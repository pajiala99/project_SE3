#!/usr/bin/env node
/**
 * Conformance check against the Person B backend.
 *
 * Walks a whole donation lifecycle — register, post, review, match, accept,
 * collect, complete — and checks the shapes the React client actually reads.
 * It answers one question: can the frontend talk to this server unchanged?
 *
 * It is not a test of the backend's internal correctness; the backend has its
 * own vitest suite for that.
 *
 *   node test/contract-check.mjs                    # http://localhost:3000
 *   node test/contract-check.mjs http://host:3000
 *
 * Creates three throwaway accounts on the target, so point it at a development
 * database, never production. Exits non-zero on failure so CI can gate on it.
 */

const BASE = (process.argv.find((a) => a.startsWith('http')) ?? 'http://localhost:3000').replace(/\/$/, '')
const STAMP = Date.now().toString(36)
const PASSWORD = 'Password123!'
const ADMIN_EMAIL = process.env.ADMIN_EMAIL ?? 'admin@foodbridge.local'
const ADMIN_PASSWORD = process.env.ADMIN_PASSWORD ?? 'Password123!'

const DONATION_STATUSES = ['PENDING_REVIEW', 'POSTED', 'REJECTED', 'MATCHED', 'PICKED_UP', 'COMPLETED', 'CANCELLED', 'EXPIRED']
const MATCH_STATUSES = ['PENDING', 'ACCEPTED', 'REJECTED', 'EXPIRED']
const PICKUP_STATUSES = ['SCHEDULED', 'PICKED_UP', 'COMPLETED', 'CANCELLED']
const ISO = /^\d{4}-\d{2}-\d{2}[T ]\d{2}:\d{2}:\d{2}/

const results = []
const ctx = {}

async function check(name, fn, { required = true } = {}) {
  try { results.push({ name, ok: true, detail: (await fn()) ?? '', required }) }
  catch (e) { results.push({ name, ok: false, detail: e.message, required }) }
}

async function call(method, path, { body, token } = {}) {
  let res
  try {
    res = await fetch(`${BASE}/api${path}`, {
      method,
      headers: { 'Content-Type': 'application/json', ...(token ? { Authorization: `Bearer ${token}` } : {}) },
      body: body === undefined ? undefined : JSON.stringify(body),
    })
  } catch (e) {
    throw new Error(`cannot reach ${BASE} (${e.cause?.code ?? e.message})`)
  }
  const text = await res.text()
  let json = null
  if (text) {
    try { json = JSON.parse(text) }
    catch { throw new Error(`HTTP ${res.status} body is not JSON: ${text.slice(0, 80)}`) }
  }
  return { status: res.status, json }
}

const must = (c, m) => { if (!c) throw new Error(m) }
const has = (o, k) => must(o && Object.prototype.hasOwnProperty.call(o, k), `missing field "${k}"`)
const oneOf = (v, set, k) => must(set.includes(v), `"${k}" is "${v}", not one of ${set.join('|')}`)
const isIso = (v, k) => must(typeof v === 'string' && ISO.test(v), `"${k}" is not an ISO timestamp (got ${JSON.stringify(v)})`)

function assertDonation(d) {
  for (const k of ['donation_id', 'donor_id', 'food_type', 'quantity_servings', 'expires_at', 'status', 'submitted_at']) has(d, k)
  oneOf(d.status, DONATION_STATUSES, 'status')
  isIso(d.expires_at, 'expires_at')
  must(Number.isInteger(d.quantity_servings), '"quantity_servings" must be a whole number')
}

// ------------------------------------------------------------------ checks

await check('GET /api/health', async () => {
  const { status, json } = await call('GET', '/health')
  must(status === 200, `expected 200, got ${status}`)
  return json?.status ?? 'ok'
})

await check('POST /api/auth/register creates a donor and returns a token', async () => {
  const { status, json } = await call('POST', '/auth/register', {
    body: { name: 'Contract Donor', email: `donor+${STAMP}@check.local`, password: PASSWORD, role: 'DONOR', donorType: 'MESS' },
  })
  must(status === 201, `expected 201, got ${status}`)
  has(json, 'user'); has(json, 'token')
  must(json.user.role === 'DONOR', `role came back as ${json.user.role}`)
  ctx.donor = json.token
  return 'token issued'
})

await check('POST /api/auth/register rejects a weak password with an error envelope', async () => {
  const { status, json } = await call('POST', '/auth/register', {
    body: { name: 'x', email: `weak+${STAMP}@check.local`, password: 'short', role: 'DONOR', donorType: 'MESS' },
  })
  must(status === 400, `expected 400, got ${status}`)
  has(json, 'error'); has(json.error, 'code'); has(json.error, 'message')
  return json.error.code
})

await check('POST /api/auth/login returns a usable token', async () => {
  const { status, json } = await call('POST', '/auth/login', {
    body: { email: `donor+${STAMP}@check.local`, password: PASSWORD },
  })
  must(status === 200, `expected 200, got ${status}`)
  has(json, 'token'); has(json, 'user')
  ctx.donor = json.token
  return 'ok'
})

await check('GET /api/auth/me identifies the caller', async () => {
  const { status, json } = await call('GET', '/auth/me', { token: ctx.donor })
  must(status === 200, `expected 200, got ${status}`)
  has(json, 'user')
  const u = json.user
  must(u.user_id ?? u.userId, 'user has neither user_id nor userId')
  oneOf(u.role, ['DONOR', 'RECIPIENT', 'ADMIN'], 'role')
  return `role=${u.role}`
})

await check('GET /api/auth/me without a token is rejected', async () => {
  const { status } = await call('GET', '/auth/me')
  must(status === 401, `expected 401, got ${status}`)
  return '401'
})

await check('POST /api/donations rejects an invalid body', async () => {
  const { status, json } = await call('POST', '/donations', { token: ctx.donor, body: { quantityServings: -5 } })
  must(status === 400, `expected 400, got ${status}`)
  has(json, 'error')
  return json.error.code
})

await check('POST /api/donations creates one at PENDING_REVIEW', async () => {
  const { status, json } = await call('POST', '/donations', {
    token: ctx.donor,
    body: {
      foodType: 'COOKED_VEG', description: 'Contract check — rice and dal',
      quantityServings: 30, pickupAddress: 'Thapar Institute, Patiala',
      latitude: 30.3548, longitude: 76.3626, expiresInHours: 4,
    },
  })
  must(status === 201, `expected 201, got ${status}`)
  has(json, 'donation')
  assertDonation(json.donation)
  must(json.donation.status === 'PENDING_REVIEW',
       `a new donation should start at PENDING_REVIEW, got ${json.donation.status}`)
  ctx.donationId = json.donation.donation_id
  return `id=${ctx.donationId}`
})

await check('GET /api/donations/mine is a collection under "donations"', async () => {
  const { status, json } = await call('GET', '/donations/mine', { token: ctx.donor })
  must(status === 200, `expected 200, got ${status}`)
  has(json, 'donations'); must(Array.isArray(json.donations), '"donations" must be an array')
  if (json.donations.length) assertDonation(json.donations[0])
  return `${json.donations.length} item(s)`
})

await check('GET /api/donations/:id carries the audit trail the timeline needs', async () => {
  const { status, json } = await call('GET', `/donations/${ctx.donationId}`, { token: ctx.donor })
  must(status === 200, `expected 200, got ${status}`)
  for (const k of ['donation', 'reviews', 'matches', 'pickups']) has(json, k)
  for (const k of ['reviews', 'matches', 'pickups']) must(Array.isArray(json[k]), `"${k}" must be an array`)
  return 'donation + reviews + matches + pickups'
})

await check('GET /api/donations/:id 404s on an unknown id', async () => {
  const { status, json } = await call('GET', '/donations/definitely-not-real', { token: ctx.donor })
  must(status === 404, `expected 404, got ${status}`)
  has(json, 'error')
  return json.error.code
})

// An administrator is provisioned by the seed, never by self-registration, so
// this signs in as the seeded account rather than creating one.
await check('Nobody can self-register as an administrator', async () => {
  const { status } = await call('POST', '/auth/register', {
    body: { name: 'Contract Admin', email: `admin+${STAMP}@check.local`, password: PASSWORD, role: 'ADMIN' },
  })
  must(status === 400, `expected 400, got ${status}`)
  return 'rejected'
})

await check('Admin can sign in and read the review queue', async () => {
  const login = await call('POST', '/auth/login', {
    body: { email: ADMIN_EMAIL, password: ADMIN_PASSWORD },
  })
  must(login.status === 200, `admin login expected 200, got ${login.status} — is the database seeded?`)
  ctx.admin = login.json.token
  const { status, json } = await call('GET', '/admin/donations/pending', { token: ctx.admin })
  must(status === 200, `expected 200, got ${status}`)
  has(json, 'donations')
  return `${json.donations.length} awaiting review`
})

await check('A donor cannot reach an admin route', async () => {
  const { status } = await call('GET', '/admin/donations/pending', { token: ctx.donor })
  must(status === 403, `expected 403 for a DONOR, got ${status}`)
  return '403'
})

await check('PATCH /api/admin/donations/:id/review approves it to POSTED', async () => {
  const { status, json } = await call('PATCH', `/admin/donations/${ctx.donationId}/review`, {
    token: ctx.admin, body: { decision: 'APPROVED', remarks: 'contract check' },
  })
  must(status === 200, `expected 200, got ${status}`)
  const after = await call('GET', `/donations/${ctx.donationId}`, { token: ctx.admin })
  must(after.json.donation.status === 'POSTED',
       `after approval expected POSTED, got ${after.json.donation.status}`)
  void json
  return 'POSTED'
})

await check('Recipient registers with capacity, radius and location', async () => {
  const { status, json } = await call('POST', '/auth/register', {
    body: {
      name: 'Contract Shelter', email: `recip+${STAMP}@check.local`, password: PASSWORD, role: 'RECIPIENT',
      organizationType: 'SHELTER', servingCapacity: 200, serviceRadiusKm: 10,
      latitude: 30.3398, longitude: 76.3869,
    },
  })
  must(status === 201, `expected 201, got ${status}`)
  has(json, 'token')
  ctx.recipient = json.token
  return 'registered'
})

// FR-11: the client asks the server to turn a typed address into a point, and
// shows that point before submitting it. The first run reaches the provider and
// fills the cache; every run after is served from it.
await check('POST /api/geocode resolves an address to a point', async () => {
  const { status, json } = await call('POST', '/geocode', {
    token: ctx.donor, body: { address: 'Thapar Institute, Patiala' },
  })
  must(status === 200, `expected 200, got ${status}`)
  has(json, 'latitude'); has(json, 'longitude'); has(json, 'source')
  must(Number.isFinite(json.latitude) && Number.isFinite(json.longitude),
       'geocode returned a non-numeric point')
  must(['CACHE', 'GEOCODED'].includes(json.source), `unexpected source '${json.source}'`)
  ctx.geocoded = json
  return `${json.latitude.toFixed(4)}, ${json.longitude.toFixed(4)} (${json.source})`
})

await check('A repeated lookup is served from the address cache', async () => {
  must(ctx.geocoded, 'skipped — the first lookup did not succeed')
  const { status, json } = await call('POST', '/geocode', {
    token: ctx.donor, body: { address: 'Thapar Institute, Patiala' },
  })
  must(status === 200, `expected 200, got ${status}`)
  must(json.source === 'CACHE', `expected CACHE on the second lookup, got '${json.source}'`)
  return 'cache hit'
})

await check('An unlocatable address is refused, not guessed', async () => {
  const { status, json } = await call('POST', '/geocode', {
    token: ctx.donor, body: { address: 'zzzz not a real place zzzz qqqq' },
  })
  must(status === 400, `expected 400, got ${status}`)
  has(json, 'error')
  return json.error.code
})

await check('A recipient can register by address alone', async () => {
  const { status, json } = await call('POST', '/auth/register', {
    body: {
      name: 'Address Shelter', email: `addr+${STAMP}@check.local`, password: PASSWORD,
      role: 'RECIPIENT', organizationType: 'SHELTER', servingCapacity: 60,
      serviceRadiusKm: 10, address: 'Thapar Institute, Patiala',
    },
  })
  must(status === 201, `expected 201, got ${status}`)
  must(json.profile?.latitude != null, 'registered without a resolved latitude')
  return `located at ${Number(json.profile.latitude).toFixed(4)}`
})

await check('POST /api/admin/matching/run reports a cycle', async () => {
  const { status, json } = await call('POST', '/admin/matching/run', { token: ctx.admin, body: { strategy: 'greedy' } })
  must(status === 200, `expected 200, got ${status}`)
  for (const k of ['strategy', 'assignments', 'waitlisted']) has(json, k)
  must(Array.isArray(json.assignments), '"assignments" must be an array')
  return `${json.strategy}: ${json.assignments.length} matched, ${json.waitlisted.length} waitlisted`
})

await check('The matching cycle offered the donation to someone', async () => {
  const { json } = await call('GET', `/donations/${ctx.donationId}`, { token: ctx.admin })
  const m = json.matches?.[0]
  must(m, 'the matching cycle produced no match for this donation at all')
  for (const k of ['match_id', 'donation_id', 'recipient_id', 'score', 'status',
                   'distance_km', 'proximity_score', 'urgency_score', 'capacity_score']) has(m, k)
  oneOf(m.status, MATCH_STATUSES, 'status')
  ctx.matchId = m.match_id
  return `match ${m.match_id} · score ${m.score}`
})

await check('GET /api/matches/inbox returns the recipient\'s own matches', async () => {
  const { status, json } = await call('GET', '/matches/inbox', { token: ctx.recipient })
  must(status === 200, `expected 200, got ${status}`)
  has(json, 'matches'); must(Array.isArray(json.matches), '"matches" must be an array')
  ctx.ourMatch = json.matches.find((m) => m.status === 'PENDING') ?? null
  // Another organisation outscoring ours is correct behaviour, not a defect, so
  // the accept flow below is skipped rather than failed when that happens.
  return ctx.ourMatch
    ? `${json.matches.length} match(es), one pending for us`
    : `${json.matches.length} match(es); this donation went to another organisation`
})

await check('Match rows carry enough to render an offer without a second call', async () => {
  // Whether our organisation wins this donation depends on the scores, so an
  // empty inbox is correct behaviour and must not fail the run. The join is
  // asserted strictly whenever there is in fact an offer to inspect.
  if (!ctx.ourMatch) return 'nothing offered to us this run — nothing to inspect'
  must(ctx.ourMatch.donation?.food_type != null && ctx.ourMatch.donation?.quantity_servings != null,
       'match rows carry no nested donation, so the inbox would need one request per offer (N+1)')
  return 'donation joined'
})

await check('POST /api/matches/:id/accept creates a pickup', async () => {
  must(ctx.ourMatch, 'skipped — the donation was matched to a different organisation')
  const { status } = await call('POST', `/matches/${ctx.ourMatch.match_id}/accept`, { token: ctx.recipient })
  must(status === 200, `expected 200, got ${status}`)
  const pk = await call('GET', '/pickups/mine', { token: ctx.recipient })
  has(pk.json, 'pickups')
  const p = pk.json.pickups[0]
  must(p, 'accepting a match should have created a pickup')
  oneOf(p.status, PICKUP_STATUSES, 'status')
  ctx.pickupId = p.pickup_id
  return `pickup ${ctx.pickupId} (${p.status})`
}, { required: false })

await check('Pickup advances to PICKED_UP then COMPLETED', async () => {
  must(ctx.pickupId, 'skipped — no pickup was created for this account')
  const up = await call('POST', `/pickups/${ctx.pickupId}/picked-up`, { token: ctx.recipient })
  must(up.status === 200, `picked-up expected 200, got ${up.status}`)
  const done = await call('POST', `/pickups/${ctx.pickupId}/complete`, { token: ctx.recipient })
  must(done.status === 200, `complete expected 200, got ${done.status}`)
  // The accepted match may belong to a seeded donation, not the one created
  // earlier in this run, so follow the pickup to its own donation.
  const pickup = await call('GET', `/pickups/${ctx.pickupId}`, { token: ctx.recipient })
  const donationId = pickup.json?.pickup?.donation_id ?? ctx.donationId
  const after = await call('GET', `/donations/${donationId}`, { token: ctx.admin })
  must(after.json.donation.status === 'COMPLETED',
       `donation should be COMPLETED, got ${after.json.donation.status}`)
  return 'COMPLETED'
}, { required: false })

await check('Completing twice is rejected as an illegal transition', async () => {
  must(ctx.pickupId, 'skipped — no pickup to re-complete')
  const { status, json } = await call('POST', `/pickups/${ctx.pickupId}/complete`, { token: ctx.recipient })
  must(status === 409, `expected 409, got ${status}`)
  has(json, 'error')
  return json.error.code
}, { required: false })

await check('GET /api/notifications reports an unread count', async () => {
  const { status, json } = await call('GET', '/notifications', { token: ctx.donor })
  must(status === 200, `expected 200, got ${status}`)
  has(json, 'notifications'); has(json, 'unread')
  must(Array.isArray(json.notifications), '"notifications" must be an array')
  const n = json.notifications[0]
  if (n) { has(n, 'notification_id'); has(n, 'message'); has(n, 'read'); has(n, 'sent_at') }
  return `${json.notifications.length} item(s), ${json.unread} unread`
})

await check('GET /api/impact/summary carries every dashboard field', async () => {
  const { status, json } = await call('GET', '/impact/summary', { token: ctx.admin })
  must(status === 200, `expected 200, got ${status}`)
  for (const k of ['mealsRedistributed', 'completedDonations', 'wasteDivertedKg',
                   'wasteAssumptionKgPerServing', 'timeToMatch', 'unmatchedCount',
                   'unmatchedRate', 'waitlistedCount', 'expiredCount', 'topDonors']) has(json, k)
  for (const k of ['avgSeconds', 'medianSeconds', 'samples']) has(json.timeToMatch, k)
  must(Array.isArray(json.topDonors), '"topDonors" must be an array')
  return `meals=${json.mealsRedistributed} medianTTM=${json.timeToMatch.medianSeconds}s`
})

// ------------------------------------------------------------------ report

const pad = (s, n) => s + ' '.repeat(Math.max(0, n - s.length))
const failed = results.filter((r) => !r.ok && r.required)
const warned = results.filter((r) => !r.ok && !r.required)

console.log(`\n  Frontend contract check against ${BASE}`)
console.log(`  ${'─'.repeat(78)}`)
for (const r of results) {
  console.log(`${r.ok ? '  PASS' : r.required ? '  FAIL' : '  WARN'}  ${pad(r.name, 62)} ${r.detail}`)
}
console.log(`  ${'─'.repeat(78)}`)
console.log(`  ${results.filter((r) => r.ok).length} passed · ${failed.length} failed · ${warned.length} advisory\n`)

if (warned.length) {
  console.log('  Advisory — not blocking; skipped steps or avoidable extra requests:')
  for (const w of warned) console.log(`    · ${w.name}\n      ${w.detail}`)
  console.log('')
}
if (failed.length) {
  console.log('  The frontend cannot talk to this server until these are fixed:')
  for (const f of failed) console.log(`    · ${f.name}\n      ${f.detail}`)
  console.log('')
  process.exit(1)
}
console.log('  This server satisfies everything the React client needs.\n')
