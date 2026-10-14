import bcrypt from 'bcryptjs';
import pg from 'pg';
import { createApp } from '../src/app';
import { setPool } from '../src/db/pool';
import { runMigrations } from '../src/db/migrate';

export const TEST_DB_URL =
  process.env.TEST_DATABASE_URL ?? 'postgres://foodbridge:foodbridge@localhost:5432/foodbridge_test';

export const PASSWORD = 'Password123!';

export interface FixtureIds {
  adminId: string;
  donorId: string;
  donor2Id: string;
  hopeId: string;
  sunriseId: string;
  greenId: string;
  farId: string;
  tinyId: string;
  inactiveId: string;
}

let pool: pg.Pool | null = null;

export function testPool(): pg.Pool {
  if (!pool) {
    pool = new pg.Pool({ connectionString: TEST_DB_URL, max: 5 });
    setPool(pool);
  }
  return pool;
}

export async function ensureMigrated(): Promise<void> {
  await runMigrations(TEST_DB_URL);
}

/** Wipe all data (schema kept) and insert a compact fixture set. */
export async function resetWithFixtures(): Promise<FixtureIds> {
  const db = testPool();
  await db.query(
    `TRUNCATE status_events, match_explanations, matching_runs, status_ratings, notifications, pickups, matches, donation_reviews, matching_waitlist,
             donations, recipient_organizations, donors, users RESTART IDENTITY CASCADE`,
  );

  const hash = bcrypt.hashSync(PASSWORD, 10);
  const users: [string, string, string][] = [
    ['admin@test.local', 'Admin', 'ADMIN'],
    ['donor@test.local', 'Test Donor', 'DONOR'],
    ['donor2@test.local', 'Second Donor', 'DONOR'],
    ['hope@test.local', 'Hope Shelter', 'RECIPIENT'],
    ['sunrise@test.local', 'Sunrise NGO', 'RECIPIENT'],
    ['green@test.local', 'Green Plate', 'RECIPIENT'],
    ['far@test.local', 'Far Away Trust', 'RECIPIENT'],
    ['tiny@test.local', 'Tiny Home', 'RECIPIENT'],
    ['inactive@test.local', 'Inactive Org', 'RECIPIENT'],
  ];
  const ids = new Map<string, string>();
  for (const [email, name, role] of users) {
    const r = await db.query<{ user_id: string }>(
      'INSERT INTO users (name, email, password_hash, role, phone) VALUES ($1,$2,$3,$4,$5) RETURNING user_id',
      [name, email, hash, role, '+91-9000000000'],
    );
    ids.set(email, r.rows[0]!.user_id);
  }
  const id = (e: string) => ids.get(e)!;

  await db.query('INSERT INTO donors (donor_id, donor_type) VALUES ($1,$2),($3,$4)', [
    id('donor@test.local'), 'MESS', id('donor2@test.local'), 'RESTAURANT',
  ]);

  const recipients: [string, number, number, number, string[], boolean, number, number][] = [
    // email, cap, assigned, radiusKm, prefs, active, lat, lng
    ['hope@test.local', 100, 40, 12, ['cooked_meals', 'packaged'], true, 12.98, 77.60],
    ['sunrise@test.local', 60, 20, 12, ['cooked_meals', 'packaged'], true, 12.95, 77.58],
    ['green@test.local', 60, 30, 12, ['cooked_meals'], true, 12.99, 77.62],
    ['far@test.local', 200, 0, 50, [], true, 13.60, 78.10],      // ~70 km: too far
    ['tiny@test.local', 10, 8, 10, ['cooked_meals'], true, 12.972, 77.595], // capacity-ineligible
    ['inactive@test.local', 150, 0, 15, [], false, 12.96, 77.59],
  ];
  for (const [email, cap, assigned, radius, prefs, active, lat, lng] of recipients) {
    await db.query(
      `INSERT INTO recipient_organizations
         (recipient_id, organization_type, serving_capacity, assigned_servings, service_radius_km,
          food_preferences, active, location)
       VALUES ($1,'NGO',$2,$3,$4,$5,$6, ST_SetSRID(ST_MakePoint($8, $7), 4326)::geography)`,
      [id(email), cap, assigned, radius, prefs, active, lat, lng],
    );
  }

  return {
    adminId: id('admin@test.local'),
    donorId: id('donor@test.local'),
    donor2Id: id('donor2@test.local'),
    hopeId: id('hope@test.local'),
    sunriseId: id('sunrise@test.local'),
    greenId: id('green@test.local'),
    farId: id('far@test.local'),
    tinyId: id('tiny@test.local'),
    inactiveId: id('inactive@test.local'),
  };
}

export function makeApp() {
  return createApp(testPool());
}

export async function teardown(): Promise<void> {
  if (pool) {
    await pool.end();
    pool = null;
    setPool(null);
  }
}
