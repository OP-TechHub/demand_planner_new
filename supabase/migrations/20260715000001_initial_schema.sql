-- ============================================================================
-- Oceanpick Demand Planner — Initial Schema
-- Implements: data-model.md sections 1-8
-- Phase 1, Session 1
--
-- DEVIATION FROM SPEC (documented):
--   data-model.md §8 uses current_setting('app.current_org_id') for RLS.
--   Since the stack decision landed on Supabase Auth, we instead derive
--   identity from auth.uid() via SECURITY DEFINER helper functions. Same
--   isolation guarantees, but no per-request session variable plumbing and
--   it cannot be spoofed by the app layer.
-- ============================================================================

create extension if not exists "pgcrypto";

-- ============================================================================
-- 0. SCHEMA
-- ============================================================================

create schema if not exists demand_planner;

-- Puts demand_planner first for the remainder of this migration, so the
-- unqualified CREATE TYPE statements below land here and not in public.
set search_path = demand_planner, public;

-- ============================================================================
-- 1. ENUMS
-- ============================================================================

create type user_role       as enum ('admin', 'planner', 'contributor', 'viewer');
create type plan_type       as enum ('master', 'scenario');
create type program_status  as enum ('active', 'pipeline', 'inactive');
create type margin_metric   as enum ('margin_fp', 'margin_wr', 'total_contribution');
create type allocation_mode as enum ('fill_what_you_can', 'all_or_nothing');
create type plan_scope      as enum ('active', 'active_pipeline');
create type alloc_path      as enum ('primary', 'secondary', 'tertiary');
create type audit_action    as enum ('insert', 'update', 'delete');
create type summary_period  as enum ('fy1', 'fy2', 'fy3', 'fy4', 'fy5', 'total_60mo');

-- ============================================================================
-- 2. SHARED TRIGGER: updated_at
-- ============================================================================

create or replace function demand_planner.touch_updated_at()
returns trigger
language plpgsql
as $$
begin
  new.updated_at := now();
  return new;
end;
$$;

-- ============================================================================
-- 3. ORGANIZATIONS  (data-model.md §1)
-- ============================================================================

create table demand_planner.organizations (
  id                    uuid primary key default gen_random_uuid(),
  name                  text not null,
  slug                  text not null unique,
  allowed_email_domain  text not null,
  created_at            timestamptz not null default now(),
  updated_at            timestamptz not null default now()
);

create unique index organizations_domain_key
  on demand_planner.organizations (lower(allowed_email_domain));

create trigger organizations_touch
  before update on demand_planner.organizations
  for each row execute function demand_planner.touch_updated_at();

-- ============================================================================
-- 4. USERS  (data-model.md §1)
-- Profile table mirroring auth.users. Sessions are delegated to Supabase Auth
-- (spec §1 explicitly permits this).
-- ============================================================================

create table demand_planner.users (
  id             uuid primary key references auth.users (id) on delete cascade,
  org_id         uuid not null references demand_planner.organizations (id),
  email          text not null unique,
  full_name      text not null default '',
  role           user_role not null default 'viewer',
  is_active      boolean not null default true,
  last_login_at  timestamptz,
  created_at     timestamptz not null default now(),
  updated_at     timestamptz not null default now()
);

create index users_org_role_idx on demand_planner.users (org_id, role);

create trigger users_touch
  before update on demand_planner.users
  for each row execute function demand_planner.touch_updated_at();

-- ---------------------------------------------------------------------------
-- Identity helpers. SECURITY DEFINER so RLS policies can read demand_planner.users
-- without recursing into demand_planner.users' own RLS.
-- ---------------------------------------------------------------------------

create or replace function demand_planner.current_org_id()
returns uuid
language sql
stable
security definer
set search_path = ''
as $$
  select org_id from demand_planner.users where id = auth.uid();
$$;

create or replace function demand_planner.current_role_name()
returns demand_planner.user_role
language sql
stable
security definer
set search_path = ''
as $$
  select role from demand_planner.users where id = auth.uid() and is_active;
$$;

create or replace function demand_planner.is_editor()
returns boolean
language sql
stable
set search_path = ''
as $$
  select demand_planner.current_role_name() in ('admin', 'planner');
$$;

-- ---------------------------------------------------------------------------
-- Signup gate: enforces org.allowed_email_domain (§1).
-- The email domain determines the org — no invite codes needed in v1.
-- First user into an org becomes admin; everyone after defaults to viewer
-- and must be promoted by that admin.
-- ---------------------------------------------------------------------------

create or replace function demand_planner.handle_new_user()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_domain   text;
  v_org_id   uuid;
  v_is_first boolean;
begin
  v_domain := lower(split_part(new.email, '@', 2));

  select id into v_org_id
  from demand_planner.organizations
  where lower(allowed_email_domain) = v_domain;

  if v_org_id is null then
    raise exception 'Signup blocked: % is not an approved email domain', v_domain
      using errcode = '42501';
  end if;

  select not exists (select 1 from demand_planner.users where org_id = v_org_id)
    into v_is_first;

  insert into demand_planner.users (id, org_id, email, full_name, role)
  values (
    new.id,
    v_org_id,
    new.email,
    coalesce(new.raw_user_meta_data ->> 'full_name', ''),
    case when v_is_first then 'admin'::demand_planner.user_role else 'viewer'::demand_planner.user_role end
  );

  return new;
end;
$$;

create trigger on_auth_user_created
  after insert on auth.users
  for each row execute function demand_planner.handle_new_user();

-- ============================================================================
-- 5. PLANS  (data-model.md §2 — Option A, full clone)
-- ============================================================================

create table demand_planner.plans (
  id                        uuid primary key default gen_random_uuid(),
  org_id                    uuid not null references demand_planner.organizations (id),
  type                      plan_type not null,
  parent_plan_id            uuid references demand_planner.plans (id),
  name                      text not null check (char_length(name) between 1 and 100),
  description               text not null default '',
  owner_user_id             uuid references demand_planner.users (id),
  is_locked                 boolean not null default false,
  plan_start_date           date not null,
  horizon_months            int  not null default 60 check (horizon_months between 1 and 120),
  settings_margin_metric    margin_metric   not null default 'margin_wr',
  settings_allocation_mode  allocation_mode not null default 'fill_what_you_can',
  settings_scope            plan_scope      not null default 'active_pipeline',
  settings_lookback_months  int  not null default 2 check (settings_lookback_months between 0 and 6),
  last_computed_at          timestamptz,
  forked_at                 timestamptz,
  deleted_at                timestamptz,
  created_at                timestamptz not null default now(),
  updated_at                timestamptz not null default now(),
  created_by                uuid references demand_planner.users (id),
  updated_by                uuid references demand_planner.users (id),

  -- §2: master is org-owned and has no parent; scenarios have both
  constraint plans_master_shape check (
    (type = 'master'   and parent_plan_id is null and owner_user_id is null)
    or
    (type = 'scenario' and parent_plan_id is not null and owner_user_id is not null)
  )
);

-- §2: exactly one live master per org
create unique index plans_one_master_per_org
  on demand_planner.plans (org_id)
  where type = 'master' and deleted_at is null;

create index plans_org_type_idx  on demand_planner.plans (org_id, type) where deleted_at is null;
create index plans_owner_idx     on demand_planner.plans (owner_user_id) where deleted_at is null;

create trigger plans_touch
  before update on demand_planner.plans
  for each row execute function demand_planner.touch_updated_at();

-- §Resolved decision 4: 20 scenarios per user
create or replace function demand_planner.enforce_scenario_limit()
returns trigger
language plpgsql
as $$
declare
  v_count int;
begin
  if new.type <> 'scenario' then
    return new;
  end if;

  select count(*) into v_count
  from demand_planner.plans
  where owner_user_id = new.owner_user_id
    and type = 'scenario'
    and deleted_at is null;

  if v_count >= 20 then
    raise exception 'Scenario limit reached (20). Delete an old scenario first.'
      using errcode = '54000';
  end if;

  return new;
end;
$$;

create trigger plans_scenario_limit
  before insert on demand_planner.plans
  for each row execute function demand_planner.enforce_scenario_limit();

-- ============================================================================
-- 6. BUCKETS  (data-model.md §3 — org-scoped, shared across all plans)
-- ============================================================================

create table demand_planner.buckets (
  id           uuid primary key default gen_random_uuid(),
  org_id       uuid not null references demand_planner.organizations (id),
  name         text not null,
  sort_order   int  not null,
  is_archived  boolean not null default false,
  created_at   timestamptz not null default now(),
  updated_at   timestamptz not null default now(),
  created_by   uuid references demand_planner.users (id),
  updated_by   uuid references demand_planner.users (id),

  constraint buckets_name_unique_per_org unique (org_id, name)
);

-- NOTE: sort_order is deliberately NOT unique. calculation-engine-spec.md
-- specifies an alphabetic fallback + warning on duplicate priority rather
-- than a hard rejection.
create index buckets_org_sort_idx on demand_planner.buckets (org_id, sort_order);

create trigger buckets_touch
  before update on demand_planner.buckets
  for each row execute function demand_planner.touch_updated_at();

-- ============================================================================
-- 7. PROGRAMS  (data-model.md §4)
-- ============================================================================

create table demand_planner.programs (
  id                     uuid primary key default gen_random_uuid(),
  plan_id                uuid not null references demand_planner.plans (id) on delete cascade,
  status                 program_status not null default 'active',
  item_code              text not null,
  item_description       text not null default '',
  customer               text not null default '',
  max_monthly_demand_fp  numeric(18,4) not null default 0 check (max_monthly_demand_fp >= 0),

  primary_bucket_id      uuid not null references demand_planner.buckets (id),
  secondary_bucket_id    uuid references demand_planner.buckets (id),
  tertiary_bucket_id     uuid references demand_planner.buckets (id),

  primary_yield          numeric(6,4) not null check (primary_yield > 0 and primary_yield <= 1),
  secondary_yield        numeric(6,4) check (secondary_yield > 0 and secondary_yield <= 1),
  tertiary_yield         numeric(6,4) check (tertiary_yield  > 0 and tertiary_yield  <= 1),

  price_per_fp           numeric(18,4) not null check (price_per_fp > 0),
  barra_cost_wr          numeric(18,4) not null default 0 check (barra_cost_wr      >= 0),
  packing_cost_fp        numeric(18,4) not null default 0 check (packing_cost_fp    >= 0),
  processing_cost_fp     numeric(18,4) not null default 0 check (processing_cost_fp >= 0),
  storage_cost_fp        numeric(18,4) not null default 0 check (storage_cost_fp    >= 0),
  freight_cost_fp        numeric(18,4) not null default 0 check (freight_cost_fp    >= 0),
  other_costs_fp         numeric(18,4) not null default 0 check (other_costs_fp     >= 0),

  locked                 boolean not null default false,
  sort_order             int not null default 0,

  created_at             timestamptz not null default now(),
  updated_at             timestamptz not null default now(),
  created_by             uuid references demand_planner.users (id),
  updated_by             uuid references demand_planner.users (id),
  deleted_at             timestamptz,

  -- §4: bucket and yield must be set together, or neither
  constraint programs_secondary_pair check (
    (secondary_bucket_id is null and secondary_yield is null)
    or
    (secondary_bucket_id is not null and secondary_yield is not null)
  ),
  constraint programs_tertiary_pair check (
    (tertiary_bucket_id is null and tertiary_yield is null)
    or
    (tertiary_bucket_id is not null and tertiary_yield is not null)
  )
);

create unique index programs_code_unique_per_plan
  on demand_planner.programs (plan_id, item_code)
  where deleted_at is null;

create index programs_plan_idx on demand_planner.programs (plan_id, deleted_at);

create trigger programs_touch
  before update on demand_planner.programs
  for each row execute function demand_planner.touch_updated_at();

-- ============================================================================
-- 8. HARVEST PLAN  (data-model.md §4 — sparse; missing row = 0)
-- ============================================================================

create table demand_planner.harvest_plan (
  id              uuid primary key default gen_random_uuid(),
  plan_id         uuid not null references demand_planner.plans (id) on delete cascade,
  bucket_id       uuid not null references demand_planner.buckets (id),
  month_index     int  not null check (month_index between 1 and 60),
  capacity_kg_wr  numeric(18,4) not null default 0 check (capacity_kg_wr >= 0),
  created_at      timestamptz not null default now(),
  updated_at      timestamptz not null default now(),
  created_by      uuid references demand_planner.users (id),
  updated_by      uuid references demand_planner.users (id),

  constraint harvest_plan_cell_unique unique (plan_id, bucket_id, month_index)
);

create trigger harvest_plan_touch
  before update on demand_planner.harvest_plan
  for each row execute function demand_planner.touch_updated_at();

-- ============================================================================
-- 9. DEMAND PLAN  (data-model.md §4 — sparse; missing row falls back to
--    programs.max_monthly_demand_fp)
-- ============================================================================

create table demand_planner.demand_plan (
  id           uuid primary key default gen_random_uuid(),
  plan_id      uuid not null references demand_planner.plans (id) on delete cascade,
  program_id   uuid not null references demand_planner.programs (id) on delete cascade,
  month_index  int  not null check (month_index between 1 and 60),
  demand_fp    numeric(18,4) not null default 0 check (demand_fp >= 0),
  created_at   timestamptz not null default now(),
  updated_at   timestamptz not null default now(),
  created_by   uuid references demand_planner.users (id),
  updated_by   uuid references demand_planner.users (id),

  constraint demand_plan_cell_unique unique (program_id, month_index)
);

create index demand_plan_plan_idx on demand_planner.demand_plan (plan_id, month_index);

create trigger demand_plan_touch
  before update on demand_planner.demand_plan
  for each row execute function demand_planner.touch_updated_at();

-- ============================================================================
-- 10. COMPUTED RESULTS  (data-model.md §5)
-- Wiped and rebuilt per plan on every engine run. No history in v1.
-- No updated_at/created_by — these rows are machine-written, never edited.
-- ============================================================================

create table demand_planner.plan_rank (
  plan_id         uuid not null references demand_planner.plans (id) on delete cascade,
  program_id      uuid not null references demand_planner.programs (id) on delete cascade,
  priority_score  bigint  not null,
  global_rank     int     not null,
  in_scope        boolean not null,
  primary key (plan_id, program_id)
);

create table demand_planner.allocations (
  plan_id        uuid not null references demand_planner.plans (id) on delete cascade,
  program_id     uuid not null references demand_planner.programs (id) on delete cascade,
  month_index    int  not null check (month_index between 1 and 60),
  path           alloc_path not null,
  allocated_wr   numeric(18,4) not null default 0,
  primary key (plan_id, program_id, month_index, path)
);

create table demand_planner.rolling_results (
  plan_id            uuid not null references demand_planner.plans (id) on delete cascade,
  program_id         uuid not null references demand_planner.programs (id) on delete cascade,
  month_index        int  not null check (month_index between 1 and 60),
  demand_fp          numeric(18,4) not null default 0,
  own_fp             numeric(18,4) not null default 0,
  own_wr             numeric(18,4) not null default 0,
  borrow_m1_prim_wr  numeric(18,4) not null default 0,
  borrow_m1_alt_wr   numeric(18,4) not null default 0,
  borrow_m1_tert_wr  numeric(18,4) not null default 0,
  borrow_m2_prim_wr  numeric(18,4) not null default 0,
  borrow_m2_alt_wr   numeric(18,4) not null default 0,
  borrow_m2_tert_wr  numeric(18,4) not null default 0,
  rolling_fp         numeric(18,4) not null default 0,
  rolling_wr         numeric(18,4) not null default 0,
  rolling_margin     numeric(18,4) not null default 0,
  revenue            numeric(18,4) not null default 0,
  cost               numeric(18,4) not null default 0,
  fulfilment_pct     numeric(6,4),
  unfulfilled_wr     numeric(18,4) not null default 0,
  primary key (plan_id, program_id, month_index)
);

create index rolling_results_month_idx on demand_planner.rolling_results (plan_id, month_index);

create table demand_planner.unallocated_wr (
  plan_id             uuid not null references demand_planner.plans (id) on delete cascade,
  bucket_id           uuid not null references demand_planner.buckets (id),
  month_index         int  not null check (month_index between 1 and 60),
  plan_capacity_wr    numeric(18,4) not null default 0,
  own_consumption_wr  numeric(18,4) not null default 0,
  borrowings_into_wr  numeric(18,4) not null default 0,
  unallocated_wr      numeric(18,4) not null default 0,
  primary key (plan_id, bucket_id, month_index)
);

create index unallocated_wr_bucket_idx on demand_planner.unallocated_wr (plan_id, bucket_id);

create table demand_planner.pipeline_wr (
  plan_id      uuid not null references demand_planner.plans (id) on delete cascade,
  bucket_id    uuid not null references demand_planner.buckets (id),
  month_index  int  not null check (month_index between 1 and 60),
  pipeline_wr  numeric(18,4) not null default 0,
  primary key (plan_id, bucket_id, month_index)
);

create table demand_planner.plan_summary (
  plan_id             uuid not null references demand_planner.plans (id) on delete cascade,
  period              summary_period not null,
  demand_fp           numeric(18,4) not null default 0,
  allocated_fp        numeric(18,4) not null default 0,
  unallocated_fp      numeric(18,4) not null default 0,
  allocated_wr        numeric(18,4) not null default 0,
  unallocated_wr      numeric(18,4) not null default 0,
  revenue             numeric(18,4) not null default 0,
  cost                numeric(18,4) not null default 0,
  margin              numeric(18,4) not null default 0,
  gp_pct              numeric(6,4)  not null default 0,
  revenue_opportunity numeric(18,4) not null default 0,
  cost_opportunity    numeric(18,4) not null default 0,
  margin_opportunity  numeric(18,4) not null default 0,
  margin_gap          numeric(18,4) not null default 0,
  primary key (plan_id, period)
);

-- ============================================================================
-- 11. AUDIT LOG  (data-model.md §6)
-- ============================================================================

create table demand_planner.audit_log (
  id           uuid primary key default gen_random_uuid(),
  org_id       uuid not null references demand_planner.organizations (id),
  plan_id      uuid references demand_planner.plans (id) on delete cascade,
  user_id      uuid references demand_planner.users (id),
  entity_type  text not null,
  entity_id    uuid not null,
  action       audit_action not null,
  changes      jsonb not null default '{}'::jsonb,
  reason       text,
  at           timestamptz not null default now()
);

create index audit_log_plan_idx   on demand_planner.audit_log (plan_id, at desc);
create index audit_log_user_idx   on demand_planner.audit_log (user_id, at desc);
create index audit_log_entity_idx on demand_planner.audit_log (entity_type, entity_id, at desc);

-- ============================================================================
-- 12. ROW-LEVEL SECURITY  (data-model.md §8)
-- ============================================================================

alter table demand_planner.organizations   enable row level security;
alter table demand_planner.users           enable row level security;
alter table demand_planner.plans           enable row level security;
alter table demand_planner.buckets         enable row level security;
alter table demand_planner.programs        enable row level security;
alter table demand_planner.harvest_plan    enable row level security;
alter table demand_planner.demand_plan     enable row level security;
alter table demand_planner.plan_rank       enable row level security;
alter table demand_planner.allocations     enable row level security;
alter table demand_planner.rolling_results enable row level security;
alter table demand_planner.unallocated_wr  enable row level security;
alter table demand_planner.pipeline_wr     enable row level security;
alter table demand_planner.plan_summary    enable row level security;
alter table demand_planner.audit_log       enable row level security;

-- --- organizations ---------------------------------------------------------
create policy org_read on demand_planner.organizations for select
  using (id = demand_planner.current_org_id());

-- --- users -----------------------------------------------------------------
create policy users_read on demand_planner.users for select
  using (org_id = demand_planner.current_org_id());

create policy users_self_update on demand_planner.users for update
  using (id = auth.uid())
  with check (id = auth.uid() and role = (select role from demand_planner.users u where u.id = auth.uid()));

create policy users_admin_write on demand_planner.users for all
  using (org_id = demand_planner.current_org_id() and demand_planner.current_role_name() = 'admin')
  with check (org_id = demand_planner.current_org_id() and demand_planner.current_role_name() = 'admin');

-- --- plans (§8: master visible to all; scenarios to owner + admin/planner) --
create policy plans_read on demand_planner.plans for select
  using (
    org_id = demand_planner.current_org_id()
    and deleted_at is null
    and (
      type = 'master'
      or owner_user_id = auth.uid()
      or demand_planner.is_editor()
    )
  );

create policy plans_insert on demand_planner.plans for insert
  with check (
    org_id = demand_planner.current_org_id()
    and (
      (type = 'master'   and demand_planner.current_role_name() = 'admin')
      or
      (type = 'scenario' and owner_user_id = auth.uid()
                         and demand_planner.current_role_name() <> 'viewer')
    )
  );

create policy plans_update on demand_planner.plans for update
  using (
    org_id = demand_planner.current_org_id()
    and (
      (type = 'master'   and demand_planner.is_editor())
      or
      (type = 'scenario' and owner_user_id = auth.uid())
    )
  );

create policy plans_delete on demand_planner.plans for delete
  using (
    org_id = demand_planner.current_org_id()
    and (
      (type = 'master'   and demand_planner.current_role_name() = 'admin')
      or
      (type = 'scenario' and (owner_user_id = auth.uid() or demand_planner.current_role_name() = 'admin'))
    )
  );

-- --- buckets (§8: read by all in org; write by admin only) -----------------
create policy buckets_read on demand_planner.buckets for select
  using (org_id = demand_planner.current_org_id());

create policy buckets_admin_write on demand_planner.buckets for all
  using (org_id = demand_planner.current_org_id() and demand_planner.current_role_name() = 'admin')
  with check (org_id = demand_planner.current_org_id() and demand_planner.current_role_name() = 'admin');

-- --- plan-scoped tables: inherit access from the parent plan ---------------
-- Readable if the plan is readable. Writable if the plan is unlocked AND the
-- caller may edit it (§8 write policies).

create or replace function demand_planner.can_read_plan(p_plan_id uuid)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select exists (
    select 1 from demand_planner.plans p
    where p.id = p_plan_id
      and p.org_id = demand_planner.current_org_id()
      and p.deleted_at is null
      and (p.type = 'master' or p.owner_user_id = auth.uid() or demand_planner.is_editor())
  );
$$;

create or replace function demand_planner.can_write_plan(p_plan_id uuid)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select exists (
    select 1 from demand_planner.plans p
    where p.id = p_plan_id
      and p.org_id = demand_planner.current_org_id()
      and p.deleted_at is null
      and not p.is_locked
      and (
        (p.type = 'master'   and demand_planner.is_editor())
        or
        (p.type = 'scenario' and p.owner_user_id = auth.uid())
      )
  );
$$;

do $$
declare
  t text;
begin
  foreach t in array array[
    'programs', 'harvest_plan', 'demand_plan'
  ] loop
    execute format(
      'create policy %1$s_read on demand_planner.%1$s for select using (demand_planner.can_read_plan(plan_id))', t);
    execute format(
      'create policy %1$s_write on demand_planner.%1$s for all
         using (demand_planner.can_write_plan(plan_id))
         with check (demand_planner.can_write_plan(plan_id))', t);
  end loop;

  -- Computed tables are read-only to clients. Only the engine (service role,
  -- which bypasses RLS) writes them.
  foreach t in array array[
    'plan_rank', 'allocations', 'rolling_results',
    'unallocated_wr', 'pipeline_wr', 'plan_summary'
  ] loop
    execute format(
      'create policy %1$s_read on demand_planner.%1$s for select using (demand_planner.can_read_plan(plan_id))', t);
  end loop;
end;
$$;

-- --- audit log: readable within org; append-only, written by the API -------
create policy audit_read on demand_planner.audit_log for select
  using (org_id = demand_planner.current_org_id());

create policy audit_insert on demand_planner.audit_log for insert
  with check (org_id = demand_planner.current_org_id() and user_id = auth.uid());

-- ============================================================================
-- 13. GRANTS
--
-- The reason for a dedicated schema rather than `public`.
--
-- Supabase's `public` schema ships with `grant all ... to anon` out of the box.
-- RLS blocks anon in practice, but the grant exists, so a single missing policy
-- becomes a data leak. A fresh schema starts with zero privileges, which lets
-- us do this properly:
--
--   * `anon` is granted NOTHING. Not usage on the schema, not select on a
--     single table. Every endpoint in this app sits behind auth, so an
--     unauthenticated request should fail at the permission layer, before RLS
--     is ever consulted. Fail closed, not fail-because-a-policy-caught-it.
--   * `authenticated` is granted only the verbs each table actually needs.
--     RLS then decides *which rows*. Two independent layers.
--   * `service_role` gets everything. It bypasses RLS by design and is what
--     the Phase 2 calc engine will use to write computed results.
-- ============================================================================

grant usage on schema demand_planner to authenticated, service_role;

-- --- read-only to clients --------------------------------------------------
grant select on demand_planner.organizations to authenticated;

-- Written only by the engine (service_role). Clients read.
grant select on
  demand_planner.plan_rank,
  demand_planner.allocations,
  demand_planner.rolling_results,
  demand_planner.unallocated_wr,
  demand_planner.pipeline_wr,
  demand_planner.plan_summary
  to authenticated;

-- --- users: rows are created by the signup trigger, never by clients -------
-- No INSERT: a users row without a matching auth.users row is meaningless.
grant select, update, delete on demand_planner.users to authenticated;

-- --- full CRUD; RLS decides which rows -------------------------------------
grant select, insert, update, delete on
  demand_planner.plans,
  demand_planner.buckets,
  demand_planner.programs,
  demand_planner.harvest_plan,
  demand_planner.demand_plan
  to authenticated;

-- --- audit log is append-only ----------------------------------------------
-- No UPDATE or DELETE, deliberately. An audit trail you can edit is not one.
grant select, insert on demand_planner.audit_log to authenticated;

-- --- the engine ------------------------------------------------------------
grant all on all tables    in schema demand_planner to service_role;
grant all on all sequences in schema demand_planner to service_role;
grant all on all functions in schema demand_planner to service_role;

-- --- helper functions used by RLS policies ---------------------------------
grant execute on function
  demand_planner.current_org_id(),
  demand_planner.current_role_name(),
  demand_planner.is_editor(),
  demand_planner.can_read_plan(uuid),
  demand_planner.can_write_plan(uuid)
  to authenticated;

-- Future tables inherit sane defaults, so a later migration that forgets to
-- grant doesn't silently 404 for every user.
alter default privileges in schema demand_planner
  grant select, insert, update, delete on tables to authenticated;
alter default privileges in schema demand_planner
  grant all on tables to service_role;
alter default privileges in schema demand_planner
  grant all on sequences to service_role;
