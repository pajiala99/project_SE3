# FoodBridge API Reference (Person B — Backend API)

Base URL: `http://localhost:3000/api`
Auth: `Authorization: Bearer <JWT>` from `/auth/login` or `/auth/register`.
Errors: `{ "error": { "code": string, "message": string, "details?": any } }`
with correct HTTP codes (400 validation, 401 auth, 403 role, 404 missing,
409 illegal state/transition, 502 matcher unreachable).

Roles: `DONOR`, `RECIPIENT`, `ADMIN`.

## /api/auth

| Method & path | Role | Body → Response |
|---|---|---|
| `POST /auth/register` | public | `role` is `DONOR` or `RECIPIENT` only — admin accounts are provisioned by the operators, never self-registered (`400` otherwise). `{name,email,password(≥8),role,phone?}` + donor: `{donorType}` or recipient: `{organizationType,servingCapacity,serviceRadiusKm?,foodPreferences?[],dietaryRestrictions?[],latitude,longitude}` → `201 {user,profile,token}` |
| `POST /auth/login` | public | `{email,password}` → `{user,profile,token}` |
| `GET /auth/me` | any | → `{user,profile}` |

Every auth endpoint returns `user` in the same shape: the `users` row in snake_case (`user_id, name, email, phone, role, address, latitude, longitude, created_at`), never the password hash.
| `PATCH /auth/profile` | any | profile fields (recipients: capacity/radius/preferences/active) → `{user,profile}` |

## /api/donations

| Method & path | Role | Notes |
|---|---|---|
| `POST /donations` | DONOR | `{foodType,description?,quantityServings,latitude+longitude \| pickupAddress,expiresAt \| expiresInHours,pickupStart?,pickupEnd?}` → `201 {donation(PENDING_REVIEW), locationSource}` |
| `GET /donations/mine` | DONOR | own donations, newest first |
| `GET /donations/:id` | owner / ADMIN / matched RECIPIENT | `{donation,reviews[],matches[],pickups[],events[]}` — audit trail for the timeline UI. `events` lists every status change of the donation, its offers and pickups, oldest first: `{entity_type: DONATION\|MATCH\|PICKUP, entity_id, from_status, to_status, actor_id, actor_name, actor_role, occurred_at, recipient_id}`; `actor_id` is `null` when the system acted (scheduled expiry, automatic re-match). A recipient only gets donations offered to it (else `403`), and `matches`/`pickups`/`events` are filtered to its own. |
| `POST /donations/:id/cancel` | DONOR (owner) | only from `PENDING_REVIEW`/`POSTED`; donor gets `DONATION_CANCELLED`, and admins too if it was still awaiting review |
| `PUT /donations/:id/rating` | DONOR (owner) / RECIPIENT (accepted it) | `{rating: 1-5, comment?}` → `{rating}`. Status-clarity rating, only once the donation is `COMPLETED` (`409 NOT_COMPLETED` before); re-submitting replaces the earlier one. |

## /api/admin

| Method & path | Role | Notes |
|---|---|---|
| `GET /admin/donations/pending` | ADMIN | review queue (`PENDING_REVIEW`) |
| `GET /admin/donations/:id` | ADMIN | donation + review history |
| `GET /admin/donations/:id/explanations` | ADMIN | `{donationId, runs[{run_id, strategy, ran_at, triggered_by, outcome, candidates[{recipientId, eligible, reasons[], totalScore, proximityScore, capacityScore, distanceKm}]}]}` — the matcher's stored reasoning for every cycle that considered the donation, newest first (SRS NFR-17) |
| `PATCH /admin/donations/:id/review` | ADMIN | `{decision: APPROVED\|REJECTED, remarks?}` → approve: `PENDING_REVIEW→POSTED`; reject: `→REJECTED`. Row lock + transaction; second review → `409 ALREADY_REVIEWED`. Review persisted in `donation_reviews`. |
| `POST /admin/matching/run` | ADMIN | `{strategy?: "greedy"\|"hungarian"}` → one matching cycle, in one transaction — if the matcher is unreachable it returns `502` and nothing changes: `{strategy, assignments[], waitlisted[], explanations[], expiredDonations[], expiredMatches[]}` |
| `GET /admin/waitlist` | ADMIN | donations that found no eligible recipient (never dropped) |

## /api/matches

| Method & path | Role | Notes |
|---|---|---|
| `GET /matches/inbox` | RECIPIENT | own match offers, newest first. Each offer embeds `donation: {donation_id, food_type, description, quantity_servings, pickup_address, pickup_start, pickup_end, expires_at, status, donor_name}`. |
| `GET /matches/:id` | the match's recipient / the donation's donor / ADMIN | match detail with score breakdown; anyone else `403` |
| `POST /matches/:id/accept` | RECIPIENT (owner of match) | `PENDING→ACCEPTED`; creates **Pickup (SCHEDULED)** with scheduledAt + contactDetails; donation stays `MATCHED`. An offer past its `expires_at` → `409 OFFER_EXPIRED`, no state change. |
| `POST /matches/:id/reject` | RECIPIENT (owner) | `PENDING→REJECTED`, donation requeued `MATCHED→POSTED`, rejecter excluded from immediate retry, fresh matching cycle runs → `{rematched, newMatch, cycle, matcherError}`. `409 OFFER_EXPIRED` past `expires_at`. If the matcher is down the rejection still stands and `matcherError` says why no re-match happened. |

## /api/pickups

| Method & path | Role | Notes |
|---|---|---|
| `GET /pickups/mine` | any | recipient/donor-scoped list |
| `GET /pickups/:id` | the pickup's recipient / the donation's donor / ADMIN | detail; anyone else `403` |
| `POST /pickups/:id/picked-up` | the collecting RECIPIENT only (BR-4) | `SCHEDULED→PICKED_UP` **and** donation `MATCHED→PICKED_UP` (one transaction) |
| `POST /pickups/:id/complete` | the collecting RECIPIENT only (BR-4) | `PICKED_UP→COMPLETED` **and** donation `→COMPLETED`; donor meal counter + recipient capacity release in the same transaction |

## /api/notifications

| Method & path | Role | Notes |
|---|---|---|
| `GET /notifications` | any | `{notifications[], unread}` |
| `PATCH /notifications/:id/read` | owner | |
| `POST /notifications/read-all` | owner | |

Notification types: `ADMIN_REVIEW_REQUIRED, DONATION_APPROVED,
DONATION_REJECTED, NEW_ELIGIBLE_DONATION, MATCH_CREATED, MATCH_ACCEPTED,
MATCH_REJECTED, DONOR_AWAITING_MATCH, PICKUP_SCHEDULED, PICKUP_PICKED_UP,
REDISTRIBUTION_COMPLETED, MATCH_EXPIRED, DONATION_CANCELLED, DONATION_EXPIRED,
PICKUP_CANCELLED`. In-app only (no SMS/email).

## /api/impact

| Method & path | Role | Notes |
|---|---|---|
| `GET /impact/summary` | any | `{mealsRedistributed, completedDonations, wasteDivertedKg, wasteAssumptionKgPerServing, timeToMatch{avgSeconds,medianSeconds,samples} (submission → first accepted offer, SRS FR-46), unmatchedCount, unmatchedRate, waitlistedCount, expiredCount, statusClarity{donor{avg,n},recipient{avg,n}}, rescueRate{rate,rescued,resolved}, firstOfferAcceptance{rate,accepted,decided}, meanDistanceKmByStrategy{greedy{meanKm,offers},hungarian{meanKm,offers}}, topDonors[]}`. **Rescue rate**: of posted donations whose outcome is settled (COMPLETED or EXPIRED), the share completed before their deadline. **First-offer acceptance**: of each donation's first offer once answered or timed out, the share accepted. Rates are `null` when there is nothing to count yet — all computed from persisted rows/timestamps |
| `GET /impact/ttm?bucket=day\|week&days=30` | any | time-to-match trend (submission → first accepted offer) by the day/week donations were submitted: `{bucket, days, targetSeconds: 1200, points[{bucket: 'YYYY-MM-DD', medianSeconds, avgSeconds, n}]}` |

## Matching service (separate process, :8000)

| Method & path | Notes |
|---|---|
| `GET /health` | liveness + strategies |
| `POST /match/run` | JSON contract in `matching-service/models.py`; backend precomputes pair distances with PostGIS `ST_DWithin`/`ST_Distance` and passes them as `pairDistances` |

## Status models enforced centrally

- **Donation**: `PENDING_REVIEW → POSTED → MATCHED → PICKED_UP → COMPLETED`;
  sides: `REJECTED`, `CANCELLED`, `EXPIRED`; rematch requeue `MATCHED→POSTED`.
- **Match**: `PENDING → ACCEPTED | REJECTED | EXPIRED` (terminal).
- **Pickup**: `SCHEDULED → PICKED_UP → COMPLETED`; `SCHEDULED→CANCELLED`.

All in `backend/src/domain/stateMachines.ts`; illegal transitions return
`409 INVALID_TRANSITION` / `409 INVALID_STATE`.

## Expiry (scheduled, SRS FR-35 / FR-52 / NFR-9)

A background sweep runs every `SWEEP_INTERVAL_SECONDS` (default 60; `0`
disables it) and at the start of every matching cycle:

- a donation whose deadline passes before collection — `PENDING_REVIEW`,
  `POSTED` or `MATCHED` — becomes `EXPIRED`; any open offer on it expires, a
  scheduled pickup is `CANCELLED` and the organisation's reserved capacity is
  released; donor and organisation are notified;
- an offer unanswered after its 30-minute window becomes `EXPIRED` and its
  donation returns to `POSTED` for the next cycle; both parties are notified.

## Audit trail (SRS NFR-19)

Every status change of a donation, offer or pickup is written to
`status_events` by a database trigger, with the acting user taken from the
transaction (`null` = system). Read it through `events` on `GET /donations/:id`.
