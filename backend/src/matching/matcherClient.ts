import { config } from '../config';
import { ApiError } from '../utils/errors';

/**
 * Node <-> Python integration (spec §9).
 *
 * The Python matching engine is a standalone local FastAPI service
 * (matching-service/app.py). The backend POSTs one JSON document to
 * POST {MATCHER_URL}/match/run and receives assignments/waitlist/explanations.
 * Distances are precomputed with PostGIS (ST_Distance) by the backend and
 * passed along, so the service scores on real spatial data; it can also fall
 * back to its own haversine when distanceKm is absent (pure-Python tests).
 */

export interface MatcherDonation {
  donationId: string;
  foodType: string;
  quantityServings: number;
  latitude: number;
  longitude: number;
  postedAt: string | null;
  expiresAt: string;
  pickupStart: string | null;
  pickupEnd: string | null;
}

export interface MatcherRecipient {
  recipientId: string;
  name: string;
  latitude: number;
  longitude: number;
  servingCapacity: number;
  assignedServings: number;
  serviceRadiusKm: number;
  foodPreferences: string[];
  dietaryRestrictions: string[];
  active: boolean;
}

export interface MatcherPairDistance {
  donationId: string;
  recipientId: string;
  distanceKm: number; // computed by PostGIS ST_Distance
}

export interface MatcherRequest {
  donations: MatcherDonation[];
  recipients: MatcherRecipient[];
  exclusions: { donationId: string; recipientId: string }[];
  pairDistances: MatcherPairDistance[];
  config: {
    strategy: 'greedy' | 'hungarian';
    weights: { urgency: number; proximity: number; capacity: number };
    initialRadiusKm: number;
    maxRadiusKm: number;
    radiusStepKm: number;
    urgencyHorizonMinutes: number;
    minPickupFeasibilityMinutes: number;
  };
  now: string;
}

export interface Assignment {
  donationId: string;
  recipientId: string;
  totalScore: number;
  urgencyScore: number;
  proximityScore: number;
  capacityScore: number;
  distanceKm: number;
  searchRadiusKmUsed: number;
}

export interface Waitlisted {
  donationId: string;
  reason: string;
  maxRadiusKmTried: number;
}

export interface MatcherResponse {
  strategy: string;
  assignments: Assignment[];
  waitlisted: Waitlisted[];
  explanations: {
    donationId: string;
    outcome: 'MATCHED' | 'WAITLISTED';
    candidates: {
      recipientId: string;
      eligible: boolean;
      reasons: string[];
      totalScore?: number;
      proximityScore?: number;
      capacityScore?: number;
      distanceKm?: number;
    }[];
  }[];
}

export async function runMatchingCycle(payload: MatcherRequest): Promise<MatcherResponse> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), config.matcherTimeoutMs);
  try {
    const res = await fetch(`${config.matcherUrl}/match/run`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload),
      signal: controller.signal,
    });
    if (!res.ok) {
      const text = await res.text();
      throw new ApiError(502, 'MATCHER_FAILED', `Matching service returned HTTP ${res.status}: ${text.slice(0, 300)}`);
    }
    return (await res.json()) as MatcherResponse;
  } catch (err) {
    if (err instanceof ApiError) throw err;
    throw new ApiError(
      502,
      'MATCHER_UNREACHABLE',
      `Could not reach the Python matching service at ${config.matcherUrl}. Start it with: cd matching-service && .venv/bin/uvicorn app:app --port 8000`,
    );
  } finally {
    clearTimeout(timer);
  }
}
