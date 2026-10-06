-- ============================================================================
-- COMPOSITE COSTING — batches and overheads
-- ============================================================================
-- A composite SKU was costed from what goes into ONE unit of it. Nobody cooks
-- one pack. A kitchen works in batches — 1 kg of rice, 360 g of garlic, two
-- staff for the session — and the batch makes twelve packs. Entering that per
-- pack means dividing every figure by twelve by hand first, which is exactly
-- the working this module exists to hold.
--
-- So the list is now entered per BATCH, and the SKU says how many finished
-- units a batch makes:
--
--     batch cost    = sum(sub-product qty x price)
--                   + sum(other ingredients x batch_units / units they cover)
--                   + sum(overheads)
--     cost per unit = batch cost / batch_units
--
-- batch_units defaults to 1, where "per batch" and "per unit" are the same
-- thing — so every composite SKU saved before this costs exactly as it did.
--
-- OVERHEADS
-- Labour, electricity, gas, transport: flat LKR amounts per batch that belong
-- to no ingredient. They are rows in cost_sku_components with kind =
-- 'overhead' rather than a table of their own — same owner, same lifetime,
-- same save — carrying just a name and an amount (qty 1 x price).
--
-- An ingredient list's "units covered" (recipe_output_qty) keeps its meaning:
-- how many FINISHED units that list is enough for. Equal to batch_units when
-- the list is this batch's quantities; larger when it is a sub-recipe made in
-- bulk — a gravy batch that fills 48 cups, of which this batch of 12 uses 12.
-- ============================================================================

set search_path = demand_planner, public;

alter table demand_planner.cost_skus
  add column if not exists batch_units numeric(18,4) not null default 1;

alter table demand_planner.cost_sku_components
  add column if not exists kind text not null default 'component';

do $$
begin
  if not exists (
    select 1 from pg_constraint
     where conname = 'cost_skus_batch_units_positive'
       and conrelid = 'demand_planner.cost_skus'::regclass
  ) then
    -- Zero is excluded rather than merely non-negative: it is the divisor.
    alter table demand_planner.cost_skus
      add constraint cost_skus_batch_units_positive check (batch_units > 0);
  end if;
  if not exists (
    select 1 from pg_constraint
     where conname = 'cost_sku_components_kind_known'
       and conrelid = 'demand_planner.cost_sku_components'::regclass
  ) then
    alter table demand_planner.cost_sku_components
      add constraint cost_sku_components_kind_known check (kind in ('component', 'overhead'));
  end if;
end $$;

comment on column demand_planner.cost_skus.batch_units is
  'How many finished units one batch makes. Sub-product quantities and overheads are entered per batch and divided by this. 1 = entered per unit.';
comment on column demand_planner.cost_sku_components.kind is
  'component = a sub-product (qty x price, plus its other ingredients). overhead = a flat LKR amount per batch (qty 1 x price), e.g. labour.';
comment on column demand_planner.cost_sku_components.qty is
  'Per BATCH of cost_skus.batch_units finished units, in the sub-product''s own unit. Always 1 for an overhead.';
