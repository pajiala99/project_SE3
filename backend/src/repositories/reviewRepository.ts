import type { Queryable } from '../db/pool';
import type { ReviewDecision } from '../domain/enums';

export interface ReviewRow {
  review_id: string;
  donation_id: string;
  admin_id: string;
  admin_name?: string;
  decision: Exclude<ReviewDecision, 'PENDING'>;
  remarks: string | null;
  reviewed_at: string;
}

export const reviewRepository = {
  async create(
    db: Queryable,
    r: { donationId: string; adminId: string; decision: 'APPROVED' | 'REJECTED'; remarks?: string },
  ): Promise<ReviewRow> {
    const res = await db.query<ReviewRow>(
      `INSERT INTO donation_reviews (donation_id, admin_id, decision, remarks)
       VALUES ($1,$2,$3,$4) RETURNING *`,
      [r.donationId, r.adminId, r.decision, r.remarks ?? null],
    );
    return res.rows[0]!;
  },

  async listByDonation(db: Queryable, donationId: string): Promise<ReviewRow[]> {
    const r = await db.query<ReviewRow>(
      `SELECT r.*, u.name AS admin_name
       FROM donation_reviews r JOIN users u ON u.user_id = r.admin_id
       WHERE r.donation_id = $1 ORDER BY r.reviewed_at ASC`,
      [donationId],
    );
    return r.rows;
  },

  /** All reviews, newest first — admin operations/audit view. */
  async listAll(db: Queryable): Promise<ReviewRow[]> {
    const r = await db.query<ReviewRow>(
      `SELECT r.*, u.name AS admin_name
       FROM donation_reviews r JOIN users u ON u.user_id = r.admin_id
       ORDER BY r.reviewed_at DESC`,
    );
    return r.rows;
  },
};
