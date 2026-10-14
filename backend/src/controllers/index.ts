import type { Request, Response } from 'express';
import type { Queryable } from '../db/pool';
import { donationService } from '../services/donationService';
import { authService } from '../services/authService';
import { impactService } from '../services/impactService';
import { matchingService } from '../services/matchingService';
import { notificationService } from '../services/notificationService';
import { pickupService } from '../services/pickupService';
import { reviewService } from '../services/reviewService';

/** Thin HTTP layer: validate auth/role at route level, call services, shape
 *  responses. No business logic here. */

export function authController(db: Queryable) {
  return {
    register: async (req: Request, res: Response) =>
      res.status(201).json(await authService.register(db, req.body)),
    login: async (req: Request, res: Response) =>
      res.json(await authService.login(db, req.body)),
    me: async (req: Request, res: Response) =>
      res.json(await authService.getProfile(db, req.user.userId)),
    updateProfile: async (req: Request, res: Response) =>
      res.json(await authService.updateProfile(db, req.user.userId, req.body)),
  };
}

export function donationController(db: Queryable) {
  return {
    create: async (req: Request, res: Response) =>
      res.status(201).json(await donationService.createDonation(db, req.user.userId, req.body)),
    mine: async (req: Request, res: Response) =>
      res.json({ donations: await donationService.listMine(db, req.user.userId) }),
    detail: async (req: Request, res: Response) =>
      res.json(await donationService.getDetail(db, req.params.id!, req.user)),
    cancel: async (req: Request, res: Response) =>
      res.json({ donation: await donationService.cancelDonation(db, req.params.id!, req.user.userId) }),
    rate: async (req: Request, res: Response) =>
      res.json({ rating: await donationService.rateStatus(db, req.params.id!, req.user, req.body) }),
  };
}

export function adminController(db: Queryable) {
  return {
    pending: async (_req: Request, res: Response) =>
      res.json({ donations: await reviewService.listPending(db) }),
    reviewDetail: async (req: Request, res: Response) =>
      res.json(await reviewService.getForReview(db, req.params.id!)),
    explanations: async (req: Request, res: Response) =>
      res.json(await reviewService.explanations(db, req.params.id!)),
    review: async (req: Request, res: Response) =>
      res.json(await reviewService.review(db, req.user.userId, req.params.id!, req.body)),
    runMatching: async (req: Request, res: Response) => {
      const strategy = (req.body as { strategy?: 'greedy' | 'hungarian' } | undefined)?.strategy;
      res.json(await matchingService.runCycle(db, strategy, req.user.userId));
    },
    waitlist: async (_req: Request, res: Response) =>
      res.json({ waitlist: await matchingService.waitlist(db) }),
  };
}

export function matchController(db: Queryable) {
  return {
    inbox: async (req: Request, res: Response) =>
      res.json({ matches: await matchingService.inbox(db, req.user.userId) }),
    detail: async (req: Request, res: Response) =>
      res.json({ match: await matchingService.getMatch(db, req.params.id!, req.user) }),
    accept: async (req: Request, res: Response) =>
      res.json(await matchingService.acceptMatch(db, req.params.id!, req.user.userId)),
    reject: async (req: Request, res: Response) =>
      res.json(await matchingService.rejectMatch(db, req.params.id!, req.user.userId, req.body)),
  };
}

export function pickupController(db: Queryable) {
  return {
    mine: async (req: Request, res: Response) =>
      res.json({ pickups: await pickupService.listMine(db, req.user.userId, req.user.role) }),
    detail: async (req: Request, res: Response) =>
      res.json({ pickup: await pickupService.get(db, req.params.id!, req.user) }),
    pickedUp: async (req: Request, res: Response) =>
      res.json({ pickup: await pickupService.markPickedUp(db, req.params.id!, req.user) }),
    complete: async (req: Request, res: Response) =>
      res.json({ pickup: await pickupService.markCompleted(db, req.params.id!, req.user) }),
  };
}

export function notificationController(db: Queryable) {
  return {
    list: async (req: Request, res: Response) =>
      res.json(await notificationService.list(db, req.user.userId)),
    markRead: async (req: Request, res: Response) => {
      await notificationService.markRead(db, req.user.userId, req.params.id!);
      res.json({ ok: true });
    },
    markAllRead: async (req: Request, res: Response) => {
      await notificationService.markAllRead(db, req.user.userId);
      res.json({ ok: true });
    },
  };
}

export function impactController(db: Queryable) {
  return {
    summary: async (_req: Request, res: Response) => res.json(await impactService.summary(db)),
    ttm: async (req: Request, res: Response) => res.json(await impactService.ttmSeries(db, req.query)),
  };
}
