-- Seed the known by-products of Center Cut Portions 180g so the Secondary
-- products page works without anyone entering them by hand:
--
--   40-70 TP     2% of feedstock whole round
--   Belly flap   1%
--   Off cut      1%
--
-- Quantity and revenue stay derived — quantity = the source program's
-- rolling_wr x yield, revenue = quantity x price — so they follow the plan
-- automatically on every recalculate. Only the rates and prices are fixed here,
-- and they remain editable on the page afterwards.
--
-- PRICES ARE SEEDED AT 0. Revenue reads zero until an admin sets $/kg on the
-- page; quantity is correct immediately. Seeding a made-up price would have put
-- invented money in front of a planner, which is worse than an obvious zero.
--
-- SOURCE RESOLUTION. The feedstock program is matched by description rather than
-- a hardcoded item_code, because codes differ between orgs and fixtures. Two
-- programs can match "Center Cut Portions 180g" -- the product itself and a
-- "Raw Materials consumed to ..." line -- and attaching to both would DOUBLE
-- COUNT the same fish. So exactly one program per org is chosen, preferring the
-- raw-materials line when it exists.

with src as (
  select
    pl.org_id,
    p.item_code,
    row_number() over (
      partition by pl.org_id
      order by
        -- prefer an explicit raw-materials feedstock line
        (p.item_description ilike 'Raw Material%') desc,
        p.sort_order,
        p.item_code
    ) as rn
  from demand_planner.programs p
  join demand_planner.plans pl on pl.id = p.plan_id
  where p.deleted_at is null
    and pl.deleted_at is null
    and p.item_description ilike '%Center Cut Portions 180g%'
),
chosen as (
  select org_id, item_code from src where rn = 1
),
parts (name, yield_pct, sort_order) as (
  values
    ('40-70 TP',   0.0200::numeric, 10),
    ('Belly flap', 0.0100::numeric, 20),
    ('Off cut',    0.0100::numeric, 30)
)
insert into demand_planner.secondary_products
  (org_id, source_item_code, name, yield_pct, price_per_kg, sort_order)
select c.org_id, c.item_code, v.name, v.yield_pct, 0, v.sort_order
from chosen c
cross join parts v
on conflict (org_id, source_item_code, name) do nothing;
