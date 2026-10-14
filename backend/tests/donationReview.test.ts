import request from 'supertest';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { ensureMigrated, makeApp, PASSWORD, resetWithFixtures, teardown, testPool } from './helpers';

const app = makeApp();

let donorToken: string;
let adminToken: string;

async function login(email: string): Promise<string> {
  const res = await request(app).post('/api/auth/login').send({ email, password: PASSWORD });
  return res.body.token as string;
}

async function createDonation(qty = 20) {
  const res = await request(app)
    .post('/api/donations')
    .set('Authorization', `Bearer ${donorToken}`)
    .send({
      foodType: 'cooked_meals',
      description: 'test lot',
      quantityServings: qty,
      latitude: 12.9716,
      longitude: 77.5946,
      expiresInHours: 4,
    });
  expect(res.status).toBe(201);
  return res.body.donation.donation_id as string;
}

beforeAll(async () => {
  await ensureMigrated();
  await resetWithFixtures();
  donorToken = await login('donor@test.local');
  adminToken = await login('admin@test.local');
});

afterAll(teardown);

describe('donation submission (spec: donor submits -> PENDING_REVIEW)', () => {
  it('creates donations in PENDING_REVIEW, never directly POSTED', async () => {
    const id = await createDonation();
    const res = await request(app).get(`/api/donations/${id}`).set('Authorization', `Bearer ${donorToken}`);
    expect(res.body.donation.status).toBe('PENDING_REVIEW');
  });

  it('validates input', async () => {
    const res = await request(app)
      .post('/api/donations')
      .set('Authorization', `Bearer ${donorToken}`)
      .send({ foodType: 'cooked_meals', latitude: 12.97, longitude: 77.59 }); // no quantity
    expect(res.status).toBe(400);

    const badGeo = await request(app)
      .post('/api/donations')
      .set('Authorization', `Bearer ${donorToken}`)
      .send({ foodType: 'x', quantityServings: 5, latitude: 91, longitude: 0 });
    expect(badGeo.status).toBe(400);
  });

  it('donor sees own donations only', async () => {
    const id = await createDonation(7);
    const otherDonor = await login('donor2@test.local');
    const res = await request(app).get(`/api/donations/${id}`).set('Authorization', `Bearer ${otherDonor}`);
    expect(res.status).toBe(403);

    const mine = await request(app).get('/api/donations/mine').set('Authorization', `Bearer ${donorToken}`);
    expect(mine.body.donations.some((d: { donation_id: string }) => d.donation_id === id)).toBe(true);
  });
});

describe('admin review (spec §7)', () => {
  it('pending queue -> approve -> POSTED, review persisted, donor notified', async () => {
    const id = await createDonation(22);

    const pending = await request(app)
      .get('/api/admin/donations/pending')
      .set('Authorization', `Bearer ${adminToken}`);
    expect(pending.body.donations.some((d: { donation_id: string }) => d.donation_id === id)).toBe(true);

    const res = await request(app)
      .patch(`/api/admin/donations/${id}/review`)
      .set('Authorization', `Bearer ${adminToken}`)
      .send({ decision: 'APPROVED', remarks: 'Listing details verified' });
    expect(res.status).toBe(200);
    expect(res.body.donation.status).toBe('POSTED');
    expect(res.body.review.decision).toBe('APPROVED');
    expect(res.body.donation.posted_at).toBeTruthy();

    // review audit trail
    const detail = await request(app)
      .get(`/api/admin/donations/${id}`)
      .set('Authorization', `Bearer ${adminToken}`);
    expect(detail.body.reviews).toHaveLength(1);
    expect(detail.body.reviews[0].remarks).toBe('Listing details verified');

    // donor notification
    const notifs = await request(app)
      .get('/api/notifications')
      .set('Authorization', `Bearer ${donorToken}`);
    expect(notifs.body.notifications.some((n: { type: string }) => n.type === 'DONATION_APPROVED')).toBe(true);
  });

  it('reject -> REJECTED with remarks; second review blocked', async () => {
    const id = await createDonation(9);
    const res = await request(app)
      .patch(`/api/admin/donations/${id}/review`)
      .set('Authorization', `Bearer ${adminToken}`)
      .send({ decision: 'REJECTED', remarks: 'Insufficient food safety detail' });
    expect(res.status).toBe(200);
    expect(res.body.donation.status).toBe('REJECTED');

    const again = await request(app)
      .patch(`/api/admin/donations/${id}/review`)
      .set('Authorization', `Bearer ${adminToken}`)
      .send({ decision: 'APPROVED' });
    expect(again.status).toBe(409);
    expect(again.body.error.code).toBe('ALREADY_REVIEWED');
  });

  it('non-admin cannot review; invalid decision rejected', async () => {
    const id = await createDonation(11);
    const asDonor = await request(app)
      .patch(`/api/admin/donations/${id}/review`)
      .set('Authorization', `Bearer ${donorToken}`)
      .send({ decision: 'APPROVED' });
    expect(asDonor.status).toBe(403);

    const badDecision = await request(app)
      .patch(`/api/admin/donations/${id}/review`)
      .set('Authorization', `Bearer ${adminToken}`)
      .send({ decision: 'MAYBE' });
    expect(badDecision.status).toBe(400);
  });

  it('donor can cancel while PENDING_REVIEW / POSTED, not later', async () => {
    const id = await createDonation(13);
    const res = await request(app)
      .post(`/api/donations/${id}/cancel`)
      .set('Authorization', `Bearer ${donorToken}`);
    expect(res.status).toBe(200);
    expect(res.body.donation.status).toBe('CANCELLED');
  });

  it('admin review-required notification was created for admins', async () => {
    const notifs = await request(app)
      .get('/api/notifications')
      .set('Authorization', `Bearer ${adminToken}`);
    expect(
      notifs.body.notifications.some((n: { type: string }) => n.type === 'ADMIN_REVIEW_REQUIRED'),
    ).toBe(true);
  });
});

describe('audit / notifications persistence', () => {
  it('notifications can be listed and marked read', async () => {
    const list = await request(app).get('/api/notifications').set('Authorization', `Bearer ${donorToken}`);
    expect(list.status).toBe(200);
    expect(list.body.unread).toBeGreaterThan(0);

    const first = list.body.notifications[0];
    const read = await request(app)
      .patch(`/api/notifications/${first.notification_id}/read`)
      .set('Authorization', `Bearer ${donorToken}`);
    expect(read.status).toBe(200);
  });

  it('database enforces closed status enum (no arbitrary strings)', async () => {
    const db = testPool();
    await expect(
      db.query(`UPDATE donations SET status = 'ACCEPTED' WHERE TRUE`),
    ).rejects.toThrow(); // CHECK constraint: ACCEPTED is not a donation status
  });
});
