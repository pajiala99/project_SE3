import type { Queryable } from '../db/pool';

export interface StatusRatingRow {
  rating_id: string;
  donation_id: string;
  user_id: string;
  role: 'DONOR' | 'RECIPIENT';
  rating: number;
  comment: string | null;
  created_at: string;
  updated_at: string;
}

export const ratingRepository = {
  /** Insert, or replace this person's earlier rating for the same donation. */
  async upsert(
    db: Queryable,
    r: { donationId: string; userId: string; role: 'DONOR' | 'RECIPIENT'; rating: number; comment?: string },
  ): Promise<StatusRatingRow> {
    const res = await db.query<StatusRatingRow>(
      `INSERT INTO status_ratings (donation_id, user_id, role, rating, comment)
       VALUES ($1,$2,$3,$4,$5)
       ON CONFLICT (donation_id, user_id)
       DO UPDATE SET rating = EXCLUDED.rating, comment = EXCLUDED.comment, updated_at = now()
       RETURNING *`,
      [r.donationId, r.userId, r.role, r.rating, r.comment ?? null],
    );
    return res.rows[0]!;
  },

  async listByDonation(db: Queryable, donationId: string): Promise<StatusRatingRow[]> {
    const res = await db.query<StatusRatingRow>(
      'SELECT * FROM status_ratings WHERE donation_id = $1 ORDER BY created_at ASC',
      [donationId],
    );
    return res.rows;
  },

  /** Average clarity per role, for the impact summary. */
  async summary(db: Queryable): Promise<{ role: string; avg: number; n: number }[]> {
    const res = await db.query<{ role: string; avg: string; n: string }>(
      `SELECT role, AVG(rating)::text AS avg, COUNT(*)::text AS n
         FROM status_ratings GROUP BY role`,
    );
    return res.rows.map((x) => ({ role: x.role, avg: Number(x.avg), n: Number(x.n) }));
  },
};
