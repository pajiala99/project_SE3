import type { Queryable } from '../db/pool';
import type { PickupStatus } from '../domain/enums';

export interface PickupRow {
  pickup_id: string;
  match_id: string;
  scheduled_at: string;
  contact_details: string | null;
  status: PickupStatus;
  picked_up_at: string | null;
  completed_at: string | null;
  created_at: string;
  // joined context (optional)
  donation_id?: string;
  recipient_id?: string;
  food_type?: string;
  quantity_servings?: number;
  pickup_address?: string | null;
}

const SELECT = `
  SELECT p.*, m.donation_id, m.recipient_id, d.food_type, d.quantity_servings, d.pickup_address
    FROM pickups p
    JOIN matches m   ON m.match_id = p.match_id
    JOIN donations d ON d.donation_id = m.donation_id`;

export const pickupRepository = {
  async create(
    db: Queryable,
    p: { matchId: string; scheduledAt: Date; contactDetails?: string },
  ): Promise<PickupRow> {
    const r = await db.query<PickupRow>(
      `INSERT INTO pickups (match_id, scheduled_at, contact_details)
       VALUES ($1,$2,$3) RETURNING *`,
      [p.matchId, p.scheduledAt, p.contactDetails ?? null],
    );
    return r.rows[0]!;
  },

  async findById(db: Queryable, pickupId: string): Promise<PickupRow | null> {
    const r = await db.query<PickupRow>(`${SELECT} WHERE p.pickup_id = $1`, [pickupId]);
    return r.rows[0] ?? null;
  },

  async findByIdForUpdate(db: Queryable, pickupId: string): Promise<PickupRow | null> {
    const r = await db.query<PickupRow>(
      'SELECT * FROM pickups WHERE pickup_id = $1 FOR UPDATE',
      [pickupId],
    );
    return r.rows[0] ?? null;
  },

  async listForRecipient(db: Queryable, recipientId: string): Promise<PickupRow[]> {
    const r = await db.query<PickupRow>(
      `${SELECT} WHERE m.recipient_id = $1 ORDER BY p.created_at DESC`,
      [recipientId],
    );
    return r.rows;
  },

  async listForDonation(db: Queryable, donationId: string): Promise<PickupRow[]> {
    const r = await db.query<PickupRow>(
      `${SELECT} WHERE m.donation_id = $1 ORDER BY p.created_at DESC`,
      [donationId],
    );
    return r.rows;
  },

  async listForDonor(db: Queryable, donorId: string): Promise<PickupRow[]> {
    const r = await db.query<PickupRow>(
      `${SELECT} WHERE d.donor_id = $1 ORDER BY p.created_at DESC`,
      [donorId],
    );
    return r.rows;
  },

  async setStatus(db: Queryable, pickupId: string, status: PickupStatus): Promise<void> {
    await db.query(
      `UPDATE pickups SET status = $2,
         picked_up_at = CASE WHEN $2 = 'PICKED_UP' THEN now() ELSE picked_up_at END,
         completed_at = CASE WHEN $2 = 'COMPLETED' THEN now() ELSE completed_at END
       WHERE pickup_id = $1`,
      [pickupId, status],
    );
  },
};
