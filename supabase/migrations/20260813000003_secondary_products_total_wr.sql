-- A second kind of by-product: whole-fish recovery, driven by TOTAL whole round
-- rather than one product's feedstock.
--
-- Group 1 (already modelled) is cutting waste from a specific product — the trim
-- that comes off Center Cut Portions 180g. Group 2 is primary-processing waste
-- that comes off every fish handled: swim bladder, scales, head & bones, gut and
-- trimmings. Its feedstock is the plan's total allocated whole round (the sum of
-- rolling_results.rolling_wr across all in-scope programs, i.e. "total WR").
--
-- So `basis` says which feedstock a row reads:
--   'program'  -> source_item_code's rolling_wr   (group 1)
--   'total_wr' -> the plan's total rolling_wr     (group 2)
--
-- Existing rows are all group 1, which the column default preserves.

alter table demand_planner.secondary_products
  add column if not exists basis text not null default 'program';

do $$
begin
  if not exists (
    select 1 from pg_constraint where conname = 'secondary_products_basis_check'
  ) then
    alter table demand_planner.secondary_products
      add constraint secondary_products_basis_check
      check (basis in ('program', 'total_wr'));
  end if;
end $$;

-- A total-WR row has no source product, so the column has to allow null.
alter table demand_planner.secondary_products
  alter column source_item_code drop not null;

do $$
begin
  if not exists (
    select 1 from pg_constraint where conname = 'secondary_products_basis_source_check'
  ) then
    alter table demand_planner.secondary_products
      add constraint secondary_products_basis_source_check
      check (
        (basis = 'program'  and source_item_code is not null)
        or
        (basis = 'total_wr' and source_item_code is null)
      );
  end if;
end $$;

-- `unique (org_id, source_item_code, name)` cannot police the group-2 rows: in
-- SQL two NULLs are distinct, so it would happily accept "Scales" twice. Partial
-- unique index covers that case.
create unique index if not exists secondary_products_total_wr_unique
  on demand_planner.secondary_products (org_id, name)
  where source_item_code is null;

comment on column demand_planner.secondary_products.basis is
  'Which feedstock the yield applies to: ''program'' = source_item_code''s rolling_wr; ''total_wr'' = the plan''s total allocated whole round.';

-- --- seed group 2: whole-fish by-products ---------------------------------
-- Rates are fixed; quantity and revenue stay derived from the plan. Prices are
-- seeded at 0 for the same reason as group 1 — quantity is right immediately,
-- and an obvious zero beats invented revenue. The page flags unpriced rows.

insert into demand_planner.secondary_products
  (org_id, basis, source_item_code, name, yield_pct, price_per_kg, sort_order)
select o.id, 'total_wr', null, v.name, v.yield_pct, 0, v.sort_order
from demand_planner.organizations o
cross join (values
  ('Swim Bladder',    0.0100::numeric, 110),
  ('Scales',          0.0500::numeric, 120),
  ('Head & Bones',    0.3700::numeric, 130),
  ('Gut',             0.0600::numeric, 140),
  ('Yellow trimming', 0.0100::numeric, 150),
  ('Fin trimming',    0.0300::numeric, 160)
) as v(name, yield_pct, sort_order)
on conflict do nothing;
