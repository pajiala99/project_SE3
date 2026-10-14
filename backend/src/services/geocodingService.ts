/**
 * Resolves a donation's pickup point to coordinates.
 *
 * Explicit coordinates always win. An address is only sent to a provider when
 * the donor gave none, and every lookup is cached in geocoding_cache first —
 * the proposal commits to caching so repeated addresses cost no external calls,
 * which is also what keeps the pilot inside a free tier.
 *
 * Interface consumed by donationService.createDonation:
 *     resolve(db, { latitude?, longitude?, address? })
 *       -> { latitude, longitude, source }
 */
import type { Queryable } from '../db/pool';
import { config } from '../config';
import { badRequest } from '../utils/errors';
import { geocacheRepository } from '../repositories/miscRepository';

export type LocationSource = 'COORDINATES' | 'CACHE' | 'GEOCODED';

export interface ResolvedLocation {
  latitude: number;
  longitude: number;
  source: LocationSource;
}

/** Cache key: case- and whitespace-insensitive, so "  Thapar,  Patiala " hits
 *  the same row as "thapar, patiala". */
const normalize = (address: string): string => address.trim().toLowerCase().replace(/\s+/g, ' ');

let lastCallAt = 0;

async function callNominatim(address: string): Promise<{ lat: number; lon: number } | null> {
  // Nominatim's usage policy permits at most one request per second.
  const wait = lastCallAt + config.geocoding.minIntervalMs - Date.now();
  if (wait > 0) await new Promise((r) => setTimeout(r, wait));
  lastCallAt = Date.now();

  const url =
    `https://nominatim.openstreetmap.org/search?format=json&limit=1&q=${encodeURIComponent(address)}`;

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 10_000);
  try {
    const res = await fetch(url, {
      headers: { 'User-Agent': config.geocoding.userAgent },
      signal: controller.signal,
    });
    if (!res.ok) return null;
    const rows = (await res.json()) as Array<{ lat: string; lon: string }>;
    const hit = rows[0];
    return hit ? { lat: Number(hit.lat), lon: Number(hit.lon) } : null;
  } catch {
    // A provider being unreachable must not take the submission down with it;
    // the caller turns this into a 400 asking for coordinates instead.
    return null;
  } finally {
    clearTimeout(timer);
  }
}

export const geocodingService = {
  async resolve(
    db: Queryable,
    input: { latitude?: number; longitude?: number; address?: string },
  ): Promise<ResolvedLocation> {
    if (input.latitude !== undefined && input.longitude !== undefined) {
      return { latitude: input.latitude, longitude: input.longitude, source: 'COORDINATES' };
    }

    if (!input.address) {
      throw badRequest("Provide 'latitude' and 'longitude', or a 'pickupAddress' to locate.");
    }

    const key = normalize(input.address);

    const cached = await geocacheRepository.get(db, key);
    if (cached) {
      return { latitude: Number(cached.latitude), longitude: Number(cached.longitude), source: 'CACHE' };
    }

    if (config.geocoding.provider === 'off') {
      throw badRequest("Geocoding is disabled. Send 'latitude' and 'longitude' with the donation.");
    }

    const hit = await callNominatim(input.address);
    if (!hit) {
      throw badRequest(`Could not locate '${input.address}'. Send latitude and longitude instead.`);
    }

    await geocacheRepository.put(db, key, hit.lat, hit.lon, config.geocoding.provider);
    return { latitude: hit.lat, longitude: hit.lon, source: 'GEOCODED' };
  },
};
