import type { Queryable } from '../db/pool';
import { ratingRepository } from '../repositories/ratingRepository';
import { badRequest } from '../utils/errors';

/**
 * Impact service (spec §15, §26). Every metric is computed from persisted
 * timestamps/rows — nothing is faked.
 *
 * ASSUMPTION (documented, not a measured fact): the domain model stores
 * servings, not weight. We convert with WASTE_KG_PER_SERVING = 0.45 kg,
 * a common planning figure (~450 g per prepared meal). Override via env.
 */

const WASTE_KG_PER_SERVING = Number(process.env.WASTE_KG_PER_SERVING ?? 0.45);

/** Proposal target for median time-to-match, shown against the trend. */
const TTM_TARGET_SECONDS = 20 * 60;

/**
 * Time-to-Match, as defined in the proposal and SRS FR-46: from the donation's
 * submission (submitted_at) to the response time (responded_at) of its first
 * ACCEPTED offer. Both timestamps are written by the system. One row per
 * donation that has at least one accepted offer.
 */
const TTM_ROWS = `
  SELECT d.donation_id, d.submitted_at,
         EXTRACT(EPOCH FROM (MIN(m.responded_at) - d.submitted_at)) AS secs
    FROM donations d
    JOIN matches m ON m.donation_id = d.donation_id
                  AND m.status = 'ACCEPTED' AND m.responded_at IS NOT NULL
   GROUP BY d.donation_id, d.submitted_at`;

const TTM_BUCKETS = ['day', 'week'] as const;
type TtmBucket = (typeof TTM_BUCKETS)[number];

export const impactService = {
  /**
   * Time-to-match trend (FR-46 definition), grouped by the day (or week) the
   * donation was submitted. Lets the dashboard show whether TTM is
   * improving, not just its current value.
   */
  async ttmSeries(db: Queryable, query: { bucket?: unknown; days?: unknown }) {
    const bucket = (query.bucket ?? 'day') as TtmBucket;
    if (!TTM_BUCKETS.includes(bucket)) {
      throw badRequest(`'bucket' must be one of: ${TTM_BUCKETS.join(', ')}.`);
    }
    const days = query.days === undefined ? 30 : Number(query.days);
    if (!Number.isInteger(days) || days < 1 || days > 365) {
      throw badRequest("'days' must be an integer between 1 and 365.");
    }

    const r = await db.query<{ bucket: string; median_seconds: number; avg_seconds: number; n: string }>(
      `SELECT to_char(date_trunc($1, t.submitted_at), 'YYYY-MM-DD') AS bucket,
              percentile_cont(0.5) WITHIN GROUP (ORDER BY t.secs) AS median_seconds,
              AVG(t.secs) AS avg_seconds,
              COUNT(*)::text AS n
         FROM (${TTM_ROWS}) t
        WHERE t.submitted_at >= now() - ($2 || ' days')::interval
        GROUP BY 1
        ORDER BY 1`,
      [bucket, String(days)],
    );

    return {
      bucket,
      days,
      targetSeconds: TTM_TARGET_SECONDS,
      points: r.rows.map((x) => ({
        bucket: x.bucket,
        medianSeconds: Math.round(Number(x.median_seconds)),
        avgSeconds: Math.round(Number(x.avg_seconds)),
        n: Number(x.n),
      })),
    };
  },

  async summary(db: Queryable) {
    const completed = await db.query<{ meals: string; count: string }>(
      `SELECT COALESCE(SUM(quantity_servings),0)::text AS meals, COUNT(*)::text AS count
       FROM donations WHERE status = 'COMPLETED'`,
    );

    // Time-to-Match (primary proposal metric, FR-46): submission -> first
    // accepted offer, only for donations that reached an accepted offer.
    const ttm = await db.query<{ avg_seconds: number | null; median_seconds: number | null; samples: string }>(
      `SELECT AVG(t.secs) AS avg_seconds,
              percentile_cont(0.5) WITHIN GROUP (ORDER BY t.secs) AS median_seconds,
              COUNT(*)::text AS samples
         FROM (${TTM_ROWS}) t`,
    );

    const unmatched = await db.query<{ count: string }>(
      `SELECT COUNT(*)::text AS count FROM donations WHERE status = 'POSTED'`,
    );
    const reviewed = await db.query<{ count: string }>(
      `SELECT COUNT(*)::text AS count FROM donations
       WHERE status IN ('POSTED','MATCHED','PICKED_UP','COMPLETED','EXPIRED')`,
    );
    const expired = await db.query<{ count: string }>(
      `SELECT COUNT(*)::text AS count FROM donations WHERE status = 'EXPIRED'`,
    );
    const waitlisted = await db.query<{ count: string }>(
      `SELECT COUNT(*)::text AS count FROM matching_waitlist`,
    );

    const topDonors = await db.query<{ donor_id: string; name: string; meals: string; donations: string }>(
      `SELECT d.donor_id, u.name,
              SUM(d.quantity_servings)::text AS meals, COUNT(*)::text AS donations
       FROM donations d JOIN users u ON u.user_id = d.donor_id
       WHERE d.status = 'COMPLETED'
       GROUP BY d.donor_id, u.name
       ORDER BY SUM(d.quantity_servings) DESC
       LIMIT 5`,
    );

    // Rescue rate (FR-45, proposal outcome metric): of posted donations whose
    // outcome is settled (COMPLETED or EXPIRED), the share completed before
    // their deadline. Donations still in progress, and ones the donor
    // cancelled, are not counted either way.
    const rescue = await db.query<{ rescued: string; resolved: string }>(
      `SELECT COUNT(*) FILTER (WHERE d.status = 'COMPLETED' AND p.completed_at <= d.expires_at)::text AS rescued,
              COUNT(*) FILTER (WHERE d.status IN ('COMPLETED', 'EXPIRED'))::text AS resolved
         FROM donations d
         LEFT JOIN LATERAL (
           SELECT MAX(pk.completed_at) AS completed_at
             FROM pickups pk JOIN matches m ON m.match_id = pk.match_id
            WHERE m.donation_id = d.donation_id
         ) p ON TRUE
        WHERE d.posted_at IS NOT NULL`,
    );

    // First-offer acceptance rate (FR-48): of each donation's first offer that
    // has been answered or timed out, the share accepted. A low rate means the
    // scoring ranks poorly.
    const firstOffers = await db.query<{ accepted: string; decided: string }>(
      `WITH first AS (
         SELECT DISTINCT ON (donation_id) status
           FROM matches ORDER BY donation_id, created_at, match_id)
       SELECT COUNT(*) FILTER (WHERE status = 'ACCEPTED')::text AS accepted,
              COUNT(*) FILTER (WHERE status IN ('ACCEPTED', 'REJECTED', 'EXPIRED'))::text AS decided
         FROM first`,
    );

    // Mean donor-to-recipient distance per allocation strategy (FR-48).
    const distance = await db.query<{ strategy: string; mean_km: number; offers: string }>(
      `SELECT strategy, AVG(distance_km) AS mean_km, COUNT(*)::text AS offers
         FROM matches WHERE strategy IS NOT NULL AND distance_km IS NOT NULL
        GROUP BY strategy`,
    );
    const distanceFor = (s: string) => {
      const row = distance.rows.find((x) => x.strategy === s);
      return row ? { meanKm: Math.round(Number(row.mean_km) * 100) / 100, offers: Number(row.offers) } : { meanKm: null, offers: 0 };
    };
    const ratio = (num: number, den: number) => (den === 0 ? null : Math.round((num / den) * 1000) / 1000);

    const ratings = await ratingRepository.summary(db);
    const clarityFor = (role: string) => {
      const row = ratings.find((x) => x.role === role);
      return row ? { avg: Math.round(row.avg * 100) / 100, n: row.n } : { avg: null, n: 0 };
    };

    const mealsRedistributed = Number(completed.rows[0]!.meals);
    const reviewedCount = Number(reviewed.rows[0]!.count);
    const unmatchedCount = Number(unmatched.rows[0]!.count);

    return {
      mealsRedistributed, // completed redistributions only
      completedDonations: Number(completed.rows[0]!.count),
      wasteDivertedKg: Math.round(mealsRedistributed * WASTE_KG_PER_SERVING * 100) / 100,
      wasteAssumptionKgPerServing: WASTE_KG_PER_SERVING,
      timeToMatch: {
        avgSeconds: ttm.rows[0]!.avg_seconds === null ? null : Math.round(Number(ttm.rows[0]!.avg_seconds)),
        medianSeconds: ttm.rows[0]!.median_seconds === null ? null : Math.round(Number(ttm.rows[0]!.median_seconds)),
        samples: Number(ttm.rows[0]!.samples),
      },
      unmatchedCount,
      unmatchedRate: reviewedCount === 0 ? 0 : Math.round((unmatchedCount / reviewedCount) * 1000) / 1000,
      waitlistedCount: Number(waitlisted.rows[0]!.count),
      expiredCount: Number(expired.rows[0]!.count),
      statusClarity: { donor: clarityFor('DONOR'), recipient: clarityFor('RECIPIENT') },
      rescueRate: {
        rate: ratio(Number(rescue.rows[0]!.rescued), Number(rescue.rows[0]!.resolved)),
        rescued: Number(rescue.rows[0]!.rescued),
        resolved: Number(rescue.rows[0]!.resolved),
      },
      firstOfferAcceptance: {
        rate: ratio(Number(firstOffers.rows[0]!.accepted), Number(firstOffers.rows[0]!.decided)),
        accepted: Number(firstOffers.rows[0]!.accepted),
        decided: Number(firstOffers.rows[0]!.decided),
      },
      meanDistanceKmByStrategy: { greedy: distanceFor('greedy'), hungarian: distanceFor('hungarian') },
      topDonors: topDonors.rows.map((r) => ({
        donorId: r.donor_id, name: r.name, meals: Number(r.meals), donations: Number(r.donations),
      })),
    };
  },
};
