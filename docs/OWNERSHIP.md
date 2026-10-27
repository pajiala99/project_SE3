# FoodBridge — Team Ownership Audit

This file records which team member owns every file/component after the
scope correction. It exists because an earlier instruction accidentally had
**Person B** implement parts of Person A's and Person C's scope. Nothing was
deleted; the table below says what each piece does and its status.

- **Person A** — React frontend (all UI)
- **Person B** — Backend API & Matching Engine (Node/Express API, auth wiring,
  donation CRUD + lifecycle endpoints, admin-review backend, match lifecycle,
  accept/reject, re-match on rejection/timeout, Python matching service,
  greedy + Hungarian, radius-expansion/waitlist, pickup backend lifecycle,
  backend notification hooks, APIs for Person A, backend+matcher tests)
- **Person C** — PostgreSQL/PostGIS schema ownership, spatial DB
  infrastructure, geocoding integration/cache, CI/CD, DB/DevOps docs

## Backend (`backend/`)

| File / Component | What it does | Owner | Status |
|---|---|---|---|
| `src/domain/enums.ts` | Closed enums: DonationStatus (no ACCEPTED), MatchStatus, PickupStatus, ReviewDecision, roles, donor/org types | B | Keep — complete |
| `src/domain/stateMachines.ts` | Single source of truth for donation/match/pickup transitions | B | Keep — complete |
| `src/middleware/authenticate.ts` | JWT sign/verify, `authenticate`, `requireRole` | B | Keep — complete |
| `src/middleware/errorHandler.ts` | Consistent `{error:{code,message}}` envelope | B | Keep — complete |
| `src/routes/index.ts` | All `/api/*` route groups with role guards | B | Keep — complete |
| `src/controllers/index.ts` | Thin HTTP handlers per resource | B | Keep — complete |
| `src/services/authService.ts` | register/login/updateProfile with bcrypt + JWT | B | Keep — complete |
| `src/services/donationService.ts` | Donation CRUD, detail+history, cancel, `isActive`/`remainingTime` helpers | B | Keep — complete |
| `src/services/reviewService.ts` | Admin review (row lock + tx, approve→POSTED / reject→REJECTED) | B | Keep — complete |
| `src/services/matchingService.ts` | Matching-cycle orchestration: PostGIS candidate query → Python service → tx persistence; accept/reject; rejection rematch; offer-timeout sweep; waitlist | B | Keep — complete |
| `src/services/pickupService.ts` | Pickup SCHEDULED→PICKED_UP→COMPLETED with donation transitions in one tx | B | Keep — complete |
| `src/services/notificationService.ts` | In-app notification events/hooks (DB rows) | B | Keep — complete (UI is Person A) |
| `src/services/impactService.ts` | Impact metrics API: meals, waste (documented assumption), TTM, unmatched, expired, top donors | B | Keep — complete (dashboard UI is Person A) |
| `src/services/geocodingService.ts` | Address→coords with cache + Nominatim | C | **Hand off** — implemented out of necessity; consumed by B via this interface; Person C owns provider/rate-limit/cache policy |
| `src/repositories/*` | SQL data access (per entity) | B (schema itself: C) | Keep — B consumes C's schema through these |
| `src/db/pool.ts` | pg pool + `withTransaction` helper | B | Keep |
| `src/db/migrate.ts` | Migration runner | Shared (C owns migrations) | Keep |
| `src/db/seed.ts` | Demo data (5 spec scenarios) | B (demo data for backend/matching) | Keep — complete |
| `migrations/001_initial_schema.sql` | PostgreSQL/PostGIS schema, indexes | **C** | **Hand off** — created during wrong-scope phase; C reviews/owns |
| `tests/*` (41 tests) | auth, roles, review, lifecycle, matching integration, pickup, impact, state machines | B | Keep — passing |
| `vitest.config.ts`, `tsconfig.json`, `package.json` | Backend tooling | B | Keep |

## Matching service (`matching-service/`)

| File / Component | What it does | Owner | Status |
|---|---|---|---|
| `app.py` | FastAPI app: `GET /health`, `POST /match/run` | B | Keep — complete |
| `models.py` | Pydantic JSON contract | B | Keep — complete |
| `filtering.py` | Hard eligibility filters + progressive radius expansion | B | Keep — complete |
| `scoring.py` | urgency/proximity/capacity weighted scoring (configurable weights) | B | Keep — complete |
| `greedy.py` | Multi-donation greedy, most-urgent-first, deterministic | B | Keep — complete |
| `hungarian.py` | `scipy.optimize.linear_sum_assignment` strategy | B | Keep — complete |
| `geo.py` | Haversine fallback (PostGIS distances preferred) | B | Keep |
| `tests/` (28 tests) | filters, greedy order, contention, expansion, waitlist, determinism, Hungarian, greedy-vs-Hungarian, HTTP contract | B | Keep — passing |
| `requirements.txt` | Python deps | B | Keep |

## Frontend (`frontend/`) — **PERSON A HANDOFF, not Person B scope**

| File / Component | What it does | Owner | Status |
|---|---|---|---|
| All of `frontend/` (React+TS+Vite SPA: login/register, donor pages, recipient inbox/pickups/profile, admin review/operations, impact dashboard, notifications; `tsc --noEmit` passes) | UI for the whole platform | **A** | **Hand off** — compiles; Person A owns, restyles, extends. Person B will NOT expand it. |

## Infrastructure / DevOps

| File / Component | What it does | Owner | Status |
|---|---|---|---|
| Local PostGIS install (Postgres.app at `~/Applications/Postgres.app`, `.pgdata/` data dir — git-ignored) | Running canonical DB | **C** | **Hand off** — working locally; C owns provisioning |
| `scripts/db-start.sh`, `scripts/db-stop.sh` | Idempotent local DB bootstrap | **C** (interim by B) | **Hand off** — kept so B's tests/demo run; C replaces with their setup (e.g. docker compose) |
| `scripts/dev.sh` | Starts db + backend + matcher | Shared | Keep (interim) |
| `scripts/test-all.sh` | Person B test gates | B | Keep |
| `scripts/e2e-demo.mjs` | Scripted full API workflow (submit→review→match→accept→pickup→complete→impact) | B | Keep — passing |
| CI / GitHub Actions | — | **C** | **Not started** (owned by C) |
| `docker-compose.yml` | — | **C** | **Not started** (owned by C; no Docker on this machine) |
| Lint/format configs | — | **C** (CI) | **Not started** — `lint` scripts removed to avoid broken commands |

## Documentation

| File | Owner | Status |
|---|---|---|
| `README.md` | Shared (B maintains run instructions for backend/matcher) | Updated |
| `docs/OWNERSHIP.md` (this file) | Shared | Current |
| `docs/API.md` | B | Written |
| `docs/MATCHING_ALGORITHM.md` | B | Written |
| `docs/SPEC_ALIGNMENT.md` | Shared (B filled backend/matching rows) | Written |
| DB/DevOps docs, CI docs | C | TODO for Person C |
| Frontend UX docs | A | TODO for Person A |
