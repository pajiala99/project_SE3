/** Uniform API error rendered by the error middleware as
 *  { "error": { code, message, details? } }. */
export class ApiError extends Error {
  constructor(
    public readonly statusCode: number,
    public readonly code: string,
    message: string,
    public readonly details?: unknown,
  ) {
    super(message);
    this.name = 'ApiError';
  }
}

export const badRequest = (message: string, details?: unknown) =>
  new ApiError(400, 'BAD_REQUEST', message, details);
export const unauthorized = (message = 'Authentication required.') =>
  new ApiError(401, 'UNAUTHORIZED', message);
export const forbidden = (message = 'You do not have access to this resource.') =>
  new ApiError(403, 'FORBIDDEN', message);
export const notFound = (message: string) => new ApiError(404, 'NOT_FOUND', message);
export const conflict = (code: string, message: string, details?: unknown) =>
  new ApiError(409, code, message, details);
