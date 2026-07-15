# Oceanpick Demand Planner

Phase 1 · Session 1 — foundation. Auth works; input pages arrive in Session 2.

## What exists right now

- Postgres schema: 14 tables, constraints, and row-level security (`supabase/migrations/`)
- Seed: org, 7 size buckets, master plan (`supabase/seed.sql`)
- Next.js app with self-serve signup (any email joins the Oceanpick workspace), login, session refresh
- Authenticated shell + a home page showing seeded state

Not yet built: Programs / Demand / Harvest pages, the calculation engine, scenarios.

---

## Setup

### 0. Prerequisites

- Node 20+ (`node --version`)
- A Supabase project — free tier, region **South Asia (Mumbai)**

### 1. Install

```bash
npm install
```

### 2. Apply the schema

From **Project Settings → General**, copy your **Reference ID**, then:

```bash
npx supabase login
npx supabase link --project-ref YOUR_PROJECT_REF
npx supabase db push
```

`db push` asks for the database password you set at project creation.

> **If `db push` complains about Docker**: it shouldn't (Docker is only needed
> for the *local* stack, `supabase start`), but if it does, fall back to
> pasting `supabase/migrations/20260715000001_initial_schema.sql` into the
> Supabase **SQL Editor** and running it. If you do that, tell the CLI so it
> doesn't try to re-apply later:
> ```bash
> npx supabase migration repair --status applied 20260715000001
> ```

### 3. Run the seed

`db push` does **not** run seeds against a remote project. Open the Supabase
**SQL Editor**, paste the contents of `supabase/seed.sql`, and run it.

This must happen **before anyone signs up**. `handle_new_user()` attaches every
new account to the Oceanpick org, so if that row isn't seeded, signup fails at
the database level.

The seed is idempotent; re-running it is harmless.

### 4. Expose the schema

**Project Settings → API → Exposed schemas**: add `demand_planner`.

> **This one is not optional.** PostgREST only serves schemas on this
> allowlist. Miss it and every single query returns 404 — the app will load,
> you'll sign in fine (auth doesn't go through PostgREST), and then the home
> page will show zeros with no obvious cause. If you see that, this is why.

You can leave `public` on the list or remove it; the app touches neither.

### 5. Configure auth

**Authentication → Providers → Email**:
- Enable Email provider
- **Turn OFF "Confirm email"** for now

> Why: the free tier's built-in SMTP is rate-limited to a handful of emails per
> hour and frequently lands in spam. Fine for a team of two testing locally;
> not fine for onboarding ten people. Before the team uses this for real, wire
> up custom SMTP (Resend, SendGrid, SES) and turn confirmation back on.

**Authentication → URL Configuration**:
- Site URL: `http://localhost:3000`
- Redirect URLs: add `http://localhost:3000/**`

### 6. Environment variables

```bash
cp .env.example apps/web/.env.local
```

Fill in from **Project Settings → API**:

| Variable | Where | Notes |
|---|---|---|
| `NEXT_PUBLIC_SUPABASE_URL` | Project URL | Safe in the browser |
| `NEXT_PUBLIC_SUPABASE_ANON_KEY` | `anon` `public` key | Safe in the browser — RLS constrains it |
| `SUPABASE_SERVICE_ROLE_KEY` | `service_role` key | **Bypasses RLS.** Server-only. Never prefix `NEXT_PUBLIC_`. Unused until Phase 2. |

`.env.local` is gitignored. Keep it that way.

### 7. Run

```bash
npm run dev
```

Open http://localhost:3000 → you'll be redirected to `/login`.

---

## First-run check

1. Go to `/signup` and register (any email works — signup is open, see below).
   The **first** account in becomes **admin**; everyone after defaults to
   **viewer**.
2. You land on `/home` and your role reads **admin**
3. Home shows: master plan name, **7** buckets, **1** team member
4. Horizon reads `M1 = Apr 26 · M60 = Mar 31`
5. Have a second person sign up → they land on `/home` as **viewer**

> **Signup is open by design.** Migration `20260715000002_open_signup.sql`
> removed the original `@oceanpick.com` email-domain gate — the tech team
> controls who can reach signup, so any email that completes signup joins the
> Oceanpick workspace. The security boundary that remains is **RLS + the auth
> gate**: a logged-in user with no Oceanpick profile row is refused at
> `(app)/layout.tsx` and reads zero rows under RLS regardless.

---

## Troubleshooting

| Symptom | Cause | Fix |
|---|---|---|
| "Account not fully provisioned" | Seed never ran | Run `supabase/seed.sql` |
| Signup fails at the database level | Seed never ran — no Oceanpick org row to attach the user to | Check `select * from organizations;`, re-run `seed.sql` |
| "No master plan found" on home | Seed partially ran | Re-run `seed.sql` — it's idempotent |
| Home shows 5 buckets, not 7 | Old seed | Re-run `seed.sql` |
| Redirect loop on `/login` | Site URL not set | Auth → URL Configuration → `http://localhost:3000` |
| `Invalid API key` | Wrong key or stale env | Re-copy the **anon** key; restart `npm run dev` |
| Sign-in works, but home shows all zeros / 404s in the network tab | `demand_planner` not on the exposed-schemas allowlist | Project Settings → API → Exposed schemas → add `demand_planner` |
| `relation "public.plans" does not exist` | A client is missing `db: { schema: DB_SCHEMA }` | Check `lib/supabase/client.ts` and `server.ts` |

---

## Layout

```
apps/web/                    Next.js 15, App Router
  app/
    login/, signup/          Public. actions.ts holds the server actions.
    auth/callback/           Email-confirmation exchange (unused while confirm is off)
    (app)/                   Authenticated. layout.tsx is the auth gate.
  lib/supabase/
    client.ts                Browser client
    server.ts                Server client (anon key -> runs under RLS)
    middleware.ts            Session refresh + route guard
  middleware.ts              Wires the above into every request

packages/shared/             Types + helpers shared across workspaces
supabase/
  migrations/                Version-controlled schema
  seed.sql                   Org, buckets, master plan
```

Everything lives in the **`demand_planner`** schema, not `public`. The name is
defined once, in `packages/shared/src/index.ts` as `DB_SCHEMA`, and both
Supabase clients read it from there. Don't hardcode it a second time.

`apps/api` (the calc engine) arrives in Phase 2. Adding an empty folder for it
now would just be clutter.

## Scripts

| Command | Does |
|---|---|
| `npm run dev` | Dev server on :3000 |
| `npm run build` | Production build |
| `npm run typecheck` | Typecheck all workspaces |
| `npm run db:push` | Apply migrations to the linked project |
| `npm run db:types` | Regenerate TS types from the live schema |

---

## Security notes

**RLS is the boundary, not the UI.** Every table has row-level security. The
app uses the anon key, so a bug in a React component cannot leak another user's
scenario — Postgres refuses the read. Verified: a viewer querying another
user's scenarios gets zero rows, and an `UPDATE` against the master plan
affects zero rows.

**`anon` has no grants at all.** This is why the app lives in `demand_planner`
rather than `public`. Supabase's `public` schema ships with
`grant all ... to anon`; RLS blocks it in practice, but one missing policy
would turn into a leak. A fresh schema starts empty, so unauthenticated
requests are refused at the permission layer — `permission denied for schema
demand_planner` — before RLS is ever consulted. Two independent layers instead
of one.

`authenticated` is granted only the verbs each table needs, and RLS then
decides which rows. Verified: `audit_log` rejects UPDATE (an audit trail you
can edit isn't one), and `users` rejects INSERT (rows come from the signup
trigger; a users row without a matching auth.users row is meaningless).

**The service role key bypasses all of that.** It exists for the Phase 2 calc
engine, which needs to write computed results across plans. It must never
reach the browser.

**Deviation from `data-model.md` §8, documented deliberately**: the spec's
pseudocode uses `current_setting('app.current_org_id')`. This implementation
derives identity from `auth.uid()` instead. Same isolation, less plumbing, and
it can't be spoofed by an app-layer bug that forgets to set the session
variable.
