# FoodBridge Matching Algorithm (Person B — Matching Engine)

Component: `matching-service/` (standalone Python 3 FastAPI service).
Backend integration: `POST /match/run` with a JSON contract
(`matching-service/models.py`); distances are precomputed by the backend with
PostGIS `ST_DWithin`/`ST_Distance` (`backend/src/services/matchingService.ts`)
and passed as `pairDistances` — the engine scores on real spatial data and
falls back to haversine only when a pair distance is absent (unit tests).

## 1. Hard eligibility filters (`filtering.py`)

A recipient is eligible for a donation at search radius `R` only if ALL hold:

1. recipient `active == true`
2. remaining capacity `servingCapacity − assignedServings − reservedThisCycle
   − pendingOffers` ≥ `quantityServings`
3. `distance ≤ min(R, recipient.serviceRadiusKm)`
4. food compatibility: `foodPreferences` empty or contains `foodType`
5. dietary restrictions: `foodType` is not listed in the recipient's
   `dietaryRestrictions` (SRS NFR-7)
6. pickup realistic: minutes until `min(expiresAt, pickupEnd)` ≥
   `minPickupFeasibilityMinutes` (30)
7. pair not excluded (recipient previously rejected this donation → excluded
   from the immediate retry)

Violations are returned per candidate with human-readable reasons
(auditability/explainability).

## 2. Scoring (`scoring.py`)

Canonical criteria per the proposal: **urgency, proximity, capacity/need**.
(Fairness from the early misread prototype was removed.)

```
urgencyScore   = clamp01(1 − minutesToExpiry / 360)          # donation-level
proximityScore = clamp01(1 − distanceKm / maxRadiusKm)       # pair-level
capacityScore  = clamp01(availableCapacity / servingCapacity)# need ratio

totalScore = w_u·urgency + w_p·proximity + w_c·capacity
```

Default weights: `urgency 0.40, proximity 0.35, capacity 0.25`
(`models.Weights`, overridable per request via `config.weights`). The backend
reads them from `config.matching.weights`, set by the environment variables
`MATCH_WEIGHT_URGENCY`, `MATCH_WEIGHT_PROXIMITY`, `MATCH_WEIGHT_CAPACITY` (SRS FR-24).

> These weights are **engineering parameters chosen for explainability, not
> scientifically optimal constants**. No empirical tuning was performed.

Every assignment returns the explanation:

```json
{ "totalScore", "urgencyScore", "proximityScore", "capacityScore",
  "distanceKm", "searchRadiusKmUsed" }
```

## 3. Greedy V1 (`greedy.py`) — default strategy

For all active POSTED donations:

1. compute remaining time-to-expiry per donation
2. **sort most-urgent-first** (tie: donation id) — urgency decides processing
   order, then enters each total score as a weighted component
3. eligible recipients via hard filters, with **progressive radius
   expansion**: `initialRadiusKm 5 → +5 → maxRadiusKm 25`
4. score candidates; take the highest-scoring one with remaining capacity
   (tie: recipient id → deterministic)
5. reserve the servings within the cycle; continue

Persistence (backend, one transaction): `Match(PENDING)` rows +
`Donation POSTED→MATCHED` (+`matched_at` for TTM) + notifications; waitlist
entries for unmatched.

**Practical complexity:** `O(D log D)` urgency sort + `O(D · R)` filter/score
worst case (each donation scans all R candidates, times a small constant
number of radius-expansion steps). Fine at city scale.

## 4. Hungarian strategy (`hungarian.py`) — second strategy

`scipy.optimize.linear_sum_assignment(maximize=True)` over the
donations×recipients score matrix (eligible pairs at max radius; ineligible
pairs −1, dropped). Config: `MATCHING_STRATEGY=hungarian` or
`POST /api/admin/matching/run {"strategy":"hungarian"}`.

- **Complexity ≈ O(n³)**, n = max(D, R) after padding.
- Deterministic: rows/cols sorted by id.
- **Documented constraint:** Hungarian assigns 1 donation ↔ 1 recipient per
  cycle (it cannot split a recipient's capacity across donations); greedy
  remains the default for that reason.
- Test `TestGreedyVsHungarian` builds a collinear scenario where greedy's
  urgent-first local choice is globally suboptimal and Hungarian scores
  higher — proving both strategies behave as theory predicts.

## 5. Zero-eligible fallback (spec §11)

`initialRadius → expand by step → maxRadius → still none → donation stays
POSTED + row in matching_waitlist (reason, max radius tried, attempts) +
donor notification (DONOR_AWAITING_MATCH)`. Retried automatically on the next
cycle. Donations are never silently dropped; unmatched/expired counts feed
the impact metrics.

## 6. Rejection / expiry rematching (spec §12)

- Reject: `Match PENDING→REJECTED`; rejecter recorded (excluded from retry);
  donation `MATCHED→POSTED`; fresh cycle runs immediately.
- Offer timeout: offers carry `expires_at` (30 min); each cycle first sweeps
  stale offers `PENDING→EXPIRED` and requeues their donations.
- All Match rows are kept forever (audit/history).
