import { badRequest } from './errors';

/** Small dependency-free request validators (academic project scope). */

export function asObject(body: unknown): Record<string, unknown> {
  if (typeof body !== 'object' || body === null) throw badRequest('Request body must be a JSON object.');
  return body as Record<string, unknown>;
}

export function requiredString(b: Record<string, unknown>, field: string, maxLen = 500): string {
  const v = b[field];
  if (typeof v !== 'string' || v.trim() === '') throw badRequest(`'${field}' is required (non-empty string).`);
  if (v.length > maxLen) throw badRequest(`'${field}' is too long (max ${maxLen}).`);
  return v.trim();
}

export function optionalString(b: Record<string, unknown>, field: string, maxLen = 1000): string | undefined {
  const v = b[field];
  if (v === undefined || v === null || v === '') return undefined;
  if (typeof v !== 'string') throw badRequest(`'${field}' must be a string.`);
  if (v.length > maxLen) throw badRequest(`'${field}' is too long (max ${maxLen}).`);
  return v.trim();
}

export function requiredInt(b: Record<string, unknown>, field: string, min: number, max: number): number {
  const v = b[field];
  if (typeof v !== 'number' || !Number.isInteger(v) || v < min || v > max) {
    throw badRequest(`'${field}' must be an integer in [${min}, ${max}].`);
  }
  return v;
}

export function requiredNumber(
  b: Record<string, unknown>,
  field: string,
  min: number,
  max: number,
): number {
  const v = b[field];
  if (typeof v !== 'number' || !Number.isFinite(v) || v < min || v > max) {
    throw badRequest(`'${field}' must be a number in [${min}, ${max}].`);
  }
  return v;
}

export function optionalNumber(
  b: Record<string, unknown>,
  field: string,
  min: number,
  max: number,
): number | undefined {
  const v = b[field];
  if (v === undefined || v === null) return undefined;
  return requiredNumber(b, field, min, max);
}

export function requiredEmail(b: Record<string, unknown>, field = 'email'): string {
  const v = requiredString(b, field, 320).toLowerCase();
  if (!/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(v)) throw badRequest(`'${field}' must be a valid email address.`);
  return v;
}

export function requiredEnum<T extends string>(
  b: Record<string, unknown>,
  field: string,
  allowed: readonly T[],
): T {
  const v = b[field];
  if (typeof v !== 'string' || !allowed.includes(v as T)) {
    throw badRequest(`'${field}' must be one of: ${allowed.join(', ')}.`);
  }
  return v as T;
}

export function optionalStringArray(b: Record<string, unknown>, field: string): string[] | undefined {
  const v = b[field];
  if (v === undefined || v === null) return undefined;
  if (!Array.isArray(v) || !v.every((x) => typeof x === 'string')) {
    throw badRequest(`'${field}' must be an array of strings.`);
  }
  return (v as string[]).map((s) => s.trim().toLowerCase()).filter(Boolean);
}

/** Accepts an ISO-8601 string or a relative { "<field>InHours": number }. */
export function requiredTimestamp(
  b: Record<string, unknown>,
  field: string,
): Date {
  const v = b[field];
  if (typeof v !== 'string') throw badRequest(`'${field}' must be an ISO-8601 timestamp string.`);
  const d = new Date(v);
  if (Number.isNaN(d.getTime())) throw badRequest(`'${field}' is not a valid timestamp.`);
  return d;
}

export function optionalTimestamp(b: Record<string, unknown>, field: string): Date | undefined {
  if (b[field] === undefined || b[field] === null) return undefined;
  return requiredTimestamp(b, field);
}

export function coordinates(
  b: Record<string, unknown>,
  latField = 'latitude',
  lngField = 'longitude',
): { latitude: number; longitude: number } {
  return {
    latitude: requiredNumber(b, latField, -90, 90),
    longitude: requiredNumber(b, lngField, -180, 180),
  };
}
