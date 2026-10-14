import type { Queryable } from '../db/pool';
import { expiryService } from './expiryService';

type Logger = Pick<Console, 'log' | 'error'>;

/**
 * SRS FR-52: expire overdue donations and offers on a schedule, without an
 * administrator having to run a matching cycle. Runs once at start-up and then
 * every `intervalSeconds`; a slow run is never overlapped by the next one.
 * An interval of 0 disables the scheduler (tests drive the sweep directly).
 * Returns a function that stops it.
 */
export function startExpiryScheduler(db: Queryable, intervalSeconds: number, log: Logger = console): () => void {
  if (!Number.isFinite(intervalSeconds) || intervalSeconds <= 0) return () => {};

  let running = false;
  const tick = async (): Promise<void> => {
    if (running) return;
    running = true;
    try {
      const r = await expiryService.sweep(db);
      if (r.expiredDonations.length || r.expiredMatches.length || r.cancelledPickups.length) {
        log.log(
          `[FoodBridge] expiry sweep: ${r.expiredDonations.length} donation(s), ` +
            `${r.expiredMatches.length} offer(s), ${r.cancelledPickups.length} pickup(s) expired`,
        );
      }
    } catch (err) {
      log.error('[FoodBridge] expiry sweep failed:', err);
    } finally {
      running = false;
    }
  };

  const handle = setInterval(() => void tick(), intervalSeconds * 1000);
  handle.unref?.();
  void tick();
  return () => clearInterval(handle);
}
