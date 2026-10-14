import type { Queryable } from '../db/pool';

/** Matching waitlist — donations that found no eligible recipient even after
 *  radius expansion stay POSTED and are tracked here for retry + metrics. */
export interface WaitlistRow {
  waitlist_id: string;
  donation_id: string;
  reason: string;
  max_radius_tried_km: number;
  attempts: number;
  created_at: string;
  last_attempt_at: string;
}

export const waitlistRepository = {
  async upsert(db: Queryable, donationId: string, reason: string, maxRadiusTriedKm: number): Promise<void> {
    await db.query(
      `INSERT INTO matching_waitlist (donation_id, reason, max_radius_tried_km)
       VALUES ($1,$2,$3)
       ON CONFLICT (donation_id) DO UPDATE SET
         reason = EXCLUDED.reason,
         max_radius_tried_km = EXCLUDED.max_radius_tried_km,
         attempts = matching_waitlist.attempts + 1,
         last_attempt_at = now()`,
      [donationId, reason, maxRadiusTriedKm],
    );
  },

  async remove(db: Queryable, donationId: string): Promise<void> {
    await db.query('DELETE FROM matching_waitlist WHERE donation_id = $1', [donationId]);
  },

  async list(db: Queryable): Promise<WaitlistRow[]> {
    const r = await db.query<WaitlistRow>('SELECT * FROM matching_waitlist ORDER BY last_attempt_at DESC');
    return r.rows;
  },
};

export interface GeocacheRow {
  address: string;
  latitude: number;
  longitude: number;
  provider: string;
  created_at: string;
}

export const geocacheRepository = {
  async get(db: Queryable, normalizedAddress: string): Promise<GeocacheRow | null> {
    const r = await db.query<GeocacheRow>(
      'SELECT * FROM geocoding_cache WHERE address = $1',
      [normalizedAddress],
    );
    return r.rows[0] ?? null;
  },

  async put(
    db: Queryable,
    normalizedAddress: string,
    latitude: number,
    longitude: number,
    provider: string,
  ): Promise<void> {
    await db.query(
      `INSERT INTO geocoding_cache (address, latitude, longitude, provider)
       VALUES ($1,$2,$3,$4)
       ON CONFLICT (address) DO NOTHING`,
      [normalizedAddress, latitude, longitude, provider],
    );
  },
};
