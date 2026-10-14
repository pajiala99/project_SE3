/**
 * Central configuration. Everything is overridable via environment variables;
 * defaults target the local academic demo (Postgres.app / docker compose).
 */
export const config = {
  port: Number(process.env.PORT ?? 3000),

  databaseUrl:
    process.env.DATABASE_URL ?? 'postgres://foodbridge:foodbridge@localhost:5432/foodbridge',

  jwtSecret: process.env.JWT_SECRET ?? 'foodbridge-dev-secret-not-for-production',
  jwtExpiresIn: process.env.JWT_EXPIRES_IN ?? '4h',
  bcryptRounds: 10,

  /** Python matching service (FastAPI) base URL. */
  matcherUrl: process.env.MATCHER_URL ?? 'http://localhost:8000',
  matcherTimeoutMs: Number(process.env.MATCHER_TIMEOUT_MS ?? 20_000),

  /** SRS FR-52: seconds between scheduled expiry sweeps; 0 disables. */
  sweepIntervalSeconds: Number(process.env.SWEEP_INTERVAL_SECONDS ?? 60),

  matching: {
    /** 'greedy' (default, mid-semester demo) or 'hungarian'. */
    strategy: (process.env.MATCHING_STRATEGY ?? 'greedy') as 'greedy' | 'hungarian',
    initialRadiusKm: Number(process.env.MATCH_INITIAL_RADIUS_KM ?? 5),
    maxRadiusKm: Number(process.env.MATCH_MAX_RADIUS_KM ?? 25),
    radiusStepKm: Number(process.env.MATCH_RADIUS_STEP_KM ?? 5),
    /** A PENDING match offer expires after this many minutes. */
    offerExpiryMinutes: Number(process.env.MATCH_OFFER_EXPIRY_MINUTES ?? 30),
    /**
     * Score weights (SRS FR-23/FR-24): configuration, not embedded logic.
     * Engineering parameters documented in docs/MATCHING_ALGORITHM.md — not tuned optima.
     */
    weights: {
      urgency: Number(process.env.MATCH_WEIGHT_URGENCY ?? 0.4),
      proximity: Number(process.env.MATCH_WEIGHT_PROXIMITY ?? 0.35),
      capacity: Number(process.env.MATCH_WEIGHT_CAPACITY ?? 0.25),
    },
  },

  geocoding: {
    /** 'nominatim' uses OpenStreetMap (needs network); 'off' = coordinates only. */
    provider: (process.env.GEOCODING_PROVIDER ?? 'nominatim') as 'nominatim' | 'off',
    userAgent: 'FoodBridge academic project (local development demo)',
    /** Nominatim usage policy: max 1 request/second. */
    minIntervalMs: 1100,
  },
} as const;

// SRS NFR-15: never run production on the development signing secret.
if (process.env.NODE_ENV === 'production' && !process.env.JWT_SECRET) {
  throw new Error('JWT_SECRET must be set when NODE_ENV=production (SRS NFR-15).');
}
