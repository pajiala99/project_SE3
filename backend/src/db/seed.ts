import bcrypt from 'bcryptjs';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import { config } from '../config';
import { getPool, closePool, type Queryable } from './pool';

/**
 * Demo seed (spec §25). Realistic local data, Bengaluru coordinates.
 *
 * Recipients:
 *   hope      ~1.1 km, cap 100 (40 used)  -> best for the main donation
 *   sunrise   ~2.9 km, cap 60 (20 used)
 *   green     ~3.4 km, cap 40 (10 used)
 *   care      ~27.8 km                    -> too far for default max radius
 *   angels    next door, cap 10 (8 used)  -> capacity-ineligible for big lots
 *   foodbank  INACTIVE + packaged-only    -> ineligible
 *
 * Donation scenarios seeded (one greedy cycle demonstrates them all):
 *   1. don-normal   POSTED  20 servings, expires +4h      -> successful match (sunrise)
 *   2. don-rematch  POSTED  15 servings, expires +5h      -> green; reject -> rematch (hope)
 *   3. don-far      POSTED  10 servings ~47 km away       -> radius expansion -> waitlist
 *   4. don-urgent   POSTED  12 servings, expires +90min   -> processed FIRST (gets hope)
 *   5. don-a/don-b  POSTED  25+25 servings near rec-orbit -> one matched, one waitlisted
 *   6. don-pending  PENDING_REVIEW                        -> admin approval demo
 *   7. don-flagged  PENDING_REVIEW                        -> admin rejection demo
 */

const PASSWORD = 'Password123!';
const HUB = { latitude: 30.3548, longitude: 76.3626 }; // donor hub — Thapar Institute, Patiala

async function wipe(db: Queryable): Promise<void> {
  await db.query(
    `TRUNCATE status_events, match_explanations, matching_runs, status_ratings, notifications, pickups, matches, donation_reviews, matching_waitlist,
             donations, recipient_organizations, donors, users RESTART IDENTITY CASCADE`,
  );
}

async function insertUsers(db: Queryable) {
  const hash = await bcrypt.hash(PASSWORD, 10);
  type U = { email: string; name: string; role: string; phone: string };
  const users: U[] = [
    { email: 'admin@foodbridge.local', name: 'Asha (Admin)', role: 'ADMIN', phone: '+91-90000-00001' },
    { email: 'donor@foodbridge.local', name: 'Campus Cafeteria', role: 'DONOR', phone: '+91-90000-00002' },
    { email: 'donor2@foodbridge.local', name: 'Grand Restaurant', role: 'DONOR', phone: '+91-90000-00003' },
    { email: 'hope@foodbridge.local', name: 'Hope Shelter', role: 'RECIPIENT', phone: '+91-90000-00011' },
    { email: 'sunrise@foodbridge.local', name: 'Sunrise NGO', role: 'RECIPIENT', phone: '+91-90000-00012' },
    { email: 'green@foodbridge.local', name: 'Green Plate Collective', role: 'RECIPIENT', phone: '+91-90000-00013' },
    { email: 'care@foodbridge.local', name: 'Care Foundation', role: 'RECIPIENT', phone: '+91-90000-00014' },
    { email: 'angels@foodbridge.local', name: 'Little Angels Home', role: 'RECIPIENT', phone: '+91-90000-00015' },
    { email: 'foodbank@foodbridge.local', name: 'City Food Bank', role: 'RECIPIENT', phone: '+91-90000-00016' },
    { email: 'orbit@foodbridge.local', name: 'Orbit Shelter West', role: 'RECIPIENT', phone: '+91-90000-00017' },
  ];
  const ids = new Map<string, string>();
  for (const u of users) {
    const r = await db.query<{ user_id: string }>(
      'INSERT INTO users (name, email, phone, password_hash, role) VALUES ($1,$2,$3,$4,$5) RETURNING user_id',
      [u.name, u.email, u.phone, hash, u.role],
    );
    ids.set(u.email, r.rows[0]!.user_id);
  }
  return ids;
}

export async function seed(db: Queryable): Promise<void> {
  await wipe(db);
  const ids = await insertUsers(db);
  const id = (email: string) => ids.get(email)!;

  await db.query('INSERT INTO donors (donor_id, donor_type) VALUES ($1,$2),($3,$4)', [
    id('donor@foodbridge.local'), 'MESS',
    id('donor2@foodbridge.local'), 'RESTAURANT',
  ]);

  const recipients: [string, string, number, number, number, string[], boolean, number, number][] = [
    // email, orgType, capacity, assigned, radiusKm, prefs, active, lat, lng
    ['hope@foodbridge.local', 'SHELTER', 100, 40, 12, ['cooked_meals', 'packaged', 'bakery', 'produce', 'dairy'], true, 30.3632, 76.3680],
    ['sunrise@foodbridge.local', 'NGO', 60, 20, 12, ['cooked_meals', 'packaged', 'bakery'], true, 30.3332, 76.3480],
    ['green@foodbridge.local', 'COMMUNITY_KITCHEN', 60, 30, 12, ['cooked_meals'], true, 30.3732, 76.3880],
    ['care@foodbridge.local', 'NGO', 200, 50, 40, ['cooked_meals', 'packaged', 'produce', 'dairy'], true, 30.5832, 76.4680],
    ['angels@foodbridge.local', 'ORPHANAGE', 10, 8, 10, ['cooked_meals'], true, 30.3552, 76.3630],
    ['foodbank@foodbridge.local', 'FOOD_BANK', 150, 30, 15, ['packaged'], false, 30.3432, 76.3580],
    // Contention zone: isolated pocket ~17 km west of the hub; the only local
    // recipient (orbit) can serve ONE 25-serving donation, not both.
    ['orbit@foodbridge.local', 'SHELTER', 30, 0, 10, ['cooked_meals'], true, 30.2342, 76.2190],
  ];
  for (const [email, org, cap, assigned, radius, prefs, active, lat, lng] of recipients) {
    await db.query(
      `INSERT INTO recipient_organizations
         (recipient_id, organization_type, serving_capacity, assigned_servings, service_radius_km,
          food_preferences, active, location)
       VALUES ($1,$2,$3,$4,$5,$6,$7, ST_SetSRID(ST_MakePoint($9, $8), 4326)::geography)`,
      [id(email), org, cap, assigned, radius, prefs, active, lat, lng],
    );
  }

  const now = Date.now();
  const h = 3_600_000;
  type D = {
    donor: string; food: string; qty: number; desc: string;
    lat: number; lng: number; submittedAgoMin: number; expiresInMin: number;
    status: 'POSTED' | 'PENDING_REVIEW';
  };
  const donations: D[] = [
    { donor: 'donor@foodbridge.local', food: 'cooked_meals', qty: 20, desc: 'Veg biryani + dal, packed in trays', lat: HUB.latitude, lng: HUB.longitude, submittedAgoMin: 20, expiresInMin: 240, status: 'POSTED' },
    { donor: 'donor2@foodbridge.local', food: 'cooked_meals', qty: 15, desc: 'Buffet surplus: paneer, roti, rice', lat: 30.3582, lng: 76.3680, submittedAgoMin: 15, expiresInMin: 300, status: 'POSTED' },
    { donor: 'donor2@foodbridge.local', food: 'cooked_meals', qty: 10, desc: 'Farmhouse event surplus (far away)', lat: 30.8332, lng: 76.7180, submittedAgoMin: 10, expiresInMin: 360, status: 'POSTED' },
    { donor: 'donor@foodbridge.local', food: 'cooked_meals', qty: 12, desc: 'Breakfast surplus, must go fast', lat: 30.3562, lng: 76.3640, submittedAgoMin: 30, expiresInMin: 90, status: 'POSTED' },
    { donor: 'donor@foodbridge.local', food: 'cooked_meals', qty: 25, desc: 'Contention lot A (west zone)', lat: 30.2332, lng: 76.2200, submittedAgoMin: 25, expiresInMin: 150, status: 'POSTED' },
    { donor: 'donor2@foodbridge.local', food: 'cooked_meals', qty: 25, desc: 'Contention lot B (west zone)', lat: 30.2334, lng: 76.2202, submittedAgoMin: 5, expiresInMin: 170, status: 'POSTED' },
    { donor: 'donor@foodbridge.local', food: 'packaged', qty: 40, desc: 'Sealed snack boxes from canteen', lat: HUB.latitude, lng: HUB.longitude, submittedAgoMin: 2, expiresInMin: 720, status: 'PENDING_REVIEW' },
    { donor: 'donor2@foodbridge.local', food: 'cooked_meals', qty: 5, desc: 'Unclear listing — smells off, no details', lat: 30.3632, lng: 76.3680, submittedAgoMin: 1, expiresInMin: 240, status: 'PENDING_REVIEW' },
  ];

  for (const d of donations) {
    await db.query(
      `INSERT INTO donations
         (donor_id, food_type, description, quantity_servings, pickup_address, pickup_location,
          submitted_at, posted_at, expires_at, pickup_start, pickup_end, status)
       VALUES ($1,$2,$3,$4,$5, ST_SetSRID(ST_MakePoint($7, $6), 4326)::geography,
               now() - ($8 || ' minutes')::interval,
               CASE WHEN $10 = 'POSTED' THEN now() - ($8 || ' minutes')::interval ELSE NULL END,
               now() + ($9 || ' minutes')::interval,
               now(), now() + ($9 || ' minutes')::interval, $10)`,
      [id(d.donor), d.food, d.desc, d.qty, 'See donor profile', d.lat, d.lng,
       String(d.submittedAgoMin), String(d.expiresInMin), d.status],
    );
  }
}

const invokedDirectly =
  process.argv[1] !== undefined && import.meta.url === pathToFileURL(process.argv[1]).href;

if (invokedDirectly) {
  const db = getPool();
  seed(db)
    .then(async () => {
      await closePool();
      console.log(`Seeded database: ${config.databaseUrl.replace(/:[^:@]*@/, ':***@')}`);
      console.log('Demo logins (password for all: Password123!):');
      console.log('  donor@foodbridge.local | donor2@foodbridge.local | admin@foodbridge.local');
      console.log('  hope@ sunrise@ green@ care@ angels@ foodbank@ (all @foodbridge.local)');
      console.log('Scenarios: match, rematch, waitlist (far), near-expiry, capacity contention, admin approve/reject.');
      process.exit(0);
    })
    .catch(async (err) => {
      console.error('Seed failed:', err);
      await closePool();
      process.exit(1);
    });
}
