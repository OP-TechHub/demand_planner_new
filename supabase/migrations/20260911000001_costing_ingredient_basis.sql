-- ============================================================================
-- PRIMARY-INGREDIENT COSTING BASIS
-- ============================================================================
-- Some products are not built from a whole fish at all. Fish maw starts from
-- wet swim bladder, dried down at its own yield; the rest of the chain -
-- marinade, processing, packing, cold-hold, freight, margins - is identical to
-- a fish SKU. Rather than a parallel model, this is a third raw-material
-- basis: the input cost stops coming from the version's whole-fish build-up
-- and comes from the SKU instead. The arithmetic is unchanged,
--
--     raw material = % input x input cost / yield
--
-- with `input cost` selected by the basis. full_fish reads the whole-fish
-- cost, absorbed reads zero, ingredient reads the columns below. The 34
-- existing SKUs keep the basis they have, so v11 parity is untouched.
--
-- Two costs, not one converted: the input is bought in rupees but the export
-- chain runs in dollars, and the rate you actually transact at is not always
-- the version's FX rate. Each market reads its own column, exactly as the
-- market_price_* pair already does.
--
-- A zero cost is legitimate and is NOT the same as a missing one. When the
-- input is a by-product of our own harvest that the main product has already
-- paid for, the honest transfer price is either what we forgo by not selling
-- it in its raw state, or nothing at all.

alter type demand_planner.cost_raw_material_basis add value if not exists 'ingredient';

alter table demand_planner.cost_skus
  add column if not exists primary_input_name     text,
  add column if not exists primary_input_cost_lkr numeric(18,4) check (primary_input_cost_lkr >= 0),
  add column if not exists primary_input_cost_usd numeric(18,4) check (primary_input_cost_usd >= 0);

comment on column demand_planner.cost_skus.primary_input_name is
  'What the SKU is made from when raw_material_basis = ingredient, e.g. wet swim bladder. Label only.';
comment on column demand_planner.cost_skus.primary_input_cost_lkr is
  'LKR per kg of INPUT (not of finished product) - divided by base_yield. Domestic chain.';
comment on column demand_planner.cost_skus.primary_input_cost_usd is
  'USD per kg of INPUT (not of finished product) - divided by base_yield. Export chain.';
