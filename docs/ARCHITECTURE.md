# Architecture

## Shape of the system

One Next.js 16 application, four route groups, one Supabase project.

```
                    ┌──────────────────────────────────────────┐
                    │        Next.js app (Vercel)              │
   customer ──────► │  (customer)  (merchant)  (rider)  (admin)│
   merchant ──────► │           shared design system           │
   rider    ──────► │      proxy.ts: session + role routing    │
   ops      ──────► └───────────────┬──────────────────────────┘
                                    │  anon key + user JWT
                                    ▼
                    ┌──────────────────────────────────────────┐
                    │              Supabase                    │
                    │  Postgres + PostGIS   ← RLS is the wall  │
                    │  Auth · Realtime · Storage · Edge Fns    │
                    └───────────────┬──────────────────────────┘
                                    │ service role (server-side only)
                    payment webhooks · dispatch loop · payouts
```

**Why one app rather than four.** Four deployments means four auth
integrations, four design systems drifting apart, and a shared component change
shipped four times. The surfaces have very different information architecture
but almost identical primitives. Route groups give the separation without the
duplication, and the rider surface still installs as a PWA from its own URL.

**Why Supabase.** Postgres with PostGIS covers delivery radii and
nearest-rider queries without a second datastore; RLS lets the security model
live next to the data instead of in middleware; Realtime covers the order board
and the tracking map; Storage covers menu photos and proof-of-delivery. The
alternative — a custom API tier — is a month of work before the first order.

---

## The database

Eleven migrations, ~40 tables, ~92 objects. Read them in order; each builds on
the last.

| Migration | Contents |
| --- | --- |
| `0001` extensions_and_enums | PostGIS, citext, and every enum in the system |
| `0002` identity | `profiles`, `addresses`, notifications, `platform_settings`, audit log |
| `0003` merchants_and_menu | stores, staff, documents, hours, the menu tree |
| `0004` zones_and_carts | service-zone polygons, the delivery-fee formula, server-side carts |
| `0005` orders | orders + snapshotted line items + the event log + reviews |
| `0006` riders_and_dispatch | riders, shifts, GPS pings, delivery offers |
| `0006b` payments_promos_ledger | promos, payments, webhook idempotency, the ledger, payouts, support |
| `0007` security_helpers | `is_admin()`, `is_merchant_member()`, … |
| `0008` order_functions | pricing, checkout, the state machine, dispatch |
| `0009` rls | every policy, every column grant, every function grant |
| `0010` realtime_and_storage | the realtime publication and five storage buckets |
| `0011` app_rpcs | discovery, cart, tracking, availability, merchant stats |

### Money

Every monetary column is an **integer of centavos**, named `*_centavos`. No
floats, no `numeric`, no pesos anywhere below the render layer. A half-centavo
rounding difference is a support ticket and, at volume, a reconciliation
problem.

`orders` carries a check constraint that the total reconciles:

```sql
total = subtotal + delivery_fee + service_fee + tip − discount
```

If any code path ever computes a total that does not balance, the write fails
loudly instead of quietly charging the wrong amount.

### Snapshots

Orders snapshot everything they depend on: item names, unit prices, selected
option names and deltas, the delivery address as jsonb, the commission rate
applied. Menus change weekly and customers delete addresses. Joining live rows
to render an old receipt is a bug, not an optimisation.

### The order state machine

```
draft → pending_payment → placed → accepted → preparing
      → ready_for_pickup → picked_up → arrived → delivered
                        ↘ cancelled / failed
```

Three pieces enforce it:

- `order_transition_allowed(from, to)` — the transition table, one readable
  `CASE` statement
- `guard_order_transition()` — a `BEFORE UPDATE` trigger that rejects anything
  else, and stamps `accepted_at` / `ready_at` / `delivered_at` so no caller has
  to remember to
- `log_order_event()` — an `AFTER UPDATE` trigger appending to `order_events`

`advance_order()` sits on top and answers the question RLS cannot: *is this
caller allowed to make this particular move.* A merchant may accept and mark
ready; a rider may pick up and deliver; a customer may cancel, but only before
the kitchen commits.

Because `orders` has no client `UPDATE` policy, this path cannot be bypassed.

### Dispatch

Modelled as **offers**, not assignments. `delivery_assignments` holds one row
per offer; only an accepted offer binds. A partial unique index guarantees at
most one live offer per order, so two riders can never be sent to one kitchen.

The same table serves both modes:

- **manual** — ops assigns from the live board (`is_auto = false`)
- **auto** — `dispatch_candidates()` ranks nearby riders by PostGIS KNN
  distance, filtered for verified, idle, recently-pinged and under their COD
  cash cap; an Edge Function offers to the closest and re-offers on decline or
  timeout

`platform_settings.dispatch_mode` flips between them without a deploy. Start
manual — with five riders, a human dispatcher beats any algorithm, and the
manual override stays useful forever.

### Money movement

Three separate layers, deliberately not collapsed:

| Table | Answers |
| --- | --- |
| `payments` | what PayMongo/Xendit told us happened |
| `ledger_entries` | what each party earned or owes, in our own books |
| `payouts` | what we actually sent, and when |

`ledger_entries` is append-only; a correction is a new `adjustment` entry with a
note, never an edit. `payment_webhook_events` has a unique
`(provider, event_id)` — the webhook function inserts there *first* and bails on
conflict, which is what stops a double-delivered `payment.paid` from crediting a
merchant twice.

COD gets its own loop: on delivery the rider is debited `cash_collected` and
`riders.cash_on_hand_centavos` rises; past the configured cap they stop being
offered cash orders until they remit.

---

## The security model

RLS is enabled on all 39 tables with a deny-by-default posture. Three layers:

**1. Row policies.** Who may see which rows. `can_view_order()` is the single
definition of "is this order your business", reused by `order_items`,
`order_item_options`, `order_events`, `payments` and `delivery_assignments`, so
those five cannot drift apart from the orders policy.

**2. Column grants.** RLS decides rows, not columns. `profiles.role` is
withheld from `authenticated` — otherwise a single `PATCH` would make any
customer an admin. Merchants cannot write `commission_rate` or `status`; riders
cannot write `is_verified` or zero their own `cash_on_hand_centavos`.

**3. Security-definer functions.** Operations too complex for a policy —
checkout, transitions, dispatch — run as definer with a pinned `search_path`
and do their own entitlement checks.

Privileged writes (approving a store, verifying a rider, adjusting the ledger,
running payouts) use the **service role from server-side code only**, guarded
by an explicit check and followed by an `admin_audit_log` row. There is no broad
"admin can update anything" policy, because that policy is reachable from a
browser with a stolen session.

### Cross-user data

`profiles` has no cross-user read policy at all. The pieces one party
legitimately needs about another are enumerated explicitly:

- the rider gets the recipient's name and phone from the order's address
  snapshot
- the customer gets the rider's **first name**, vehicle, plate and live position
  from `order_tracking()` — enough to recognise someone at the gate, not enough
  to look them up afterwards

---

## Realtime

Four tables are published: `orders`, `order_events`, `delivery_assignments`,
`riders`. Realtime respects RLS, so subscribers receive only rows their policies
already allow.

`rider_pings` is deliberately **not** published. It is the highest-write table
in the system, and broadcasting a GPS sample every ten seconds to every
subscriber is how a realtime bill becomes the largest line item in the business.
The live pin reads `riders.current_location`, which the same RPC updates.

---

## Known gaps

Honest list of what the foundation does not yet include:

- **Payment provider integration.** The schema, webhook idempotency table and
  refund model are in place; the PayMongo/Xendit Edge Functions are not written.
- **The dispatch loop itself.** `dispatch_candidates()` and
  `offer_order_to_rider()` exist; the scheduled function that drives them
  (and `expire_stale_offers()`) is not deployed.
- **Maps.** No provider is wired. Address pinning, route preview and the
  tracking map all need one — see the open question in ROADMAP.
- **Generated database types.** `src/lib/types/domain.ts` is hand-written and
  narrow. Run `npm run db:types` once a project exists.
- **Tests.** None yet. The first ones that matter are pgTAP tests asserting
  that a merchant cannot read another merchant's orders, and that `place_order`
  rejects a tampered option id.
