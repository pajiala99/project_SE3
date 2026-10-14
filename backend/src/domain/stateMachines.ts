import { ApiError } from '../utils/errors';
import type { DonationStatus, MatchStatus, PickupStatus } from './enums';

/**
 * Central state machines — the ONLY place legal transitions are defined.
 * Controllers/services must never scatter status checks; they call
 * assertDonationTransition / assertMatchTransition / assertPickupTransition.
 *
 * Donation lifecycle (spec §6):
 *
 *   PENDING_REVIEW --admin approval--> POSTED --match found--> MATCHED
 *   MATCHED --pickup--> PICKED_UP --completion--> COMPLETED
 *   Side states: REJECTED (admin), CANCELLED (donor, pre-pickup), EXPIRED
 *   (deadline passed before collection — from PENDING_REVIEW, POSTED or
 *   MATCHED; SRS NFR-9).
 *   MATCHED --> POSTED is the requeue path when the recipient rejects a match
 *   or the match offer expires (the Match row keeps the audit trail).
 */

const DONATION_TRANSITIONS: Readonly<Record<DonationStatus, readonly DonationStatus[]>> = {
  PENDING_REVIEW: ['POSTED', 'REJECTED', 'CANCELLED', 'EXPIRED'],
  POSTED: ['MATCHED', 'CANCELLED', 'EXPIRED'],
  MATCHED: ['PICKED_UP', 'POSTED', 'CANCELLED', 'EXPIRED'],
  PICKED_UP: ['COMPLETED'],
  COMPLETED: [],
  REJECTED: [],
  CANCELLED: [],
  EXPIRED: [],
};

const MATCH_TRANSITIONS: Readonly<Record<MatchStatus, readonly MatchStatus[]>> = {
  PENDING: ['ACCEPTED', 'REJECTED', 'EXPIRED'],
  ACCEPTED: [],
  REJECTED: [],
  EXPIRED: [],
};

const PICKUP_TRANSITIONS: Readonly<Record<PickupStatus, readonly PickupStatus[]>> = {
  SCHEDULED: ['PICKED_UP', 'CANCELLED'],
  PICKED_UP: ['COMPLETED'],
  COMPLETED: [],
  CANCELLED: [],
};

function assertLegal(
  machine: Record<string, readonly string[]>,
  entity: string,
  from: string,
  to: string,
): void {
  if (!machine[from]?.includes(to)) {
    throw new ApiError(
      409,
      'INVALID_TRANSITION',
      `Invalid ${entity} transition: ${from} -> ${to}. ` +
        `Allowed from ${from}: ${machine[from]?.join(', ') || '(none — terminal state)'}.`,
      { from, to },
    );
  }
}

export const canTransitionDonation = (from: DonationStatus, to: DonationStatus): boolean =>
  DONATION_TRANSITIONS[from].includes(to);
export const canTransitionMatch = (from: MatchStatus, to: MatchStatus): boolean =>
  MATCH_TRANSITIONS[from].includes(to);
export const canTransitionPickup = (from: PickupStatus, to: PickupStatus): boolean =>
  PICKUP_TRANSITIONS[from].includes(to);

export const assertDonationTransition = (from: DonationStatus, to: DonationStatus): void =>
  assertLegal(DONATION_TRANSITIONS, 'donation', from, to);
export const assertMatchTransition = (from: MatchStatus, to: MatchStatus): void =>
  assertLegal(MATCH_TRANSITIONS, 'match', from, to);
export const assertPickupTransition = (from: PickupStatus, to: PickupStatus): void =>
  assertLegal(PICKUP_TRANSITIONS, 'pickup', from, to);

/** Guard used by endpoints: action requires the entity to be in one of `expected`. */
export function assertInStatus<S extends string>(
  entity: string,
  current: S,
  expected: readonly S[],
  action: string,
): void {
  if (!expected.includes(current)) {
    throw new ApiError(
      409,
      'INVALID_STATE',
      `Cannot ${action}: ${entity} is ${current}, required: ${expected.join(' or ')}.`,
      { current, required: expected },
    );
  }
}
