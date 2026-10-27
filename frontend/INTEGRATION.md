# Frontend ↔ Backend integration

The React client is built directly against the Person B backend. The source of
truth for the HTTP surface is **`docs/API.md`** and `backend/src/routes/index.ts`
on the `person-b-backend-matching` branch — this file records only how the
frontend consumes it, and what is still open.

An earlier `API_CONTRACT.md` in this folder described a contract the frontend
proposed before the backend existed. The backend went a different way, so that
document has been removed rather than left to rot; the backend's own docs win.

## Running the two together

```bash
# terminal 1 — the backend (needs PostgreSQL + PostGIS)
npm --prefix backend run migrate && npm --prefix backend run seed
npm --prefix backend start                      # :3000

# terminal 2 — the frontend
npm --prefix code/frontend run dev              # :5173, proxies /api to :3000
```

Without PostgreSQL there is a stand-in: `npm run stub` serves a fake of the same
API on :3000 so the UI can be exercised. It is a **test double**, not the
backend — never develop against it alone.

Point the client at a different origin with `VITE_API_BASE` in `.env`; leave it
blank to use the dev proxy.

## Checking a server before trusting it

```bash
npm run check:contract                    # http://localhost:3000
npm run check:contract -- http://host:3000
```

Walks a full lifecycle — register, post, review, match, accept, collect,
complete — and checks the shapes the client actually reads. Exits non-zero on
failure, so CI can gate on it. It creates three throwaway accounts, so run it
against a development database.

## How the frontend maps onto the API

| Screen | Endpoints |
|---|---|
| Sign in / register | `POST /auth/login`, `POST /auth/register`, `GET /auth/me` |
| Post surplus food | `POST /donations` |
| My donations | `GET /donations/mine` |
| Donation detail + timeline | `GET /donations/:id` (donation + reviews + matches + pickups) |
| Offers (recipient) | `GET /matches/inbox`, `POST /matches/:id/accept`, `/reject` |
| Collections (recipient) | `GET /pickups/mine`, `POST /pickups/:id/picked-up`, `/complete` |
| Review queue (admin) | `GET /admin/donations/pending`, `PATCH /admin/donations/:id/review` |
| Matching (admin) | `POST /admin/matching/run`, `GET /admin/waitlist` |
| Impact (admin) | `GET /impact/summary` |
| Notification bell | `GET /notifications`, `PATCH /notifications/:id/read`, `POST /notifications/read-all` |

Responses are database rows in snake_case and the client reads them as-is. There
is no renaming layer on purpose: a silent rename is where drift hides.

The one normalisation is the user object, because `POST /auth/login` returns it
camelCased (`userId`) while `GET /auth/me` returns the row (`user_id`). That is
handled in `src/context/Session.jsx` so no screen has to know which call it came
from — worth reconciling on the backend eventually.

## Open items for Person B

1. **`GET /matches/inbox` returns no donation detail.** A recipient sees a score,
   a distance and a deadline, but not what the food is or how much — which is
   what they actually decide on. The inbox therefore fetches every match's
   donation separately (an N+1). Joining `food_type`, `quantity_servings` and
   `pickup_address` into the inbox query would remove it. The contract check
   reports this as an advisory.

2. **No handover verification.** `POST /pickups/:id/picked-up` is called by the
   recipient, and so is `/complete` — so one party drives both ends and the two
   timestamps are not independent evidence that food changed hands. A pickup
   code issued to the collector and verified by the donor would fix it. Until
   then the pickup timestamps should be described as self-reported, not
   measured, in the report.

3. **No time series for time-to-match.** `/impact/summary` gives one average and
   one median. The dashboard can show the current figure against the 20-minute
   target but cannot show whether it is improving, which is the thing the
   proposal set out to demonstrate. A `GET /impact/ttm?bucket=day` returning
   `{bucket, medianSeconds, n}` would cover it.

4. **No endpoint for the status-clarity rating.** The proposal lists donor- and
   recipient-reported clarity of the status timeline (1–5) as a secondary
   evaluation metric. There is nowhere to send it, so it currently cannot be
   collected at all.
