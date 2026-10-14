import request from 'supertest';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { ensureMigrated, makeApp, PASSWORD, resetWithFixtures, teardown, testPool } from './helpers';

/**
 * Full workflow tests (spec §22 backend + §12/§13): these spawn nothing —
 * they talk to the REAL Python matching service on :8000 and the real
 * PostgreSQL foodbridge_test database.
 */

const app = makeApp();

let donorToken: string;
let adminToken: string;
let hopeToken: string;
let sunriseToken: string;
let greenToken: string;

async function login(email: string): Promise<string> {
  const res = await request(app).post('/api/auth/login').send({ email, password: PASSWORD });
  expect(res.status).toBe(200);
  return res.body.token as string;
}

async function createAndApprove(qty: number, expiresInHours = 4, lat = 12.9716, lng = 77.5946): Promise<string> {
  const created = await request(app)
    .post('/api/donations')
    .set('Authorization', `Bearer ${donorToken}`)
    .send({ foodType: 'cooked_meals', description: 'flow test', quantityServings: qty, latitude: lat, longitude: lng, expiresInHours });
  expect(created.status).toBe(201);
  const id = created.body.donation.donation_id as string;

  const review = await request(app)
    .patch(`/api/admin/donations/${id}/review`)
    .set('Authorization', `Bearer ${adminToken}`)
    .send({ decision: 'APPROVED' });
  expect(review.status).toBe(200);
  return id;
}

async function pendingMatchFor(token: string) {
  const inbox = await request(app).get('/api/matches/inbox').set('Authorization', `Bearer ${token}`);
  return (inbox.body.matches as { match_id: string; status: string }[]).find((m) => m.status === 'PENDING') ?? null;
}

beforeAll(async () => {
  await ensureMigrated();
  await resetWithFixtures();
  donorToken = await login('donor@test.local');
  adminToken = await login('admin@test.local');
  hopeToken = await login('hope@test.local');
  sunriseToken = await login('sunrise@test.local');
  greenToken = await login('green@test.local');
});

afterAll(teardown);

describe('matching cycle (greedy via real Python service)', () => {
  it('creates Match rows (PENDING) with score explanations and moves POSTED -> MATCHED', async () => {
    const donationId = await createAndApprove(20);
    const res = await request(app)
      .post('/api/admin/matching/run')
      .set('Authorization', `Bearer ${adminToken}`)
      .send({});
    expect(res.status).toBe(200);
    expect(res.body.strategy).toBe('greedy');

    const assignment = (res.body.assignments as { donationId: string }[]).find((a) => a.donationId === donationId);
    expect(assignment).toBeTruthy();

    const detail = await request(app).get(`/api/donations/${donationId}`).set('Authorization', `Bearer ${donorToken}`);
    expect(detail.body.donation.status).toBe('MATCHED');
    expect(detail.body.donation.matched_at).toBeTruthy(); // TTM timestamp stored
    expect(detail.body.matches[0].status).toBe('PENDING');
    expect(detail.body.matches[0].score).toBeGreaterThan(0);
    expect(detail.body.matches[0].urgency_score).toBeGreaterThan(0);
    expect(detail.body.matches[0].proximity_score).toBeGreaterThan(0);
  });

  it('matching requires ADMIN role', async () => {
    const res = await request(app)
      .post('/api/admin/matching/run')
      .set('Authorization', `Bearer ${donorToken}`)
      .send({});
    expect(res.status).toBe(403);
  });

  it('recipient accept: Match -> ACCEPTED, Pickup SCHEDULED created, donation stays MATCHED', async () => {
    const donationId = await createAndApprove(15);
    await request(app).post('/api/admin/matching/run').set('Authorization', `Bearer ${adminToken}`).send({});

    const match = await pendingMatchFor(hopeToken);
    expect(match).toBeTruthy();

    const res = await request(app).post(`/api/matches/${match!.match_id}/accept`).set('Authorization', `Bearer ${hopeToken}`);
    expect(res.status).toBe(200);
    expect(res.body.match.status).toBe('ACCEPTED');
    expect(res.body.pickup.status).toBe('SCHEDULED');
    expect(res.body.pickup.contact_details).toBeTruthy();

    const detail = await request(app).get(`/api/donations/${donationId}`).set('Authorization', `Bearer ${donorToken}`);
    expect(detail.body.donation.status).toBe('MATCHED'); // no ACCEPTED donation status!

    // recipient notified about pickup, donor about acceptance
    const notifs = await request(app).get('/api/notifications').set('Authorization', `Bearer ${donorToken}`);
    expect(notifs.body.notifications.some((n: { type: string }) => n.type === 'MATCH_ACCEPTED')).toBe(true);
  });

  it('recipient cannot accept another recipient\'s match', async () => {
    await createAndApprove(18);
    await request(app).post('/api/admin/matching/run').set('Authorization', `Bearer ${adminToken}`).send({});
    const hopeMatch = await pendingMatchFor(hopeToken);
    if (!hopeMatch) return; // this donation may have gone to green depending on capacity; skip if so
    const res = await request(app)
      .post(`/api/matches/${hopeMatch.match_id}/accept`)
      .set('Authorization', `Bearer ${sunriseToken}`);
    expect(res.status).toBe(403);
  });

  it('recipient reject: Match -> REJECTED, donation requeued POSTED, rematch excludes rejecter', async () => {
    const donationId = await createAndApprove(14);
    await request(app).post('/api/admin/matching/run').set('Authorization', `Bearer ${adminToken}`).send({});

    // find which recipient holds the pending match for this donation
    const detail = await request(app).get(`/api/donations/${donationId}`).set('Authorization', `Bearer ${donorToken}`);
    const match = detail.body.matches[0];
    expect(match.status).toBe('PENDING');

    // resolve the token of the recipient that owns this match via inboxes
    let tokenForMatch = hopeToken;
    for (const token of [hopeToken, sunriseToken, greenToken]) {
      const inbox = await request(app).get('/api/matches/inbox').set('Authorization', `Bearer ${token}`);
      if (inbox.body.matches.some((m: { match_id: string }) => m.match_id === match.match_id)) {
        tokenForMatch = token;
        break;
      }
    }

    const reject = await request(app)
      .post(`/api/matches/${match.match_id}/reject`)
      .set('Authorization', `Bearer ${tokenForMatch}`)
      .send({ reason: 'no volunteers available' });
    expect(reject.status).toBe(200);
    expect(reject.body.rematched).toBe(true);
    expect(reject.body.newMatch.recipient_id).not.toBe(match.recipient_id);

    const after = await request(app).get(`/api/donations/${donationId}`).set('Authorization', `Bearer ${donorToken}`);
    expect(after.body.donation.status).toBe('MATCHED');
    expect(after.body.matches.length).toBeGreaterThanOrEqual(2); // full history kept
    expect(after.body.matches.some((m: { status: string }) => m.status === 'REJECTED')).toBe(true);
  });
});

describe('pickup lifecycle + completion (spec §13)', () => {
  it('SCHEDULED -> PICKED_UP -> COMPLETED with donation transitions and donor meal credit', async () => {
    const donationId = await createAndApprove(12);
    await request(app).post('/api/admin/matching/run').set('Authorization', `Bearer ${adminToken}`).send({});

    const detail = await request(app).get(`/api/donations/${donationId}`).set('Authorization', `Bearer ${donorToken}`);
    const match = detail.body.matches[0];

    let recipientToken = hopeToken;
    for (const token of [hopeToken, sunriseToken, greenToken]) {
      const inbox = await request(app).get('/api/matches/inbox').set('Authorization', `Bearer ${token}`);
      if (inbox.body.matches.some((m: { match_id: string }) => m.match_id === match.match_id)) {
        recipientToken = token;
        break;
      }
    }

    const accept = await request(app).post(`/api/matches/${match.match_id}/accept`).set('Authorization', `Bearer ${recipientToken}`);
    const pickupId = accept.body.pickup.pickup_id as string;

    // illegal: complete before picked up
    const early = await request(app).post(`/api/pickups/${pickupId}/complete`).set('Authorization', `Bearer ${recipientToken}`);
    expect(early.status).toBe(409);

    const picked = await request(app).post(`/api/pickups/${pickupId}/picked-up`).set('Authorization', `Bearer ${recipientToken}`);
    expect(picked.status).toBe(200);
    expect(picked.body.pickup.status).toBe('PICKED_UP');
    expect(picked.body.pickup.picked_up_at).toBeTruthy();

    let d = await request(app).get(`/api/donations/${donationId}`).set('Authorization', `Bearer ${donorToken}`);
    expect(d.body.donation.status).toBe('PICKED_UP');

    const done = await request(app).post(`/api/pickups/${pickupId}/complete`).set('Authorization', `Bearer ${recipientToken}`);
    expect(done.status).toBe(200);
    expect(done.body.pickup.status).toBe('COMPLETED');
    expect(done.body.pickup.completed_at).toBeTruthy();

    d = await request(app).get(`/api/donations/${donationId}`).set('Authorization', `Bearer ${donorToken}`);
    expect(d.body.donation.status).toBe('COMPLETED');

    // donor impact counter credited
    const me = await request(app).get('/api/auth/me').set('Authorization', `Bearer ${donorToken}`);
    expect(me.body.profile.total_meals_donated).toBeGreaterThanOrEqual(12);
  });
});

describe('match timeout (spec §12: expired offer -> EXPIRED -> donation requeued)', () => {
  it('expires a stale PENDING offer and re-matches the donation', async () => {
    const donationId = await createAndApprove(13);
    await request(app).post('/api/admin/matching/run').set('Authorization', `Bearer ${adminToken}`).send({});

    const detail = await request(app).get(`/api/donations/${donationId}`).set('Authorization', `Bearer ${donorToken}`);
    const match = detail.body.matches[0];
    expect(match.status).toBe('PENDING');

    // Force the offer to be stale (nobody responded in time).
    await testPool().query(
      `UPDATE matches SET expires_at = now() - interval '1 minute' WHERE match_id = $1`,
      [match.match_id],
    );

    // Next cycle sweeps the stale offer and requeues the donation.
    const res = await request(app)
      .post('/api/admin/matching/run')
      .set('Authorization', `Bearer ${adminToken}`)
      .send({});

    const after = await request(app).get(`/api/donations/${donationId}`).set('Authorization', `Bearer ${donorToken}`);
    const statuses = (after.body.matches as { status: string }[]).map((m) => m.status);
    expect(statuses).toContain('EXPIRED');
    expect(res.body.expiredMatches.some((m: { donation_id: string }) => m.donation_id === donationId)).toBe(true);
    // donation was requeued and matched again (recipients available in fixtures)
    expect(after.body.donation.status).toBe('MATCHED');
    expect(statuses.filter((s) => s === 'PENDING').length).toBe(1);
  });
});

describe('waitlist + hungarian strategy + impact', () => {
  it('far-away donation is waitlisted after radius expansion (never dropped)', async () => {
    // (13.9, 78.4): no recipient within the 25 km max radius, not even
    // the far fixture org at (13.6, 78.1) which is ~46 km away.
    const donationId = await createAndApprove(10, 6, 13.9, 78.4);
    const res = await request(app)
      .post('/api/admin/matching/run')
      .set('Authorization', `Bearer ${adminToken}`)
      .send({});
    expect(res.body.waitlisted.some((w: { donationId: string }) => w.donationId === donationId)).toBe(true);

    const detail = await request(app).get(`/api/donations/${donationId}`).set('Authorization', `Bearer ${donorToken}`);
    expect(detail.body.donation.status).toBe('POSTED'); // still waiting

    const wl = await request(app).get('/api/admin/waitlist').set('Authorization', `Bearer ${adminToken}`);
    expect(wl.body.waitlist.some((w: { donation_id: string }) => w.donation_id === donationId)).toBe(true);
  });

  it('hungarian strategy runs end-to-end through the API', async () => {
    await createAndApprove(16);
    const res = await request(app)
      .post('/api/admin/matching/run')
      .set('Authorization', `Bearer ${adminToken}`)
      .send({ strategy: 'hungarian' });
    expect(res.status).toBe(200);
    expect(res.body.strategy).toBe('hungarian');
  });

  it('impact summary is computed from real rows (TTM, meals, unmatched, expired)', async () => {
    // Make TTM genuinely measurable (FR-46: submission -> first accepted
    // offer): approve, backdate submitted_at by 1 h, match, then accept.
    const ttmDonationId = await createAndApprove(8);
    await testPool().query(
      `UPDATE donations SET submitted_at = now() - interval '1 hour' WHERE donation_id = $1`,
      [ttmDonationId],
    );
    await request(app).post('/api/admin/matching/run').set('Authorization', `Bearer ${adminToken}`).send({});

    const detail = await request(app).get(`/api/donations/${ttmDonationId}`).set('Authorization', `Bearer ${donorToken}`);
    const offer = detail.body.matches.find((m: { status: string }) => m.status === 'PENDING');
    expect(offer).toBeTruthy();
    let accepted = false;
    for (const token of [hopeToken, sunriseToken, greenToken]) {
      const r = await request(app).post(`/api/matches/${offer.match_id}/accept`).set('Authorization', `Bearer ${token}`);
      if (r.status === 200) { accepted = true; break; }
    }
    expect(accepted).toBe(true);

    // per-donation TTM must be ~1 hour for the backdated donation
    const after = await request(app).get(`/api/donations/${ttmDonationId}`).set('Authorization', `Bearer ${donorToken}`);
    const acceptedOffer = after.body.matches.find((m: { status: string }) => m.status === 'ACCEPTED');
    const ttmSeconds =
      (new Date(acceptedOffer.responded_at).getTime() - new Date(after.body.donation.submitted_at).getTime()) / 1000;
    expect(ttmSeconds).toBeGreaterThan(3500);
    expect(ttmSeconds).toBeLessThan(3700);

    const res = await request(app).get('/api/impact/summary').set('Authorization', `Bearer ${adminToken}`);
    expect(res.status).toBe(200);
    expect(res.body.mealsRedistributed).toBeGreaterThanOrEqual(12);
    expect(res.body.wasteDivertedKg).toBeGreaterThan(0);
    expect(res.body.timeToMatch.samples).toBeGreaterThan(0);
    expect(res.body.timeToMatch.avgSeconds).toBeGreaterThan(0);
    expect(res.body.timeToMatch.medianSeconds).toBeGreaterThanOrEqual(0);
    expect(res.body.unmatchedCount).toBeGreaterThanOrEqual(1); // the far donation
    expect(res.body.topDonors.length).toBeGreaterThan(0);
  });
});
