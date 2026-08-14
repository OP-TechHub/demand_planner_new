-- Secondary products (by-products recovered while processing a main product).
--
-- Processing whole round into a finished product leaves saleable off-cuts. For
-- Frozen Barramundi Center Cut Portions 180g, for example, the same feedstock
-- also yields 40-70 TP, Belly flap and Off cut. Each carries its own recovery
-- rate and its own price:
--
--   quantity_kg = feedstock_wr × yield_pct
--   revenue     = quantity_kg  × price_per_kg
--
-- where feedstock_wr is the whole round the engine actually allocated to the
-- source program (rolling_results.rolling_wr) — by-products only exist if fish
-- was really processed.
--
-- ORG-SCOPED, keyed by the source product's item_code rather than a program id.
-- Recovery rates are a physical property of processing a product, not of one
-- plan, and programs are cloned with new ids every time a scenario is forked —
-- keying by item_code means these definitions survive forks with no clone logic,
-- exactly like `buckets`.
--
-- Note this matches item_code EXACTLY, so a pipeline twin (`‹code›-P`) needs its
-- own row if its by-products should be counted too.

create table if not exists demand_planner.secondary_products (
  id                uuid primary key default gen_random_uuid(),
  org_id            uuid not null references demand_planner.organizations (id) on delete cascade,
  -- programs.item_code of the product whose processing yields this by-product
  source_item_code  text not null,
  name              text not null,
  -- fraction of feedstock whole round recovered as this by-product (0.02 = 2%)
  yield_pct         numeric(6,4) not null check (yield_pct > 0 and yield_pct <= 1),
  price_per_kg      numeric(18,4) not null default 0 check (price_per_kg >= 0),
  sort_order        int not null default 0,
  is_archived       boolean not null default false,
  created_at        timestamptz not null default now(),
  updated_at        timestamptz not null default now(),
  created_by        uuid references demand_planner.users (id),
  updated_by        uuid references demand_planner.users (id),

  constraint secondary_products_unique_per_source
    unique (org_id, source_item_code, name)
);

create index if not exists secondary_products_source_idx
  on demand_planner.secondary_products (org_id, source_item_code);

create trigger secondary_products_touch
  before update on demand_planner.secondary_products
  for each row execute function demand_planner.touch_updated_at();

alter table demand_planner.secondary_products enable row level security;

-- Same shape as buckets: everyone in the org reads, admins write.
drop policy if exists secondary_products_read on demand_planner.secondary_products;
create policy secondary_products_read on demand_planner.secondary_products for select
  using (org_id = demand_planner.current_org_id());

drop policy if exists secondary_products_admin_write on demand_planner.secondary_products;
create policy secondary_products_admin_write on demand_planner.secondary_products for all
  using (org_id = demand_planner.current_org_id() and demand_planner.current_role_name() = 'admin')
  with check (org_id = demand_planner.current_org_id() and demand_planner.current_role_name() = 'admin');

grant select, insert, update, delete on demand_planner.secondary_products to authenticated;

comment on table demand_planner.secondary_products is
  'By-products recovered when processing a main product. quantity = source program''s rolling_wr × yield_pct.';
comment on column demand_planner.secondary_products.source_item_code is
  'programs.item_code of the product being processed. Matched exactly — a pipeline twin needs its own row.';
comment on column demand_planner.secondary_products.yield_pct is
  'Fraction of feedstock whole round recovered as this by-product (0.02 = 2%).';
