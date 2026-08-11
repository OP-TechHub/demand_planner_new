# Developer Guide

**Oceanpick Demand Planner** — architecture, setup, and conventions.

The app reproduces the "V30" demand-planning workbook: enter programs, demand, and
harvest capacity; the allocation engine computes fulfilment, revenue, cost, and
margin over a 60-month horizon, across multiple plans and users.

---

## 1. Stack

- **Next.js 15** (App Router, React Server Components, Server Actions)
- **React 19**, **Tailwind CSS**, **Recharts** (charts), **lucide-react** (icons)
- **Supabase** — Postgres (schema `demand_planner`), Auth, Row-Level Security
- **Resend** — transactional email (change notifications)
- **Vercel** — hosting (uses `@vercel/functions` `waitUntil` for background work)
- **TypeScript** throughout; **npm workspaces** monorepo

---

## 2. Monorepo layout

```
apps/web              Next.js app (UI, server actions, API routes)
  app/(app)/…         Authenticated app pages (route group)
  app/login, /signup, /forgot-password, /reset-password, /auth/callback
  app/api/v1/…        Read-only external API (API-key auth)
  app/api/recompute   Background recompute trigger
  lib/                supabase clients, plan helpers, recompute-core, email, audit
  components/         shared UI + charts
packages/shared       Types, role/permission logic, month helpers (@oceanpick/shared)
packages/engine       The allocation engine (@oceanpick/engine)
supabase/migrations   SQL migrations (run manually — see §8)
docs/                 This documentation
```

Import aliases: `@/…` → `apps/web`, `@oceanpick/shared`, `@oceanpick/engine`.

---

## 3. Local setup

**Prereqs:** Node ≥ 20.

```bash
npm install
```

Create `apps/web/.env.local`:

```
NEXT_PUBLIC_SUPABASE_URL=…            # your Supabase project URL
NEXT_PUBLIC_SUPABASE_ANON_KEY=…       # anon public key
SUPABASE_SERVICE_ROLE_KEY=…           # service role (server-only; bypasses RLS)

# Optional
NEXT_PUBLIC_SITE_URL=http://localhost:3000   # used for email links / auth redirects
RESEND_API_KEY=re_…                          # enables change-notification emails
RESEND_FROM=Oceanpick Demand Planner <planner@oceanpick.com>
```

Run:

```bash
npm run dev            # apps/web on :3000
```

**Scripts** (root):

| Command | Does |
|---|---|
| `npm run dev` | Next dev server |
| `npm run build` | Production build (also the pre-commit gate) |
| `npm run typecheck` | `tsc --noEmit` across workspaces |
| `npm run lint` | Next lint |
| `npm run db:push` / `db:types` | Supabase CLI (if you use it locally) |

Always run `npm run typecheck -w @oceanpick/web` and `npm run build` before
committing.

---

## 4. Architecture

### Rendering & data flow
- **Server Components** read data directly via the server Supabase client and pass
  plain props to client components.
- **Server Actions** (`'use server'`) perform mutations, then `revalidatePath`.
- Client components handle interactivity (`useState`, `useTransition`,
  `useActionState`), calling server actions.
- Next 15: `searchParams` / `params` are **Promises** — `await` them.

### Supabase clients (`apps/web/lib/supabase/`)
- **server** (`createClient`) — request-scoped, RLS-enforced, the caller's session.
- **service** (`createServiceClient`) — **service role, bypasses RLS**. Used for
  privileged writes where authorization is enforced **in app code** (recompute,
  admin undo, cross-user reads). Never expose it to the client.
- **middleware** — refreshes the auth token on every request and gates routes.

### Auth & routing
- `middleware.ts` → `lib/supabase/middleware.ts`. Public routes: `/login`,
  `/signup`, `/auth`, `/forgot-password`. Everything else requires a session;
  unauthenticated users are redirected to `/login`.
- **Sign-up approval**: `handle_new_user()` attaches the account to the org; the
  first user is admin, others start `is_active = false` and need admin approval.
- **Password reset**: `/forgot-password` → `resetPasswordForEmail` → email link →
  `/auth/callback` (handles both PKCE `?code` and OTP `?token_hash&type=recovery`)
  → `/reset-password` → `updateUser({ password })`. The reset email is sent by
  **Supabase Auth** (configure its SMTP + allow-list the callback redirect URL).

### Permissions (`packages/shared`)
- `UserRole = 'admin' | 'planner' | 'contributor' | 'viewer'`.
- `can.*` — coarse capabilities (`manageUsers`, `editBuckets`, `editMaster`,
  `createScenario`, `createPlan`).
- `canEditSection(role, editSections, section)` — org-wide grants (buckets).
- `canEditPlanSection(plan, user, hasGrant)` — **mirrors the DB's
  `can_write_section()`**: locked ⇒ nobody; admin ⇒ any unlocked plan; sandbox ⇒
  owner; official ⇒ requires a `plan_editor_grants` row. Keep these in sync with
  the SQL policy so the UI never offers an edit the DB will reject.

---

## 5. The calc engine (`packages/engine`)

Pure functions; no I/O. `runRecompute` (in `apps/web/lib/recompute-core.ts`) loads
a plan's inputs, calls the engine, and persists the results.

Core ideas:
- **Units:** demand is finished product **FP**; capacity is whole round **WR**.
  `FP = WR × yield`, so `WR_needed = FP / yield`.
- **Allocation:** each program's monthly demand is met from its **primary →
  secondary → tertiary** buckets in order; it can **borrow** capacity from up to
  the previous four months (twelve channels: m1…m4 × primary/alt/tertiary),
  truncated by the plan's `settings_lookback_months` (1–4). `MAX_LOOKBACK` in
  `rolling.ts` is the single source of truth — the channel list, the persistence
  mapping, and the Open-to-buy attribution all derive from it.
- **Outputs per program-month** (`rolling_results`): `demand_fp`, `rolling_fp`
  (fulfilled), `revenue`, `cost`, `rolling_margin`, and borrow fields.
- **Spare/consumption per bucket-month:** `unallocated_wr` (spare WR) and
  `pipeline_wr` (WR consumed by pipeline programs).
- **`allocations`** stores own-month allocation (program, month, path, WR).

Files: `engine.ts` (orchestration), `allocate.ts` (cascade + borrowing),
`rank.ts` (ordering), `rolling.ts` / `aggregate.ts` / `derived.ts` (roll-ups),
`types.ts`.

**Attribution can be reconstructed** from persisted tables (`allocations` own-month
+ `rolling_results` borrow channels) — that's how the Open-to-buy per-inquiry
breakdown is built.

---

## 6. Data model (schema `demand_planner`)

Key tables:

- **organizations**, **users** (`role`, `is_active`, `edit_sections`, `org_id`)
- **plans** — `type` (master/scenario), `is_sandbox`, `is_live`, `is_locked`,
  `owner_user_id`, `plan_start_date`, `horizon_months`, settings, `last_computed_at`
- **programs** — customer, product, `status` (active/pipeline/inactive), sourcing
  buckets + yields, price, costs, `sort_order`, `deleted_at`
- **demand_plan** — (plan, program, month) → `demand_fp`
- **harvest_plan** — (plan, bucket, month) → `capacity_kg_wr`
- **buckets** — org-wide size ranges
- **allocations**, **rolling_results** — engine outputs
- **plan_summary** — cached totals for the Dashboard
- **inquiries** — the inquiry register
- **plan_editor_grants** — per-plan, per-tab edit grants
- **recompute_jobs** — background job status (queued/running/done/error)
- **audit_log** — every change (`changes` jsonb; `reverted_at`/`reverted_by` for undo)
- **api_keys** — external API auth

RLS is enabled; reads are org-scoped. Privileged/cross-user writes go through the
service-role client with app-level authorization.

### Twin model
A program has one `status`. Per-month active + pipeline for the same product is
modelled with **pipeline twins** (`‹code›-P`). Inquiries accumulate onto the twin;
promotion moves months from pipeline to active (splitting where partial).

---

## 7. Recompute flow

`POST /api/recompute` (`app/api/recompute/route.ts`):
1. Authorizes the caller (must read the plan under RLS).
2. Inserts a `recompute_jobs` row (`running`), returns **202** immediately.
3. Runs `runRecompute(planId)` via `waitUntil` (survives the response; on non-Vercel
   it awaits). Marks the job `done`/`error`.
4. On `done` for an **official** plan, best-effort emails the change summary if the
   Harvest Plan changed (see §9). Mail failure never affects the recompute.

The client (`recalculate-button.tsx`) polls `recompute_jobs` for status.

---

## 8. Migrations

SQL lives in `supabase/migrations/` and is **applied manually** in the Supabase SQL
editor (or via `supabase db push`), in filename order. Apply any not yet present:

```
20260715000001_initial_schema … 20260716000006_restore_plan_from_snapshot
20260716000007_per_plan_grants
20260716000008_scenarios_vs_plans        (is_sandbox)
20260716000009_inquiry_grant
20260716000010_inquiries
20260716000011_live_plan                 (is_live)
20260718000001_api_keys
20260805000001_audit_undo                (reverted_at / reverted_by)
```

Prefer idempotent SQL (`if not exists`, `drop policy if exists`). If you add a
migration, also update `canEditPlanSection` / `can.*` if you touched permissions,
so the UI and DB stay in lockstep.

---

## 9. Email

- **Change notifications** — `lib/email.ts` (Resend batch HTTP API, no SDK) +
  `lib/notify-recompute.ts`. Fires from the recompute job when an official plan's
  **Harvest Plan** changed since the last recalculation; emails each active user
  individually. Dormant unless `RESEND_API_KEY` is set. `RESEND_FROM` should be a
  verified domain. Times are formatted in **Asia/Colombo**.
- **Password-reset email** — sent by **Supabase Auth**, not Resend. Configure
  Supabase SMTP (can point at Resend) and **allow-list** `…/auth/callback` in
  Supabase Auth → URL Configuration.

---

## 10. Conventions & gotchas

- **Row cap:** PostgREST returns ≤ 1000 rows. Use `lib/fetch-all.ts`
  (`fetchAllByPlan`) for anything plan-scoped that can exceed that (demand/harvest
  have up to programs×60 rows).
- **Typing concatenated `.select()`** strings defeats row inference — cast
  `as unknown as {…}` and pin `new Map<K,V>(…)` generics.
- **No React namespace** in some client files — import `type { CSSProperties }` /
  `ReactNode` explicitly.
- **Server→client boundary:** don't pass functions as props (e.g. chart formatters
  are serializable strings resolved client-side).
- **Audit `changes` is heterogeneous** — the undo path relies on specific shapes
  (`edits:[{m,old,new}]`, `saved_from`, `inquiry_id`, `trim_for_inquiry`). See
  `app/(app)/admin/audit/reversible.ts` before changing what gets logged.
- **Stale `.next`** can cause phantom errors — `rm -rf apps/web/.next` and rebuild.

---

## 11. Deployment

- Hosted on **Vercel**, deploying from the repo's main branch via PR.
- Set the env vars from §3 in the Vercel project (Production), then **redeploy** so
  a build picks them up (env changes don't apply to an existing build).
- **Run outstanding migrations** in Supabase (see §8) before relying on new
  features.
- Post-deploy smoke test: sign in, open the Dashboard (charts render), create an
  official plan with a custom window, edit harvest + recalculate (email arrives),
  and try an Audit-Log undo.
