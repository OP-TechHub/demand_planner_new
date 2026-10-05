-- ============================================================================
-- COMPOSITE COSTING BASIS — products assembled from sub-products
-- ============================================================================
-- Some products are not one input put through a yield at all. A rice pack is
-- rice, chopsuey, fish and a curry: four sub-products, each costed on its own,
-- assembled into one sellable unit. The fish / marinade split cannot hold
-- that — it has room for one primary input and one marinade — so this is a
-- fourth raw-material basis beside full_fish, absorbed and ingredient.
--
-- Only the raw material line changes:
--
--     raw material (per unit) = sum( sub-product qty x its price per unit )
--
-- Everything after it — processing, packing, cold-hold, freight, margins, the
-- target price and the export ladder — is exactly what every other SKU uses.
-- The 34 workbook SKUs keep the basis they have, so v11 parity is untouched.
--
-- A sub-product has its own price — rice is priced as rice — and may ALSO carry
-- a list of other ingredients used for it (the garlic and vegetables cooked
-- into the rice). The list adds to the price; it never replaces it:
--
--     sub-product cost (per unit) = qty x price + ingredients total / units covered
--
-- LKR THROUGHOUT
-- Sub-products are bought and made here, in rupees. The export chain converts
-- the one total at the assumption version's FX rate, exactly as a marinade
-- recipe is converted. There is deliberately no USD column to keep in step.
--
-- THE FINISHED PRODUCT'S UNIT
-- A meal is sold by the pack, not by the kilo, so the SKU says what one unit
-- is (unit_label) and what it weighs (unit_weight_g). The sub-product list is
-- per ONE unit. The adders and margins stay per kg, as they are for every SKU,
-- and the weight is what turns the per-unit total into the per-kg figure the
-- engine runs on — and turns the per-kg result back into a price per pack.
-- unit_label = 'kg' needs no weight: the list is then per kg directly.
--
-- composite_cost_lkr is the stored answer of the list, per unit, the same way
-- marinade_usd_per_kg is the stored answer of a marinade recipe: the grid and
-- the API cost from it without loading the lines.
-- ============================================================================

set search_path = demand_planner, public;

alter type demand_planner.cost_raw_material_basis add value if not exists 'composite';

alter table demand_planner.cost_skus
  add column if not exists unit_label         text not null default 'kg',
  add column if not exists unit_weight_g      numeric(18,4),
  add column if not exists composite_cost_lkr numeric(18,4);

do $$
begin
  if not exists (
    select 1 from pg_constraint
     where conname = 'cost_skus_unit_weight_positive'
       and conrelid = 'demand_planner.cost_skus'::regclass
  ) then
    -- Zero is excluded rather than merely non-negative: it is a divisor.
    alter table demand_planner.cost_skus
      add constraint cost_skus_unit_weight_positive
      check (unit_weight_g is null or unit_weight_g > 0);
  end if;
  if not exists (
    select 1 from pg_constraint
     where conname = 'cost_skus_composite_cost_non_negative'
       and conrelid = 'demand_planner.cost_skus'::regclass
  ) then
    alter table demand_planner.cost_skus
      add constraint cost_skus_composite_cost_non_negative
      check (composite_cost_lkr is null or composite_cost_lkr >= 0);
  end if;
end $$;

comment on column demand_planner.cost_skus.unit_label is
  'What one unit of the finished product is — kg, pack, piece… Costs and prices are shown per this unit. Read for composite SKUs; kg for everything else.';
comment on column demand_planner.cost_skus.unit_weight_g is
  'Net grams in one unit. Converts the per-unit sub-product total to the per-kg figure the engine runs on. Null when the unit is kg.';
comment on column demand_planner.cost_skus.composite_cost_lkr is
  'LKR per UNIT of finished product: the total of the sub-product list. Read only when raw_material_basis = composite.';

-- --- the sub-products ------------------------------------------------------
create table if not exists demand_planner.cost_sku_components (
  id         uuid primary key default gen_random_uuid(),
  sku_id     uuid not null references demand_planner.cost_skus (id) on delete cascade,
  sort_order int  not null default 0,

  name text not null check (length(trim(name)) > 0),

  -- How much of this sub-product goes into ONE unit of the finished product,
  -- counted in the sub-product's own unit (0.15 kg of rice, 1 portion of curry).
  qty  numeric(18,4) not null check (qty >= 0),
  unit text not null default 'kg' check (length(trim(unit)) > 0),

  -- LKR per one `unit` of the sub-product itself — the main thing. Always the
  -- typed figure; the ingredient list below is added on top, never folded in.
  price_lkr_per_unit numeric(18,4) not null check (price_lkr_per_unit >= 0),

  -- How many units of the FINISHED product the ingredient list covers: 1 when
  -- its quantities are per pack, 12 when one cooked batch does twelve packs.
  -- Null means this sub-product has no other ingredients.
  recipe_output_qty numeric(18,4) check (recipe_output_qty is null or recipe_output_qty > 0),

  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index if not exists cost_sku_components_sku_idx
  on demand_planner.cost_sku_components (sku_id, sort_order);

-- --- the other ingredients used for a sub-product ---------------------------
create table if not exists demand_planner.cost_sku_component_ingredients (
  id           uuid primary key default gen_random_uuid(),
  component_id uuid not null references demand_planner.cost_sku_components (id) on delete cascade,
  sort_order   int  not null default 0,

  -- Free text, like marinade ingredients, and for the same reason: a shared
  -- ingredient master would block adding a product on someone else's data entry.
  ingredient text not null check (length(trim(ingredient)) > 0),

  qty_g            numeric(18,4) not null check (qty_g            >= 0),
  price_lkr_per_kg numeric(18,4) not null check (price_lkr_per_kg >= 0),

  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index if not exists cost_sku_component_ingredients_component_idx
  on demand_planner.cost_sku_component_ingredients (component_id, sort_order);

do $$
begin
  if not exists (
    select 1 from pg_trigger
     where tgname = 'cost_sku_components_touch'
       and tgrelid = 'demand_planner.cost_sku_components'::regclass
  ) then
    create trigger cost_sku_components_touch
      before update on demand_planner.cost_sku_components
      for each row execute function demand_planner.touch_updated_at();
  end if;
  if not exists (
    select 1 from pg_trigger
     where tgname = 'cost_sku_component_ingredients_touch'
       and tgrelid = 'demand_planner.cost_sku_component_ingredients'::regclass
  ) then
    create trigger cost_sku_component_ingredients_touch
      before update on demand_planner.cost_sku_component_ingredients
      for each row execute function demand_planner.touch_updated_at();
  end if;
end $$;

-- --- access ----------------------------------------------------------------
alter table demand_planner.cost_sku_components            enable row level security;
alter table demand_planner.cost_sku_component_ingredients enable row level security;

-- Sub-products follow their SKU's ownership exactly, the same way marinade
-- ingredients do: whoever may edit the recipe may edit what is in it, and
-- anyone who may read costing may see it. Drop-then-create so re-running is safe.
drop policy if exists cost_sku_components_read  on demand_planner.cost_sku_components;
drop policy if exists cost_sku_components_write on demand_planner.cost_sku_components;

create policy cost_sku_components_read on demand_planner.cost_sku_components for select
  using (exists (
    select 1 from demand_planner.cost_skus s
    where s.id = sku_id and s.org_id = demand_planner.current_org_id()
  ) and demand_planner.can_read_costing());

create policy cost_sku_components_write on demand_planner.cost_sku_components for all
  using      (exists (
    select 1 from demand_planner.cost_skus s
    where s.id = sku_id and s.org_id = demand_planner.current_org_id()
      and (s.created_by = auth.uid() or demand_planner.can_admin_costing())))
  with check (exists (
    select 1 from demand_planner.cost_skus s
    where s.id = sku_id and s.org_id = demand_planner.current_org_id()
      and (s.created_by = auth.uid() or demand_planner.can_admin_costing())));

drop policy if exists cost_sku_component_ingredients_read  on demand_planner.cost_sku_component_ingredients;
drop policy if exists cost_sku_component_ingredients_write on demand_planner.cost_sku_component_ingredients;

create policy cost_sku_component_ingredients_read on demand_planner.cost_sku_component_ingredients for select
  using (exists (
    select 1 from demand_planner.cost_sku_components c
    join demand_planner.cost_skus s on s.id = c.sku_id
    where c.id = component_id and s.org_id = demand_planner.current_org_id()
  ) and demand_planner.can_read_costing());

create policy cost_sku_component_ingredients_write on demand_planner.cost_sku_component_ingredients for all
  using      (exists (
    select 1 from demand_planner.cost_sku_components c
    join demand_planner.cost_skus s on s.id = c.sku_id
    where c.id = component_id and s.org_id = demand_planner.current_org_id()
      and (s.created_by = auth.uid() or demand_planner.can_admin_costing())))
  with check (exists (
    select 1 from demand_planner.cost_sku_components c
    join demand_planner.cost_skus s on s.id = c.sku_id
    where c.id = component_id and s.org_id = demand_planner.current_org_id()
      and (s.created_by = auth.uid() or demand_planner.can_admin_costing())));

grant select, insert, update, delete on demand_planner.cost_sku_components            to authenticated;
grant select, insert, update, delete on demand_planner.cost_sku_component_ingredients to authenticated;

-- --- verify ----------------------------------------------------------------
-- Fail here rather than in the UI, which would otherwise offer an editor whose
-- save the database silently refuses.
do $$
declare
  n int;
begin
  select count(*) into n
    from pg_policies
   where schemaname = 'demand_planner'
     and tablename in ('cost_sku_components', 'cost_sku_component_ingredients');
  if n <> 4 then
    raise exception 'composite costing: expected 4 policies on the sub-product tables, found %', n;
  end if;
end $$;
