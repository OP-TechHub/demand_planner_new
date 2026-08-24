-- ============================================================================
-- Costing & Quoting Module — schema
-- Implements: costing_module/Costing_Module_Decisions.md
--
-- SAFETY: every object here is NEW and ADDITIVE. Nothing existing is altered,
-- dropped or re-policied. There is deliberately NO foreign key from any table
-- below to plans, programs, buckets or any other planner table (Decisions §1) —
-- costing is data-independent and cannot move a planner number.
--
-- DEVIATIONS FROM THE HANDOFF SPEC (Costing_Module_Handoff.md), all agreed:
--   §7 of the handoff keys sku_cost_config to programs.item_id. Dropped: those
--      ids are plan-scoped, so configs would orphan on every plan roll-forward.
--      Costing SKUs are a standalone master (Decisions §1, §2).
--   §5 of the handoff shares the planner's size buckets. Costing keeps its own
--      copy so a rename in the planner cannot shift a costing (Decisions §6).
--   §2 of the handoff ships behind a feature flag. There is no flag: costing
--      cannot affect the planner, so the flag's rationale does not apply
--      (Decisions §1).
--
-- ACCESS MODEL (Decisions §5): every signed-in org member can read everything
-- and create their own costings. Only the creator (or an admin) can edit a
-- costing. The shared masters — SKUs, buckets, assumptions, destinations — are
-- admin-maintained; users get freedom through per-costing overrides instead.
-- ============================================================================

set search_path = demand_planner, public;

-- ============================================================================
-- 1. ENUMS
-- ============================================================================

create type demand_planner.cost_market       as enum ('domestic', 'export');
create type demand_planner.cost_currency     as enum ('LKR', 'USD');
create type demand_planner.cost_odc_basis    as enum ('per_kg', 'per_fish');
create type demand_planner.cost_sku_status   as enum ('active', 'inactive');
create type demand_planner.cost_dest_mode    as enum ('single', 'multi');

-- Decisions §7. full_fish carries whole_fish_cost / yield and reproduces v11;
-- absorbed carries NO raw material, because the main product already paid for
-- the fish. Co-products stay full_fish deliberately — only by-products absorb.
create type demand_planner.cost_raw_material_basis as enum ('full_fish', 'absorbed');

-- Domestic resolves unglazed/glazed; export resolves the three shipping states.
create type demand_planner.cost_product_state as enum (
  'unglazed', 'glazed', 'frozen_plain', 'frozen_glazed', 'fresh'
);

-- ============================================================================
-- 2. SIZE BUCKETS  (costing's own copy — Decisions §6)
-- ============================================================================
-- Mirrors the planner's seven grades but is NOT the same table and carries no
-- FK to it. median_g is what per-fish ODC amortises over; fcr is farm data and
-- ships as the workbook's placeholder (v11 cell A22 flags it as such).
--
-- Not version-scoped: reproducibility for a saved costing comes from its
-- resolved lines (§4), not from versioning every master.

create table demand_planner.cost_size_buckets (
  id          uuid primary key default gen_random_uuid(),
  org_id      uuid not null references demand_planner.organizations (id) on delete cascade,
  label       text not null,
  min_g       int  not null check (min_g >= 0),
  max_g       int  not null check (max_g > 0),
  median_g    int  not null check (median_g > 0),
  fcr         numeric(8,4) not null check (fcr > 0),
  sort_order  int  not null default 0,
  created_at  timestamptz not null default now(),
  updated_at  timestamptz not null default now(),

  constraint cost_size_buckets_range check (max_g > min_g),
  constraint cost_size_buckets_median_in_range check (median_g >= min_g and median_g <= max_g)
);

create unique index cost_size_buckets_label_unique
  on demand_planner.cost_size_buckets (org_id, label);

create trigger cost_size_buckets_touch
  before update on demand_planner.cost_size_buckets
  for each row execute function demand_planner.touch_updated_at();

-- ============================================================================
-- 3. ASSUMPTION VERSIONS  (Decisions §4)
-- ============================================================================
-- Versioned, not a single editable set: a saved costing pins the version it was
-- built on so "what did we actually quote" stays answerable months later.
-- Retrofitting version history would mean backfilling every quote.
--
-- Farm costs (feed, clearing, FCR, ODC) are entered ONCE and shared by both
-- markets. Import tax is the only base-cost difference — export is 0 on duty
-- drawback (Decisions §3).

create table demand_planner.cost_assumption_versions (
  id          uuid primary key default gen_random_uuid(),
  org_id      uuid not null references demand_planner.organizations (id) on delete cascade,
  version_no  int  not null check (version_no > 0),
  label       text not null default '',
  notes       text not null default '',
  -- Exactly one current version per org; older ones stay readable for pinning.
  is_current  boolean not null default false,
  effective_from date not null default current_date,

  -- Farm (shared across both markets)
  feed_cost_per_kg      numeric(18,4) not null check (feed_cost_per_kg      >= 0),
  clearing_cost_per_kg  numeric(18,4) not null check (clearing_cost_per_kg  >= 0),
  fcr_reference         numeric(8,4)  not null check (fcr_reference         >  0),
  fx_rate               numeric(12,4) not null check (fx_rate               >  0),

  -- The one line that differs by market
  import_tax_pct_domestic numeric(6,4) not null default 0 check (import_tax_pct_domestic >= 0),
  import_tax_pct_export   numeric(6,4) not null default 0 check (import_tax_pct_export   >= 0),

  -- Per-kg adders. Domestic in LKR, export in USD — NOT the same figure
  -- converted: v11 enters them separately per market.
  domestic_transport_lkr     numeric(18,4) not null default 0 check (domestic_transport_lkr     >= 0),
  domestic_cold_hold_lkr     numeric(18,4) not null default 0 check (domestic_cold_hold_lkr     >= 0),
  export_freight_to_port_usd numeric(18,4) not null default 0 check (export_freight_to_port_usd >= 0),
  export_cold_chain_usd      numeric(18,4) not null default 0 check (export_cold_chain_usd      >= 0),

  -- Margins. Gross-margin basis: price = cost / (1 - pct), so pct must be < 1.
  rack_margin_pct        numeric(6,4) not null default 0.40 check (rack_margin_pct >= 0 and rack_margin_pct < 1),
  fob_margin_pct         numeric(6,4) not null default 0.40 check (fob_margin_pct  >= 0 and fob_margin_pct  < 1),
  -- Markups, not margins: applied as (1 + pct), so they may exceed 1.
  importer_clearing_pct  numeric(6,4) not null default 0.05 check (importer_clearing_pct  >= 0),
  importer_markup_pct    numeric(6,4) not null default 0.10 check (importer_markup_pct    >= 0),
  distributor_markup_pct numeric(6,4) not null default 0.15 check (distributor_markup_pct >= 0),

  -- Freight divisors: per-shipment rates become per-kg through these.
  container_fill_kg numeric(12,4) not null default 7000 check (container_fill_kg > 0),
  air_lot_kg        numeric(12,4) not null default 500  check (air_lot_kg        > 0),

  created_at  timestamptz not null default now(),
  updated_at  timestamptz not null default now(),
  created_by  uuid references demand_planner.users (id),
  updated_by  uuid references demand_planner.users (id)
);

create unique index cost_assumption_versions_no_unique
  on demand_planner.cost_assumption_versions (org_id, version_no);

create unique index cost_assumption_versions_one_current
  on demand_planner.cost_assumption_versions (org_id)
  where is_current;

create trigger cost_assumption_versions_touch
  before update on demand_planner.cost_assumption_versions
  for each row execute function demand_planner.touch_updated_at();

-- ============================================================================
-- 4. ODC COMPONENTS  (per assumption version)
-- ============================================================================
-- Other Direct Costs, built up from components rather than typed as a total.
-- Each is entered in LKR or USD and converted to USD by the engine.
--
-- `basis` is hard-coded in v11 (fingerling + vaccine amortise per fish). Here it
-- is an explicit, editable column, because it drives size-bucket amortisation:
--   ODC(bucket) = sum(per_kg) + sum(per_fish) / median_kg

create table demand_planner.cost_odc_components (
  id          uuid primary key default gen_random_uuid(),
  version_id  uuid not null references demand_planner.cost_assumption_versions (id) on delete cascade,
  name        text not null,
  value       numeric(18,6) not null check (value >= 0),
  currency    demand_planner.cost_currency  not null,
  basis       demand_planner.cost_odc_basis not null,
  sort_order  int not null default 0,
  created_at  timestamptz not null default now()
);

create unique index cost_odc_components_name_unique
  on demand_planner.cost_odc_components (version_id, name);

create index cost_odc_components_version_idx
  on demand_planner.cost_odc_components (version_id);

-- ============================================================================
-- 5. DESTINATIONS  (org master) + RATES (per assumption version)
-- ============================================================================
-- The port list is stable; its freight rates move. Splitting them keeps a saved
-- costing reproducible without duplicating fifteen port names per version.

create table demand_planner.cost_destinations (
  id          uuid primary key default gen_random_uuid(),
  org_id      uuid not null references demand_planner.organizations (id) on delete cascade,
  name        text not null,
  is_active   boolean not null default true,
  sort_order  int not null default 0,
  created_at  timestamptz not null default now(),
  updated_at  timestamptz not null default now()
);

create unique index cost_destinations_name_unique
  on demand_planner.cost_destinations (org_id, name);

create trigger cost_destinations_touch
  before update on demand_planner.cost_destinations
  for each row execute function demand_planner.touch_updated_at();

-- Rates are per shipment; the engine divides by the version's fill weights:
--   sea $/kg = sea_rate_per_20ft / container_fill_kg
--   air $/kg = air_rate_per_lot  / air_lot_kg
create table demand_planner.cost_destination_rates (
  version_id        uuid not null references demand_planner.cost_assumption_versions (id) on delete cascade,
  destination_id    uuid not null references demand_planner.cost_destinations (id)        on delete cascade,
  sea_rate_per_20ft numeric(18,4) not null default 0 check (sea_rate_per_20ft >= 0),
  air_rate_per_lot  numeric(18,4) not null default 0 check (air_rate_per_lot  >= 0),
  primary key (version_id, destination_id)
);

-- ============================================================================
-- 6. SKU MASTER  (Decisions §2)
-- ============================================================================
-- ONE standalone list serving BOTH markets. Deliberately NOT joined to
-- programs.item_code — costing SKUs are their own vocabulary until a customer
-- master and an integration decision arrive.
--
-- Per-SKU inputs are shared across markets: the v11 extractor asserts the two
-- workbook tabs hold identical values, and they do. Market changes only the
-- feed tax, which adder set applies, and the display currency.

create table demand_planner.cost_skus (
  id          uuid primary key default gen_random_uuid(),
  org_id      uuid not null references demand_planner.organizations (id) on delete cascade,
  name        text not null,
  status      demand_planner.cost_sku_status not null default 'active',
  category    text not null default '',
  sort_order  int  not null default 0,

  -- Added ice on frozen product. Dilutes fish cost only, via effective yield —
  -- which is why one SKU row can show both glazed and unglazed without a
  -- duplicate SKU (Decisions §7 / handoff §6).
  glaze_pct   numeric(6,4) not null default 0 check (glaze_pct >= 0),

  -- Flat yield. Used while buckets are off, and as fallback for a bucket the
  -- farm has not filled in yet.
  base_yield  numeric(6,4) not null check (base_yield > 0 and base_yield <= 1),

  pct_fish     numeric(6,4) not null default 1 check (pct_fish     >= 0 and pct_fish     <= 1),
  pct_marinade numeric(6,4) not null default 0 check (pct_marinade >= 0 and pct_marinade <= 1),

  -- Always USD. Domestic converts them at the version's FX rate.
  marinade_usd_per_kg numeric(18,4) not null default 0 check (marinade_usd_per_kg >= 0),
  process_usd_per_kg  numeric(18,4) not null default 0 check (process_usd_per_kg  >= 0),
  packing_usd_per_kg  numeric(18,4) not null default 0 check (packing_usd_per_kg  >= 0),
  pack_size           text,

  raw_material_basis demand_planner.cost_raw_material_basis not null default 'full_fish',

  -- What the market bears. Load-bearing for absorbed by-products, whose cost is
  -- a FLOOR rather than a base for cost-plus (Decisions §7). Benchmark only for
  -- full_fish SKUs, matching the workbook's orange block.
  market_price_lkr numeric(18,4) check (market_price_lkr >= 0),
  market_price_usd numeric(18,4) check (market_price_usd >= 0),

  -- Per-SKU overrides (Decisions §8). NULL means inherit the global value.
  override_rack_margin_pct        numeric(6,4)  check (override_rack_margin_pct >= 0 and override_rack_margin_pct < 1),
  override_fob_margin_pct         numeric(6,4)  check (override_fob_margin_pct  >= 0 and override_fob_margin_pct  < 1),
  override_transport_lkr          numeric(18,4) check (override_transport_lkr          >= 0),
  override_cold_hold_lkr          numeric(18,4) check (override_cold_hold_lkr          >= 0),
  override_freight_to_port_usd    numeric(18,4) check (override_freight_to_port_usd    >= 0),
  override_cold_chain_usd         numeric(18,4) check (override_cold_chain_usd         >= 0),

  created_at  timestamptz not null default now(),
  updated_at  timestamptz not null default now(),
  created_by  uuid references demand_planner.users (id),
  updated_by  uuid references demand_planner.users (id),
  deleted_at  timestamptz,

  -- Decisions §11: a split that is not 100% highlights and does NOT calculate.
  -- The engine enforces this too; the constraint stops a bad row being stored at
  -- all. numeric is exact decimal, so the tolerance is not for float noise — it
  -- absorbs rounding at the column's 4dp, and matches the engine's own epsilon.
  constraint cost_skus_split_totals_100 check (abs((pct_fish + pct_marinade) - 1) < 0.000001)
);

create unique index cost_skus_name_unique
  on demand_planner.cost_skus (org_id, name)
  where deleted_at is null;

create index cost_skus_org_idx on demand_planner.cost_skus (org_id, deleted_at);

create trigger cost_skus_touch
  before update on demand_planner.cost_skus
  for each row execute function demand_planner.touch_updated_at();

-- ============================================================================
-- 7. PER-BUCKET YIELD  (Decisions §6)
-- ============================================================================
-- One yield per SKU per bucket, at the bucket's median weight — structurally
-- the twin of cost_size_buckets.fcr. Seeded with each SKU's flat yield as an
-- obvious placeholder, replaced later with real farm data.
--
-- NOT imported from the workbook's "Master Yield summary": that sheet is sparse,
-- mixes generic product names with customer item codes, has a typo at W10
-- (4.88 where neighbours are ~0.48), and bakes 20% glaze into two columns —
-- which would double-count against the glaze logic.

create table demand_planner.cost_sku_bucket_yields (
  sku_id     uuid not null references demand_planner.cost_skus        (id) on delete cascade,
  bucket_id  uuid not null references demand_planner.cost_size_buckets (id) on delete cascade,
  yield_pct  numeric(6,4) not null check (yield_pct > 0 and yield_pct <= 1),
  updated_at timestamptz not null default now(),
  updated_by uuid references demand_planner.users (id),
  primary key (sku_id, bucket_id)
);

create trigger cost_sku_bucket_yields_touch
  before update on demand_planner.cost_sku_bucket_yields
  for each row execute function demand_planner.touch_updated_at();

-- ============================================================================
-- 8. SAVED COSTINGS  (Decisions §9)
-- ============================================================================
-- A deliberate, named snapshot — distinct from the live grid, which is computed
-- on the fly and stored nowhere.
--
-- Visible to everyone; editable only by its creator or an admin (Decisions §5).

create table demand_planner.cost_costings (
  id          uuid primary key default gen_random_uuid(),
  org_id      uuid not null references demand_planner.organizations (id) on delete cascade,
  name        text not null,
  notes       text not null default '',
  market      demand_planner.cost_market not null,

  -- Pinned so reopening shows what was actually quoted (Decisions §4).
  version_id  uuid not null references demand_planner.cost_assumption_versions (id),

  -- Assumptions this costing deviates from, as {field: value}. Stamped visibly
  -- so a quote built on non-standard numbers is obvious to a reviewer.
  assumption_overrides jsonb not null default '{}'::jsonb,

  -- NULL = the flat reference model, i.e. buckets switched off.
  bucket_id   uuid references demand_planner.cost_size_buckets (id),

  destination_mode demand_planner.cost_dest_mode not null default 'single',

  created_at  timestamptz not null default now(),
  updated_at  timestamptz not null default now(),
  created_by  uuid not null references demand_planner.users (id),
  updated_by  uuid references demand_planner.users (id),
  deleted_at  timestamptz,

  constraint cost_costings_overrides_is_object check (jsonb_typeof(assumption_overrides) = 'object'),
  -- Domestic has no ports; export always has at least one (enforced in app).
  constraint cost_costings_domestic_single check (
    market <> 'domestic' or destination_mode = 'single'
  )
);

create index cost_costings_org_idx     on demand_planner.cost_costings (org_id, deleted_at);
create index cost_costings_creator_idx on demand_planner.cost_costings (created_by);

create trigger cost_costings_touch
  before update on demand_planner.cost_costings
  for each row execute function demand_planner.touch_updated_at();

-- Which ports this costing covers. One row for 'single', several for 'multi'.
create table demand_planner.cost_costing_destinations (
  costing_id     uuid not null references demand_planner.cost_costings    (id) on delete cascade,
  destination_id uuid not null references demand_planner.cost_destinations (id),
  -- Snapshot: the costing must still read correctly if the port is renamed.
  destination_name text not null,
  is_primary     boolean not null default false,
  sort_order     int not null default 0,
  primary key (costing_id, destination_id)
);

-- The port a customer quote goes out on. At most one per costing.
create unique index cost_costing_destinations_one_primary
  on demand_planner.cost_costing_destinations (costing_id)
  where is_primary;

-- ============================================================================
-- 9. RESOLVED LINES  (Decisions §4, §9)
-- ============================================================================
-- The snapshot proper: what the engine produced, stored so reopening a costing
-- shows the numbers as sent rather than as they would be today. "Reprice at
-- current assumptions" recomputes into a NEW costing and never overwrites these.
--
-- Scalars that get filtered, sorted or charted are columns; the full build-up
-- lives in `inputs`/`outputs` jsonb so the engine can grow a field without a
-- migration and without the DB and the engine drifting apart.

create table demand_planner.cost_costing_lines (
  id          uuid primary key default gen_random_uuid(),
  costing_id  uuid not null references demand_planner.cost_costings (id) on delete cascade,

  -- Snapshots alongside the FK: a renamed or retired SKU must not corrupt
  -- history, so the name is stored, not looked up.
  sku_id      uuid references demand_planner.cost_skus (id) on delete set null,
  sku_name    text not null,
  destination_id   uuid references demand_planner.cost_destinations (id) on delete set null,
  destination_name text,

  state       demand_planner.cost_product_state not null,
  currency    demand_planner.cost_currency not null,

  final_cost         numeric(18,6) not null,
  selling_price      numeric(18,6),
  contribution_per_kg numeric(18,6),

  inputs      jsonb not null default '{}'::jsonb,
  outputs     jsonb not null default '{}'::jsonb,

  sort_order  int not null default 0,
  created_at  timestamptz not null default now(),

  constraint cost_costing_lines_state_matches_market check (
    (currency = 'LKR' and state in ('unglazed', 'glazed'))
    or
    (currency = 'USD' and state in ('frozen_plain', 'frozen_glazed', 'fresh'))
  )
);

create index cost_costing_lines_costing_idx on demand_planner.cost_costing_lines (costing_id);
create unique index cost_costing_lines_unique
  on demand_planner.cost_costing_lines (costing_id, sku_name, state, coalesce(destination_name, ''));

-- ============================================================================
-- 10. ROW-LEVEL SECURITY  (Decisions §5)
-- ============================================================================
-- Reads: any signed-in member of the org, every table.
-- Writes: shared masters are admin-only; costings belong to their creator.
--
-- current_role_name() returns NULL for an inactive or unknown user, so
-- `is not null` is the "signed-in and active" test.

alter table demand_planner.cost_size_buckets          enable row level security;
alter table demand_planner.cost_assumption_versions   enable row level security;
alter table demand_planner.cost_odc_components        enable row level security;
alter table demand_planner.cost_destinations          enable row level security;
alter table demand_planner.cost_destination_rates     enable row level security;
alter table demand_planner.cost_skus                  enable row level security;
alter table demand_planner.cost_sku_bucket_yields     enable row level security;
alter table demand_planner.cost_costings              enable row level security;
alter table demand_planner.cost_costing_destinations  enable row level security;
alter table demand_planner.cost_costing_lines         enable row level security;

-- --- helper: is this row's org mine, and am I active? -----------------------
create or replace function demand_planner.can_read_costing()
returns boolean
language sql
stable
set search_path = ''
as $$
  select demand_planner.current_role_name() is not null;
$$;

create or replace function demand_planner.can_admin_costing()
returns boolean
language sql
stable
set search_path = ''
as $$
  select demand_planner.current_role_name() = 'admin';
$$;

-- --- shared masters: everyone reads, admins write --------------------------
create policy cost_size_buckets_read on demand_planner.cost_size_buckets for select
  using (org_id = demand_planner.current_org_id() and demand_planner.can_read_costing());
create policy cost_size_buckets_write on demand_planner.cost_size_buckets for all
  using      (org_id = demand_planner.current_org_id() and demand_planner.can_admin_costing())
  with check (org_id = demand_planner.current_org_id() and demand_planner.can_admin_costing());

create policy cost_assumption_versions_read on demand_planner.cost_assumption_versions for select
  using (org_id = demand_planner.current_org_id() and demand_planner.can_read_costing());
create policy cost_assumption_versions_write on demand_planner.cost_assumption_versions for all
  using      (org_id = demand_planner.current_org_id() and demand_planner.can_admin_costing())
  with check (org_id = demand_planner.current_org_id() and demand_planner.can_admin_costing());

create policy cost_destinations_read on demand_planner.cost_destinations for select
  using (org_id = demand_planner.current_org_id() and demand_planner.can_read_costing());
create policy cost_destinations_write on demand_planner.cost_destinations for all
  using      (org_id = demand_planner.current_org_id() and demand_planner.can_admin_costing())
  with check (org_id = demand_planner.current_org_id() and demand_planner.can_admin_costing());

-- --- SKUs: you own what you make ------------------------------------------
-- Anyone may add a SKU — being unable to cost a product because it isn't on an
-- admin-controlled list would contradict "anyone can do costing". But a recipe
-- everyone else depends on must not be quietly altered by someone else, so
-- editing is limited to its creator (or an admin). Same rule as costings.
--
-- Note the consequence for the seeded 34: they were inserted with no
-- created_by, so they are admin-editable only. That is the intent — the
-- workbook's recipes are shared company data, not one person's work.
create policy cost_skus_read on demand_planner.cost_skus for select
  using (org_id = demand_planner.current_org_id() and demand_planner.can_read_costing());

create policy cost_skus_insert on demand_planner.cost_skus for insert
  with check (
    org_id = demand_planner.current_org_id()
    and demand_planner.can_read_costing()
    and created_by = auth.uid()
  );

create policy cost_skus_update on demand_planner.cost_skus for update
  using      (org_id = demand_planner.current_org_id()
              and (created_by = auth.uid() or demand_planner.can_admin_costing()))
  with check (org_id = demand_planner.current_org_id()
              and (created_by = auth.uid() or demand_planner.can_admin_costing()));

create policy cost_skus_delete on demand_planner.cost_skus for delete
  using (org_id = demand_planner.current_org_id()
         and (created_by = auth.uid() or demand_planner.can_admin_costing()));

-- --- children of a master: inherit the parent's org, same rules -------------
create policy cost_odc_components_read on demand_planner.cost_odc_components for select
  using (exists (
    select 1 from demand_planner.cost_assumption_versions v
    where v.id = version_id and v.org_id = demand_planner.current_org_id()
  ) and demand_planner.can_read_costing());
create policy cost_odc_components_write on demand_planner.cost_odc_components for all
  using      (demand_planner.can_admin_costing() and exists (
    select 1 from demand_planner.cost_assumption_versions v
    where v.id = version_id and v.org_id = demand_planner.current_org_id()))
  with check (demand_planner.can_admin_costing() and exists (
    select 1 from demand_planner.cost_assumption_versions v
    where v.id = version_id and v.org_id = demand_planner.current_org_id()));

create policy cost_destination_rates_read on demand_planner.cost_destination_rates for select
  using (exists (
    select 1 from demand_planner.cost_assumption_versions v
    where v.id = version_id and v.org_id = demand_planner.current_org_id()
  ) and demand_planner.can_read_costing());
create policy cost_destination_rates_write on demand_planner.cost_destination_rates for all
  using      (demand_planner.can_admin_costing() and exists (
    select 1 from demand_planner.cost_assumption_versions v
    where v.id = version_id and v.org_id = demand_planner.current_org_id()))
  with check (demand_planner.can_admin_costing() and exists (
    select 1 from demand_planner.cost_assumption_versions v
    where v.id = version_id and v.org_id = demand_planner.current_org_id()));

-- Yields follow their SKU's ownership: whoever may edit the recipe may set its
-- per-grade yields.
create policy cost_sku_bucket_yields_read on demand_planner.cost_sku_bucket_yields for select
  using (exists (
    select 1 from demand_planner.cost_skus s
    where s.id = sku_id and s.org_id = demand_planner.current_org_id()
  ) and demand_planner.can_read_costing());
create policy cost_sku_bucket_yields_write on demand_planner.cost_sku_bucket_yields for all
  using      (exists (
    select 1 from demand_planner.cost_skus s
    where s.id = sku_id and s.org_id = demand_planner.current_org_id()
      and (s.created_by = auth.uid() or demand_planner.can_admin_costing())))
  with check (exists (
    select 1 from demand_planner.cost_skus s
    where s.id = sku_id and s.org_id = demand_planner.current_org_id()
      and (s.created_by = auth.uid() or demand_planner.can_admin_costing())));

-- --- costings: anyone creates, everyone reads, only the owner edits ---------
create policy cost_costings_read on demand_planner.cost_costings for select
  using (org_id = demand_planner.current_org_id() and demand_planner.can_read_costing() and deleted_at is null);

create policy cost_costings_insert on demand_planner.cost_costings for insert
  with check (
    org_id = demand_planner.current_org_id()
    and demand_planner.can_read_costing()
    and created_by = auth.uid()
  );

create policy cost_costings_update on demand_planner.cost_costings for update
  using      (org_id = demand_planner.current_org_id()
              and (created_by = auth.uid() or demand_planner.can_admin_costing()))
  with check (org_id = demand_planner.current_org_id()
              and (created_by = auth.uid() or demand_planner.can_admin_costing()));

create policy cost_costings_delete on demand_planner.cost_costings for delete
  using (org_id = demand_planner.current_org_id()
         and (created_by = auth.uid() or demand_planner.can_admin_costing()));

-- --- costing children: follow the parent costing ----------------------------
create policy cost_costing_destinations_read on demand_planner.cost_costing_destinations for select
  using (exists (
    select 1 from demand_planner.cost_costings c
    where c.id = costing_id and c.org_id = demand_planner.current_org_id()
  ) and demand_planner.can_read_costing());

create policy cost_costing_destinations_write on demand_planner.cost_costing_destinations for all
  using      (exists (select 1 from demand_planner.cost_costings c
              where c.id = costing_id and c.org_id = demand_planner.current_org_id()
                and (c.created_by = auth.uid() or demand_planner.can_admin_costing())))
  with check (exists (select 1 from demand_planner.cost_costings c
              where c.id = costing_id and c.org_id = demand_planner.current_org_id()
                and (c.created_by = auth.uid() or demand_planner.can_admin_costing())));

create policy cost_costing_lines_read on demand_planner.cost_costing_lines for select
  using (exists (
    select 1 from demand_planner.cost_costings c
    where c.id = costing_id and c.org_id = demand_planner.current_org_id()
  ) and demand_planner.can_read_costing());

create policy cost_costing_lines_write on demand_planner.cost_costing_lines for all
  using      (exists (select 1 from demand_planner.cost_costings c
              where c.id = costing_id and c.org_id = demand_planner.current_org_id()
                and (c.created_by = auth.uid() or demand_planner.can_admin_costing())))
  with check (exists (select 1 from demand_planner.cost_costings c
              where c.id = costing_id and c.org_id = demand_planner.current_org_id()
                and (c.created_by = auth.uid() or demand_planner.can_admin_costing())));

-- ============================================================================
-- 11. GRANTS
-- ============================================================================
-- RLS does the gating; these just let authenticated roles reach the tables.

grant usage on schema demand_planner to authenticated;

grant select, insert, update, delete on
  demand_planner.cost_size_buckets,
  demand_planner.cost_assumption_versions,
  demand_planner.cost_odc_components,
  demand_planner.cost_destinations,
  demand_planner.cost_destination_rates,
  demand_planner.cost_skus,
  demand_planner.cost_sku_bucket_yields,
  demand_planner.cost_costings,
  demand_planner.cost_costing_destinations,
  demand_planner.cost_costing_lines
to authenticated;
