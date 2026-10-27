# FoodBridge

A surplus food redistribution matcher: restaurants, canteens and messes post
food they cannot sell, and the system offers it to a nearby shelter, NGO or
food bank that can actually take it before it spoils.

Matching is the point of the project. A donation is not broadcast to everyone —
organisations that cannot take it are excluded first, and the rest are ranked on
how urgent the donation is, how close they are, and how well it fits their
remaining capacity.

Built for **UCS503P Software Engineering Lab**, Thapar Institute of Engineering
and Technology — Group 3.

---

## Architecture

Three services and a spatial database.

| Component | Stack | Port | Role |
|---|---|---|---|
| `frontend/` | React 18 + Vite | 5173 | All screens: registration, posting, admin review, match inbox, pickups, impact dashboard |
| `backend/` | Express + TypeScript | 3000 | REST API, authentication, state machines, geocoding |
| `backend/matching-service/` | FastAPI + SciPy | 8000 | Scoring and allocation, isolated behind an HTTP boundary |
| database | PostgreSQL 17 + PostGIS | 5432 | Spatial queries on `GEOGRAPHY(Point,4326)` with GiST indexes |

The matcher is a separate service on purpose: the allocation strategy can be
replaced — greedy or Hungarian — without touching the API.

---

## Running it locally

**Prerequisites:** Node 20+, Python 3.12+, PostgreSQL 17 with PostGIS.

**1. Backend dependencies** — first, because the database script runs the
migrations through them:

```bash
cd backend && npm ci
```

**2. Database** — creates the role, both databases, enables PostGIS and runs
the migrations against each:

```bash
./scripts/db-start.sh
cd backend && npm run seed     # demo accounts and scenarios
```

**3. Matching service** — port 8000, which is what the API expects by default:

```bash
cd backend/matching-service
python3 -m venv .venv && .venv/bin/pip install -r requirements.txt
.venv/bin/python -m uvicorn app:app --port 8000
```

**4. Backend API** — port 3000, in a second terminal:

```bash
cd backend && npm run dev
```

**5. Frontend** — port 5173, proxying `/api` to the backend, in a third:

```bash
cd frontend && npm ci && npm run dev
```

Open http://localhost:5173.

### Demo accounts

Password for all: `Password123!`

| Role | Email |
|---|---|
| Donor | `donor@foodbridge.local`, `donor2@foodbridge.local` |
| Administrator | `admin@foodbridge.local` |
| Organisations | `hope@`, `sunrise@`, `green@`, `care@`, `angels@`, `foodbank@foodbridge.local` |

Administrators are provisioned by the seed, never by self-registration.

---

## How matching works

**Filter, then rank.** Eligibility is settled before any scoring, so an
organisation that fails a hard constraint never competes on score — which is why
the nearest organisation is often not the one that wins.

Hard filters: inactive, insufficient remaining capacity, food type not accepted,
food type on the organisation's dietary restrictions, outside the search radius,
or not enough time left to collect.

Survivors are scored on three normalised components, weighted as configuration
rather than embedded logic:

| Component | Weight |
|---|---|
| Urgency (how soon it expires) | 0.40 |
| Proximity | 0.35 |
| Capacity fit | 0.25 |

Matching starts at a 5 km radius and widens in 5 km steps to 25 km when nobody
is eligible, then waitlists the donation rather than discarding it. An offer
reserves the organisation's capacity and expires after 30 minutes. Every
allocation stores its score components and a per-candidate reason, so any
decision can be explained after the fact.

**Addresses, not coordinates.** Donors and organisations type an address; the
server resolves it through a cache and then OpenStreetMap Nominatim, and the
resolved point is shown before anything is submitted.

---

## Tests

```bash
cd backend            && npm test              # 77 tests — API, state machines, geocoding, ratings
cd backend/matching-service && .venv/bin/python -m pytest -q   # 30 tests — scoring, greedy, Hungarian
cd frontend           && npm run check:contract # 32 checks against a running server
```

The contract check is the one that matters for integration: it exercises every
endpoint the React client depends on, verifies status codes, response shapes,
the error envelope and role restrictions, and exits non-zero on failure. It
needs the API, the matching service and the database running, and a freshly
seeded database — so it is run locally rather than in CI.

GitHub Actions runs backend tests (against a real PostGIS service), the matcher
tests, and a frontend lint and build on every push.

---

## Repository layout

```
frontend/              React client, and the contract check
backend/               Express API, migrations, tests
  matching-service/    FastAPI scoring and allocation
docs/                  SRS source, UML, use case diagram and its generator
journals/              Weekly journals, per member
scripts/               Database bootstrap and test runners
SRS/                   Submitted SRS (PDF and Overleaf source)
project_proposal/      Original proposal
```

---

## Division of work

| Member | Roll | Component |
|---|---|---|
| Hardik Pajiala | 1024030119 | Person A — frontend and UX, integration, contract testing |
| Shikhar Goel | 1024030916 | Person B — backend API and matching engine |
| Aayush Shukla | 1024030164 | Person C — database schema and geocoding |

---

## Status

The core workflow is complete and tested end to end: register, post by address,
administrator approval, matching by location, accept, pick up, complete, rate.

Deferred to a later iteration, and marked as such in the SRS: e-mail and SMS
notification, organisation verification documents, a manual fallback list when
matching finds nobody, and administrator oversight screens.
