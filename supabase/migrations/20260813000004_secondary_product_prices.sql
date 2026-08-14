-- Sales prices ($/kg) for the seeded by-products.
--
-- Both groups were seeded at 0 deliberately — quantity is derived and correct
-- immediately, but revenue needed real prices rather than invented ones. These
-- are the supplied figures.
--
-- Names here are the ones used when the recovery rates were defined; the price
-- sheet spells some of them differently, so the mapping is:
--
--   40-70 TP        <- 40G-70G Tail Portion
--   Off cut         <- Off cuts
--   Swim Bladder    <- Swimming Bladder
--   Head & Bones    <- Head, Bones
--
-- NOT APPLIED: "Wings" ($0.08/kg). It has a price but no recovery rate and is in
-- neither group, so there is nothing to multiply. Adding it with a guessed yield
-- would invent volume, so it is left out until its rate and basis are known.

update demand_planner.secondary_products sp
set price_per_kg = v.price,
    updated_at   = now()
from (values
  -- group 1: cutting waste off Center Cut Portions 180g
  ('40-70 TP',        4.62::numeric),
  ('Belly flap',      0.62::numeric),
  ('Off cut',         0.62::numeric),
  -- group 2: whole-fish recovery from total WR
  ('Swim Bladder',    8.50::numeric),
  ('Scales',          0.03::numeric),
  ('Head & Bones',    0.04::numeric),
  ('Gut',             0.11::numeric),
  ('Yellow trimming', 0.03::numeric),
  ('Fin trimming',    0.03::numeric)
) as v(name, price)
where sp.name = v.name
  and sp.price_per_kg is distinct from v.price;
