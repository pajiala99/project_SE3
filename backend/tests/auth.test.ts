import request from 'supertest';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { ensureMigrated, makeApp, PASSWORD, resetWithFixtures, teardown } from './helpers';

const app = makeApp();

beforeAll(async () => {
  await ensureMigrated();
  await resetWithFixtures();
});

afterAll(teardown);

describe('auth: registration + login + JWT roles', () => {
  it('registers a donor (profile row created, password hashed)', async () => {
    const res = await request(app).post('/api/auth/register').send({
      name: 'New Donor',
      email: 'newdonor@test.local',
      password: 'Secret123!',
      role: 'DONOR',
      donorType: 'RESTAURANT',
    });
    expect(res.status).toBe(201);
    expect(res.body.token).toBeTruthy();
    expect(res.body.profile.donor_type).toBe('RESTAURANT');
    expect(res.body.user).not.toHaveProperty('password_hash');
  });

  it('registers a recipient organization with geo profile', async () => {
    const res = await request(app).post('/api/auth/register').send({
      name: 'New NGO',
      email: 'newngo@test.local',
      password: 'Secret123!',
      role: 'RECIPIENT',
      organizationType: 'NGO',
      servingCapacity: 80,
      serviceRadiusKm: 8,
      foodPreferences: ['cooked_meals'],
      latitude: 12.97,
      longitude: 77.59,
    });
    expect(res.status).toBe(201);
    expect(res.body.profile.serving_capacity).toBe(80);
  });

  it('rejects duplicate email and weak input', async () => {
    const dup = await request(app).post('/api/auth/register').send({
      name: 'Dup', email: 'donor@test.local', password: 'Secret123!', role: 'DONOR', donorType: 'MESS',
    });
    expect(dup.status).toBe(409);

    const weak = await request(app).post('/api/auth/register').send({
      name: 'Weak', email: 'weak@test.local', password: 'short', role: 'DONOR', donorType: 'MESS',
    });
    expect(weak.status).toBe(400);
  });

  it('logs in with valid credentials, rejects bad ones', async () => {
    const ok = await request(app)
      .post('/api/auth/login')
      .send({ email: 'donor@test.local', password: PASSWORD });
    expect(ok.status).toBe(200);
    expect(ok.body.user.role).toBe('DONOR');

    const bad = await request(app)
      .post('/api/auth/login')
      .send({ email: 'donor@test.local', password: 'wrong-password' });
    expect(bad.status).toBe(401);
  });

  it('GET /auth/me requires and accepts a JWT', async () => {
    expect((await request(app).get('/api/auth/me')).status).toBe(401);

    const login = await request(app)
      .post('/api/auth/login')
      .send({ email: 'donor@test.local', password: PASSWORD });
    const me = await request(app)
      .get('/api/auth/me')
      .set('Authorization', `Bearer ${login.body.token}`);
    expect(me.status).toBe(200);
    expect(me.body.user.email).toBe('donor@test.local');
  });

  it('enforces role-based authorization on protected endpoints', async () => {
    const donorLogin = await request(app)
      .post('/api/auth/login')
      .send({ email: 'donor@test.local', password: PASSWORD });
    const donorToken = donorLogin.body.token;

    const recipientLogin = await request(app)
      .post('/api/auth/login')
      .send({ email: 'hope@test.local', password: PASSWORD });
    const recipientToken = recipientLogin.body.token;

    // admin-only queue
    expect(
      (await request(app).get('/api/admin/donations/pending').set('Authorization', `Bearer ${donorToken}`)).status,
    ).toBe(403);

    // donor-only donation creation
    expect(
      (
        await request(app)
          .post('/api/donations')
          .set('Authorization', `Bearer ${recipientToken}`)
          .send({ foodType: 'cooked_meals', quantityServings: 5, latitude: 12.97, longitude: 77.59 })
      ).status,
    ).toBe(403);

    // recipient-only inbox
    expect(
      (await request(app).get('/api/matches/inbox').set('Authorization', `Bearer ${donorToken}`)).status,
    ).toBe(403);

    // admin can see the queue
    const adminLogin = await request(app)
      .post('/api/auth/login')
      .send({ email: 'admin@test.local', password: PASSWORD });
    expect(
      (await request(app).get('/api/admin/donations/pending').set('Authorization', `Bearer ${adminLogin.body.token}`)).status,
    ).toBe(200);
  });
});
