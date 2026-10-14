import type { Queryable } from '../db/pool';
import type { DonationStatus } from '../domain/enums';

export interface DonationRow {
  donation_id: string;
  donor_id: string;
  donor_name?: string;
  food_type: string;
  description: string | null;
  quantity_servings: number;
  pickup_address: string | null;
  latitude: number;
  longitude: number;
  submitted_at: string;
  posted_at: string | null;
  matched_at: string | null;
  pickup_start: string | null;
  pickup_end: string | null;
  expires_at: string;
  status: DonationStatus;
  created_at: string;
  updated_at: string;
}

const SELECT = `
  SELECT d.donation_id, d.donor_id, u.name AS donor_name, d.food_type, d.description,
         d.quantity_servings, d.pickup_address,
         ST_Y(d.pickup_location::geometry) AS latitude,
         ST_X(d.pickup_location::geometry) AS longitude,
         d.submitted_at, d.posted_at, d.matched_at, d.pickup_start, d.pickup_end,
         d.expires_at, d.status, d.created_at, d.updated_at
    FROM donations d JOIN users u ON u.user_id = d.donor_id`;

export const donationRepository = {
  async create(
    db: Queryable,
    d: {
      donorId: string; foodType: string; description?: string; quantityServings: number;
      pickupAddress?: string; latitude: number; longitude: number;
      pickupStart?: Date; pickupEnd?: Date; expiresAt: Date;
    },
  ): Promise<DonationRow> {
    const r = await db.query<DonationRow>(
      `INSERT INTO donations
         (donor_id, food_type, description, quantity_servings, pickup_address,
          pickup_location, pickup_start, pickup_end, expires_at, status)
       VALUES ($1,$2,$3,$4,$5,
         ST_SetSRID(ST_MakePoint($7, $6), 4326)::geography, $8, $9, $10, 'PENDING_REVIEW')
       RETURNING donation_id`,
      [d.donorId, d.foodType, d.description ?? null, d.quantityServings, d.pickupAddress ?? null,
       d.latitude, d.longitude, d.pickupStart ?? null, d.pickupEnd ?? null, d.expiresAt],
    );
    return (await this.findById(db, r.rows[0]!.donation_id as string))!;
  },

  async findById(db: Queryable, donationId: string): Promise<DonationRow | null> {
    const r = await db.query<DonationRow>(`${SELECT} WHERE d.donation_id = $1`, [donationId]);
    return r.rows[0] ?? null;
  },

  /** Row lock for review/transition consistency (spec §7). */
  async findByIdForUpdate(db: Queryable, donationId: string): Promise<DonationRow | null> {
    const r = await db.query<DonationRow>(
      `SELECT d.*, ST_Y(d.pickup_location::geometry) AS latitude,
              ST_X(d.pickup_location::geometry) AS longitude
       FROM donations d WHERE d.donation_id = $1 FOR UPDATE`,
      [donationId],
    );
    return r.rows[0] ?? null;
  },

  async listByDonor(db: Queryable, donorId: string): Promise<DonationRow[]> {
    const r = await db.query<DonationRow>(`${SELECT} WHERE d.donor_id = $1 ORDER BY d.submitted_at DESC`, [donorId]);
    return r.rows;
  },

  async listByStatus(db: Queryable, status: DonationStatus): Promise<DonationRow[]> {
    const r = await db.query<DonationRow>(`${SELECT} WHERE d.status = $1 ORDER BY d.submitted_at ASC`, [status]);
    return r.rows;
  },

  async listAll(db: Queryable): Promise<DonationRow[]> {
    const r = await db.query<DonationRow>(`${SELECT} ORDER BY d.submitted_at DESC`);
    return r.rows;
  },

  async updateStatus(
    db: Queryable,
    donationId: string,
    status: DonationStatus,
    extra: { postedAt?: boolean; matchedAt?: boolean } = {},
  ): Promise<void> {
    await db.query(
      `UPDATE donations SET status = $2, updated_at = now(),
         posted_at  = CASE WHEN $3 THEN COALESCE(posted_at, now())  ELSE posted_at  END,
         matched_at = CASE WHEN $4 THEN COALESCE(matched_at, now()) ELSE matched_at END
       WHERE donation_id = $1`,
      [donationId, status, extra.postedAt ?? false, extra.matchedAt ?? false],
    );
  },

  /** POSTED donations that are not yet expired — feed for a matching cycle. */
  async listMatchablePosted(db: Queryable): Promise<DonationRow[]> {
    const r = await db.query<DonationRow>(
      `${SELECT} WHERE d.status = 'POSTED' AND d.expires_at > now() ORDER BY d.expires_at ASC`,
    );
    return r.rows;
  },

};
