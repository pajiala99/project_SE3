import request from 'supertest';
import { beforeAll, afterAll, describe, expect, it } from 'vitest';
import { ensureMigrated, makeApp, PASSWORD, resetWithFixtures, teardown, testPool } from './helpers';

const app = makeApp();

/**
 * The donation detail carries `myRating`: the caller's own status-clarity score
 * (FR-49) or null. The score is a measurement of our interface rather than
 * feedback the two sides exchange, so each party must see only its own — the
 * last test here is what holds that property in place.
 */
const login = async (email: string) => {
  const r = await request(app).post('/api/auth/login').send({ email, password: PASSWORD });
  expect(r.status, `login failed for ${email}`).toBe(200);
  return r.body.token as string;
};

let donorToken = '';
let recipientToken = '';
let adminToken = '';
let donationId = '';

beforeAll(async () => {
  await ensureMigrated();
  await resetWithFixtures();

  donorToken = await login('donor@test.local');
  adminToken = await login('admin@test.local');

  // Drive one donation all the way to COMPLETED: a rating is refused before
  // that, so there is no shortcut to this state.
  const created = await request(app).post('/api/donations').set('Authorization', `Bearer ${donorToken}`)
    .send({
      foodType: 'cooked_meals', description: 'Rating fixture', quantityServings: 10,
      // On top of the Bengaluru fixture organisations, so the cycle has
      // someone eligible to offer it to.
      latitude: 12.98, longitude: 77.60, expiresInHours: 6,
    });
  expect(created.status).toBe(201);
  donationId = created.body.donation.donation_id;

  await request(app).patch(`/api/admin/donations/${donationId}/review`)
    .set('Authorization', `Bearer ${adminToken}`).send({ decision: 'APPROVED', remarks: 'fixture' });
  await request(app).post('/api/admin/matching/run')
    .set('Authorization', `Bearer ${adminToken}`).send({});

  const offer = await testPool().query<{ match_id: string; recipient_id: string }>(
    `SELECT match_id, recipient_id FROM matches WHERE donation_id = $1 AND status = 'PENDING' LIMIT 1`,
    [donationId],
  );
  expect(offer.rowCount, 'the fixture donation was not offered to anyone').toBeGreaterThan(0);

  const who = await testPool().query<{ email: string }>(
    'SELECT email FROM users WHERE user_id = $1', [offer.rows[0]!.recipient_id],
  );
  recipientToken = await login(who.rows[0]!.email);

  const accept = await request(app).post(`/api/matches/${offer.rows[0]!.match_id}/accept`)
    .set('Authorization', `Bearer ${recipientToken}`).send({});
  expect(accept.status).toBe(200);

  const pickupId = accept.body.pickup.pickup_id;
  await request(app).post(`/api/pickups/${pickupId}/picked-up`).set('Authorization', `Bearer ${recipientToken}`);
  await request(app).post(`/api/pickups/${pickupId}/complete`).set('Authorization', `Bearer ${recipientToken}`);
});

afterAll(teardown);

const detailAs = (token: string) =>
  request(app).get(`/api/donations/${donationId}`).set('Authorization', `Bearer ${token}`);

describe('donation detail carries the caller\'s own clarity rating', () => {
  it('is null before anyone has rated', async () => {
    const res = await detailAs(donorToken);
    expect(res.status).toBe(200);
    expect(res.body.myRating).toBeNull();
  });

  it('returns the donor\'s score once the donor has rated', async () => {
    await request(app).put(`/api/donations/${donationId}/rating`)
      .set('Authorization', `Bearer ${donorToken}`).send({ rating: 5, comment: 'very clear' });

    const res = await detailAs(donorToken);
    expect(res.body.myRating).toMatchObject({ rating: 5, comment: 'very clear', role: 'DONOR' });
  });

  it('reflects a changed score rather than keeping the first one', async () => {
    await request(app).put(`/api/donations/${donationId}/rating`)
      .set('Authorization', `Bearer ${donorToken}`).send({ rating: 2 });

    const res = await detailAs(donorToken);
    expect(res.body.myRating.rating).toBe(2);

    const rows = await testPool().query(
      'SELECT 1 FROM status_ratings WHERE donation_id = $1 AND role = $2', [donationId, 'DONOR'],
    );
    expect(rows.rowCount, 're-rating created a second row instead of replacing').toBe(1);
  });

  it('never shows one party the other party\'s score', async () => {
    // The donor has rated; the organisation has not. It must see null, not a 2.
    const theirs = await detailAs(recipientToken);
    expect(theirs.status).toBe(200);
    expect(theirs.body.myRating).toBeNull();

    // And once it rates, each side sees only its own number.
    await request(app).put(`/api/donations/${donationId}/rating`)
      .set('Authorization', `Bearer ${recipientToken}`).send({ rating: 4 });

    expect((await detailAs(recipientToken)).body.myRating.rating).toBe(4);
    expect((await detailAs(donorToken)).body.myRating.rating).toBe(2);
  });
});
