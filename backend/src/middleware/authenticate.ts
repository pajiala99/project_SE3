import type { NextFunction, Request, Response } from 'express';
import jwt from 'jsonwebtoken';
import { config } from '../config';
import type { UserRole } from '../domain/enums';
import { forbidden, unauthorized } from '../utils/errors';

export interface AuthUser {
  userId: string;
  email: string;
  name: string;
  role: UserRole;
}

declare module 'express-serve-static-core' {
  interface Request {
    user: AuthUser;
  }
}

export function signToken(user: AuthUser): string {
  return jwt.sign(
    { sub: user.userId, email: user.email, name: user.name, role: user.role },
    config.jwtSecret,
    { expiresIn: config.jwtExpiresIn } as jwt.SignOptions,
  );
}

/** Real JWT authentication (local). Replaces the old prototype mock auth. */
export function authenticate(req: Request, _res: Response, next: NextFunction): void {
  const header = req.header('authorization');
  if (!header?.startsWith('Bearer ')) {
    next(unauthorized());
    return;
  }
  try {
    const payload = jwt.verify(header.slice(7), config.jwtSecret) as jwt.JwtPayload;
    req.user = {
      userId: String(payload.sub),
      email: String(payload.email),
      name: String(payload.name),
      role: payload.role as UserRole,
    };
    next();
  } catch {
    next(unauthorized('Invalid or expired token.'));
  }
}

/** Role-based authorization, e.g. requireRole('ADMIN'). */
export function requireRole(...roles: UserRole[]) {
  return (req: Request, _res: Response, next: NextFunction): void => {
    if (!req.user) {
      next(unauthorized());
      return;
    }
    if (!roles.includes(req.user.role)) {
      next(forbidden(`Requires role: ${roles.join(' or ')}.`));
      return;
    }
    next();
  };
}
