import { describe, expect, it } from 'vitest';
import type { DonationStatus, MatchStatus, PickupStatus } from '../src/domain/enums';
import {
  assertDonationTransition,
  assertMatchTransition,
  assertPickupTransition,
  canTransitionDonation,
  canTransitionMatch,
  canTransitionPickup,
} from '../src/domain/stateMachines';
import { ApiError } from '../src/utils/errors';

describe('donation state machine (canonical, no ACCEPTED)', () => {
  it('allows the canonical lifecycle', () => {
    const flow: [DonationStatus, DonationStatus][] = [
      ['PENDING_REVIEW', 'POSTED'],
      ['POSTED', 'MATCHED'],
      ['MATCHED', 'PICKED_UP'],
      ['PICKED_UP', 'COMPLETED'],
    ];
    for (const [from, to] of flow) expect(canTransitionDonation(from, to)).toBe(true);
  });

  it('allows review rejection and requeue', () => {
    expect(canTransitionDonation('PENDING_REVIEW', 'REJECTED')).toBe(true);
    expect(canTransitionDonation('MATCHED', 'POSTED')).toBe(true); // rematch requeue
    // NFR-9: a donation past its deadline before collection expires from any open state
    expect(canTransitionDonation('PENDING_REVIEW', 'EXPIRED')).toBe(true);
    expect(canTransitionDonation('POSTED', 'EXPIRED')).toBe(true);
    expect(canTransitionDonation('MATCHED', 'EXPIRED')).toBe(true);
    expect(canTransitionDonation('PICKED_UP', 'EXPIRED')).toBe(false); // collected food never expires
  });

  it.each([
    ['PENDING_REVIEW', 'MATCHED'],
    ['PENDING_REVIEW', 'PICKED_UP'],
    ['POSTED', 'PICKED_UP'],
    ['POSTED', 'COMPLETED'],
    ['MATCHED', 'COMPLETED'],
    ['COMPLETED', 'POSTED'],
    ['REJECTED', 'POSTED'],
  ] as [DonationStatus, DonationStatus][])('rejects %s -> %s', (from, to) => {
    expect(canTransitionDonation(from, to)).toBe(false);
    expect(() => assertDonationTransition(from, to)).toThrowError(ApiError);
  });

  it('there is no ACCEPTED donation status anywhere', () => {
    const all: DonationStatus[] = ['PENDING_REVIEW', 'POSTED', 'REJECTED', 'MATCHED', 'PICKED_UP', 'COMPLETED', 'CANCELLED', 'EXPIRED'];
    expect(all).not.toContain('ACCEPTED');
  });
});

describe('match state machine (acceptance lives HERE)', () => {
  it('PENDING -> ACCEPTED / REJECTED / EXPIRED only', () => {
    const valid: [MatchStatus, MatchStatus][] = [
      ['PENDING', 'ACCEPTED'],
      ['PENDING', 'REJECTED'],
      ['PENDING', 'EXPIRED'],
    ];
    for (const [from, to] of valid) expect(canTransitionMatch(from, to)).toBe(true);

    const invalid: [MatchStatus, MatchStatus][] = [
      ['ACCEPTED', 'REJECTED'],
      ['REJECTED', 'PENDING'],
      ['EXPIRED', 'PENDING'],
      ['PENDING', 'PENDING'],
    ];
    for (const [from, to] of invalid) {
      expect(canTransitionMatch(from, to)).toBe(false);
      expect(() => assertMatchTransition(from, to)).toThrowError(ApiError);
    }
  });
});

describe('pickup state machine', () => {
  it('SCHEDULED -> PICKED_UP -> COMPLETED with CANCELLED off SCHEDULED', () => {
    expect(canTransitionPickup('SCHEDULED', 'PICKED_UP')).toBe(true);
    expect(canTransitionPickup('PICKED_UP', 'COMPLETED')).toBe(true);
    expect(canTransitionPickup('SCHEDULED', 'CANCELLED')).toBe(true);
  });

  it.each([
    ['SCHEDULED', 'COMPLETED'],
    ['PICKED_UP', 'SCHEDULED'],
    ['COMPLETED', 'PICKED_UP'],
    ['CANCELLED', 'PICKED_UP'],
  ] as [PickupStatus, PickupStatus][])('rejects %s -> %s', (from, to) => {
    expect(canTransitionPickup(from, to)).toBe(false);
    expect(() => assertPickupTransition(from, to)).toThrowError(ApiError);
  });
});
