-- Other products — traded lines that sit outside the harvest plan entirely.
--
-- Unlike `secondary_products`, nothing here is derived from the engine: the
-- quantity is typed in month by month, and cost and revenue are per-unit rates
-- entered against it. They are shown beside the by-products because they answer
-- the same question — what else does this business sell, and what does it make
-- on it — but the arithmetic is plain:
--
--   total_cost    = quantity × unit_cost
--   total_revenue = quantity × unit_revenue
--   total_margin  = total_revenue − total_cost
--
-- ORG-SCOPED, like `secondary_products` and `buckets`: these lines belong to the
-- business, not to one plan, so they survive a scenario fork with no clone
-- logic. Months are plan-relative indexes (M1 = the plan's first month), which
-- is how every other monthly figure in the app is keyed.

create table if not exists demand_planner.other_products (
  id            uuid primary key default gen_random_uuid(),
  org_id        uuid not null references demand_planner.organizations (id) on delete cascade,
  name          text not null,
  -- per-unit rates; the unit is whatever the quantity is counted in (kg, cases…)
  unit_cost     numeric(18,4) not null default 0 check (unit_cost >= 0),
  unit_revenue  numeric(18,4) not null default 0 check (unit_revenue >= 0),
  unit_label    text not null default 'kg',
  sort_order    int not null default 0,
  is_archived   boolean not null default false,
  created_at    timestamptz not null default now(),
  updated_at    timestamptz not null default now(),
  created_by    uuid references demand_planner.users (id),
  updated_by    uuid references demand_planner.users (id),

  constraint other_products_unique_name unique (org_id, name)
);

-- One row per month a product actually has a quantity in. Months with nothing
-- planned are absent rather than stored as zero, exactly like `demand_overrides`.
create table if not exists demand_planner.other_product_months (
  product_id   uuid not null references demand_planner.other_products (id) on delete cascade,
  org_id       uuid not null references demand_planner.organizations (id) on delete cascade,
  month_index  int  not null check (month_index between 1 and 60),
  quantity     numeric(18,4) not null default 0 check (quantity >= 0),
  primary key (product_id, month_index)
);

create index if not exists other_product_months_org_idx
  on demand_planner.other_product_months (org_id, product_id);

-- Dropped first so the whole file can be re-run: create trigger has no
-- "if not exists", and a partial first run would otherwise block every retry.
drop trigger if exists other_products_touch on demand_planner.other_products;
create trigger other_products_touch
  before update on demand_planner.other_products
  for each row execute function demand_planner.touch_updated_at();

alter table demand_planner.other_products       enable row level security;
alter table demand_planner.other_product_months enable row level security;

-- Same shape as secondary_products: everyone in the org reads, admins write.
drop policy if exists other_products_read on demand_planner.other_products;
create policy other_products_read on demand_planner.other_products for select
  using (org_id = demand_planner.current_org_id());

drop policy if exists other_products_admin_write on demand_planner.other_products;
create policy other_products_admin_write on demand_planner.other_products for all
  using (org_id = demand_planner.current_org_id() and demand_planner.current_role_name() = 'admin')
  with check (org_id = demand_planner.current_org_id() and demand_planner.current_role_name() = 'admin');

drop policy if exists other_product_months_read on demand_planner.other_product_months;
create policy other_product_months_read on demand_planner.other_product_months for select
  using (org_id = demand_planner.current_org_id());

drop policy if exists other_product_months_admin_write on demand_planner.other_product_months;
create policy other_product_months_admin_write on demand_planner.other_product_months for all
  using (org_id = demand_planner.current_org_id() and demand_planner.current_role_name() = 'admin')
  with check (org_id = demand_planner.current_org_id() and demand_planner.current_role_name() = 'admin');

grant select, insert, update, delete on demand_planner.other_products       to authenticated;
grant select, insert, update, delete on demand_planner.other_product_months to authenticated;

comment on table demand_planner.other_products is
  'Traded lines outside the harvest plan. Quantity is entered per month; cost and revenue are per-unit rates.';
comment on table demand_planner.other_product_months is
  'Monthly quantity for an other product. month_index is plan-relative (M1 = the plan''s first month).';
