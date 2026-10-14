#!/usr/bin/env node
/**
 * FoodBridge end-to-end API demo (Person B: backend + matching engine).
 *
 * Drives the complete canonical workflow over HTTP against the running stack:
 *   donor login -> submit donation -> PENDING_REVIEW
 *   -> admin login -> approve -> POSTED
 *   -> matching cycle -> MATCHED (score explanation)
 *   -> recipient login -> ACCEPT -> Pickup SCHEDULED
 *   -> PICKED_UP -> COMPLETED -> impact metrics updated
 * Also demonstrates: admin rejection, and no-eligible -> radius expansion ->
 * waitlist (donation never dropped).
 *
 * Prereqs: bash scripts/db-start.sh && npm run seed && npm run dev
 */

const BASE = process.env.FOODBRIDGE_API ?? 'http://localhost:3000/api';
const PASSWORD = 'Password123!';

let failures = 0;

function step(title) {
  console.log(`\n=== ${title} ===`);
}

function check(cond, label) {
  if (cond) console.log(`  ✔ ${label}`);
  else {
    console.log(`  ✘ FAILED: ${label}`);
    failures += 1;
  }
}

async function call(method, path, { token, body } = {}) {
  const res = await fetch(`${BASE}${path}`, {
    method,
    headers: {
      'Content-Type': 'application/json',
      ...(token ? { Authorization: `Bearer ${token}` } : {}),
    },
    body: body ? JSON.stringify(body) : undefined,
  });
  const data = await res.json().catch(() => ({}));
  return { status: res.status, data };
}

async function login(email) {
  const { status, data } = await call('POST', '/auth/login', { body: { email, password: PASSWORD } });
  if (status !== 200) throw new Error(`login failed for ${email}: ${JSON.stringify(data)}`);
  return data.token;
}

const health = await fetch('http://localhost:8000/health').then((r) => r.ok).catch(() => false);
if (!health) {
  console.error('Matching service not reachable on :8000. Run: npm run dev');
  process.exit(1);
}

step('1. Donor login + submit donation (expect PENDING_REVIEW)');
const donor = await login('donor@foodbridge.local');
const created = await call('POST', '/donations', {
  token: donor,
  body: {
    foodType: 'cooked_meals',
    description: 'E2E demo: lunch surplus',
    quantityServings: 22,
    // Donor hub used by backend/src/db/seed.ts (Thapar Institute, Patiala).
    latitude: 30.3548,
    longitude: 76.3626,
    expiresInHours: 4,
  },
});
const donationId = created.data.donation.donation_id;
check(created.status === 201, 'donation created');
check(created.data.donation.status === 'PENDING_REVIEW', `status is PENDING_REVIEW (got ${created.data.donation.status})`);

step('2. Admin login, pending queue, approve (expect POSTED)');
const admin = await login('admin@foodbridge.local');
const pending = await call('GET', '/admin/donations/pending', { token: admin });
check(pending.data.donations.some((d) => d.donation_id === donationId), 'donation appears in pending queue');
const approved = await call('PATCH', `/admin/donations/${donationId}/review`, {
  token: admin,
  body: { decision: 'APPROVED', remarks: 'E2E demo approval' },
});
check(approved.data.donation.status === 'POSTED', `status POSTED after approval (got ${approved.data.donation.status})`);

step('3. Admin rejection path (second donation)');
const created2 = await call('POST', '/donations', {
  token: donor,
  body: { foodType: 'cooked_meals', description: 'E2E reject demo', quantityServings: 5, latitude: 30.3600, longitude: 76.3700, expiresInHours: 3 },
});
const rejected = await call('PATCH', `/admin/donations/${created2.data.donation.donation_id}/review`, {
  token: admin,
  body: { decision: 'REJECTED', remarks: 'Not enough detail' },
});
check(rejected.data.donation.status === 'REJECTED', `second donation REJECTED (got ${rejected.data.donation.status})`);

step('4. Greedy matching cycle (multi-donation, urgent first)');
const cycle = await call('POST', '/admin/matching/run', { token: admin, body: {} });
const ours = cycle.data.assignments.find((a) => a.donationId === donationId);
check(cycle.data.strategy === 'greedy', 'strategy greedy');
check(Boolean(ours), 'our donation matched');
if (ours) {
  console.log(`  recipient=${ours.recipientId.slice(0, 8)}… score=${ours.totalScore} (u=${ours.urgencyScore} p=${ours.proximityScore} c=${ours.capacityScore}) dist=${ours.distanceKm.toFixed(2)}km`);
}
const matchedDetail = await call('GET', `/donations/${donationId}`, { token: donor });
check(matchedDetail.data.donation.status === 'MATCHED', 'donation MATCHED');

step('5. Zero-eligible fallback: far donation -> radius expansion -> waitlist');
const farCreated = await call('POST', '/donations', {
  token: donor,
  body: { foodType: 'cooked_meals', description: 'E2E far demo', quantityServings: 8, latitude: 31.2000, longitude: 77.2000, expiresInHours: 5 },
});
const farId = farCreated.data.donation.donation_id;
await call('PATCH', `/admin/donations/${farId}/review`, { token: admin, body: { decision: 'APPROVED' } });
const cycle2 = await call('POST', '/admin/matching/run', { token: admin, body: {} });
check(cycle2.data.waitlisted.some((w) => w.donationId === farId), 'far donation waitlisted after expansion');
const farDetail = await call('GET', `/donations/${farId}`, { token: donor });
check(farDetail.data.donation.status === 'POSTED', 'far donation remains POSTED (not dropped)');
const waitlist = await call('GET', '/admin/waitlist', { token: admin });
check(waitlist.data.waitlist.some((w) => w.donation_id === farId), 'waitlist entry persisted');

step('6. Recipient login -> inbox -> ACCEPT (expect Pickup SCHEDULED)');
const detail = await call('GET', `/donations/${donationId}`, { token: donor });
const match = detail.data.matches.find((m) => m.status === 'PENDING');
const recipientEmails = ['hope@foodbridge.local', 'sunrise@foodbridge.local', 'green@foodbridge.local'];
let recipientToken = null;
for (const email of recipientEmails) {
  const token = await login(email);
  const inbox = await call('GET', '/matches/inbox', { token });
  if (inbox.data.matches.some((m) => m.match_id === match.match_id)) {
    recipientToken = token;
    break;
  }
}
const accepted = await call('POST', `/matches/${match.match_id}/accept`, { token: recipientToken });
check(accepted.data.match.status === 'ACCEPTED', 'match ACCEPTED (MatchStatus, not donation status)');
check(accepted.data.pickup.status === 'SCHEDULED', `pickup SCHEDULED (got ${accepted.data.pickup.status})`);
const pickupId = accepted.data.pickup.pickup_id;

step('7. Pickup lifecycle: PICKED_UP -> COMPLETED (donation follows)');
const picked = await call('POST', `/pickups/${pickupId}/picked-up`, { token: recipientToken });
check(picked.data.pickup.status === 'PICKED_UP', 'pickup PICKED_UP');
const afterPickup = await call('GET', `/donations/${donationId}`, { token: donor });
check(afterPickup.data.donation.status === 'PICKED_UP', 'donation PICKED_UP');
const completed = await call('POST', `/pickups/${pickupId}/complete`, { token: recipientToken });
check(completed.data.pickup.status === 'COMPLETED', 'pickup COMPLETED');
const afterComplete = await call('GET', `/donations/${donationId}`, { token: donor });
check(afterComplete.data.donation.status === 'COMPLETED', 'donation COMPLETED');

step('8. Impact metrics updated (TTM: submission -> first accepted offer)');
const impact = await call('GET', '/impact/summary', { token: admin });
console.log(' ', JSON.stringify({
  mealsRedistributed: impact.data.mealsRedistributed,
  wasteDivertedKg: impact.data.wasteDivertedKg,
  timeToMatch: impact.data.timeToMatch,
  unmatchedCount: impact.data.unmatchedCount,
  unmatchedRate: impact.data.unmatchedRate,
  expiredCount: impact.data.expiredCount,
  topDonors: impact.data.topDonors,
}, null, 2));
check(impact.data.mealsRedistributed >= 22, 'meals redistributed includes our 22 servings');
check(impact.data.timeToMatch.samples > 0, 'TTM measurable from persisted timestamps');

console.log(failures === 0 ? '\nE2E DEMO: ALL CHECKS PASSED' : `\nE2E DEMO: ${failures} CHECK(S) FAILED`);
process.exit(failures === 0 ? 0 : 1);
