import type { Queryable } from '../db/pool';
import type { NotificationType } from '../domain/enums';
import { notificationRepository } from '../repositories/notificationRepository';

/**
 * In-app notification service (spec §14). Rows are written in the same
 * transaction as the triggering event so notifications are never lost on
 * rollback. No SMS/email in this academic version.
 */
export const notificationService = {
  async notify(db: Queryable, userId: string, type: NotificationType, message: string): Promise<void> {
    await notificationRepository.create(db, { userId, type, message });
  },

  async notifyMany(db: Queryable, userIds: string[], type: NotificationType, message: string): Promise<void> {
    for (const id of userIds) await notificationRepository.create(db, { userId: id, type, message });
  },

  async list(db: Queryable, userId: string) {
    return {
      notifications: await notificationRepository.listByUser(db, userId),
      unread: await notificationRepository.countUnread(db, userId),
    };
  },

  async markRead(db: Queryable, userId: string, notificationId: string): Promise<void> {
    await notificationRepository.markRead(db, userId, notificationId);
  },

  async markAllRead(db: Queryable, userId: string): Promise<void> {
    await notificationRepository.markAllRead(db, userId);
  },
};
