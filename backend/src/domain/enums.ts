/**
 * FoodBridge domain enums — aligned with the UML class diagram.
 *
 * IMPORTANT: there is deliberately NO DonationStatus.ACCEPTED.
 * Acceptance is a property of a Match (MatchStatus.ACCEPTED), not a Donation.
 */

export const USER_ROLES = ['DONOR', 'RECIPIENT', 'ADMIN'] as const;
export type UserRole = (typeof USER_ROLES)[number];

export const DONOR_TYPES = [
  'RESTAURANT',
  'HOSTEL',
  'MESS',
  'CATERER',
  'EVENT_ORGANIZER',
  'HOUSEHOLD',
] as const;
export type DonorType = (typeof DONOR_TYPES)[number];

export const ORGANIZATION_TYPES = [
  'NGO',
  'SHELTER',
  'COMMUNITY_KITCHEN',
  'ORPHANAGE',
  'OLD_AGE_HOME',
  'FOOD_BANK',
] as const;
export type OrganizationType = (typeof ORGANIZATION_TYPES)[number];

export const DONATION_STATUSES = [
  'PENDING_REVIEW',
  'POSTED',
  'REJECTED',
  'MATCHED',
  'PICKED_UP',
  'COMPLETED',
  'CANCELLED',
  'EXPIRED',
] as const;
export type DonationStatus = (typeof DONATION_STATUSES)[number];

export const MATCH_STATUSES = ['PENDING', 'ACCEPTED', 'REJECTED', 'EXPIRED'] as const;
export type MatchStatus = (typeof MATCH_STATUSES)[number];

export const PICKUP_STATUSES = ['SCHEDULED', 'PICKED_UP', 'COMPLETED', 'CANCELLED'] as const;
export type PickupStatus = (typeof PICKUP_STATUSES)[number];

export const REVIEW_DECISIONS = ['PENDING', 'APPROVED', 'REJECTED'] as const;
export type ReviewDecision = (typeof REVIEW_DECISIONS)[number];

export const NOTIFICATION_TYPES = [
  'ADMIN_REVIEW_REQUIRED',
  'DONATION_APPROVED',
  'DONATION_REJECTED',
  'NEW_ELIGIBLE_DONATION',
  'MATCH_CREATED',
  'MATCH_ACCEPTED',
  'MATCH_REJECTED',
  'DONOR_AWAITING_MATCH',
  'PICKUP_SCHEDULED',
  'PICKUP_PICKED_UP',
  'REDISTRIBUTION_COMPLETED',
  'MATCH_EXPIRED',
  'DONATION_CANCELLED',
  'DONATION_EXPIRED',
  'PICKUP_CANCELLED',
] as const;
export type NotificationType = (typeof NOTIFICATION_TYPES)[number];
