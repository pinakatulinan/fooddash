# Third-party pricing

Every external service this app depends on, what it costs today, and what
triggers a real bill. Written so "is this commercially viable" and "what
breaks the $0 we're currently paying" both have a straight answer, without
digging through five different vendor dashboards.

Figures below were checked against each vendor's own pricing page in
October 2026. Vendors change pricing without much notice — re-verify before
using these numbers in a client-facing budget.

---

## At a glance

| Service | Used for | Plan right now | Current cost | Free allowance | What it costs past free |
|---|---|---|---|---|---|
| [Supabase](#supabase) | Database, auth, storage, realtime | Free | $0/mo | 500 MB DB, 5 GB egress, 50K MAU, 2 projects | Pro $25/mo + compute, billed per project |
| [Vercel](#vercel) | Hosting, serverless functions | Hobby | $0/mo | 100 GB bandwidth, ~1M function calls/mo | Pro $20/seat/mo — **see ⚠️ below, this one isn't just a future cost** |
| [PayMongo](#paymongo-payments) | Payment processing | Test mode (`sk_test_…`) | $0 — test transactions aren't charged | No monthly fee, ever — pure pay-per-transaction | Cards 3.5% + ₱15, GCash 2.5%, Maya 2.0%, GrabPay 2.2%, QR Ph 1.5%, online banking 0.8%/₱15 (whichever is higher) |
| [CARTO](#maps-carto-today) | Map tiles (order tracking, store location pin) | Free API key | $0/mo | 5,000,000 tile requests/mo | No published self-serve rate — CARTO asks heavy/commercial users to talk to sales |
| [Google Maps](#maps-google-proposed-not-yet-adopted) | Proposed replacement for CARTO | **Not set up yet** | — | 10,000 map loads/mo, 10,000 Directions requests/mo (each its own free quota) | $7 per 1,000 map loads, ~$5 per 1,000 Directions requests |
| [Web Push (VAPID)](#web-push) | Order status / rider offer notifications | Keys not generated yet | $0 | Unlimited — it's a protocol, not a paid service | Never costs anything, at any volume |

**Total right now: $0/month.** Every paid service is either still on its free
tier or running in test mode.

---

## Supabase

Free plan. Covers the Postgres database (migrations, RLS, every table), auth,
file storage (merchant/menu images, documents), and Realtime (order status,
rider location, chat).

- **Free tier:** 500 MB database, 1 GB file storage, 5 GB database egress,
  50,000 monthly active users, up to 2 active projects. Free projects
  **auto-pause after 7 days with no activity** — the project is restored on
  the next request, but the first request after a pause is slow.
- **Pro plan ($25/month per organization):** 8 GB database, 100 GB storage,
  250 GB egress, 7-day backups, 100,000 MAU, no auto-pause. Compute is billed
  on top ($10/mo credit covers the smallest instance).
- **Why this matters before launch:** the free plan's auto-pause is fine for
  development, not for a live product a customer might open at 2am. Budget
  for Pro ($25/mo minimum) once this actually accepts real orders.

## Vercel

Hobby plan (free). Hosts the Next.js app — every server-rendered page and
API route runs here.

- **Free tier:** 100 GB bandwidth/month, ~1,000,000 function invocations,
  ~4 hours of Active CPU time, 1 region only (currently `hnd1`, Tokyo, to
  match Supabase — see the earlier region change).
- **Pro plan:** $20 per seat/month. Adds 1 TB bandwidth, multi-region
  functions, longer function timeouts, and more build minutes.
- **⚠️ This one isn't purely a future cost.** Vercel's Hobby plan is
  licensed for **personal, non-commercial use only** — commercial use is
  meant to be on Pro or Enterprise. FoodDash is a commercial food-delivery
  product, which puts the current Hobby deployment outside Vercel's terms
  the moment this is actually used to take real orders from real customers,
  independent of whether traffic ever exceeds the free limits. Worth
  resolving (upgrade to Pro) before this goes in front of a client or the
  public, not after.

## PayMongo (payments)

Currently wired up with **test-mode keys** (`sk_test_…` in `.env.local`) —
no real money moves, and nothing is charged. These are PayMongo's own
official published rates (VAT-inclusive, no extra deduction at payout) for
when live keys replace the test ones:

| Method | Fee |
|---|---|
| Card | 3.5% + ₱15 (+1% extra for cards issued outside the Philippines) |
| GCash | 2.5% |
| Maya | 2.0% |
| GrabPay | 2.2% |
| QR Ph | 1.5% |
| Online banking | 0.8% or ₱15, whichever is higher |
| BNPL (BillEase) | 1.5% |

No monthly fee, no setup fee — this is pure per-transaction cost, so it
scales with revenue rather than being a fixed line item. Cash on delivery
(the only method currently enabled for customers — see the checkout-form
restriction) costs nothing through PayMongo since it never touches them.

## Maps — CARTO (today)

The order-tracking map and store-location pin currently use CARTO's free
"Voyager" basemap tiles via a free API key (`NEXT_PUBLIC_MAPS_API_KEY`).

- **Free allowance:** 5,000,000 tile requests/month, raster + vector
  combined. No signup approval queue — the key is emailed back immediately.
- **Catch:** CARTO frames this free tier as meant for non-commercial use.
  Commercial apps can still use it under the same quota, but past the limit
  (or if CARTO decides usage is meaningfully commercial) they may ask for a
  move to a paid agreement rather than just rate-limiting.
- **No routed directions.** The tracking map currently draws a straight
  line between rider and destination, not an actual street route — there is
  no directions/routing provider wired up at all right now.

## Maps — Google (proposed, not yet adopted)

Discussed as a replacement for CARTO, not yet implemented. Would require a
Google Cloud project with billing enabled (a card on file) even though
usage would very likely stay inside the free quota.

- **Maps JavaScript API** (the live map itself): 10,000 free loads/month,
  then $7 per 1,000.
- **Directions API** (would add a real routed path + accurate ETA — the one
  thing CARTO/Leaflet can't currently do): 10,000 free requests/month, then
  ~$5 per 1,000.
- **At FoodDash's current scale**, a "map load" happens once per tracking-
  page open (not per realtime refresh), so realistically $0/month for a
  long time — see the fuller cost walkthrough from the Google Maps
  discussion for the reasoning.
- **Decision still open** — `docs/ROADMAP.md`'s "Open questions" section
  already flagged this exact tradeoff (Google = best PH coverage, most
  expensive; Mapbox = cheaper, weaker barangay data; OSM = free, roughest)
  before this conversation revisited it. Update that section once this is
  actually decided either way.

## Web push

VAPID keys (`NEXT_PUBLIC_VAPID_PUBLIC_KEY` / `VAPID_PRIVATE_KEY`) are
reserved in `.env.local` but **not generated yet** — web push isn't live.
Once set up (`npx web-push generate-vapid-keys`), it costs nothing at any
volume: web push is a browser-vendor-run protocol, not a paid API.

---

## What actually changes the $0

In order of how likely each is to happen first:

1. **PayMongo goes live** — switches from $0 (test mode) to real
   per-transaction fees the moment real payment methods are turned back on.
   This scales with revenue, not a flat bill, so it's the "good problem"
   kind of cost.
2. **Vercel Hobby → Pro** — a compliance fix, not a traffic-driven one; see
   the ⚠️ above. $20/month minimum once addressed.
3. **Supabase Free → Pro** — needed once this is a real product someone
   might open at any hour, not just during development. $25/month minimum.
4. **Google Maps adoption** — optional, and $0 unless usage genuinely
   exceeds 10,000 map loads or 10,000 Directions requests in a month.

Rough floor for an actually-launched version of this app: **~$45–65/month**
(Vercel Pro + Supabase Pro, give or take compute/overage), before any
payment-processing fees, which track revenue rather than being fixed.
