import type { NextFunction, Request, Response } from 'express';
import { tooManyRequests } from '../utils/errors';

/**
 * Fixed-window per-caller limit for routes that must stay open.
 *
 * /geocode cannot sit behind authentication — an organisation has to locate its
 * own address while it is still registering — but it reaches an external
 * provider, and Nominatim's usage policy applies to the application as a whole,
 * not to each caller. An open proxy would therefore let one abusive client get
 * the whole project blocked. This bounds that.
 *
 * In-memory, so the window is per process: good enough for a single-instance
 * deployment, and the cache absorbs repeats either way. A multi-instance
 * deployment would move this to Redis.
 */
export function rateLimit(limit: number, windowMs: number) {
  const hits = new Map<string, { count: number; resetAt: number }>();

  return (req: Request, _res: Response, next: NextFunction): void => {
    const now = Date.now();
    const key = req.ip ?? 'unknown';
    const entry = hits.get(key);

    if (!entry || now >= entry.resetAt) {
      hits.set(key, { count: 1, resetAt: now + windowMs });
    } else if (entry.count >= limit) {
      const seconds = Math.ceil((entry.resetAt - now) / 1000);
      next(tooManyRequests(`Too many lookups. Try again in ${seconds}s.`));
      return;
    } else {
      entry.count += 1;
    }

    // Opportunistic sweep: this map is only as large as the callers seen in one
    // window, so it does not need its own timer.
    if (hits.size > 1000) {
      for (const [k, v] of hits) if (now >= v.resetAt) hits.delete(k);
    }
    next();
  };
}
