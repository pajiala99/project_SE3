import type { NextFunction, Request, Response } from 'express';
import { ApiError } from '../utils/errors';

/** Single error-rendering point: consistent { error: {...} } envelope. */
export function errorHandler(
  err: unknown,
  _req: Request,
  res: Response,
  _next: NextFunction,
): void {
  if (err instanceof ApiError) {
    res.status(err.statusCode).json({
      error: { code: err.code, message: err.message, ...(err.details !== undefined ? { details: err.details } : {}) },
    });
    return;
  }
  if (typeof err === 'object' && err !== null && (err as { type?: string }).type === 'entity.parse.failed') {
    res.status(400).json({ error: { code: 'BAD_JSON', message: 'Request body is not valid JSON.' } });
    return;
  }
  // PostgreSQL 22P02 (invalid_text_representation) is what a malformed id looks
  // like: a route parameter that is not a UUID reaches a uuid column and the
  // cast throws. That is the client asking for something that cannot exist, not
  // a server fault, so it must not surface as a 500 — a typo in a URL would
  // otherwise tell the user "an unexpected error occurred".
  if (typeof err === 'object' && err !== null && (err as { code?: string }).code === '22P02') {
    res.status(404).json({ error: { code: 'NOT_FOUND', message: 'No such record.' } });
    return;
  }

  console.error('[FoodBridge] Unexpected error:', err);
  res.status(500).json({ error: { code: 'INTERNAL_ERROR', message: 'An unexpected error occurred.' } });
}
