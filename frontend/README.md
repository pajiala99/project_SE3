# FoodBridge — Frontend

React client for donors, recipient organisations and administrators.
Person A deliverable (UCS503P, Team 3).

## Run it

```bash
npm install
npm run dev
```

Opens on http://localhost:5173. **No backend is required** — see below.

## Talking to the backend

The client is built against the Person B backend (`docs/API.md` on the
`person-b-backend-matching` branch). See [INTEGRATION.md](INTEGRATION.md) for how
to run the two together, how to verify a server before trusting it, and what is
still open on the backend side.

There is no mock mode any more — every screen talks to a real API. When
PostgreSQL is not available, `npm run stub` serves a test double of the same API
on :3000.

## Layout

```
src/
  api/client.js      Single entry point for every network call
  context/Session.jsx  Who is signed in; JWT handling
  components/        Shared UI: shell, timeline, notifications, form fields
  pages/             One file per screen
  hooks/useApi.js    loading/error/data and mutation state
  lib/format.js      Every user-facing date and number goes through here
  styles.css         Design tokens; light and dark
```

## Screens

| Route | What it is |
|---|---|
| `/donate` | Donor submission form |
| `/donations` | Donor's own listings |
| `/donations/:id` | Status timeline, pickup code, handover confirmation |
| `/offers` | Recipient's offer inbox — accept / decline |
| `/collections` | What the recipient has agreed to collect, with the pickup code |
| `/register` | Recipient organisation registration |
| `/dashboard` | Admin impact metrics |

Navigation is role-aware: a donor, a recipient organisation and an administrator
each see only their own screens and land on the right one.

## Switching roles while developing

In mock mode the header carries a **Viewing as** control for role, plus an
organisation picker when the role is *recipient*. That exists so one browser can
walk both sides of a handover — the only way to exercise the pickup-code exchange
without two accounts. It is absent in `live` mode: the role arrives with the auth
token and is not settable by the client.

## Design constraints

These come from the project proposal and are requirements, not preferences:

- **A donor's entire obligation fits in one short form on a phone.** Six inputs,
  no wizard. Food type and collection window are tap targets rather than
  dropdowns or date pickers. Everything is mobile-first with 44 px touch targets.
- **Low-to-mid range devices.** The charting library is roughly two-thirds of the
  bundle, so `/dashboard` is lazily loaded and the donor path stays at ~68 kB
  gzipped.
- **Contact details are disclosed only after a confirmed match.** The UI shows a
  placeholder until `status === 'ACCEPTED'`; the server enforces it.
- **The handover is two-sided.** The collecting organisation holds the pickup
  code and reads it out; the donor types it in to confirm. So `PICKED_UP` is the
  donor's transition and `COMPLETED` is the recipient's, and the donor is never
  sent the code — otherwise the check would be circular. The UI hides the wrong
  controls, but the server is what enforces it.
- **Every offer can be explained.** The inbox renders the matcher's four score
  components in plain language.

## Metric owned here

`POST /api/feedback/clarity` backs the proposal's "user clarity" secondary
metric — donor- and recipient-reported clarity of the status timeline, 1–5,
collected after a donation completes and surfaced on the dashboard as
`clarity_score_mean`.

## Published preview

Pushing to `main` builds this app and publishes it to GitHub Pages:

**https://pajiala99.github.io/project_SE3/**

It serves **fixture data, not a real backend** — the `MOCK DATA` chip in the
header says so on every screen. It is there so the team and reviewers can click
through the workflow without running anything locally.

Two details make the subpath work, both in `vite.config.js`:

- `base` is set to `/project_SE3/` in production so asset URLs carry the
  repository prefix, and the router takes its `basename` from
  `import.meta.env.BASE_URL`. It is keyed on `mode`, not `command`, because
  `vite preview` reports the same command as the dev server.
- GitHub Pages has no rewrite rule, so a request for `/project_SE3/donate` would
  404. The build writes a copy of the app shell to `404.html`, which Pages serves
  for unmatched paths — the app then reads the URL and renders the right screen.

Check the production build locally with `npm run build && npm run preview`; it
serves at `http://localhost:4173/project_SE3/`, matching the deployed layout.

Once the Express API exists, this pipeline is **not** what should ship it. It
publishes a static mock preview; the real staging deployment is a separate
concern and belongs with whoever owns CI/CD.

## Notes

- The matcher in `mock/handlers.js` is a **UI stand-in only**. Real scoring, weight
  tuning and the Hungarian upgrade belong to the Python matching service.
- Metrics are never derived in the browser. The dashboard renders what the API
  returns so the number on screen equals the number in the report.
