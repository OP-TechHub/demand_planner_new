# Data Model Specification

**Version**: Draft 1
**Reference**: `calculation-engine-spec.md` (Sections 1-9)
**Purpose**: Define the Postgres schema, relationships, and scenario/branching model
for the Oceanpick Demand Planner web application.

## Reading conventions

- All primary keys are UUIDs (`uuid` in Postgres, generated with `gen_random_uuid()`)
- Timestamps are `timestamptz` in UTC
- Money is `numeric(18, 4)` — enough precision for kg × $/kg calcs
- Quantities (kg WR, kg FP) are `numeric(18, 4)`
- Yields are `numeric(6, 4)` — 4 decimal places, e.g., 0.4980
- Percentages are `numeric(6, 4)` stored as fractions (0.2555 = 25.55%)
- Every mutable table has `created_at`, `updated_at`, `created_by`, `updated_by`
- Soft delete via `deleted_at timestamptz null` on tables where deletion should be recoverable

## Table of contents

1. [Users, orgs, and authentication](#1-users-orgs-and-authentication)
2. [Plans and scenarios (the branching model)](#2-plans-and-scenarios)
3. [Reference data (buckets, master data)](#3-reference-data)
4. [Plan input tables](#4-plan-input-tables)
5. [Computed results (materialized outputs)](#5-computed-results)
6. [Audit and versioning](#6-audit-and-versioning)
7. [Indexes and performance](#7-indexes-and-performance)
8. [Row-level security](#8-row-level-security)

---

## 1. Users, orgs, and authentication

### `organizations`

The tenant boundary. In v1 there's likely only one — Oceanpick. But baking multi-org
support in at the schema level costs almost nothing and prevents painful migrations later.

| Column | Type | Notes |
|---|---|---|
| `id` | uuid PK | |
| `name` | text | e.g., "Oceanpick" |
| `slug` | text unique | e.g., "oceanpick"; used in URLs |
| `allowed_email_domain` | text | e.g., "oceanpick.com". Enforced at signup. |
| `created_at`, `updated_at` | timestamptz | |

### `users`

| Column | Type | Notes |
|---|---|---|
| `id` | uuid PK | |
| `org_id` | uuid FK organizations | |
| `email` | text unique | Must end with `org.allowed_email_domain` |
| `full_name` | text | |
| `role` | enum | See below. Stored as text: `admin`, `planner`, `contributor`, `viewer`. |
| `is_active` | boolean | Soft-disable users without deleting |
| `last_login_at` | timestamptz null | |
| `created_at`, `updated_at` | timestamptz | |

**Role definitions** (from spec):
- **admin**: everything, including user management
- **planner**: edit master plan, create/edit any scenario, promote scenarios (v2), view all
- **contributor**: edit their own scenarios; edit specific fields on master only if allowed (v2 field-level perms); view all
- **viewer**: read-only

### `sessions` (or delegated to auth provider)

If we use AWS Cognito, Auth0, or similar, session tables live there. If we roll our own:

| Column | Type | Notes |
|---|---|---|
| `id` | uuid PK | |
| `user_id` | uuid FK | |
| `token_hash` | text | bcrypt or argon2 |
| `expires_at` | timestamptz | |
| `created_at` | timestamptz | |
| `revoked_at` | timestamptz null | |

Recommendation: use AWS Cognito or Auth0 for v1 to avoid building auth from scratch.

---

## 2. Plans and scenarios

**This is the central design decision.** I present three options with tradeoffs, then
recommend one.

### The problem

Every user can have their own "scenarios" — sandbox copies of the master plan they
edit for what-if analysis. There's one canonical master plan that the team edits
collaboratively. We need to represent both efficiently.

### Option A — Full clone per scenario

Every scenario is a complete copy of all plan data (programs, harvest plan, demand
plan, buckets, settings).

**Pros:**
- Simple queries: `WHERE plan_id = X` is all you ever need
- Deletion is trivial: drop the scenario, no orphan concerns
- No coupling: each scenario is fully independent

**Cons:**
- Storage: each scenario is ~50 programs × 60 months × ~10 fields = ~30k rows.
  With 10 users × 5 scenarios each = 50 scenarios = 1.5M rows. Manageable but
  will grow.
- Diverging from master: if master changes after fork, scenario doesn't see the
  update automatically (may be desired or not — user decision).
- Compare to master requires JOIN across two full plan copies.

### Option B — Copy-on-write overlay

Each scenario stores ONLY the fields that differ from master. Reads join scenario
data with master, using scenario value if present, else master value.

**Pros:**
- Efficient storage: a scenario that changed 3 cells stores 3 rows
- "Rebase on master" is possible: pull in master updates while keeping local edits

**Cons:**
- Every read is a JOIN or a COALESCE across two tables — more complex queries
- Deleting a program from master: what happens to scenario overrides for that
  program? Cascade decisions get thorny.
- Bugs in override logic can silently corrupt data — hard to debug.

### Option C — Immutable versioning + branches

Every save creates an immutable version of the plan (all data). Scenarios are
just named branches pointing to versions. Master is a "branch" too.

**Pros:**
- Full history for free. Rollback to any past state.
- Git-like mental model: familiar to some users.
- Concurrent edits: two people editing = two branches, then merge.

**Cons:**
- Massive storage overhead: every save = full plan copy
- Complex to build: versioning + merge logic
- Overkill for the "master + scenarios" v1 model

### Recommendation: **Option A (full clone)** for v1

Storage is not a real constraint at Oceanpick's scale. Query simplicity is worth
more than storage efficiency. If we ever need history or overlay behavior, we
can migrate to Option B or C when the pain is real.

**One concession**: even in Option A, we'll keep a `parent_plan_id` reference so
we know which master a scenario was forked from. Later, if we want "sync from
master" as a feature, we can add it without schema changes.

### `plans`

Both the master and scenarios live in this table.

| Column | Type | Notes |
|---|---|---|
| `id` | uuid PK | |
| `org_id` | uuid FK | |
| `type` | enum | `master` or `scenario` |
| `parent_plan_id` | uuid FK plans null | For scenarios: which plan they were forked from (usually master). Null for master itself. |
| `name` | text | For master: "Master Plan". For scenario: user-provided name like "What if we lose Woolworths". |
| `description` | text | Free text. |
| `owner_user_id` | uuid FK users | For scenarios: the user who owns it. For master: `null` (org-owned). |
| `is_locked` | boolean | If true, no edits allowed. For master, admin can lock during monthly close. |
| `plan_start_date` | date | The first day of M1. E.g., 2026-04-01. |
| `horizon_months` | int | Fixed at 60 for v1, but stored so future flexibility exists. |
| `settings_margin_metric` | enum | `margin_fp` / `margin_wr` / `total_contribution` |
| `settings_allocation_mode` | enum | `fill_what_you_can` / `all_or_nothing` |
| `settings_scope` | enum | `active` / `active_pipeline`. Default `active_pipeline`. |
| `settings_lookback_months` | int | Default 2. |
| `forked_at` | timestamptz null | When the scenario was created from parent. Null for master. |
| `deleted_at` | timestamptz null | Soft delete. |
| `created_at`, `updated_at` | timestamptz | |
| `created_by`, `updated_by` | uuid FK users | |

**Constraint**: only one `master` plan per org. Enforced by partial unique index:
`CREATE UNIQUE INDEX ... ON plans(org_id) WHERE type='master' AND deleted_at IS NULL`.

### Scenario lifecycle

1. **Fork**: User clicks "New Scenario" on master → app copies all input tables
   (programs, harvest_plan, demand_plan) from master to a new plan with
   `type='scenario'`, `parent_plan_id=<master.id>`, `owner_user_id=<current user>`.
2. **Edit**: User edits scenario's inputs. Master is unaffected.
3. **View diff**: Query compares scenario input rows to master input rows. Where
   values differ, show as "changed from master".
4. **Delete**: Soft delete (`deleted_at`). Physical cleanup by background job after
   retention period (e.g., 90 days).
5. **Promote to master** (v2): copy scenario's inputs back to master. Not in v1.

---

## 3. Reference data

Data that's shared across all plans within an org. Doesn't get cloned per scenario.

### `buckets`

The size grade master list. Managed at org level.

| Column | Type | Notes |
|---|---|---|
| `id` | uuid PK | |
| `org_id` | uuid FK | |
| `name` | text | e.g., "800-1100g". Unique per org. |
| `sort_order` | int | Lower = higher priority. Unique per org (except duplicates are handled per spec — alphabetic fallback + warning). |
| `is_archived` | boolean | Soft-hide instead of delete, to preserve historical plan references. |
| `created_at`, `updated_at`, `created_by`, `updated_by` | | |

**Note**: buckets are org-scoped, not plan-scoped. Changing a bucket's `sort_order`
affects ALL plans (master + all scenarios) in that org. If we ever need
plan-specific bucket priorities, we'd add a `bucket_overrides` table keyed by
(plan_id, bucket_id).

---

## 4. Plan input tables

These are the tables that get cloned when a scenario is forked. Each row belongs
to exactly one plan.

### `programs`

| Column | Type | Notes |
|---|---|---|
| `id` | uuid PK | |
| `plan_id` | uuid FK plans | |
| `status` | enum | `active` / `pipeline` / `inactive` |
| `item_code` | text | Unique per plan |
| `item_description` | text | |
| `customer` | text | |
| `max_monthly_demand_fp` | numeric(18,4) | Baseline demand (kg FP/month) |
| `primary_bucket_id` | uuid FK buckets | Required |
| `secondary_bucket_id` | uuid FK buckets null | |
| `tertiary_bucket_id` | uuid FK buckets null | |
| `primary_yield` | numeric(6,4) | ∈ (0, 1] |
| `secondary_yield` | numeric(6,4) null | Required iff `secondary_bucket_id` is set |
| `tertiary_yield` | numeric(6,4) null | |
| `price_per_fp` | numeric(18,4) | $/kg FP |
| `barra_cost_wr` | numeric(18,4) | $/kg WR |
| `packing_cost_fp` | numeric(18,4) | |
| `processing_cost_fp` | numeric(18,4) | |
| `storage_cost_fp` | numeric(18,4) | |
| `freight_cost_fp` | numeric(18,4) | |
| `other_costs_fp` | numeric(18,4) | Simple field in v1 (per Q1 answer). |
| `locked` | boolean | |
| `sort_order` | int | Display order in Programs tab; also breaks ties in ranking. |
| `created_at`, `updated_at`, `created_by`, `updated_by` | | |
| `deleted_at` | timestamptz null | Soft delete. |

**Constraints**:
- `(plan_id, item_code)` unique
- `secondary_bucket_id IS NOT NULL` ↔ `secondary_yield IS NOT NULL` (check constraint)
- Same for tertiary
- `primary_yield > 0 AND primary_yield <= 1`
- `max_monthly_demand_fp >= 0`
- All cost fields `>= 0`, price `> 0`

### `harvest_plan`

| Column | Type | Notes |
|---|---|---|
| `id` | uuid PK | |
| `plan_id` | uuid FK plans | |
| `bucket_id` | uuid FK buckets | |
| `month_index` | int | 1-60 |
| `capacity_kg_wr` | numeric(18,4) | ≥ 0 |
| `created_at`, `updated_at`, `created_by`, `updated_by` | | |

**Constraints**:
- `(plan_id, bucket_id, month_index)` unique
- `month_index BETWEEN 1 AND 60`
- `capacity_kg_wr >= 0`

Missing rows default to `0`. We don't materialize the full grid (30 buckets × 60
months = 1800 rows) if capacity is 0 for many cells — sparse storage.

### `demand_plan`

Per-program per-month demand. Sparse: missing rows fall back to
`program.max_monthly_demand_fp`.

| Column | Type | Notes |
|---|---|---|
| `id` | uuid PK | |
| `plan_id` | uuid FK plans | |
| `program_id` | uuid FK programs | |
| `month_index` | int | 1-60 |
| `demand_fp` | numeric(18,4) | ≥ 0 |
| `created_at`, `updated_at`, `created_by`, `updated_by` | | |

**Constraints**:
- `(program_id, month_index)` unique
- `demand_fp >= 0`

**Read behavior**: to get demand for (program, month), fetch this table; if no
row, fall back to `program.max_monthly_demand_fp`.

**Write behavior**: when user edits a specific cell, we UPSERT into this table.
When user hits "reset to baseline" for a cell, we DELETE the row (so it falls back).

---

## 5. Computed results (materialized outputs)

Per the calc engine spec, the engine produces many outputs: rolling_fp,
rolling_wr, rolling_margin, unallocated_wr, per-program aggregates, etc.

**Design decision**: materialize the outputs into tables, don't compute on every
read. This is important for the < 2 second re-run target and for making read
pages fast.

Every re-run:
1. Deletes existing rows in these tables where `plan_id = X`
2. Recomputes and inserts fresh rows
3. Updates `plans.last_computed_at`

This is destructive (no history of past runs) but simple. If we want past-run
history later, we add a `computation_run_id` column.

### `plan_rank`

Program rank order for the plan.

| Column | Type | Notes |
|---|---|---|
| `plan_id` | uuid FK plans | |
| `program_id` | uuid FK programs | |
| `priority_score` | bigint | The composite score |
| `global_rank` | int | 1..N |
| `in_scope` | boolean | Whether the program was in scope for this rank |
| PK | `(plan_id, program_id)` | |

### `allocations`

The per-(program, month, path) own-month allocation.

| Column | Type | Notes |
|---|---|---|
| `plan_id` | uuid FK plans | |
| `program_id` | uuid FK programs | |
| `month_index` | int | 1-60 |
| `path` | enum | `primary` / `secondary` / `tertiary` |
| `allocated_wr` | numeric(18,4) | |
| PK | `(plan_id, program_id, month_index, path)` | |

### `rolling_results`

Per-(program, month), the outputs of Rolling Calc.

| Column | Type | Notes |
|---|---|---|
| `plan_id` | uuid FK plans | |
| `program_id` | uuid FK programs | |
| `month_index` | int | |
| `demand_fp` | numeric(18,4) | Copy of input for convenience |
| `own_fp` | numeric(18,4) | |
| `own_wr` | numeric(18,4) | |
| `borrow_m1_prim_wr` | numeric(18,4) | |
| `borrow_m1_alt_wr` | numeric(18,4) | |
| `borrow_m1_tert_wr` | numeric(18,4) | |
| `borrow_m2_prim_wr` | numeric(18,4) | |
| `borrow_m2_alt_wr` | numeric(18,4) | |
| `borrow_m2_tert_wr` | numeric(18,4) | |
| `rolling_fp` | numeric(18,4) | |
| `rolling_wr` | numeric(18,4) | |
| `rolling_margin` | numeric(18,4) | |
| `revenue` | numeric(18,4) | |
| `cost` | numeric(18,4) | |
| `fulfilment_pct` | numeric(6,4) null | |
| `unfulfilled_wr` | numeric(18,4) | |
| PK | `(plan_id, program_id, month_index)` | |

### `unallocated_wr`

Per-(bucket, month) leftover after own consumption AND all borrowings.

| Column | Type | Notes |
|---|---|---|
| `plan_id` | uuid FK plans | |
| `bucket_id` | uuid FK buckets | |
| `month_index` | int | |
| `plan_capacity_wr` | numeric(18,4) | Copy of input |
| `own_consumption_wr` | numeric(18,4) | |
| `borrowings_into_wr` | numeric(18,4) | |
| `unallocated_wr` | numeric(18,4) | |
| PK | `(plan_id, bucket_id, month_index)` | |

### `pipeline_wr` (denormalized view)

Redundant with `unallocated_wr` + `allocations` filtered to pipeline programs,
but pre-aggregated for the Pipeline tab's grid.

| Column | Type | Notes |
|---|---|---|
| `plan_id` | uuid FK plans | |
| `bucket_id` | uuid FK buckets | |
| `month_index` | int | |
| `pipeline_wr` | numeric(18,4) | WR consumed by pipeline programs at (B, M) |
| PK | `(plan_id, bucket_id, month_index)` | |

### `plan_summary`

FY-level and 60-month totals for Annual Summary tab.

| Column | Type | Notes |
|---|---|---|
| `plan_id` | uuid FK plans | |
| `period` | enum | `fy1`, `fy2`, `fy3`, `fy4`, `fy5`, `total_60mo` |
| `demand_fp` | numeric(18,4) | |
| `allocated_fp` | numeric(18,4) | |
| `unallocated_fp` | numeric(18,4) | |
| `allocated_wr` | numeric(18,4) | |
| `unallocated_wr` | numeric(18,4) | |
| `revenue` | numeric(18,4) | |
| `cost` | numeric(18,4) | |
| `margin` | numeric(18,4) | |
| `gp_pct` | numeric(6,4) | |
| `revenue_opportunity` | numeric(18,4) | |
| `cost_opportunity` | numeric(18,4) | |
| `margin_opportunity` | numeric(18,4) | |
| `margin_gap` | numeric(18,4) | |
| PK | `(plan_id, period)` | |

### `plans.last_computed_at`

Add column to `plans`:
- `last_computed_at` timestamptz null — set to `now()` after a successful full re-run

If any input mutation occurs after `last_computed_at`, the plan is "stale" and
must be recomputed before displaying results.

---

## 6. Audit and versioning

### `audit_log`

Every write to any input table gets an entry. Used for "who changed what and when".

| Column | Type | Notes |
|---|---|---|
| `id` | uuid PK | |
| `org_id` | uuid FK | |
| `plan_id` | uuid FK plans null | Null for org-level changes (buckets, users) |
| `user_id` | uuid FK users | Who did it |
| `entity_type` | text | e.g., `programs`, `harvest_plan`, `demand_plan`, `plans`, `users`, `buckets` |
| `entity_id` | uuid | The row that changed |
| `action` | enum | `insert` / `update` / `delete` |
| `changes` | jsonb | `{"field_name": {"old": ..., "new": ...}, ...}` |
| `reason` | text null | Optional user-provided note. Required for certain fields in v2 (per Model B semantics). |
| `at` | timestamptz | |

**Retention**: keep 2 years by default. Configurable per org.

### v1 does NOT include

- Snapshot versioning of the master plan (no "restore to yesterday's state")
- Diff view of two plans (beyond scenario-vs-master current-state)
- Approval workflows for changes

These land in v2.

---

## 7. Indexes and performance

Beyond primary keys:

| Table | Index | Purpose |
|---|---|---|
| `users` | `(email)` unique | Login lookup |
| `users` | `(org_id, role)` | List users by role |
| `plans` | `(org_id, type)` where `deleted_at IS NULL` | Find master; list scenarios |
| `plans` | `(owner_user_id)` where `deleted_at IS NULL` | User's own scenarios |
| `programs` | `(plan_id, deleted_at)` | Load all programs for a plan |
| `harvest_plan` | `(plan_id, bucket_id, month_index)` unique | Idempotent upserts + fast lookup |
| `demand_plan` | `(plan_id, program_id, month_index)` unique | Idempotent upserts |
| `rolling_results` | `(plan_id, month_index)` | Time-slice queries for charts |
| `unallocated_wr` | `(plan_id, bucket_id)` | Per-bucket views |
| `audit_log` | `(plan_id, at DESC)` | Recent activity feed |
| `audit_log` | `(user_id, at DESC)` | User's history |
| `audit_log` | `(entity_type, entity_id, at DESC)` | Change history for a specific row |

### Performance target rationale

< 2 seconds full re-run assumes:
- 50 programs × 60 months × 6 borrow channels = 18,000 borrow decisions
- Plus 3,000 own-month allocations
- Plus rank calc + aggregations
- On a single Postgres connection with reasonable indexes and a Python (or Node)
  engine that holds all data in memory during compute

If the engine is written naively (e.g., a SUMIFS per cell against a database),
this will not hit 2s. The engine must:
1. Load all inputs into memory (a few MB at most)
2. Compute in-memory
3. Bulk-insert results (COPY or multi-row INSERT)

---

## 8. Row-level security

Postgres RLS policies enforce access at the database layer.

### Principles

- **Org isolation**: no user ever sees data from another org
- **Master plan**: readable by all users of the org (given their role permits reads)
- **Scenarios**: readable/writable ONLY by the owner + admins/planners
- **Buckets**: readable by all users; writable by admins only

### Policies (pseudocode)

```sql
-- Every table with org_id
CREATE POLICY org_isolation ON <table>
  USING (org_id = current_setting('app.current_org_id')::uuid);

-- plans: master visible to all in org; scenarios only to owner + planners/admins
CREATE POLICY plans_read ON plans FOR SELECT
  USING (
    type = 'master'
    OR owner_user_id = current_setting('app.current_user_id')::uuid
    OR current_setting('app.current_role') IN ('admin', 'planner')
  );

-- programs, harvest_plan, demand_plan: inherit from parent plan
CREATE POLICY programs_read ON programs FOR SELECT
  USING (
    EXISTS (
      SELECT 1 FROM plans p 
      WHERE p.id = programs.plan_id
      AND (
        p.type = 'master'
        OR p.owner_user_id = current_setting('app.current_user_id')::uuid
        OR current_setting('app.current_role') IN ('admin', 'planner')
      )
    )
  );

-- Write policies: only admins/planners can edit master; scenario owners can edit their own
CREATE POLICY plans_write ON plans FOR UPDATE
  USING (
    (type = 'master' AND current_setting('app.current_role') IN ('admin', 'planner'))
    OR (type = 'scenario' AND owner_user_id = current_setting('app.current_user_id')::uuid)
  );
```

App layer sets `app.current_org_id`, `app.current_user_id`, `app.current_role`
per request from the authenticated session.

---

## Resolved decisions

All 6 open questions from Draft 1 have been resolved:

1. **Bucket rename affecting historical scenarios**: **Shared buckets**. Renaming
   a bucket affects every plan (master + all scenarios). No snapshot at fork time.

2. **Program deletion semantics**: **Leave scenarios intact**. Scenarios have their
   own program rows (per Option A full-clone); deleting from master does not
   cascade.

3. **Scenario naming**: **Required at fork time**. Max 100 chars.

4. **Scenario limit per user**: **20 scenarios per user**, admin-configurable in
   v2.

5. **Master plan lock during recalc**: **Stale data with banner**. Users see
   previous results until recalc completes (usually < 2s).

6. **Time zone**: **Browser local time** for display. All timestamps stored UTC.

Spec is locked. Ready for implementation.
