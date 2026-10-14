import { setActor } from '../db/actor';
import { withTransaction, type Queryable } from '../db/pool';
import type { DonationStatus } from '../domain/enums';
import { assertDonationTransition } from '../domain/stateMachines';
import { donationRepository } from '../repositories/donationRepository';
import { matchRepository } from '../repositories/matchRepository';
import { waitlistRepository } from '../repositories/miscRepository';
import { pickupRepository } from '../repositories/pickupRepository';
import { userRepository } from '../repositories/userRepository';
import { notificationService } from './notificationService';

export interface ExpiredMatch {
  match_id: string;
  donation_id: string;
  recipient_id: string;
}

export interface SweepResult {
  /** Donations whose deadline passed before collection (now EXPIRED). */
  expiredDonations: string[];
  /** Offers that expired, either unanswered in time or because their donation expired. */
  expiredMatches: ExpiredMatch[];
  /** Scheduled pickups cancelled because the donation expired before collection. */
  cancelledPickups: string[];
}

/**
 * Expiry rules (SRS FR-35, FR-52, NFR-9). Must run inside a transaction.
 *
 * 1. A donation whose deadline has passed before it was collected becomes
 *    EXPIRED — whether it was awaiting review, posted, or matched. Any open
 *    offer on it expires, a scheduled pickup is cancelled, the organisation's
 *    reserved capacity is released, and both parties are told.
 * 2. An offer left unanswered past its response window expires and its
 *    donation returns to POSTED to be offered to someone else.
 */
async function sweepWithin(tx: Queryable): Promise<SweepResult> {
  const expiredDonations: string[] = [];
  const expiredMatches: ExpiredMatch[] = [];
  const cancelledPickups: string[] = [];

  // ---- 1. donations past their deadline
  const due = await tx.query<{
    donation_id: string; donor_id: string; status: DonationStatus;
    food_type: string; quantity_servings: number;
  }>(
    `SELECT donation_id, donor_id, status, food_type, quantity_servings
       FROM donations
      WHERE status IN ('PENDING_REVIEW', 'POSTED', 'MATCHED') AND expires_at <= now()
      ORDER BY expires_at
      FOR UPDATE`,
  );

  for (const d of due.rows) {
    const what = `${d.quantity_servings} servings of ${d.food_type}`;

    if (d.status === 'MATCHED') {
      const open = await tx.query<ExpiredMatch>(
        `UPDATE matches SET status = 'EXPIRED'
          WHERE donation_id = $1 AND status = 'PENDING'
          RETURNING match_id, donation_id, recipient_id`,
        [d.donation_id],
      );
      for (const m of open.rows) {
        expiredMatches.push(m);
        await notificationService.notify(tx, m.recipient_id, 'MATCH_EXPIRED',
          `The offer of ${what} expired: the donation passed its deadline.`);
      }

      const scheduled = await tx.query<{ pickup_id: string; recipient_id: string }>(
        `SELECT p.pickup_id, m.recipient_id
           FROM pickups p JOIN matches m ON m.match_id = p.match_id
          WHERE m.donation_id = $1 AND m.status = 'ACCEPTED' AND p.status = 'SCHEDULED'
          FOR UPDATE OF p`,
        [d.donation_id],
      );
      for (const p of scheduled.rows) {
        await pickupRepository.setStatus(tx, p.pickup_id, 'CANCELLED');
        await userRepository.adjustAssignedServings(tx, p.recipient_id, -d.quantity_servings);
        cancelledPickups.push(p.pickup_id);
        await notificationService.notify(tx, p.recipient_id, 'PICKUP_CANCELLED',
          `Pickup of ${what} was cancelled: the donation passed its deadline before collection.`);
      }
    }

    assertDonationTransition(d.status, 'EXPIRED');
    await donationRepository.updateStatus(tx, d.donation_id, 'EXPIRED');
    await waitlistRepository.remove(tx, d.donation_id);
    expiredDonations.push(d.donation_id);
    await notificationService.notify(tx, d.donor_id, 'DONATION_EXPIRED',
      `Your donation of ${what} reached its deadline before it was collected and has expired.`);
  }

  // ---- 2. offers unanswered past their response window
  const stale = await matchRepository.expireStalePending(tx);
  for (const m of stale) {
    expiredMatches.push(m);
    const donation = await donationRepository.findByIdForUpdate(tx, m.donation_id);
    if (!donation) continue;
    if (donation.status === 'MATCHED') {
      assertDonationTransition('MATCHED', 'POSTED');
      await donationRepository.updateStatus(tx, m.donation_id, 'POSTED');
    }
    await notificationService.notify(tx, m.recipient_id, 'MATCH_EXPIRED',
      'A match offer expired before a response.');
    await notificationService.notify(tx, donation.donor_id, 'MATCH_EXPIRED',
      `An organisation did not respond in time to your ${donation.food_type} donation; it will be offered to another.`);
  }

  return { expiredDonations, expiredMatches, cancelledPickups };
}

export const expiryService = {
  sweepWithin,

  /** Run the expiry rules as the system, in their own transaction. */
  async sweep(db: Queryable): Promise<SweepResult> {
    return withTransaction(db, async (tx) => {
      await setActor(tx, null);
      return sweepWithin(tx);
    });
  },
};
