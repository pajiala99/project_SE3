import request from 'supertest';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { ensureMigrated, makeApp, PASSWORD, resetWithFixtures, teardown, testPool } from './helpers';

/**
 * Backend refinements for frontend integration:
 *  - one user shape from register / login / me
 *  - inbox embeds the donation it offers
 *  - recipients only see donations, matches and pickups that are theirs
 *  - time-to-match trend endpoint
 *  - status-clarity ratings
 * Runs against the real foodbridge_test database and matching service.
 */

const app = makeApp();
const RECIPIENTS = ['hope@test.local', 'sunrise@test.local', 'green@test.local'];

const tokens: Record<string, string> = {};

async function login(email: string): Promise<string> {
  const res = await request(app).post('/api/auth/login').send({ email, password: PASSWORD });
  expect(res.status).toBe(200);
  return res.body.token as string;
}

const as = (email: string) => ({ Authorization: `Bearer ${tokens[email]}` });

async function createApproveAndMatch(qty: number): Promise<{ donationId: string; matchId: string; owner: string }> {
  const created = await request(app)
    .post('/api/donations')
    .set(as('donor@test.local'))
    .send({ foodType: 'cooked_meals', description: 'refinement test', quantityServings: qty,
            latitude: 12.9716, longitude: 77.5946, pickupAddress: 'Test Mess, Block A', expiresInHours: 4 });
  expect(created.status).toBe(201);
  const donationId = created.body.donation.donation_id as string;

  await request(app).patch(`/api/admin/donations/${donationId}/review`).set(as('admin@test.local')).send({ decision: 'APPROVED' });
  await request(app).post('/api/admin/matching/run').set(as('admin@test.local')).send({});

  const detail = await request(app).get(`/api/donations/${donationId}`).set(as('donor@test.local'));
  const match = (detail.body.matches as { match_id: string; status: string }[]).find((m) => m.status === 'PENDING');
  expect(match).toBeTruthy();

  for (const email of RECIPIENTS) {
    const inbox = await request(app).get('/api/matches/inbox').set(as(email));
    if (inbox.body.matches.some((m: { match_id: string }) => m.match_id === match!.match_id)) {
      return { donationId, matchId: match!.match_id, owner: email };
    }
  }
  throw new Error('no recipient holds the match');
}

beforeAll(async () => {
  await ensureMigrated();
  await resetWithFixtures();
  for (const email of ['admin@test.local', 'donor@test.local', 'donor2@test.local', ...RECIPIENTS]) {
    tokens[email] = await login(email);
  }
});

afterAll(teardown);

describe('auth: one user shape', () => {
  it('login and /auth/me return the same snake_case user, without the password hash', async () => {
    const login = await request(app).post('/api/auth/login').send({ email: 'donor@test.local', password: PASSWORD });
    const me = await request(app).get('/api/auth/me').set('Authorization', `Bearer ${login.body.token}`);

    expect(login.body.user.user_id).toBeTruthy();
    expect(login.body.user).not.toHaveProperty('userId');
    expect(login.body.user).not.toHaveProperty('password_hash');
    expect(login.body.user).toEqual(me.body.user);
    expect(login.body.profile.donor_type).toBe('MESS');
  });

  it('register returns the same shape', async () => {
    const res = await request(app).post('/api/auth/register').send({
      name: 'New Donor', email: 'new-donor@test.local', password: PASSWORD, role: 'DONOR', donorType: 'MESS',
    });
    expect(res.status).toBe(201);
    expect(res.body.user.user_id).toBeTruthy();
    expect(res.body.user).not.toHaveProperty('password_hash');
    expect(res.body.token).toBeTruthy();
  });
});

describe('inbox embeds the donation', () => {
  it('each offer carries food type, quantity, address and donor name', async () => {
    const { matchId, owner } = await createApproveAndMatch(15);
    const inbox = await request(app).get('/api/matches/inbox').set(as(owner));
    const m = inbox.body.matches.find((x: { match_id: string }) => x.match_id === matchId);

    expect(m.score).toBeGreaterThan(0);
    expect(m.donation.food_type).toBe('cooked_meals');
    expect(m.donation.quantity_servings).toBe(15);
    expect(m.donation.pickup_address).toBe('Test Mess, Block A');
    expect(m.donation.donor_name).toBe('Test Donor');
    expect(m.donation.expires_at).toBeTruthy();
  });
});

describe('access control', () => {
  it('a recipient sees only its own offer on a donation, and is refused donations not offered to it', async () => {
    const { donationId, matchId, owner } = await createApproveAndMatch(10);
    const outsider = RECIPIENTS.find((e) => e !== owner)!;

    const mine = await request(app).get(`/api/donations/${donationId}`).set(as(owner));
    expect(mine.status).toBe(200);
    expect(mine.body.matches.every((m: { match_id: string }) => m.match_id === matchId)).toBe(true);

    const notMine = await request(app).get(`/api/donations/${donationId}`).set(as(outsider));
    expect(notMine.status).toBe(403);

    const matchAsOutsider = await request(app).get(`/api/matches/${matchId}`).set(as(outsider));
    expect(matchAsOutsider.status).toBe(403);
    const matchAsOtherDonor = await request(app).get(`/api/matches/${matchId}`).set(as('donor2@test.local'));
    expect(matchAsOtherDonor.status).toBe(403);
  });

  it('another donor cannot read or advance a pickup', async () => {
    const { matchId, owner } = await createApproveAndMatch(8);
    const accept = await request(app).post(`/api/matches/${matchId}/accept`).set(as(owner));
    const pickupId = accept.body.pickup.pickup_id as string;

    expect((await request(app).get(`/api/pickups/${pickupId}`).set(as('donor2@test.local'))).status).toBe(403);
    expect((await request(app).post(`/api/pickups/${pickupId}/picked-up`).set(as('donor2@test.local'))).status).toBe(403);

    // the donation's own donor can read it, but only the collecting
    // organisation records collection (SRS BR-4)
    expect((await request(app).get(`/api/pickups/${pickupId}`).set(as('donor@test.local'))).status).toBe(200);
    expect((await request(app).post(`/api/pickups/${pickupId}/picked-up`).set(as('donor@test.local'))).status).toBe(403);
    expect((await request(app).post(`/api/pickups/${pickupId}/picked-up`).set(as(owner))).status).toBe(200);
    expect((await request(app).post(`/api/pickups/${pickupId}/complete`).set(as('donor@test.local'))).status).toBe(403);
  });
});

describe('SRS conformance fixes', () => {
  it('FR-1: an ADMIN account cannot be self-registered', async () => {
    const res = await request(app).post('/api/auth/register').send({
      name: 'Sneaky', email: 'sneaky@test.local', password: PASSWORD, role: 'ADMIN',
    });
    expect(res.status).toBe(400);
  });

  it('FR-10: a deadline in the past or a non-positive hour count is refused, naming the field', async () => {
    const base = { foodType: 'cooked_meals', quantityServings: 5, latitude: 12.9716, longitude: 77.5946 };
    const past = await request(app).post('/api/donations').set(as('donor@test.local'))
      .send({ ...base, expiresAt: new Date(Date.now() - 60_000).toISOString() });
    expect(past.status).toBe(400);
    expect(past.body.error.details).toHaveProperty('expiresAt');

    for (const bad of [0, -3, 'abc']) {
      const r = await request(app).post('/api/donations').set(as('donor@test.local')).send({ ...base, expiresInHours: bad });
      expect(r.status).toBe(400);
      expect(r.body.error.details).toHaveProperty('expiresInHours');
    }
  });

  it('FR-36: an offer past its response window cannot be accepted or rejected', async () => {
    const { matchId, owner } = await createApproveAndMatch(4);
    await testPool().query(`UPDATE matches SET expires_at = now() - interval '1 minute' WHERE match_id = $1`, [matchId]);

    const accept = await request(app).post(`/api/matches/${matchId}/accept`).set(as(owner));
    expect(accept.status).toBe(409);
    expect(accept.body.error.code).toBe('OFFER_EXPIRED');
    const reject = await request(app).post(`/api/matches/${matchId}/reject`).set(as(owner));
    expect(reject.status).toBe(409);

    // no state change: the offer is still PENDING until the sweep expires it
    const m = await testPool().query<{ status: string }>('SELECT status FROM matches WHERE match_id = $1', [matchId]);
    expect(m.rows[0]!.status).toBe('PENDING');

    // the next cycle's sweep expires it and frees the donation
    await request(app).post('/api/admin/matching/run').set(as('admin@test.local')).send({});
    const after = await testPool().query<{ status: string }>('SELECT status FROM matches WHERE match_id = $1', [matchId]);
    expect(after.rows[0]!.status).toBe('EXPIRED');
  });
});

describe('impact: time-to-match trend', () => {
  it('returns daily points with median, average and sample count', async () => {
    const res = await request(app).get('/api/impact/ttm?bucket=day&days=7').set(as('admin@test.local'));
    expect(res.status).toBe(200);
    expect(res.body.bucket).toBe('day');
    expect(res.body.targetSeconds).toBe(1200);
    expect(res.body.points.length).toBeGreaterThanOrEqual(1);
    const p = res.body.points[0];
    expect(p.bucket).toMatch(/^\d{4}-\d{2}-\d{2}$/);
    expect(p.n).toBeGreaterThanOrEqual(1);
    expect(typeof p.medianSeconds).toBe('number');
  });

  it('rejects a bad bucket', async () => {
    const res = await request(app).get('/api/impact/ttm?bucket=hour').set(as('admin@test.local'));
    expect(res.status).toBe(400);
  });
});

describe('status-clarity ratings', () => {
  it('donor and accepting recipient can rate 1-5 after completion; re-rating replaces; summary reports averages', async () => {
    const { donationId, matchId, owner } = await createApproveAndMatch(6);
    const outsider = RECIPIENTS.find((e) => e !== owner)!;

    // recipient must have accepted before rating
    expect((await request(app).put(`/api/donations/${donationId}/rating`).set(as(owner)).send({ rating: 4 })).status).toBe(403);
    const accept = await request(app).post(`/api/matches/${matchId}/accept`).set(as(owner));
    const pickupId = accept.body.pickup.pickup_id as string;

    // FR-49: not before completion
    const early = await request(app).put(`/api/donations/${donationId}/rating`).set(as('donor@test.local')).send({ rating: 3 });
    expect(early.status).toBe(409);
    expect(early.body.error.code).toBe('NOT_COMPLETED');

    await request(app).post(`/api/pickups/${pickupId}/picked-up`).set(as(owner));
    await request(app).post(`/api/pickups/${pickupId}/complete`).set(as(owner));

    const r1 = await request(app).put(`/api/donations/${donationId}/rating`).set(as(owner)).send({ rating: 4 });
    expect(r1.status).toBe(200);
    expect(r1.body.rating.role).toBe('RECIPIENT');

    const d1 = await request(app).put(`/api/donations/${donationId}/rating`).set(as('donor@test.local')).send({ rating: 3 });
    const d2 = await request(app).put(`/api/donations/${donationId}/rating`).set(as('donor@test.local')).send({ rating: 5, comment: 'clear' });
    expect(d2.body.rating.rating_id).toBe(d1.body.rating.rating_id);
    expect(d2.body.rating.rating).toBe(5);

    expect((await request(app).put(`/api/donations/${donationId}/rating`).set(as('donor@test.local')).send({ rating: 6 })).status).toBe(400);
    expect((await request(app).put(`/api/donations/${donationId}/rating`).set(as('donor2@test.local')).send({ rating: 2 })).status).toBe(403);
    expect((await request(app).put(`/api/donations/${donationId}/rating`).set(as(outsider)).send({ rating: 2 })).status).toBe(403);

    const summary = await request(app).get('/api/impact/summary').set(as('admin@test.local'));
    expect(summary.body.statusClarity.donor).toEqual({ avg: 5, n: 1 });
    expect(summary.body.statusClarity.recipient).toEqual({ avg: 4, n: 1 });
  });
});
