import request from 'supertest';
import { beforeAll, afterAll, describe, expect, it } from 'vitest';
import { ensureMigrated, makeApp, PASSWORD, resetWithFixtures, teardown } from './helpers';

const app = makeApp();

/**
 * A matching cycle reports, for every organisation it weighed, whether that
 * organisation was eligible and — when it was not — why. The administrator
 * screen renders this, so the shape is a contract, not an internal detail.
 *
 * The matcher itself answers in identifiers because it has no notion of who an
 * organisation is; the names are attached by matchingService afterwards. These
 * tests exist mainly to stop that attachment being lost, which would leave the
 * screen listing anonymous rows.
 */
const login = async (email: string) => {
  const r = await request(app).post('/api/auth/login').send({ email, password: PASSWORD });
  expect(r.status, `login failed for ${email}`).toBe(200);
  return r.body.token as string;
};

let explanation: {
  candidates: {
    recipientId: string; recipientName: string | null; eligible: boolean;
    reasons: string[]; totalScore: number | null; distanceKm: number | null;
  }[];
};

beforeAll(async () => {
  await ensureMigrated();
  await resetWithFixtures();

  const donorToken = await login('donor@test.local');
  const adminToken = await login('admin@test.local');

  // 50 servings on top of Hope Shelter. Of the fixture organisations only Hope
  // has that much capacity free, so one is eligible and the rest are excluded
  // for three different reasons.
  const created = await request(app).post('/api/donations')
    .set('Authorization', `Bearer ${donorToken}`)
    .send({
      foodType: 'cooked_meals', description: 'explanation fixture', quantityServings: 50,
      latitude: 12.98, longitude: 77.60, expiresInHours: 6,
    });
  expect(created.status).toBe(201);
  const donationId = created.body.donation.donation_id;

  await request(app).patch(`/api/admin/donations/${donationId}/review`)
    .set('Authorization', `Bearer ${adminToken}`).send({ decision: 'APPROVED', remarks: 'fixture' });

  const run = await request(app).post('/api/admin/matching/run')
    .set('Authorization', `Bearer ${adminToken}`).send({});
  expect(run.status).toBe(200);

  explanation = run.body.explanations.find(
    (e: { donationId: string }) => e.donationId === donationId,
  );
  expect(explanation, 'the cycle reported no explanation for this donation').toBeTruthy();
});

afterAll(teardown);

describe('a matching cycle explains every candidate', () => {
  it('names every organisation it considered', () => {
    expect(explanation.candidates.length).toBeGreaterThan(1);
    for (const c of explanation.candidates) {
      expect(c.recipientName, `candidate ${c.recipientId} came back without a name`).toBeTruthy();
    }
  });

  it('uses the organisations\' real names, not identifiers', () => {
    const names = explanation.candidates.map((c) => c.recipientName);
    expect(names).toContain('Hope Shelter');
    expect(names).toContain('Far Away Trust');
    // A UUID leaking through as a name would satisfy "truthy" but not this.
    for (const n of names) {
      expect(n).not.toMatch(/^[0-9a-f-]{36}$/);
    }
  });

  it('leaves out an organisation that is not active', () => {
    expect(explanation.candidates.map((c) => c.recipientName)).not.toContain('Inactive Org');
  });

  it('scores the eligible organisation and gives it no exclusion reason', () => {
    const hope = explanation.candidates.find((c) => c.recipientName === 'Hope Shelter')!;
    expect(hope.eligible).toBe(true);
    expect(hope.totalScore).toBeGreaterThan(0);
    expect(hope.reasons ?? []).toHaveLength(0);
  });

  it('excludes the distant organisation on radius, before any scoring', () => {
    const far = explanation.candidates.find((c) => c.recipientName === 'Far Away Trust')!;
    expect(far.eligible).toBe(false);
    expect(far.reasons.join(' ')).toMatch(/outside radius/i);
    // Eligibility is settled first, so an excluded candidate never competes.
    expect(far.totalScore).toBeNull();
  });

  it('excludes the organisation that lacks remaining capacity, and says the numbers', () => {
    const tiny = explanation.candidates.find((c) => c.recipientName === 'Tiny Home')!;
    expect(tiny.eligible).toBe(false);
    expect(tiny.reasons.join(' ')).toMatch(/insufficient remaining capacity/i);
    expect(tiny.reasons.join(' ')).toMatch(/50 needed/);
  });

  it('reports a distance for every candidate inside the maximum radius', () => {
    for (const c of explanation.candidates) {
      if ((c.reasons ?? []).some((r) => /outside radius/i.test(r))) continue;
      expect(typeof c.distanceKm, `${c.recipientName} has no distance`).toBe('number');
    }
  });
});
