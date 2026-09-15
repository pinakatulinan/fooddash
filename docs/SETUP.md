# Setup

Two paths. Pick **A** if you have Docker Desktop, **B** if you do not.

---

## A — Local stack (Docker)

Everything runs on your machine: Postgres, Auth, Storage, Studio, a fake inbox.
No account needed, no data leaves the laptop, and `db:reset` gives you a clean
database with seed data in about twenty seconds.

```bash
npm install
npx supabase start          # first run pulls images — a few minutes
```

It prints your local credentials. Put them in `.env.local`:

```bash
cp .env.example .env.local
```

```env
NEXT_PUBLIC_SUPABASE_URL=http://127.0.0.1:54321
NEXT_PUBLIC_SUPABASE_ANON_KEY=<the anon key it printed>
SUPABASE_SERVICE_ROLE_KEY=<the service_role key it printed>
```

Then:

```bash
npm run db:reset            # migrations + seed
npm run db:types            # generate src/lib/types/database.ts
npm run dev
```

- App — http://localhost:3000
- Studio — http://127.0.0.1:54323
- Email inbox — http://127.0.0.1:54324

---

## B — Hosted project (no Docker)

1. Create a project at [supabase.com/dashboard](https://supabase.com/dashboard).
   **Choose the Singapore region** — it is the closest to the Philippines, and
   the round-trip difference to `us-east-1` is noticeable on every query.

2. Enable PostGIS: Dashboard → Database → Extensions → search `postgis` → enable
   (into the `extensions` schema). Migration `0001` also creates it, so this is
   belt-and-braces.

3. Copy Settings → API into `.env.local`:

```env
NEXT_PUBLIC_SUPABASE_URL=https://<ref>.supabase.co
NEXT_PUBLIC_SUPABASE_ANON_KEY=<anon public>
SUPABASE_SERVICE_ROLE_KEY=<service_role — server only, never NEXT_PUBLIC_>
```

4. Push the schema:

```bash
npx supabase login
npx supabase link --project-ref <ref>
npm run db:push
npm run db:types:remote
npm run dev
```

The seed file is **not** applied by `db:push`. To load demo data into a hosted
project, paste `supabase/seed.sql` into the SQL editor — and only ever into a
development project, since it creates accounts with a known password.

---

## Auth configuration

In Dashboard → Authentication → URL Configuration:

- **Site URL** — `http://localhost:3000` in development, your Vercel domain in
  production
- **Redirect URLs** — add `http://localhost:3000/auth/callback` and
  `https://<your-domain>/auth/callback`

Email confirmations are **off** locally (`supabase/config.toml`) so the seeded
accounts sign in immediately. Turn them **on** for any deployed environment.

### Creating the first admin

`admin` is not self-serve — `handle_new_user()` only honours
`customer`, `merchant` and `rider`. Sign up normally, then in the SQL editor:

```sql
update public.profiles set role = 'admin' where email = 'you@example.com';
```

---

## Deploying to Vercel

1. Import the repo.
2. Add the environment variables from `.env.example`. Set
   `NEXT_PUBLIC_SITE_URL` to the production domain.
3. Deploy. `npm run build` is the default and needs no configuration.

Set the Vercel function region to **Singapore (`sin1`)** to match the database.
Server Components make several round trips per render, and putting the compute
on another continent from the data multiplies every one of them.

---

## Making schema changes

Never edit an applied migration. Either write a new file:

```bash
npx supabase migration new add_loyalty_points
```

or make the change in Studio and capture it:

```bash
npm run db:diff -- add_loyalty_points
```

Then `npm run db:reset` to verify it applies cleanly from scratch, and
`npm run db:types` to refresh the types.

**After any schema change, re-check RLS.** A new table starts with no policies
and RLS disabled — which means it is wide open to every user the moment
PostgREST exposes it. Migration `0009` is the checklist.

---

## Troubleshooting

| Symptom | Cause |
| --- | --- |
| Setup screen instead of the app | `.env.local` missing or not picked up — restart the dev server |
| `type "geography" does not exist` | PostGIS not enabled, or not in the `extensions` schema |
| Queries return `[]` for a user who should see rows | An RLS policy — check as that role in Studio, not as `postgres` |
| Signed out every hour | The proxy is not running on that route; check the matcher in `src/proxy.ts` |
| `permission denied for table X` | A column grant in `0009`, not a policy — see the grants section |
