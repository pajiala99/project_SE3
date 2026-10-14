# FoodBridge — Backend

Backend API and matching engine for FoodBridge (UCS503P Software Engineering Lab, Team 3).
Backend and matching engine: **Shikhar Goel**.

```
backend/
├── src/                 Express API (TypeScript)
├── migrations/          PostgreSQL + PostGIS schema (001 init, 002 ratings, 003 audit trail)
├── tests/               API integration tests (vitest, real database + matcher)
├── matching-service/    Python matcher: filters, scoring, greedy + Hungarian (FastAPI)
├── docs/                API.md (every endpoint), MATCHING_ALGORITHM.md
└── scripts/             db-start.sh, test-all.sh, e2e-demo.mjs
```

## What it does

- **Accounts:** register as donor or recipient organisation (admins are provisioned, not self-registered), JWT sign-in, one user shape on every auth call.
- **Donations:** submit with a deadline (validated, must be in the future), admin review, cancel, full history.
- **Matching:** hard filters (radius, capacity, food type, dietary restrictions, rejected-before, 30-minute pickup window), weighted score (urgency 0.40, proximity 0.35, capacity 0.25, configurable), greedy or Hungarian per cycle, radius widening 5 → 25 km, waitlist. Each cycle runs in one transaction, so if the matcher is down nothing changes.
- **Offers and pickups:** accept / reject (expired offers refused), automatic re-match, pickup Scheduled → Picked up → Completed by the collecting organisation only.
- **Scheduled expiry:** every 60 s, overdue donations (awaiting review, posted or matched) and unanswered offers expire; scheduled pickups are cancelled and reserved capacity released.
- **Access control:** users see only their own donations, offers and pickups.
- **Notifications:** in-app, at every transition including cancel and expiry.
- **Impact metrics:** meals, waste diverted, time-to-match (submission → first accepted offer) and its daily trend, rescue rate, first-offer acceptance, mean distance per strategy, status-clarity ratings (1–5).
- **Audit trail:** a database trigger logs every status change with time and actor; every matching run stores the matcher's per-candidate reasons.

Full endpoint reference: [docs/API.md](docs/API.md).

## Run locally

Prerequisites: Node 20+, Python 3.10+, PostgreSQL 16+ with PostGIS.

```bash
cd backend

# 1. Databases (creates foodbridge + foodbridge_test and runs migrations)
bash scripts/db-start.sh

# 2. Matching service on :8000
cd matching-service
python -m venv .venv && source .venv/bin/activate
pip install -r requirements.txt
uvicorn app:app --port 8000
cd ..

# 3. API on :3000
npm install
npm run seed          # demo users, all with password Password123!
npm run dev
```

Environment variables (all optional): `DATABASE_URL`, `JWT_SECRET` (required when `NODE_ENV=production`),
`MATCHER_URL`, `MATCHING_STRATEGY`, `MATCH_WEIGHT_URGENCY` / `_PROXIMITY` / `_CAPACITY`,
`SWEEP_INTERVAL_SECONDS` (default 60, `0` disables), `GEOCODING_PROVIDER` (`nominatim` or `off`).

## Tests

```bash
bash scripts/test-all.sh          # matcher tests + API tests (needs PostGIS running)
node scripts/e2e-demo.mjs         # full workflow against a running, seeded API
```

| Suite | Tests |
|---|---|
| Matching service (pytest) | 30 |
| API integration (vitest, real PostGIS + matcher) | 64 |
| End-to-end demo | 19 checks |

GitHub Actions runs all of them on every change under `backend/`
(`.github/workflows/backend-ci.yml`).
