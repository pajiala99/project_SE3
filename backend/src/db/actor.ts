import type { Queryable } from './pool';

/**
 * Record who is acting for the rest of the current transaction (SRS NFR-19).
 * The status-change trigger (migration 003) reads this setting, so every
 * donation, offer and pickup transition is logged with its actor. Pass null
 * for system actions. Must be called inside a transaction: the setting is
 * transaction-local and disappears at COMMIT/ROLLBACK.
 */
export async function setActor(tx: Queryable, userId: string | null): Promise<void> {
  await tx.query(`SELECT set_config('foodbridge.actor_id', $1, true)`, [userId ?? '']);
}
