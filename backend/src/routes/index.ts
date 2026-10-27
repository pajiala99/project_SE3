import { Router, type NextFunction, type Request, type Response } from 'express';
import type { Queryable } from '../db/pool';
import {
  adminController,
  authController,
  donationController,
  geocodingController,
  impactController,
  matchController,
  notificationController,
  pickupController,
} from '../controllers';
import { authenticate, requireRole } from '../middleware/authenticate';
import { rateLimit } from '../middleware/rateLimit';

const wrap =
  (fn: (req: Request, res: Response, next: NextFunction) => unknown) =>
  (req: Request, res: Response, next: NextFunction): void => {
    Promise.resolve(fn(req, res, next)).catch(next);
  };

/**
 * API groups (spec §19). Role-based authorization is enforced here with
 * requireRole after JWT authentication.
 */
export function buildRouter(db: Queryable): Router {
  const auth = authController(db);
  const donations = donationController(db);
  const admin = adminController(db);
  const matches = matchController(db);
  const pickups = pickupController(db);
  const notifications = notificationController(db);
  const impact = impactController(db);
  const geocoding = geocodingController(db);

  const r = Router();

  r.get('/health', (_req, res) => res.json({ status: 'ok', service: 'foodbridge-backend' }));

  // ---- /api/auth
  r.post('/auth/register', wrap(auth.register));
  r.post('/auth/login', wrap(auth.login));
  r.get('/auth/me', authenticate, wrap(auth.me));
  r.patch('/auth/profile', authenticate, wrap(auth.updateProfile));

  // ---- /api/donations (donor-facing)
  // ---- /api/geocode — turn a postal address into coordinates so a client can
  // confirm the point before submitting it. Deliberately unauthenticated: an
  // organisation has to locate its own address while it is still registering,
  // so requiring a token here would make registration by address impossible.
  // Rate limited instead, because it reaches an external provider.
  r.post('/geocode', rateLimit(30, 60_000), wrap(geocoding.lookup));

  r.post('/donations', authenticate, requireRole('DONOR'), wrap(donations.create));
  r.get('/donations/mine', authenticate, requireRole('DONOR'), wrap(donations.mine));
  r.get('/donations/:id', authenticate, wrap(donations.detail));
  r.post('/donations/:id/cancel', authenticate, requireRole('DONOR'), wrap(donations.cancel));
  r.put('/donations/:id/rating', authenticate, requireRole('DONOR', 'RECIPIENT'), wrap(donations.rate));

  // ---- /api/admin (donation review + operations)
  r.get('/admin/donations/pending', authenticate, requireRole('ADMIN'), wrap(admin.pending));
  r.get('/admin/donations/:id', authenticate, requireRole('ADMIN'), wrap(admin.reviewDetail));
  r.get('/admin/donations/:id/explanations', authenticate, requireRole('ADMIN'), wrap(admin.explanations));
  r.patch('/admin/donations/:id/review', authenticate, requireRole('ADMIN'), wrap(admin.review));
  r.post('/admin/matching/run', authenticate, requireRole('ADMIN'), wrap(admin.runMatching));
  r.get('/admin/waitlist', authenticate, requireRole('ADMIN'), wrap(admin.waitlist));

  // ---- /api/matches (recipient inbox + decisions)
  r.get('/matches/inbox', authenticate, requireRole('RECIPIENT'), wrap(matches.inbox));
  r.get('/matches/:id', authenticate, wrap(matches.detail));
  r.post('/matches/:id/accept', authenticate, requireRole('RECIPIENT'), wrap(matches.accept));
  r.post('/matches/:id/reject', authenticate, requireRole('RECIPIENT'), wrap(matches.reject));

  // ---- /api/pickups
  r.get('/pickups/mine', authenticate, wrap(pickups.mine));
  r.get('/pickups/:id', authenticate, wrap(pickups.detail));
  r.post('/pickups/:id/picked-up', authenticate, wrap(pickups.pickedUp));
  r.post('/pickups/:id/complete', authenticate, wrap(pickups.complete));

  // ---- /api/notifications
  r.get('/notifications', authenticate, wrap(notifications.list));
  r.patch('/notifications/:id/read', authenticate, wrap(notifications.markRead));
  r.post('/notifications/read-all', authenticate, wrap(notifications.markAllRead));

  // ---- /api/impact (dashboard)
  r.get('/impact/summary', authenticate, wrap(impact.summary));
  r.get('/impact/ttm', authenticate, wrap(impact.ttm));

  return r;
}
