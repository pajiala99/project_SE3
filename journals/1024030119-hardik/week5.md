# Journal — Hardik Pajiala (1024030119)

**Role:** Person A — Frontend & UX (React)
**Project:** FoodBridge — a surplus food redistribution matcher

---

## Week 5 (24 – 25 November 2026)

### What I did

**Checked the live deployment against our code.** Shikhar deployed the client
on Vercel with the API tunnelled from his machine. I confirmed it was running our
latest code, and that geocoding and PostGIS both worked end to end — a typed
address resolved through Nominatim, and a radius search used the spatial index
rather than scanning every organisation.

**Prepared a three-area demo and rehearsed it on the live site.** Each area shows
something different: at Thapar, one donation through every stage from posting to
rating; in Chandigarh, one organisation offered the food while two nearby were
excluded for two different reasons; in Manali, a donation with nobody within
172 km waitlisted rather than dropped, then matched once a local organisation
registered. I wrote a step-by-step guide with accounts and expected results.

**Built the explanation panel the demo needed.** Rehearsing showed that the
reasons for each decision existed only in the API response — no screen showed
them, so the system's best property was invisible. The administrator screen now
has a *Why?* button listing every organisation a cycle weighed, with its distance
and either its score or why it was excluded. The matcher answers in identifiers,
so I attached organisation names on the server. Seven tests cover it, and I
checked they fail without the feature: five of seven did.

**Wrote the end-semester report** to the course template. I redrew all the UML
diagrams from the code, because the ones carried over from the proposal had
drifted — they showed a pickup code that was never built and a donation state
that does not exist. I measured the latencies rather than estimating them.

**Fixed two of my own mistakes.** The "Model Town, Patiala" address shortcut
never worked, because OpenStreetMap has no entry for that phrase; replaced. And
the demo guide PDF I had generated still described a screen that did not exist,
because I fixed the Markdown after making the PDF; regenerated.

**Verified:** 84 backend tests, 30 matcher tests, 32 contract checks, all passing
in CI.

### What I learned

The useful test of a demo is rehearsing it, not reading it. My first guide told
the presenter to open a list of excluded organisations; it was only when I tried
to find that list on screen that I discovered it had never existed.

A passing test proves little unless it would fail without the code it guards.
Deliberately removing the feature and watching five tests fail is what showed the
explanation tests were actually checking something.

### Blocked / needs the team

- The address shortcut fix needs another Vercel deploy to reach the live demo.
- The live demo depends on Shikhar's machine staying awake behind the tunnel.
