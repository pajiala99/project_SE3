import request from 'supertest';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { expiryService } from '../src/services/expiryService';
import { startExpiryScheduler } from '../src/services/scheduler';
import { ensureMigrated, makeApp, PASSWORD, resetWithFixtures, teardown, testPool, type FixtureIds } from './helpers';

/**
 * Remaining SRS requirements:
 *  FR-35/FR-52/NFR-9  scheduled expiry of donations (any open state) and offers
 *  FR-42              notifications on cancel and expiry
 *  FR-45/FR-48        rescue rate, first-offer acceptance, distance per strategy
 *  NFR-17             stored matcher explanations
 *  NFR-19             every status change logged with its actor
 * Runs against the real foodbridge_test database and matching service.
 */

const app = makeApp();
const RECIPIENTS = ['hope@test.local', 'sunrise@test.local', 'green@test.local'];
const tokens: Record<string, string> = {};
let ids: FixtureIds;

const as = (email: string) => ({ Authorization: `Bearer ${tokens[email]}` });
const db = () => testPool();

async function loginAll(): Promise<void> {
  for (const email of ['admin@test.local', 'donor@test.local', 'donor2@test.local', ...RECIPIENTS]) {
    const res = await request(app).post('/api/auth/login').send({ email, password: PASSWORD });
    expect(res.status).toBe(200);
    tokens[email] = res.body.token as string;
  }
}

async function createDonation(qty: number): Promise<string> {
  const res = await request(app).post('/api/donations').set(as('donor@test.local'))
    .send({ foodType: 'cooked_meals', quantityServings: qty, latitude: 12.9716, longitude: 77.5946, expiresInHours: 4 });
  expect(res.status).toBe(201);
  return res.body.donation.donation_id as string;
}

async function approve(donationId: string): Promise<void> {
  const res = await request(app).patch(`/api/admin/donations/${donationId}/review`).set(as('admin@test.local'))
    .send({ decision: 'APPROVED' });
  expect(res.status).toBe(200);
}

async function runCycle(strategy?: 'greedy' | 'hungarian') {
  const res = await request(app).post('/api/admin/matching/run').set(as('admin@test.local')).send(strategy ? { strategy } : {});
  expect(res.status).toBe(200);
  return res.body;
}

/** The PENDING offer on a donation and the recipient (email) it was made to. */
async function pendingOffer(donationId: string): Promise<{ matchId: string; owner: string }> {
  const r = await db().query<{ match_id: string; email: string }>(
    `SELECT m.match_id, u.email FROM matches m JOIN users u ON u.user_id = m.recipient_id
      WHERE m.donation_id = $1 AND m.status = 'PENDING'`,
    [donationId],
  );
  expect(r.rows.length).toBe(1);
  return { matchId: r.rows[0]!.match_id, owner: r.rows[0]!.email };
}

const statusOf = async (table: 'donations' | 'matches' | 'pickups', idCol: string, id: string) =>
  (await db().query<{ status: string }>(`SELECT status FROM ${table} WHERE ${idCol} = $1`, [id])).rows[0]!.status;

const notificationTypes = async (userId: string) =>
  (await db().query<{ type: string }>('SELECT type FROM notifications WHERE user_id = $1', [userId])).rows.map((r) => r.type);

const pastDeadline = (donationId: string) =>
  db().query(`UPDATE donations SET expires_at = now() - interval '1 minute' WHERE donation_id = $1`, [donationId]);

beforeAll(async () => {
  await ensureMigrated();
  ids = await resetWithFixtures();
  await loginAll();
});

afterAll(teardown);

// ------------------------------------------------------------------ expiry
describe('expiry sweep (FR-35, FR-52, NFR-9)', () => {
  it('expires a donation still awaiting review once its deadline passes, and tells the donor', async () => {
    const id = await createDonation(5);
    await pastDeadline(id);
    const r = await expiryService.sweep(db());
    expect(r.expiredDonations).toContain(id);
    expect(await statusOf('donations', 'donation_id', id)).toBe('EXPIRED');
    expect(await notificationTypes(ids.donorId)).toContain('DONATION_EXPIRED');
  });

  it('expires a MATCHED donation with an unanswered offer: offer and donation both EXPIRED', async () => {
    const id = await createDonation(6);
    await approve(id);
    await runCycle();
    const { matchId } = await pendingOffer(id);
    await pastDeadline(id);

    const r = await expiryService.sweep(db());
    expect(r.expiredDonations).toContain(id);
    expect(r.expiredMatches.map((m) => m.match_id)).toContain(matchId);
    expect(await statusOf('donations', 'donation_id', id)).toBe('EXPIRED');
    expect(await statusOf('matches', 'match_id', matchId)).toBe('EXPIRED');
  });

  it('expires a MATCHED donation awaiting collection: pickup cancelled, capacity released, both told', async () => {
    const id = await createDonation(7);
    await approve(id);
    await runCycle();
    const { matchId, owner } = await pendingOffer(id);
    const recipientId = (await db().query<{ recipient_id: string }>('SELECT recipient_id FROM matches WHERE match_id = $1', [matchId])).rows[0]!.recipient_id;
    const before = (await db().query<{ a: number }>('SELECT assigned_servings AS a FROM recipient_organizations WHERE recipient_id = $1', [recipientId])).rows[0]!.a;

    const accept = await request(app).post(`/api/matches/${matchId}/accept`).set(as(owner));
    expect(accept.status).toBe(200);
    const pickupId = accept.body.pickup.pickup_id as string;
    await pastDeadline(id);

    const r = await expiryService.sweep(db());
    expect(r.cancelledPickups).toContain(pickupId);
    expect(await statusOf('donations', 'donation_id', id)).toBe('EXPIRED');
    expect(await statusOf('pickups', 'pickup_id', pickupId)).toBe('CANCELLED');
    const after = (await db().query<{ a: number }>('SELECT assigned_servings AS a FROM recipient_organizations WHERE recipient_id = $1', [recipientId])).rows[0]!.a;
    expect(after).toBe(before);
    expect(await notificationTypes(recipientId)).toContain('PICKUP_CANCELLED');
  });

  it('expires an offer left unanswered past its response window and returns the donation to POSTED, telling the donor', async () => {
    const id = await createDonation(4);
    await approve(id);
    await runCycle();
    const { matchId } = await pendingOffer(id);
    await db().query(`DELETE FROM notifications WHERE user_id = $1`, [ids.donorId]);
    await db().query(`UPDATE matches SET expires_at = now() - interval '1 minute' WHERE match_id = $1`, [matchId]);

    await expiryService.sweep(db());
    expect(await statusOf('matches', 'match_id', matchId)).toBe('EXPIRED');
    expect(await statusOf('donations', 'donation_id', id)).toBe('POSTED');
    expect(await notificationTypes(ids.donorId)).toContain('MATCH_EXPIRED');
  });

  it('the scheduler runs the sweep without anyone triggering a cycle (FR-52)', async () => {
    const id = await createDonation(3);
    await approve(id);
    await pastDeadline(id);

    const lines: string[] = [];
    const stop = startExpiryScheduler(db(), 3600, { log: (m: string) => lines.push(m), error: (...a: unknown[]) => lines.push(String(a)) });
    try {
      for (let i = 0; i < 40 && (await statusOf('donations', 'donation_id', id)) !== 'EXPIRED'; i++) {
        await new Promise((r) => setTimeout(r, 100));
      }
    } finally {
      stop();
    }
    expect(await statusOf('donations', 'donation_id', id)).toBe('EXPIRED');
    expect(lines.some((l) => l.includes('expiry sweep'))).toBe(true);
  });

  it('an interval of 0 disables the scheduler', () => {
    const stop = startExpiryScheduler(db(), 0);
    expect(typeof stop).toBe('function');
    stop();
  });
});

// ------------------------------------------------------------------ notifications
describe('cancel notifications (FR-42)', () => {
  it('confirms to the donor and tells admins when a donation leaves the review queue', async () => {
    await db().query('DELETE FROM notifications');
    const id = await createDonation(5);
    const res = await request(app).post(`/api/donations/${id}/cancel`).set(as('donor@test.local'));
    expect(res.status).toBe(200);
    expect(res.body.donation.status).toBe('CANCELLED');
    expect(await notificationTypes(ids.donorId)).toContain('DONATION_CANCELLED');
    expect(await notificationTypes(ids.adminId)).toContain('DONATION_CANCELLED');
  });
});

// ------------------------------------------------------------------ audit trail
describe('audit trail (NFR-17, NFR-19)', () => {
  it('logs every status change with its actor; the system is the actor for expiry', async () => {
    const id = await createDonation(6);
    await approve(id);
    await runCycle();
    const { matchId, owner } = await pendingOffer(id);
    await request(app).post(`/api/matches/${matchId}/accept`).set(as(owner));

    const detail = await request(app).get(`/api/donations/${id}`).set(as('donor@test.local'));
    expect(detail.status).toBe(200);
    const ev = detail.body.events as { entity_type: string; from_status: string | null; to_status: string; actor_role: string | null }[];
    const find = (type: string, to: string) => ev.find((e) => e.entity_type === type && e.to_status === to);

    expect(find('DONATION', 'PENDING_REVIEW')).toMatchObject({ from_status: null, actor_role: 'DONOR' });
    expect(find('DONATION', 'POSTED')).toMatchObject({ from_status: 'PENDING_REVIEW', actor_role: 'ADMIN' });
    expect(find('MATCH', 'PENDING')).toMatchObject({ actor_role: 'ADMIN' });         // admin ran the cycle
    expect(find('MATCH', 'ACCEPTED')).toMatchObject({ actor_role: 'RECIPIENT' });
    expect(find('PICKUP', 'SCHEDULED')).toMatchObject({ actor_role: 'RECIPIENT' });

    await pastDeadline(id);
    await expiryService.sweep(db());
    const after = await request(app).get(`/api/donations/${id}`).set(as('donor@test.local'));
    const expired = (after.body.events as { entity_type: string; to_status: string; actor_id: string | null }[])
      .find((e) => e.entity_type === 'DONATION' && e.to_status === 'EXPIRED');
    expect(expired).toBeTruthy();
    expect(expired!.actor_id).toBeNull();
  });

  it('a recipient sees only the donation events and its own offer events', async () => {
    const id = await createDonation(5);
    await approve(id);
    await runCycle();
    const { owner } = await pendingOffer(id);
    const res = await request(app).get(`/api/donations/${id}`).set(as(owner));
    const ownerId = (await db().query<{ user_id: string }>('SELECT user_id FROM users WHERE email = $1', [owner])).rows[0]!.user_id;
    for (const e of res.body.events as { entity_type: string; recipient_id: string | null }[]) {
      if (e.entity_type !== 'DONATION') expect(e.recipient_id).toBe(ownerId);
    }
  });

  it('stores the matcher explanation of every run, readable by admins only', async () => {
    const id = await createDonation(8);
    await approve(id);
    const cycle = await runCycle('hungarian');
    expect(cycle.runId).toBeTruthy();

    const res = await request(app).get(`/api/admin/donations/${id}/explanations`).set(as('admin@test.local'));
    expect(res.status).toBe(200);
    const run = res.body.runs[0];
    expect(run.strategy).toBe('hungarian');
    expect(run.outcome).toBe('MATCHED');
    expect(run.candidates.length).toBeGreaterThan(0);
    // excluded organisations carry the reason they were excluded
    expect(run.candidates.some((c: { eligible: boolean; reasons: string[] }) => !c.eligible && c.reasons.length > 0)).toBe(true);

    const offer = (await db().query<{ strategy: string; run_id: string }>(
      'SELECT strategy, run_id FROM matches WHERE donation_id = $1', [id])).rows[0]!;
    expect(offer).toEqual({ strategy: 'hungarian', run_id: cycle.runId });

    expect((await request(app).get(`/api/admin/donations/${id}/explanations`).set(as('donor@test.local'))).status).toBe(403);
  });
});

// ------------------------------------------------------------------ metrics
describe('impact metrics (FR-45, FR-48)', () => {
  beforeAll(async () => {
    ids = await resetWithFixtures();
    await loginAll();
  });

  it('reports rescue rate, first-offer acceptance and mean distance per strategy', async () => {
    const rescued = await createDonation(5);
    const lost = await createDonation(5);
    await approve(rescued);
    await approve(lost);
    await runCycle('greedy');

    const a = await pendingOffer(rescued);
    const accept = await request(app).post(`/api/matches/${a.matchId}/accept`).set(as(a.owner));
    const pickupId = accept.body.pickup.pickup_id as string;
    await request(app).post(`/api/pickups/${pickupId}/picked-up`).set(as(a.owner));
    await request(app).post(`/api/pickups/${pickupId}/complete`).set(as(a.owner));

    await pastDeadline(lost);
    await expiryService.sweep(db());

    const res = await request(app).get('/api/impact/summary').set(as('admin@test.local'));
    expect(res.status).toBe(200);
    expect(res.body.rescueRate).toEqual({ rate: 0.5, rescued: 1, resolved: 2 });
    expect(res.body.firstOfferAcceptance).toEqual({ rate: 0.5, accepted: 1, decided: 2 });
    expect(res.body.meanDistanceKmByStrategy.greedy.offers).toBe(2);
    expect(res.body.meanDistanceKmByStrategy.greedy.meanKm).toBeGreaterThanOrEqual(0);
    expect(res.body.meanDistanceKmByStrategy.hungarian).toEqual({ meanKm: null, offers: 0 });
  });
});
