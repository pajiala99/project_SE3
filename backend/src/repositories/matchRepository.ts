import type { Queryable } from '../db/pool';
import type { MatchStatus } from '../domain/enums';

export interface MatchRow {
  match_id: string;
  donation_id: string;
  recipient_id: string;
  recipient_name?: string;
  score: number;
  distance_km: number;
  urgency_score: number;
  proximity_score: number;
  capacity_score: number;
  status: MatchStatus;
  search_radius_km: number | null;
  expires_at: string | null;
  created_at: string;
  responded_at: string | null;
  strategy?: 'greedy' | 'hungarian' | null;
  run_id?: string | null;
}

export interface InboxRow extends MatchRow {
  donation: {
    donation_id: string;
    food_type: string;
    description: string | null;
    quantity_servings: number;
    pickup_address: string | null;
    pickup_start: string | null;
    pickup_end: string | null;
    expires_at: string;
    status: string;
    donor_name: string;
  };
}

const SELECT = `
  SELECT m.*, u.name AS recipient_name
    FROM matches m
    JOIN users u ON u.user_id = m.recipient_id`;

export const matchRepository = {
  async create(
    db: Queryable,
    m: {
      donationId: string; recipientId: string; score: number; distanceKm: number;
      urgencyScore: number; proximityScore: number; capacityScore: number;
      searchRadiusKm?: number; offerExpiryMinutes: number;
      strategy?: 'greedy' | 'hungarian'; runId?: string;
    },
  ): Promise<MatchRow> {
    const r = await db.query<MatchRow>(
      `INSERT INTO matches
         (donation_id, recipient_id, score, distance_km, urgency_score,
          proximity_score, capacity_score, search_radius_km, expires_at, strategy, run_id)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8, now() + ($9 || ' minutes')::interval, $10, $11)
       RETURNING *`,
      [m.donationId, m.recipientId, m.score, m.distanceKm, m.urgencyScore,
       m.proximityScore, m.capacityScore, m.searchRadiusKm ?? null, String(m.offerExpiryMinutes),
       m.strategy ?? null, m.runId ?? null],
    );
    return r.rows[0]!;
  },

  async findById(db: Queryable, matchId: string): Promise<MatchRow | null> {
    const r = await db.query<MatchRow>(`${SELECT} WHERE m.match_id = $1`, [matchId]);
    return r.rows[0] ?? null;
  },

  async findByIdForUpdate(db: Queryable, matchId: string): Promise<MatchRow | null> {
    const r = await db.query<MatchRow>(
      'SELECT * FROM matches WHERE match_id = $1 FOR UPDATE',
      [matchId],
    );
    return r.rows[0] ?? null;
  },

  async listByRecipient(db: Queryable, recipientId: string): Promise<MatchRow[]> {
    const r = await db.query<MatchRow>(
      `${SELECT} WHERE m.recipient_id = $1 ORDER BY m.created_at DESC`,
      [recipientId],
    );
    return r.rows;
  },

  /**
   * Recipient inbox: each offer carries the donation it is for, nested under
   * `donation` with the same field names as GET /donations/:id, so the inbox
   * can render what the food is without one extra request per offer.
   */
  async inboxForRecipient(db: Queryable, recipientId: string): Promise<InboxRow[]> {
    const r = await db.query<InboxRow>(
      `SELECT m.*, ru.name AS recipient_name,
              json_build_object(
                'donation_id',       d.donation_id,
                'food_type',         d.food_type,
                'description',       d.description,
                'quantity_servings', d.quantity_servings,
                'pickup_address',    d.pickup_address,
                'pickup_start',      d.pickup_start,
                'pickup_end',        d.pickup_end,
                'expires_at',        d.expires_at,
                'status',            d.status,
                'donor_name',        du.name
              ) AS donation
         FROM matches m
         JOIN users ru     ON ru.user_id = m.recipient_id
         JOIN donations d  ON d.donation_id = m.donation_id
         JOIN users du     ON du.user_id = d.donor_id
        WHERE m.recipient_id = $1
        ORDER BY m.created_at DESC`,
      [recipientId],
    );
    return r.rows;
  },

  async listByDonation(db: Queryable, donationId: string): Promise<MatchRow[]> {
    const r = await db.query<MatchRow>(
      `${SELECT} WHERE m.donation_id = $1 ORDER BY m.created_at DESC`,
      [donationId],
    );
    return r.rows;
  },

  async listAll(db: Queryable): Promise<MatchRow[]> {
    const r = await db.query<MatchRow>(`${SELECT} ORDER BY m.created_at DESC`);
    return r.rows;
  },

  async setStatus(
    db: Queryable,
    matchId: string,
    status: MatchStatus,
    responded = false,
  ): Promise<void> {
    await db.query(
      `UPDATE matches SET status = $2,
         responded_at = CASE WHEN $3 THEN now() ELSE responded_at END
       WHERE match_id = $1`,
      [matchId, status, responded],
    );
  },

  /** Recipients that rejected this donation — excluded from its immediate retry. */
  async rejectedRecipientIds(db: Queryable, donationId: string): Promise<string[]> {
    const r = await db.query<{ recipient_id: string }>(
      `SELECT recipient_id FROM matches WHERE donation_id = $1 AND status = 'REJECTED'`,
      [donationId],
    );
    return r.rows.map((x) => x.recipient_id);
  },

  /** PENDING offers past their expiry — for the match-expiry sweep. */
  async expireStalePending(db: Queryable): Promise<{ match_id: string; donation_id: string; recipient_id: string }[]> {
    const r = await db.query<{ match_id: string; donation_id: string; recipient_id: string }>(
      `UPDATE matches SET status = 'EXPIRED'
       WHERE status = 'PENDING' AND expires_at IS NOT NULL AND expires_at <= now()
       RETURNING match_id, donation_id, recipient_id`,
    );
    return r.rows;
  },

  async hasPendingForDonation(db: Queryable, donationId: string): Promise<boolean> {
    const r = await db.query(
      `SELECT 1 FROM matches WHERE donation_id = $1 AND status = 'PENDING' LIMIT 1`,
      [donationId],
    );
    return (r.rowCount ?? 0) > 0;
  },
};
