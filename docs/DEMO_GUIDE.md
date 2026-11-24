# FoodBridge — demo guide

**Live demo:** https://deploy-sigma-ruddy.vercel.app
**Password for every account below:** `Password123!`

Three scenarios, each showing something different:

| | Area | What it proves |
|---|---|---|
| 1 | Thapar, Patiala | The whole lifecycle works, end to end |
| 2 | Chandigarh | Matching is selective, and it explains itself |
| 3 | Manali | Food is never silently dropped |

---

## Before you walk in — two minutes

The frontend is on Vercel, but **the API and database run on a teammate's
machine behind a tunnel**. If that machine is asleep, nothing works.

1. Open https://deploy-sigma-ruddy.vercel.app
2. Sign in as the donor. If it signs in, the tunnel is up.
3. If it does not: message your teammate, or fall back to localhost (last section).

Do this **before** the room fills, not in front of her.

---

## Accounts

| Role | Email | Use it for |
|---|---|---|
| Donor | `donor@foodbridge.local` | Posting food in all three scenarios |
| Administrator | `admin@foodbridge.local` | Approving, and running matching cycles |
| Hope Shelter | `hope@foodbridge.local` | Accepting the Thapar offer |
| Sector 17 Community Kitchen | `chd.kitchen@foodbridge.demo` | Wins the Chandigarh donation |
| Sector 22 Food Bank | `chd.foodbank@foodbridge.demo` | Excluded — wrong food type |
| Sector 35 Day Centre | `chd.daycare@foodbridge.demo` | Excluded — not enough capacity |

You will create one more account live, in Scenario 3.

**Nothing matches on its own.** A donation only moves when an administrator
approves it and then runs a matching cycle. Say this early — otherwise it looks
broken when nothing happens after posting.

---

## Scenario 1 — Thapar: the whole journey

*"First, the normal case: food posted on campus reaching a shelter nearby."*

1. Sign in as **`donor@foodbridge.local`** → **Donate**
2. Food: **Cooked meals** · Description: *Hostel mess surplus* · Servings: **40**
3. Address: type **Thapar Institute, Patiala**, press **Find**

   > Point out the green line: *Located Thapar Institute, Patiala at 30.3545, 76.3658.*
   > The address became coordinates — matching is spatial, so everything needs a point.

4. Collect within **4 hours** → **Post donation**. Status is **Awaiting review**.
5. Sign out → sign in as **`admin@foodbridge.local`** → **Review**
6. Approve the donation, then press **Run a matching cycle**
7. Sign out → sign in as **`hope@foodbridge.local`** → **Offers**
8. Open the offer and press **Why was this offered to us?**

   > This is the moment to slow down. Urgency 40%, proximity 35%, capacity fit 25%.
   > The system can justify every decision it makes.

9. **Accept** → **Collections** → mark picked up → mark completed
10. As the donor, open the donation and give it a 1–5 clarity rating

**Expected:** offered to Hope Shelter at about **0.99 km**.

---

## Scenario 2 — Chandigarh: it refuses, and says why

*"The interesting part isn't who gets the food. It's who doesn't."*

1. As **`donor@foodbridge.local`** → **Donate**
2. Food: **Cooked meals** · Description: *Wedding surplus, Sector 17* · Servings: **60**
3. Address: **Sector 17, Chandigarh** → **Find** → **6 hours** → Post
4. As **admin**: approve, then press **Run greedy**
5. Press the **Why?** button that appears under the result

   > It reads *Why? — 60 servings · Cooked meals: 1 of N eligible*. Expand it.
   > Every organisation the cycle considered is listed, with its distance, and
   > either its score or the reason it was ruled out.

**Expected — three different reasons on screen at once:**

| Organisation | Distance | Outcome |
|---|---|---|
| Sector 17 Community Kitchen | 0.00 km | **Offered** |
| Sector 22 Food Bank | 1.31 km | `does not accept food type 'cooked_meals'` |
| Sector 35 Day Centre | 2.67 km | `insufficient remaining capacity (10 servings free < 60 needed)` |
| The Patiala shelters | 34–58 km | `outside radius` |

> Say: *a closer organisation lost to one further away, because distance is only
> 35% of the score. The nearest is not automatically the right one.* The two
> eligible rows show this directly — compare their scores against their distances.

The same **Why?** panel works in Scenario 1 and Scenario 3. In Scenario 3 it is
what proves the Manali donation reached nobody: every row says *outside radius*.

---

## Scenario 3 — Manali: nothing is thrown away

*"What happens when there is nobody to give it to?"*

**Part A — the waitlist**

1. As **donor** → **Donate** → Cooked meals · *Hotel surplus, Manali* · **40** servings
2. Address: **Manali** → **Find** → 8 hours → Post
3. As **admin**: approve → **Run a matching cycle**
4. Open **Waitlist** on the admin screen

**Expected:** no match. Nearest organisation is about **171 km** away —
far outside the 25 km maximum. The donation is **waitlisted, not discarded.**

> *The search starts at 5 km and widens in 5 km steps to 25 km. Past that it
> waits and is retried on every later cycle, rather than being dropped.*

**Part B — the rescue (the strong ending)**

5. Sign out → **Register an organisation**:

   - Name: **Manali Himalayan Trust**
   - Email: **`manali.trust@foodbridge.demo`** · Password: `Password123!`
   - Type: **NGO** · Capacity: **100** · Radius: **20 km**
   - Leave both food lists untouched — that means *accepts everything*
   - Address: **Manali** → **Find** → Create account

6. As **admin** → **Run a matching cycle** again
7. Sign in as **`manali.trust@foodbridge.demo`** → **Offers**

**Expected:** the waitlisted donation is now offered to them at **0.00 km**.

> *Nothing was lost. It waited for supply to exist, and the moment a local
> organisation joined, the food found it.*

---

## Questions she is likely to ask

**"Why didn't the closest one get it?"**
Proximity is 35% of the score. Urgency is 40% and capacity fit 25%. A slightly
further organisation that needs it sooner, or fits the quantity better, wins.

**"What if two donations want the same organisation?"**
An offer reserves that capacity for 30 minutes. A second donation sees the
reduced capacity and is matched elsewhere — it cannot be double-promised.

**"What if nobody answers an offer?"**
It expires after 30 minutes, the capacity is released automatically, and the
donation returns for re-matching. The expiry sweep runs every 60 seconds.

**"Is this real geocoding?"**
Yes — OpenStreetMap Nominatim, cached in PostgreSQL so a repeat address is
instant. Distances are PostGIS great-circle on `GEOGRAPHY(Point,4326)` with
spatial indexes, not flat arithmetic.

**"Why is matching manual?"**
Deliberate for this release, and documented as FR-52/FR-53 in the SRS. Expiry
is already automatic; scheduled re-matching is the next iteration.

**"What is not built?"**
E-mail/SMS notification, organisation verification documents, and administrator
oversight screens. All marked deferred in the SRS rather than hidden.

---

## If something breaks

**The site loads but nothing works** — the tunnel is down. Your teammate's
machine has slept. Switch to localhost.

**Running on localhost instead:**

```bash
cd ~/Desktop/project_SE3/backend/matching-service && .venv/bin/python -m uvicorn app:app --port 8000
cd ~/Desktop/project_SE3/backend && npm run dev
cd ~/Desktop/project_SE3/frontend && npm run dev
```

Then use http://localhost:5173 with the same accounts. The Chandigarh and
Manali organisations do **not** exist locally — you would create them as you go,
which still demonstrates registration by address.

**An address will not resolve** — OpenStreetMap only knows some phrasings. If a
typed address fails, try a landmark instead. These are known to work: *Thapar
Institute, Patiala*, *Rajindra Hospital, Patiala*, *Sector 17, Chandigarh*,
*Manali*. (`Model Town, Patiala` does not, which is why it was removed from the
shortcuts.)

**Nothing happens after posting** — you have not run a matching cycle. Admin →
**Run a matching cycle**.
