# FoodDash

> Where Food Finds You.

A food-delivery platform for Philippine neighbourhood kitchens — carinderias,
cafés and family restaurants first, larger chains later. One Next.js app serving
four surfaces (customer, merchant, rider, ops) on one Supabase project.

**Status: foundation complete.** The database, security model, design system and
app shell are built and verified. The customer, merchant, rider and ops features
are scaffolded on top of them and are the next thing to build.

---

## Quick start

```bash
npm install
cp .env.example .env.local        # fill in your Supabase URL + anon key

# Option A — local stack (needs Docker)
npm run db:start                   # Postgres + Auth + Storage on localhost
npm run db:reset                   # apply migrations, then seed
npm run db:types                   # generate TypeScript types from the schema

# Option B — hosted project (no Docker)
npx supabase link --project-ref <ref>
npm run db:push
npm run db:types:remote

npm run dev                        # http://localhost:3000
```

Without Supabase credentials the app still boots and shows a setup screen
instead of crashing. See [docs/SETUP.md](docs/SETUP.md) for the full walkthrough.

### Seeded accounts (local only)

All use the password `password123`.

| Email | Role | Lands on |
| --- | --- | --- |
| `customer@fooddash.test` | Customer | `/` |
| `merchant@fooddash.test` | Merchant | `/merchant` |
| `rider@fooddash.test` | Rider | `/rider` |
| `admin@fooddash.test` | Ops | `/admin` |

---

## What is here

```
src/app/
  (customer)/        discovery, store pages, cart, checkout, tracking
  (merchant)/        order console, menu management, earnings
  (rider)/           offers, active delivery, earnings  (mobile-only, PWA)
  (admin)/           live ops, approvals, finance, support
  (auth)/            sign in / sign up for all four
supabase/
  migrations/        11 migrations: schema, RLS, functions, realtime, storage
  seed.sql           three merchants, menus, a zone, a rider, promos
src/lib/
  supabase/          browser, server and service-role clients
  domain/            order state machine presentation
  format.ts          money, distance, ETA, PH phone numbers
docs/                architecture, setup, roadmap, design system
```

---

## The three rules this codebase is built around

**1. The client never sends a price.** Checkout posts a cart id, an address id
and a promo code. `place_order()` recomputes every centavo in Postgres from
rows it already owns, and writes an immutable price snapshot onto the order.
See `supabase/migrations/*_order_functions.sql`.

**2. RLS is the security boundary.** Not the middleware, not the route guards —
those are UX. Every table has Row Level Security enabled and a deny-by-default
posture. Orders have no client `INSERT` or `UPDATE` policy at all: they can only
be created and moved by security-definer functions that check entitlement
themselves.

**3. Orders are a state machine in the database.** A trigger rejects any
transition not listed in `order_transition_allowed()`, stamps the matching
timestamp, and appends to an immutable `order_events` log. Tracking timelines,
dispute evidence and ops metrics all fall out of that one table for free.

---

## Scripts

| Command | What it does |
| --- | --- |
| `npm run dev` | Development server |
| `npm run build` | Production build |
| `npm run typecheck` | `tsc --noEmit` |
| `npm run lint` | ESLint |
| `npm run db:start` / `db:stop` | Local Supabase stack (Docker) |
| `npm run db:reset` | Re-apply all migrations and re-seed |
| `npm run db:push` | Apply migrations to the linked hosted project |
| `npm run db:diff -- <name>` | Capture Studio changes as a new migration |
| `npm run db:types` | Regenerate `src/lib/types/database.ts` |

---

## Documentation

- [docs/ARCHITECTURE.md](docs/ARCHITECTURE.md) — the data model, the security
  model, dispatch, and the decisions behind them
- [docs/SETUP.md](docs/SETUP.md) — getting a database running, with and without
  Docker
- [docs/ROADMAP.md](docs/ROADMAP.md) — the full feature set, phased
- [docs/DESIGN.md](docs/DESIGN.md) — the colour system and its contrast rules
