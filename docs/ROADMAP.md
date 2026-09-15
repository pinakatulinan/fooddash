# Roadmap

The full feature set, phased. Phase 0 is done; everything after it is scoped
against the foundation that already exists.

---

## Phase 0 — Foundation ✅ complete

- Postgres schema: 39 tables, PostGIS, every enum
- Row Level Security on every table, plus column grants and function grants
- Server-side pricing (`price_cart`, `place_order`) and the order state machine
- Dispatch model — offers, candidates, expiry — in both manual and auto modes
- Ledger, payouts, COD cash tracking, refunds, webhook idempotency
- Realtime publication and five storage buckets with policies
- Design system: tokens, dark mode, primitives, four navigation surfaces
- App shell, auth, role routing, seed data

---

## Phase 1 — First real order (4–6 weeks)

The goal is one order, placed by a real customer, cooked by a real merchant,
delivered by a real rider, with ops watching. COD only.

**Customer**
- Geolocation + saved-address picker with a map pin (needs a maps provider)
- Store page: menu by category, item sheet with option groups
- Cart and checkout — `price_cart` is written; the screens are not
- Order tracking with a realtime status timeline
- Order history and reorder

**Merchant**
- Live order console: accept / decline with reason, set prep time, mark ready
- **New-order sound and push.** The single highest-value feature on this
  surface — a missed order is worse than a slow one.
- Menu CRUD, photo upload, sold-out toggle
- Store hours and the pause button

**Rider**
- Offer card with accept/decline countdown
- Active-delivery screen: navigation handoff, pickup confirmation, proof of
  delivery via the 6-digit code
- Background location pings (`record_rider_ping` exists)
- Earnings summary and cash-on-hand

**Ops**
- Merchant approval queue and rider verification
- Manual dispatch from the live board
- Order detail with a full event timeline
- Cancel and refund

**Engineering**
- pgTAP tests for the RLS policies and `place_order` tampering cases
- Playwright test covering the full order path
- Sentry, structured logging

---

## Phase 2 — Take ops out of the loop (6–8 weeks)

- **GCash / Maya via PayMongo or Xendit** — Edge Functions for checkout and
  webhooks; the schema and idempotency table are already in place
- Automatic dispatch: the offer loop, `expire_stale_offers` on a schedule,
  re-offer on decline
- Live rider tracking on the customer's map
- Ratings and reviews for store and rider
- Promo engine surfaced in the UI (the tables and validation exist)
- Merchant earnings dashboard and weekly payout runs
- Rider remittance flow with proof upload
- Web push for all three surfaces
- Support tickets and refund workflow

---

## Phase 3 — Scale (ongoing)

- Order batching — two orders, one run
- Scheduled and recurring orders
- Multi-branch merchants under one owner
- Loyalty points and subscriptions
- Merchant analytics: top items, peak hours, prep-time distribution
- Zone-based surge pricing (`surge_multiplier` is already on `service_zones`)
- Rider incentives and quest campaigns
- Multi-city rollout, per-zone commission rules
- Native wrappers if the rider PWA hits a real limitation — not before

---

## Deliberately not built yet

| Thing | Why not |
| --- | --- |
| Multi-store carts | Multiplies delivery legs, prep timings and partial-cancellation cases. It is the fastest way to make early ops unmanageable. |
| In-app chat | Phone calls work, cost nothing to build, and are what people actually use here. |
| Native apps | The rider PWA covers geolocation and push. Two app-store review cycles per release is a tax to pay only once something needs it. |
| Own routing engine | A maps provider is cheaper than a routing team until roughly 10k orders a day. |
| Microservices | One Postgres and one Next.js app will carry this well past the point where the business can afford to split them. |

---

## Open questions

Things that need a decision before the phase they belong to:

1. **Maps provider.** Google Maps has the best PH address and POI coverage and
   is the most expensive; Mapbox is roughly a third of the cost with weaker
   barangay-level data; OpenStreetMap tiles plus a geocoder is nearly free and
   noticeably rougher. This blocks address pinning, so it is a Phase 1 decision.

2. **Payment gateway.** PayMongo has the simpler API and better local support;
   Xendit has broader payment-method coverage and better payout tooling. Both
   need business registration. Phase 2, but apply early — onboarding takes
   weeks.

3. **The CTA contrast question** in [DESIGN.md](DESIGN.md) — a brand call.

4. **Commission rate.** Currently 15% platform-wide (`platform_settings`).
   Grab and foodpanda charge 20–30%, which is exactly the grievance small
   merchants voice. 15% is defensible as a wedge; it needs to be a deliberate
   decision, not a default left in place.

5. **Rider employment model.** Contractor vs employee changes the payout
   tables, tax handling, and how `rider_shifts` is used. Talk to a lawyer
   before Phase 2.
