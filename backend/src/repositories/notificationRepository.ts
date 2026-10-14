import type { Queryable } from '../db/pool';
import type { NotificationType } from '../domain/enums';

export interface NotificationRow {
  notification_id: string;
  user_id: string;
  type: NotificationType;
  message: string;
  sent_at: string;
  read: boolean;
}

export const notificationRepository = {
  async create(
    db: Queryable,
    n: { userId: string; type: NotificationType; message: string },
  ): Promise<NotificationRow> {
    const r = await db.query<NotificationRow>(
      `INSERT INTO notifications (user_id, type, message) VALUES ($1,$2,$3) RETURNING *`,
      [n.userId, n.type, n.message],
    );
    return r.rows[0]!;
  },

  async listByUser(db: Queryable, userId: string, limit = 50): Promise<NotificationRow[]> {
    const r = await db.query<NotificationRow>(
      'SELECT * FROM notifications WHERE user_id = $1 ORDER BY sent_at DESC LIMIT $2',
      [userId, limit],
    );
    return r.rows;
  },

  async countUnread(db: Queryable, userId: string): Promise<number> {
    const r = await db.query<{ count: string }>(
      'SELECT COUNT(*)::text AS count FROM notifications WHERE user_id = $1 AND read = FALSE',
      [userId],
    );
    return Number(r.rows[0]!.count);
  },

  async markRead(db: Queryable, userId: string, notificationId: string): Promise<void> {
    await db.query(
      'UPDATE notifications SET read = TRUE WHERE notification_id = $1 AND user_id = $2',
      [notificationId, userId],
    );
  },

  async markAllRead(db: Queryable, userId: string): Promise<void> {
    await db.query('UPDATE notifications SET read = TRUE WHERE user_id = $1', [userId]);
  },
};
