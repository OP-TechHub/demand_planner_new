-- ============================================================================
-- COSTING: THE VERSION EACH SKU IS COSTED ON
-- ============================================================================
-- Until now the Cost Grid priced every SKU on whichever assumptions version was
-- current, so publishing a new version silently moved every product's cost at
-- once. That is the wrong default for a grid that is read as "what we cost this
-- at": a new version should change nothing until someone decides, product by
-- product or in bulk, that the product is now costed on it.
--
-- So each SKU carries the version it was last costed on. The grid prices a
-- row on ITS version; a compare toggle shows the same row at the current one.
-- Assumptions versions are never edited in place (20260824000001 §3), so a
-- pinned version reproduces the same figures for as long as the recipe holds.
--
-- WHO MAY MOVE A SKU
--   Deciding that a product is now costed on new assumptions is the same trust
--   level as publishing those assumptions, so the gate is the same two grants:
--   admins, plus users holding 'assumptions_edit' or 'base_cost_edit'. Anyone
--   may still add a SKU; the trigger below pins it for them.
--
-- NEW SKUS
--   Pinned to the current version automatically on insert, by a trigger, so
--   that "saved automatically" holds for someone without the grant above. A SKU
--   with no row at all (a database that missed the backfill) is treated by the
--   app as costed on the current version, which is what it was before this.
--
-- Migrations here are applied by hand (no linked Supabase CLI), so everything
-- is written to land on a database in either state.

create table if not exists demand_planner.cost_sku_costed_versions (
  sku_id     uuid primary key references demand_planner.cost_skus (id) on delete cascade,
  -- No cascade: a version with a SKU costed on it cannot be removed, matching
  -- the saved costings' pin.
  version_id uuid not null references demand_planner.cost_assumption_versions (id),
  costed_at  timestamptz not null default now(),
  costed_by  uuid references demand_planner.users (id)
);

create index if not exists cost_sku_costed_versions_version_idx
  on demand_planner.cost_sku_costed_versions (version_id);

-- ----------------------------------------------------------------------------
-- Gate: the same people who may publish a version may move a SKU onto one.
-- ----------------------------------------------------------------------------
create or replace function demand_planner.can_recost_sku()
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select demand_planner.can_edit_section('assumptions_edit')
      or demand_planner.can_edit_section('base_cost_edit');
$$;

-- ----------------------------------------------------------------------------
-- RLS
-- ----------------------------------------------------------------------------
alter table demand_planner.cost_sku_costed_versions enable row level security;

drop policy if exists cost_sku_costed_versions_read on demand_planner.cost_sku_costed_versions;
create policy cost_sku_costed_versions_read on demand_planner.cost_sku_costed_versions for select
  using (
    demand_planner.can_read_costing()
    and exists (
      select 1 from demand_planner.cost_skus s
      where s.id = sku_id and s.org_id = demand_planner.current_org_id()
    )
  );

drop policy if exists cost_sku_costed_versions_write on demand_planner.cost_sku_costed_versions;
create policy cost_sku_costed_versions_write on demand_planner.cost_sku_costed_versions for all
  using (
    demand_planner.can_recost_sku()
    and exists (
      select 1 from demand_planner.cost_skus s
      where s.id = sku_id and s.org_id = demand_planner.current_org_id()
    )
  )
  with check (
    demand_planner.can_recost_sku()
    and exists (
      select 1 from demand_planner.cost_skus s
      where s.id = sku_id and s.org_id = demand_planner.current_org_id()
    )
    -- The version has to be one of this org's: a pin to another org's version
    -- would price a product on numbers nobody here can read.
    and exists (
      select 1 from demand_planner.cost_assumption_versions v
      where v.id = version_id and v.org_id = demand_planner.current_org_id()
    )
  );

grant select, insert, update, delete on demand_planner.cost_sku_costed_versions to authenticated;

-- ----------------------------------------------------------------------------
-- New SKUs land on the current version.
-- ----------------------------------------------------------------------------
-- Security definer because the person adding the SKU usually does not hold the
-- re-cost grant, and RLS would otherwise refuse the pin the app relies on.
-- An org with no current version gets no row, and the app's fallback covers it.
create or replace function demand_planner.cost_sku_pin_current_version()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  insert into demand_planner.cost_sku_costed_versions (sku_id, version_id, costed_by)
  select new.id, v.id, new.created_by
  from demand_planner.cost_assumption_versions v
  where v.org_id = new.org_id and v.is_current
  on conflict (sku_id) do nothing;
  return new;
end;
$$;

drop trigger if exists cost_skus_pin_current on demand_planner.cost_skus;
create trigger cost_skus_pin_current
  after insert on demand_planner.cost_skus
  for each row execute function demand_planner.cost_sku_pin_current_version();

-- ----------------------------------------------------------------------------
-- Backfill: every existing SKU is costed on today's current version, which is
-- exactly what the grid was showing for it up to now. Soft-deleted SKUs are
-- included so a restore does not come back unpinned.
-- ----------------------------------------------------------------------------
insert into demand_planner.cost_sku_costed_versions (sku_id, version_id)
select s.id, v.id
from demand_planner.cost_skus s
join demand_planner.cost_assumption_versions v on v.org_id = s.org_id and v.is_current
on conflict (sku_id) do nothing;

-- ----------------------------------------------------------------------------
-- Sanity check
-- ----------------------------------------------------------------------------
do $$
declare
  n int;
begin
  select count(*) into n from pg_policies
   where schemaname = 'demand_planner' and tablename = 'cost_sku_costed_versions';
  if n <> 2 then
    raise exception 'expected 2 cost_sku_costed_versions policies, found %', n;
  end if;
  if not exists (
    select 1 from pg_trigger where tgname = 'cost_skus_pin_current'
  ) then
    raise exception 'cost_skus_pin_current trigger is missing';
  end if;
end $$;
