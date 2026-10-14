import { config } from '../config';
import { setActor } from '../db/actor';
import { withTransaction, type Queryable } from '../db/pool';
import { assertDonationTransition, assertInStatus, assertMatchTransition } from '../domain/stateMachines';
import {
  runMatchingCycle,
  type MatcherRequest,
  type MatcherResponse,
} from '../matching/matcherClient';
import { donationRepository, type DonationRow } from '../repositories/donationRepository';
import { matchRepository } from '../repositories/matchRepository';
import { pickupRepository } from '../repositories/pickupRepository';
import { waitlistRepository } from '../repositories/miscRepository';
import { userRepository } from '../repositories/userRepository';
import { ApiError, conflict, forbidden, notFound } from '../utils/errors';
import { expiryService } from './expiryService';
import { notificationService } from './notificationService';

/** SRS FR-36: an offer past its response window cannot be answered, even if
 *  the expiry sweep has not run yet. Refused with 409, no state change. */
function assertOfferOpen(match: { expires_at: string | null }): void {
  if (match.expires_at && new Date(match.expires_at).getTime() <= Date.now()) {
    throw conflict('OFFER_EXPIRED', 'This offer has expired and can no longer be answered.');
  }
}

async function buildMatcherRequest(
  db: Queryable,
  donations: DonationRow[],
  strategy: 'greedy' | 'hungarian',
): Promise<MatcherRequest> {
  const recipients = await userRepository.listActiveRecipients(db);

  // Capacity already committed to PENDING match offers must count against
  // recipients, otherwise later cycles would double-book the same capacity.
  const pendingR = await db.query<{ recipient_id: string; pending: string }>(
    `SELECT m.recipient_id, SUM(d.quantity_servings)::text AS pending
       FROM matches m JOIN donations d ON d.donation_id = m.donation_id
      WHERE m.status = 'PENDING'
      GROUP BY m.recipient_id`,
  );
  const pendingByRecipient = new Map(pendingR.rows.map((r) => [r.recipient_id, Number(r.pending)]));

  // PostGIS spatial candidate retrieval (spec §9): ST_DWithin prefilters at
  // max radius, ST_Distance gives exact km for every donation-recipient pair.
  const pairDistances: MatcherRequest['pairDistances'] = [];
  if (donations.length && recipients.length) {
    const r = await db.query<{ donation_id: string; recipient_id: string; distance_km: number }>(
      `SELECT d.donation_id, r.recipient_id,
              ST_Distance(d.pickup_location, r.location) / 1000.0 AS distance_km
         FROM donations d CROSS JOIN recipient_organizations r
        WHERE d.donation_id = ANY($1)
          AND r.active = TRUE AND r.location IS NOT NULL
          AND ST_DWithin(d.pickup_location, r.location, $2 * 1000.0)`,
      [donations.map((d) => d.donation_id), config.matching.maxRadiusKm],
    );
    pairDistances.push(
      ...r.rows.map((x) => ({
        donationId: x.donation_id,
        recipientId: x.recipient_id,
        distanceKm: Number(x.distance_km),
      })),
    );
  }

  const exclusions: MatcherRequest['exclusions'] = [];
  for (const d of donations) {
    for (const recipientId of await matchRepository.rejectedRecipientIds(db, d.donation_id)) {
      exclusions.push({ donationId: d.donation_id, recipientId });
    }
  }

  return {
    donations: donations.map((d) => ({
      donationId: d.donation_id,
      foodType: d.food_type,
      quantityServings: d.quantity_servings,
      latitude: d.latitude,
      longitude: d.longitude,
      postedAt: d.posted_at,
      expiresAt: d.expires_at,
      pickupStart: d.pickup_start,
      pickupEnd: d.pickup_end,
    })),
    recipients: recipients.map((r) => ({
      recipientId: r.recipient_id,
      name: r.name ?? r.recipient_id,
      latitude: r.latitude!,
      longitude: r.longitude!,
      servingCapacity: r.serving_capacity,
      assignedServings: r.assigned_servings + (pendingByRecipient.get(r.recipient_id) ?? 0),
      serviceRadiusKm: r.service_radius_km,
      foodPreferences: r.food_preferences,
      dietaryRestrictions: r.dietary_restrictions,
      active: r.active,
    })),
    exclusions,
    pairDistances,
    config: {
      strategy,
      weights: config.matching.weights,
      initialRadiusKm: config.matching.initialRadiusKm,
      maxRadiusKm: config.matching.maxRadiusKm,
      radiusStepKm: config.matching.radiusStepKm,
      urgencyHorizonMinutes: 360,
      minPickupFeasibilityMinutes: 30,
    },
    now: new Date().toISOString(),
  };
}

/** Persist matcher output atomically: Match rows, donation transitions,
 *  waitlist entries and notifications all commit or roll back together. */
async function persistResult(
  db: Queryable,
  result: MatcherResponse,
  donationsById: Map<string, DonationRow>,
  strategy: 'greedy' | 'hungarian',
  actorId: string | null,
): Promise<string> {
  return withTransaction(db, async (tx) => {
    // SRS NFR-17: keep the matcher's per-candidate reasons for every donation
    // this run considered, so any allocation can be explained afterwards.
    const run = await tx.query<{ run_id: string }>(
      'INSERT INTO matching_runs (strategy, triggered_by) VALUES ($1, $2) RETURNING run_id',
      [strategy, actorId],
    );
    const runId = run.rows[0]!.run_id;
    for (const e of result.explanations) {
      if (!donationsById.has(e.donationId)) continue;
      await tx.query(
        `INSERT INTO match_explanations (run_id, donation_id, outcome, candidates)
         VALUES ($1, $2, $3, $4::jsonb)`,
        [runId, e.donationId, e.outcome, JSON.stringify(e.candidates)],
      );
    }

    for (const a of result.assignments) {
      const donation = donationsById.get(a.donationId);
      if (!donation || donation.status !== 'POSTED') continue; // raced; skip

      await matchRepository.create(tx, {
        donationId: a.donationId,
        recipientId: a.recipientId,
        score: a.totalScore,
        distanceKm: a.distanceKm,
        urgencyScore: a.urgencyScore,
        proximityScore: a.proximityScore,
        capacityScore: a.capacityScore,
        searchRadiusKm: a.searchRadiusKmUsed,
        offerExpiryMinutes: config.matching.offerExpiryMinutes,
        strategy,
        runId,
      });
      assertDonationTransition('POSTED', 'MATCHED');
      await donationRepository.updateStatus(tx, a.donationId, 'MATCHED', { matchedAt: true });
      await waitlistRepository.remove(tx, a.donationId);

      await notificationService.notify(
        tx, a.recipientId, 'MATCH_CREATED',
        `New match offer: ${donation.quantity_servings} servings of ${donation.food_type}, ` +
          `${a.distanceKm.toFixed(1)} km away (score ${a.totalScore.toFixed(2)}). Please accept or reject.`,
      );
      await notificationService.notify(
        tx, donation.donor_id, 'MATCH_CREATED',
        `A recipient was found for your ${donation.food_type} donation — awaiting their confirmation.`,
      );
    }

    for (const w of result.waitlisted) {
      const donation = donationsById.get(w.donationId);
      if (!donation || donation.status !== 'POSTED') continue;
      // Donation REMAINS POSTED (never silently dropped, spec §11) and is
      // tracked on the waitlist for the next cycle.
      await waitlistRepository.upsert(tx, w.donationId, w.reason, w.maxRadiusKmTried);
      await notificationService.notify(
        tx, donation.donor_id, 'DONOR_AWAITING_MATCH',
        `No eligible recipient found within ${w.maxRadiusKmTried.toFixed(0)} km yet. ` +
          'Your donation stays posted and will be retried in the next matching cycle.',
      );
    }
    return runId;
  });
}

export const matchingService = {
  /**
   * Run one greedy/hungarian matching cycle over all active POSTED donations
   * (spec §9): expire stale donations/offers first, then match most-urgent
   * first (greedy) or globally optimally (hungarian).
   */
  async runCycle(db: Queryable, strategyOverride?: 'greedy' | 'hungarian', actorId: string | null = null) {
    // The whole cycle — expiry sweep, matcher call, persistence — is one
    // transaction. If the matching service is unreachable it throws 502 and
    // everything rolls back, so no donation state changes (SRS FR-31).
    return withTransaction(db, async (tx) => {
      // Expiry first, as the system (offers that timed out requeue their
      // donation for this very cycle), then matching as the caller.
      await setActor(tx, null);
      const { expiredDonations, expiredMatches, cancelledPickups } = await expiryService.sweepWithin(tx);
      await setActor(tx, actorId);

      const strategy = strategyOverride ?? config.matching.strategy;
      const donations = await donationRepository.listMatchablePosted(tx);
      if (!donations.length) {
        return { strategy, runId: null, assignments: [], waitlisted: [], explanations: [], expiredDonations, expiredMatches, cancelledPickups };
      }

      const request = await buildMatcherRequest(tx, donations, strategy);
      const result = await runMatchingCycle(request);
      const runId = await persistResult(tx, result, new Map(donations.map((d) => [d.donation_id, d])), strategy, actorId);

      return { ...result, runId, expiredDonations, expiredMatches, cancelledPickups };
    });
  },

  /** Recipient accepts a PENDING match offer (spec §12): Match -> ACCEPTED,
   *  Pickup created (SCHEDULED). Donation stays MATCHED. */
  async acceptMatch(db: Queryable, matchId: string, recipientUserId: string) {
    return withTransaction(db, async (tx) => {
      await setActor(tx, recipientUserId);
      const match = await matchRepository.findByIdForUpdate(tx, matchId);
      if (!match) throw notFound(`Match '${matchId}' not found.`);
      if (match.recipient_id !== recipientUserId) throw forbidden('This match belongs to another recipient.');
      assertInStatus('match', match.status, ['PENDING'], 'accept');
      assertOfferOpen(match);

      const donation = await donationRepository.findByIdForUpdate(tx, match.donation_id);
      if (!donation) throw notFound('Donation for this match no longer exists.');
      assertInStatus('donation', donation.status, ['MATCHED'], 'accept match for');

      assertMatchTransition(match.status, 'ACCEPTED');
      await matchRepository.setStatus(tx, matchId, 'ACCEPTED', true);
      await userRepository.adjustAssignedServings(tx, match.recipient_id, donation.quantity_servings);

      const scheduledAt = donation.pickup_start ? new Date(donation.pickup_start) : new Date(Date.now() + 3_600_000);
      const donor = await userRepository.findById(tx, donation.donor_id);
      const recipient = await userRepository.findById(tx, match.recipient_id);
      const pickup = await pickupRepository.create(tx, {
        matchId,
        scheduledAt,
        contactDetails:
          `Donor: ${donor?.name ?? ''} (${donor?.phone ?? 'no phone'}) | ` +
          `Recipient: ${recipient?.name ?? ''} (${recipient?.phone ?? 'no phone'})` +
          (donation.pickup_address ? ` | Address: ${donation.pickup_address}` : ''),
      });

      await notificationService.notify(tx, donation.donor_id, 'MATCH_ACCEPTED', `${recipient?.name} accepted your donation match.`);
      await notificationService.notify(tx, donation.donor_id, 'PICKUP_SCHEDULED', `Pickup scheduled at ${scheduledAt.toISOString()}.`);
      await notificationService.notify(tx, match.recipient_id, 'PICKUP_SCHEDULED', `Pickup scheduled at ${scheduledAt.toISOString()}.`);

      return { match: await matchRepository.findById(tx, matchId), pickup };
    });
  },

  /** Recipient rejects a PENDING match (spec §12): Match -> REJECTED, the
   *  recipient is excluded from this donation's immediate retry, the donation
   *  returns to POSTED and a fresh single-donation matching cycle runs. */
  async rejectMatch(db: Queryable, matchId: string, recipientUserId: string, body: unknown) {
    const reason = (body as { reason?: string } | undefined)?.reason;

    const { donationId } = await withTransaction(db, async (tx) => {
      await setActor(tx, recipientUserId);
      const match = await matchRepository.findByIdForUpdate(tx, matchId);
      if (!match) throw notFound(`Match '${matchId}' not found.`);
      if (match.recipient_id !== recipientUserId) throw forbidden('This match belongs to another recipient.');
      assertInStatus('match', match.status, ['PENDING'], 'reject');
      assertOfferOpen(match);

      assertMatchTransition(match.status, 'REJECTED');
      await matchRepository.setStatus(tx, matchId, 'REJECTED', true);

      const donation = await donationRepository.findByIdForUpdate(tx, match.donation_id);
      if (!donation) throw notFound('Donation for this match no longer exists.');
      assertDonationTransition(donation.status, 'POSTED'); // MATCHED -> POSTED requeue
      await donationRepository.updateStatus(tx, match.donation_id, 'POSTED');

      await notificationService.notify(
        tx, donation.donor_id, 'MATCH_REJECTED',
        `A recipient declined the match${reason ? ` (${reason})` : ''}. Re-matching your donation now.`,
      );
      return { donationId: match.donation_id };
    });

    // Requeue matching for this donation (rejected recipient now excluded).
    // The rejection itself is already committed; if the matching service is
    // down the donation simply waits, POSTED, for the next cycle.
    let cycle: unknown = null;
    let matcherError: string | null = null;
    try {
      cycle = await this.runCycle(db);
    } catch (err) {
      if (!(err instanceof ApiError) || err.statusCode !== 502) throw err;
      matcherError = err.message;
    }
    const newMatch = (await matchRepository.listByDonation(db, donationId)).find((m) => m.status === 'PENDING') ?? null;
    return { donationId, rematched: newMatch !== null, newMatch, cycle, matcherError };
  },

  async inbox(db: Queryable, recipientUserId: string) {
    return matchRepository.inboxForRecipient(db, recipientUserId);
  },

  async getMatch(db: Queryable, matchId: string, actor: { userId: string; role: string }) {
    const match = await matchRepository.findById(db, matchId);
    if (!match) throw notFound(`Match '${matchId}' not found.`);
    if (actor.role === 'RECIPIENT' && match.recipient_id !== actor.userId) {
      throw forbidden('This match belongs to another recipient.');
    }
    if (actor.role === 'DONOR') {
      const donation = await donationRepository.findById(db, match.donation_id);
      if (donation?.donor_id !== actor.userId) throw forbidden('This match is for another donor\'s donation.');
    }
    return match;
  },

  async waitlist(db: Queryable) {
    return waitlistRepository.list(db);
  },
};
