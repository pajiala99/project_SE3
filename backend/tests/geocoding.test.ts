import request from 'supertest';
import { afterAll, afterEach, beforeAll, describe, expect, it } from 'vitest';
import { config } from '../src/config';
import { ensureMigrated, makeApp, PASSWORD, resetWithFixtures, teardown, testPool } from './helpers';

const app = makeApp();

/**
 * These tests never reach a geocoding provider. Every case either seeds the
 * cache first or disables the provider, so the suite stays offline and does not
 * spend anyone's Nominatim rate limit.
 */
const geocoding = config.geocoding as { provider: 'nominatim' | 'off' };
const original = geocoding.provider;

const seedCache = (address: string, lat: number, lon: number) =>
  testPool().query(
    `INSERT INTO geocoding_cache (address, latitude, longitude, provider)
     VALUES ($1,$2,$3,'test') ON CONFLICT (address) DO UPDATE
     SET latitude = EXCLUDED.latitude, longitude = EXCLUDED.longitude`,
    [address, lat, lon],
  );

let donorToken = '';

beforeAll(async () => {
  await ensureMigrated();
  await resetWithFixtures();
  await testPool().query('DELETE FROM geocoding_cache');
  const login = await request(app).post('/api/auth/login')
    .send({ email: 'donor@test.local', password: PASSWORD });
  donorToken = login.body.token;
});

afterEach(() => { geocoding.provider = original; });
afterAll(teardown);

describe('POST /api/geocode', () => {
  it('serves an unauthenticated caller, because registration needs it', async () => {
    await seedCache('patiala', 30.3398, 76.3869);
    geocoding.provider = 'off';
    // No Authorization header: an organisation registering has no token yet.
    const res = await request(app).post('/api/geocode').send({ address: 'Patiala' });
    expect(res.status).toBe(200);
    expect(res.body.source).toBe('CACHE');
  });

  it('rejects a missing address with a field error', async () => {
    const res = await request(app).post('/api/geocode')
      .set('Authorization', `Bearer ${donorToken}`).send({});
    expect(res.status).toBe(400);
    expect(res.body.error.code).toBe('BAD_REQUEST');
  });

  it('serves a cached address without consulting the provider', async () => {
    await seedCache('thapar institute, patiala', 30.3548, 76.3626);
    geocoding.provider = 'off';

    const res = await request(app).post('/api/geocode')
      .set('Authorization', `Bearer ${donorToken}`)
      .send({ address: 'Thapar Institute, Patiala' });

    expect(res.status).toBe(200);
    expect(res.body.source).toBe('CACHE');
    expect(res.body.latitude).toBeCloseTo(30.3548, 4);
    expect(res.body.longitude).toBeCloseTo(76.3626, 4);
  });

  it('matches the cache regardless of case or surrounding spaces', async () => {
    await seedCache('thapar institute, patiala', 30.3548, 76.3626);
    geocoding.provider = 'off';

    const res = await request(app).post('/api/geocode')
      .set('Authorization', `Bearer ${donorToken}`)
      .send({ address: '  THAPAR Institute,   Patiala ' });

    expect(res.status).toBe(200);
    expect(res.body.source).toBe('CACHE');
  });

  it('explains itself when the address is unknown and lookup is disabled', async () => {
    geocoding.provider = 'off';
    const res = await request(app).post('/api/geocode')
      .set('Authorization', `Bearer ${donorToken}`)
      .send({ address: 'Somewhere nobody has ever cached' });

    expect(res.status).toBe(400);
    expect(res.body.error.message).toMatch(/latitude/i);
  });
});

describe('registration by address (FR-11)', () => {
  it('locates a recipient from its address alone', async () => {
    await seedCache('model town, patiala', 30.3398, 76.3869);
    geocoding.provider = 'off';

    const res = await request(app).post('/api/auth/register').send({
      name: 'Address-Only Shelter',
      email: 'addressonly@test.local',
      password: 'Secret123!',
      role: 'RECIPIENT',
      organizationType: 'SHELTER',
      servingCapacity: 120,
      serviceRadiusKm: 10,
      address: 'Model Town, Patiala',
    });

    expect(res.status).toBe(201);
    expect(Number(res.body.profile.latitude)).toBeCloseTo(30.3398, 4);
    expect(Number(res.body.profile.longitude)).toBeCloseTo(76.3869, 4);
  });

  it('still refuses a recipient with no location at all', async () => {
    const res = await request(app).post('/api/auth/register').send({
      name: 'Nowhere Shelter',
      email: 'nowhere@test.local',
      password: 'Secret123!',
      role: 'RECIPIENT',
      organizationType: 'SHELTER',
      servingCapacity: 50,
    });

    expect(res.status).toBe(400);
    expect(res.body.error.message).toMatch(/address/i);
  });

  it('prefers explicit coordinates over an address', async () => {
    await seedCache('model town, patiala', 30.3398, 76.3869);
    geocoding.provider = 'off';

    const res = await request(app).post('/api/auth/register').send({
      name: 'Coordinates Win Shelter',
      email: 'coordswin@test.local',
      password: 'Secret123!',
      role: 'RECIPIENT',
      organizationType: 'SHELTER',
      servingCapacity: 60,
      address: 'Model Town, Patiala',
      latitude: 12.97,
      longitude: 77.59,
    });

    expect(res.status).toBe(201);
    expect(Number(res.body.profile.latitude)).toBeCloseTo(12.97, 2);
  });
});

// Last in the file on purpose: the limiter is per process, so spending its
// budget here cannot starve the checks above.
describe('the open endpoint is rate limited', () => {
  it('starts refusing a caller that floods it', async () => {
    await seedCache('patiala', 30.3398, 76.3869);
    geocoding.provider = 'off';

    let limited = 0;
    for (let i = 0; i < 45; i += 1) {
      const res = await request(app).post('/api/geocode').send({ address: 'Patiala' });
      if (res.status === 429) {
        limited += 1;
        expect(res.body.error.code).toBe('RATE_LIMITED');
      }
    }
    expect(limited).toBeGreaterThan(0);
  });
});
