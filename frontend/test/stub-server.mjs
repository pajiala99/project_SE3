#!/usr/bin/env node
/**
 * Stub of the Person B backend — a TEST DOUBLE, not the project's backend.
 *
 * It mirrors backend/src/routes/index.ts and the row shapes in
 * backend/src/repositories/*, so the React client can be exercised over real
 * HTTP without PostgreSQL/PostGIS installed. No persistence, tokens are opaque
 * strings rather than real JWTs, and the matcher is a stand-in.
 *
 * The real backend and matching engine are Person B's deliverable. Verify
 * against that with `npm run check:contract` before believing anything here.
 *
 *   node test/stub-server.mjs [--port 3000]
 */

import { createServer } from 'node:http'

const portIdx = process.argv.indexOf('--port')
const PORT = Number(portIdx !== -1 ? process.argv[portIdx + 1] : 3000)

const iso = (d = new Date()) => new Date(d).toISOString()
const hours = (n) => iso(Date.now() + n * 3600e3)
let seq = 0
const id = (p) => `${p}_${Date.now().toString(36)}${(seq++).toString(36)}`

class HttpError extends Error {
  constructor(status, code, message, details) {
    super(message); this.status = status; this.code = code; this.details = details
  }
}
const fail = (s, c, m, d) => { throw new HttpError(s, c, m, d) }

// ------------------------------------------------------------------- state

const db = { users: [], donors: {}, recipients: {}, donations: [], reviews: [], matches: [], pickups: [], notifications: [], waitlist: [], tokens: {} }

function seedUser({ name, email, role, ...extra }) {
  const user = { user_id: id('u'), name, email, role, phone: extra.phone ?? null, address: null, created_at: iso() }
  db.users.push(user)
  if (role === 'RECIPIENT') {
    db.recipients[user.user_id] = {
      user_id: user.user_id, organization_type: extra.organizationType ?? 'SHELTER',
      serving_capacity: extra.servingCapacity ?? 120, assigned_servings: 0,
      service_radius_km: extra.serviceRadiusKm ?? 8,
      latitude: extra.latitude ?? 30.3398, longitude: extra.longitude ?? 76.3869, active: true,
    }
  }
  if (role === 'DONOR') db.donors[user.user_id] = { user_id: user.user_id, donor_type: extra.donorType ?? 'MESS' }
  return user
}

// Same logins as the backend's own seed.ts, so whatever you learn here still
// works once the real database is up. Coordinates are Patiala, not the
// backend seed's Bengaluru — the project is Thapar/Patiala, and a donor posting
// from Patiala can never match a recipient 1,900 km away.
;[
  { name: 'Asha (Admin)', email: 'admin@foodbridge.local', role: 'ADMIN' },
  { name: 'Campus Cafeteria', email: 'donor@foodbridge.local', role: 'DONOR', phone: '+91-90000-00002' },
  { name: 'Grand Restaurant', email: 'donor2@foodbridge.local', role: 'DONOR', phone: '+91-90000-00003' },
  { name: 'Hope Shelter', email: 'hope@foodbridge.local', role: 'RECIPIENT', phone: '+91-90000-00011',
    organizationType: 'SHELTER', servingCapacity: 100, serviceRadiusKm: 12, latitude: 30.3398, longitude: 76.3869 },
  { name: 'Sunrise NGO', email: 'sunrise@foodbridge.local', role: 'RECIPIENT', phone: '+91-90000-00012',
    organizationType: 'NGO', servingCapacity: 60, serviceRadiusKm: 12, latitude: 30.3221, longitude: 76.4009 },
  { name: 'Green Plate Collective', email: 'green@foodbridge.local', role: 'RECIPIENT', phone: '+91-90000-00013',
    organizationType: 'COMMUNITY_KITCHEN', servingCapacity: 60, serviceRadiusKm: 12, latitude: 30.3345, longitude: 76.3924 },
  { name: 'Little Angels Home', email: 'angels@foodbridge.local', role: 'RECIPIENT', phone: '+91-90000-00015',
    organizationType: 'ORPHANAGE', servingCapacity: 10, serviceRadiusKm: 10, latitude: 30.3122, longitude: 76.4041 },
].forEach(seedUser)

const notify = (user_id, type, message) =>
  db.notifications.push({ notification_id: id('nt'), user_id, type, message, sent_at: iso(), read: false })

const userOf = (req) => {
  const h = req.headers.authorization ?? ''
  const t = h.startsWith('Bearer ') ? h.slice(7) : null
  const uid = t ? db.tokens[t] : null
  const u = db.users.find((x) => x.user_id === uid)
  if (!u) fail(401, 'UNAUTHENTICATED', 'Sign in to continue.')
  return u
}
const requireRole = (u, role) => { if (u.role !== role) fail(403, 'FORBIDDEN', `This action requires the ${role} role.`) }

const issueToken = (u) => { const t = id('tok'); db.tokens[t] = u.user_id; return t }
const authShape = (u) => ({ userId: u.user_id, email: u.email, name: u.name, role: u.role })
const profileOf = (u) => (u.role === 'DONOR' ? db.donors[u.user_id] : u.role === 'RECIPIENT' ? db.recipients[u.user_id] : null)

// --------------------------------------------------------------- matching

function runCycle(strategy = 'greedy') {
  const assignments = [], waitlisted = []
  for (const d of db.donations.filter((x) => x.status === 'POSTED')) {
    const already = db.matches.filter((m) => m.donation_id === d.donation_id && m.status === 'REJECTED')
      .map((m) => m.recipient_id)
    const cands = Object.values(db.recipients).filter((r) =>
      r.active && !already.includes(r.user_id) &&
      r.serving_capacity - r.assigned_servings >= d.quantity_servings)

    if (!cands.length) { waitlisted.push({ donation_id: d.donation_id, reason: 'no eligible recipient' }); db.waitlist.push({ donation_id: d.donation_id, reason: 'no eligible recipient' }); continue }

    const r = cands[0]
    const match = {
      match_id: id('m'), donation_id: d.donation_id, recipient_id: r.user_id,
      recipient_name: db.users.find((u) => u.user_id === r.user_id)?.name,
      score: 0.81, distance_km: 2.87,
      urgency_score: 0.4, proximity_score: 0.9, capacity_score: 0.6,
      status: 'PENDING', search_radius_km: r.service_radius_km,
      expires_at: iso(Date.now() + 15 * 60000), created_at: iso(), responded_at: null,
    }
    db.matches.push(match)
    d.status = 'MATCHED'
    d.matched_at = iso()
    assignments.push({ donationId: d.donation_id, recipientId: r.user_id, score: match.score })
    notify(r.user_id, 'MATCH_CREATED', `New offer: ${d.quantity_servings} servings, 2.87 km away.`)
    notify(d.donor_id, 'MATCH_CREATED', 'Your donation was offered to an organisation.')
  }
  return { strategy, assignments, waitlisted, explanations: [], expiredDonations: [], expiredMatches: [] }
}

// ------------------------------------------------------------------ routes

function route(method, seg, query, body, req) {
  const [a, b, c, d] = seg

  if (a === 'health') return [200, { status: 'ok', service: 'foodbridge-backend-stub' }]

  if (a === 'auth') {
    if (b === 'register' && method === 'POST') {
      const details = {}
      if (!body?.name?.trim()) details.name = "'name' is required."
      if (!body?.email?.trim()) details.email = "'email' is required."
      if (!body?.password || body.password.length < 8) details.password = "'password' must be at least 8 characters."
      if (!['DONOR', 'RECIPIENT', 'ADMIN'].includes(body?.role)) details.role = "'role' must be DONOR, RECIPIENT or ADMIN."
      if (Object.keys(details).length) fail(400, 'VALIDATION_ERROR', 'Please correct the highlighted fields.', details)
      if (db.users.some((u) => u.email === body.email)) fail(409, 'EMAIL_IN_USE', 'That email is already registered.')
      const u = seedUser(body)
      return [201, { user: { ...authShape(u), phone: u.phone, address: u.address }, profile: profileOf(u), token: issueToken(u) }]
    }
    if (b === 'login' && method === 'POST') {
      const u = db.users.find((x) => x.email === body?.email)
      if (!u) fail(401, 'UNAUTHENTICATED', 'Invalid email or password.')
      return [200, { user: authShape(u), token: issueToken(u) }]
    }
    if (b === 'me' && method === 'GET') { const u = userOf(req); return [200, { user: u, profile: profileOf(u) }] }
    if (b === 'profile' && method === 'PATCH') { const u = userOf(req); Object.assign(u, body ?? {}); return [200, { user: u, profile: profileOf(u) }] }
  }

  if (a === 'donations') {
    if (!b && method === 'POST') {
      const u = userOf(req); requireRole(u, 'DONOR')
      const details = {}
      if (!body?.foodType) details.foodType = "'foodType' is required."
      if (!Number.isInteger(body?.quantityServings) || body.quantityServings < 1)
        details.quantityServings = "'quantityServings' must be a positive whole number."
      if (!body?.expiresAt && !body?.expiresInHours) details.expiresInHours = 'Set a collection deadline.'
      if (Object.keys(details).length) fail(400, 'VALIDATION_ERROR', 'Please correct the highlighted fields.', details)

      const donation = {
        donation_id: id('dn'), donor_id: u.user_id, donor_name: u.name,
        food_type: body.foodType, description: body.description ?? null,
        quantity_servings: body.quantityServings,
        pickup_address: body.pickupAddress ?? null,
        latitude: body.latitude ?? 30.3548, longitude: body.longitude ?? 76.3626,
        submitted_at: iso(), posted_at: null, matched_at: null,
        pickup_start: null, pickup_end: null,
        expires_at: body.expiresAt ?? hours(body.expiresInHours ?? 4),
        status: 'PENDING_REVIEW', created_at: iso(), updated_at: iso(),
      }
      db.donations.push(donation)
      db.users.filter((x) => x.role === 'ADMIN').forEach((ad) =>
        notify(ad.user_id, 'ADMIN_REVIEW_REQUIRED', `${u.name} posted ${donation.quantity_servings} servings for review.`))
      return [201, { donation, locationSource: body.latitude ? 'COORDINATES' : 'ADDRESS' }]
    }
    if (b === 'mine' && method === 'GET') {
      const u = userOf(req); requireRole(u, 'DONOR')
      return [200, { donations: db.donations.filter((x) => x.donor_id === u.user_id).reverse() }]
    }
    if (b && !c && method === 'GET') {
      const u = userOf(req)
      const donation = db.donations.find((x) => x.donation_id === b) ?? fail(404, 'NOT_FOUND', `Donation '${b}' not found.`)
      if (u.role === 'DONOR' && donation.donor_id !== u.user_id)
        fail(403, 'FORBIDDEN', 'Donors can only view their own donations.')
      const matches = db.matches.filter((m) => m.donation_id === b)
      return [200, {
        donation,
        reviews: db.reviews.filter((r) => r.donation_id === b),
        matches,
        pickups: db.pickups.filter((p) => matches.some((m) => m.match_id === p.match_id)),
      }]
    }
    if (c === 'cancel' && method === 'POST') {
      const u = userOf(req); requireRole(u, 'DONOR')
      const donation = db.donations.find((x) => x.donation_id === b) ?? fail(404, 'NOT_FOUND', 'Donation not found.')
      if (donation.donor_id !== u.user_id) fail(403, 'FORBIDDEN', 'Only the owning donor can cancel this donation.')
      if (!['PENDING_REVIEW', 'POSTED'].includes(donation.status))
        fail(409, 'INVALID_STATE', `A donation that is ${donation.status} cannot be cancelled.`)
      donation.status = 'CANCELLED'
      return [200, { donation }]
    }
  }

  if (a === 'admin') {
    const u = userOf(req); requireRole(u, 'ADMIN')
    if (b === 'donations' && c === 'pending') return [200, { donations: db.donations.filter((x) => x.status === 'PENDING_REVIEW') }]
    if (b === 'donations' && d === 'review' && method === 'PATCH') {
      const donation = db.donations.find((x) => x.donation_id === c) ?? fail(404, 'NOT_FOUND', 'Donation not found.')
      if (donation.status !== 'PENDING_REVIEW') fail(409, 'ALREADY_REVIEWED', 'This donation has already been reviewed.')
      const decision = body?.decision
      if (!['APPROVED', 'REJECTED'].includes(decision))
        fail(400, 'VALIDATION_ERROR', "'decision' must be APPROVED or REJECTED.", { decision: 'APPROVED | REJECTED' })
      db.reviews.push({ review_id: id('rv'), donation_id: donation.donation_id, admin_id: u.user_id, decision, remarks: body?.remarks ?? null, reviewed_at: iso() })
      if (decision === 'APPROVED') { donation.status = 'POSTED'; donation.posted_at = iso() } else donation.status = 'REJECTED'
      notify(donation.donor_id, decision === 'APPROVED' ? 'DONATION_APPROVED' : 'DONATION_REJECTED',
        decision === 'APPROVED' ? 'Your donation was approved and is now open for matching.' : `Your donation was rejected. ${body?.remarks ?? ''}`)
      return [200, { donation, review: db.reviews.at(-1) }]
    }
    if (b === 'matching' && c === 'run' && method === 'POST') return [200, runCycle(body?.strategy)]
    if (b === 'waitlist') return [200, { waitlist: db.waitlist }]
  }

  if (a === 'matches') {
    const u = userOf(req)
    if (b === 'inbox') { requireRole(u, 'RECIPIENT'); return [200, { matches: db.matches.filter((m) => m.recipient_id === u.user_id).reverse() }] }
    if (b && c === 'accept' && method === 'POST') {
      requireRole(u, 'RECIPIENT')
      const m = db.matches.find((x) => x.match_id === b) ?? fail(404, 'NOT_FOUND', 'Match not found.')
      if (m.recipient_id !== u.user_id) fail(403, 'FORBIDDEN', 'This match belongs to another recipient.')
      if (m.status !== 'PENDING') fail(409, 'INVALID_STATE', 'You have already responded to this match.')
      const donation = db.donations.find((x) => x.donation_id === m.donation_id)
      m.status = 'ACCEPTED'; m.responded_at = iso()
      db.recipients[u.user_id].assigned_servings += donation.quantity_servings
      const donorUser = db.users.find((x) => x.user_id === donation.donor_id)
      const pickup = {
        pickup_id: id('pk'), match_id: m.match_id, scheduled_at: iso(Date.now() + 3600e3),
        contact_details: `Donor: ${donorUser?.name} (${donorUser?.phone ?? 'no phone'}) | Recipient: ${u.name} (${u.phone ?? 'no phone'})`,
        status: 'SCHEDULED', picked_up_at: null, completed_at: null, created_at: iso(),
        donation_id: donation.donation_id, recipient_id: u.user_id,
        food_type: donation.food_type, quantity_servings: donation.quantity_servings,
        pickup_address: donation.pickup_address,
      }
      db.pickups.push(pickup)
      notify(donation.donor_id, 'MATCH_ACCEPTED', `${u.name} accepted your donation.`)
      return [200, { match: m, pickup }]
    }
    if (b && c === 'reject' && method === 'POST') {
      requireRole(u, 'RECIPIENT')
      const m = db.matches.find((x) => x.match_id === b) ?? fail(404, 'NOT_FOUND', 'Match not found.')
      if (m.status !== 'PENDING') fail(409, 'INVALID_STATE', 'You have already responded to this match.')
      m.status = 'REJECTED'; m.responded_at = iso()
      const donation = db.donations.find((x) => x.donation_id === m.donation_id)
      donation.status = 'POSTED'
      notify(donation.donor_id, 'MATCH_REJECTED', 'A recipient declined. Re-matching your donation now.')
      const cycle = runCycle()
      return [200, { rematched: cycle.assignments.length > 0, newMatch: db.matches.at(-1), cycle }]
    }
    if (b && !c && method === 'GET') return [200, { match: db.matches.find((x) => x.match_id === b) ?? fail(404, 'NOT_FOUND', 'Match not found.') }]
  }

  if (a === 'pickups') {
    const u = userOf(req)
    if (b === 'mine') {
      const mine = db.pickups.filter((p) => {
        if (u.role === 'RECIPIENT') return p.recipient_id === u.user_id
        const don = db.donations.find((x) => x.donation_id === p.donation_id)
        return u.role === 'ADMIN' || don?.donor_id === u.user_id
      })
      return [200, { pickups: mine.reverse() }]
    }
    if (b && (c === 'picked-up' || c === 'complete') && method === 'POST') {
      const p = db.pickups.find((x) => x.pickup_id === b) ?? fail(404, 'NOT_FOUND', 'Pickup not found.')
      const donation = db.donations.find((x) => x.donation_id === p.donation_id)
      if (c === 'picked-up') {
        if (p.status !== 'SCHEDULED') fail(409, 'INVALID_TRANSITION', `A pickup that is ${p.status} cannot be marked picked up.`)
        p.status = 'PICKED_UP'; p.picked_up_at = iso(); donation.status = 'PICKED_UP'
        notify(donation.donor_id, 'PICKUP_PICKED_UP', 'Your donation has been collected.')
      } else {
        if (p.status !== 'PICKED_UP') fail(409, 'INVALID_TRANSITION', `A pickup that is ${p.status} cannot be completed.`)
        p.status = 'COMPLETED'; p.completed_at = iso(); donation.status = 'COMPLETED'
        db.recipients[p.recipient_id].assigned_servings -= donation.quantity_servings
        notify(donation.donor_id, 'REDISTRIBUTION_COMPLETED', `${donation.quantity_servings} servings redistributed.`)
      }
      return [200, { pickup: p }]
    }
    if (b && !c && method === 'GET') return [200, { pickup: db.pickups.find((x) => x.pickup_id === b) ?? fail(404, 'NOT_FOUND', 'Pickup not found.') }]
  }

  if (a === 'notifications') {
    const u = userOf(req)
    const mine = db.notifications.filter((n) => n.user_id === u.user_id)
    if (!b && method === 'GET') return [200, { notifications: [...mine].reverse(), unread: mine.filter((n) => !n.read).length }]
    if (b === 'read-all' && method === 'POST') { mine.forEach((n) => { n.read = true }); return [200, { ok: true }] }
    if (b && c === 'read' && method === 'PATCH') {
      const n = mine.find((x) => x.notification_id === b) ?? fail(404, 'NOT_FOUND', 'Notification not found.')
      n.read = true; return [200, { ok: true }]
    }
  }

  if (a === 'impact' && b === 'summary') {
    userOf(req)
    const completed = db.donations.filter((x) => x.status === 'COMPLETED')
    const meals = completed.reduce((s, x) => s + x.quantity_servings, 0)
    const ttms = db.matches.filter((m) => m.status === 'ACCEPTED' && m.responded_at)
      .map((m) => (new Date(m.responded_at) - new Date(m.created_at)) / 1000)
    const median = ttms.length ? [...ttms].sort((x, y) => x - y)[Math.floor(ttms.length / 2)] : null
    const reviewed = db.donations.filter((x) => x.status !== 'PENDING_REVIEW').length
    const unmatched = db.donations.filter((x) => ['POSTED', 'EXPIRED'].includes(x.status)).length
    const byDonor = new Map()
    for (const x of completed) byDonor.set(x.donor_id, (byDonor.get(x.donor_id) ?? 0) + x.quantity_servings)
    return [200, {
      mealsRedistributed: meals,
      completedDonations: completed.length,
      wasteDivertedKg: Math.round(meals * 0.4 * 100) / 100,
      wasteAssumptionKgPerServing: 0.4,
      timeToMatch: {
        avgSeconds: ttms.length ? Math.round(ttms.reduce((s, v) => s + v, 0) / ttms.length) : null,
        medianSeconds: median == null ? null : Math.round(median),
        samples: ttms.length,
      },
      unmatchedCount: unmatched,
      unmatchedRate: reviewed ? Math.round((unmatched / reviewed) * 1000) / 1000 : 0,
      waitlistedCount: db.waitlist.length,
      expiredCount: db.donations.filter((x) => x.status === 'EXPIRED').length,
      topDonors: [...byDonor.entries()].map(([donorId, m]) => ({
        donorId, name: db.users.find((u) => u.user_id === donorId)?.name, meals: m,
        donations: completed.filter((x) => x.donor_id === donorId).length,
      })).sort((x, y) => y.meals - x.meals).slice(0, 5),
    }]
  }

  fail(404, 'NOT_FOUND', `No route for ${method} /api/${seg.join('/')}`)
}

// ------------------------------------------------------------------ server

createServer(async (req, res) => {
  const url = new URL(req.url, `http://${req.headers.host}`)
  res.setHeader('Access-Control-Allow-Origin', req.headers.origin ?? '*')
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Authorization')
  res.setHeader('Access-Control-Allow-Methods', 'GET, POST, PATCH, DELETE, OPTIONS')
  if (req.method === 'OPTIONS') { res.writeHead(204).end(); return }

  let body
  if (req.method !== 'GET') {
    const chunks = []
    for await (const ch of req) chunks.push(ch)
    const raw = Buffer.concat(chunks).toString()
    if (raw) { try { body = JSON.parse(raw) } catch { body = undefined } }
  }

  const seg = url.pathname.split('/').filter(Boolean)
  if (seg[0] !== 'api') {
    res.writeHead(404, { 'Content-Type': 'application/json' })
      .end(JSON.stringify({ error: { code: 'NOT_FOUND', message: 'Not an API route.' } }))
    return
  }

  try {
    const [status, payload] = route(req.method, seg.slice(1), url.searchParams, body, req)
    res.writeHead(status, { 'Content-Type': 'application/json' }).end(JSON.stringify(payload))
    console.log(`  ${req.method} ${url.pathname} -> ${status}`)
  } catch (e) {
    const status = e.status ?? 500
    const error = { code: e.code ?? 'INTERNAL', message: e.message }
    if (e.details) error.details = e.details
    res.writeHead(status, { 'Content-Type': 'application/json' }).end(JSON.stringify({ error }))
    console.log(`  ${req.method} ${url.pathname} -> ${status} ${error.code}`)
  }
}).listen(PORT, () => {
  console.log(`\n  Stub of the Person B API on http://localhost:${PORT}`)
  console.log('  Logins (password Password123!): admin@ / donor@ / hope@foodbridge.local')
  console.log(`  Not the project backend — verify against the real one.\n`)
})
