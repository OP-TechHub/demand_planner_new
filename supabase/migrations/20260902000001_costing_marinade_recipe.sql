-- ============================================================================
-- Costing SKUs: build the marinade cost from its ingredients
--
-- Marinade cost was one typed number — USD per kg of marinade — with no record
-- of where it came from. In practice it is a recipe: eleven or so ingredients,
-- each with a dose in grams and a price per kilo, all in LKR. The number people
-- were typing was the answer to a calculation they did in a spreadsheet and
-- then threw away, so nobody could see how it was reached, and a price change
-- on one ingredient meant redoing the whole thing by hand.
--
-- This stores the working. The lines below are the ingredients; the chain is
--
--   line cost LKR      = qty_g x price_lkr_per_kg / 1000
--   total cost LKR     = sum(line cost)
--   LKR per g marinade = total cost / marinade_total_dose_g
--   LKR per kg         = LKR per g x 1000
--   marinade_usd_per_kg = LKR per kg / FX
--
-- and marinade_usd_per_kg is what the engine already consumes. So nothing
-- downstream changes: this is an input builder for a column that already
-- exists, not a new cost component.
--
-- WHY THE TOTAL DOSE IS ITS OWN COLUMN AND NOT sum(qty_g)
-- It is the divisor, and it is deliberately allowed to differ from the sum of
-- the doses. A batch loses weight to cooking and evaporation, so the marinade
-- retained in the finished product weighs less than the marinade that went in.
-- Dividing by the input weight would under-recover the cost. Whoever enters the
-- recipe decides which weight is right; the app defaults it to the sum and lets
-- them change it.
--
-- FISH IS NOT AN INGREDIENT HERE
-- The recipe sheets this replaces list fish as their first line. It must not be
-- entered: the engine already carries fish as whole-fish cost / yield, and
-- pricing it again here would count it twice. The builder only holds what goes
-- INTO the marinade.
--
-- NULL marinade_total_dose_g means "no recipe" — the SKU's marinade cost was
-- typed directly, which stays entirely valid. Most SKUs have no marinade at all.
-- ============================================================================

set search_path = demand_planner, public;

-- Written to be safe to re-run: these migrations are sometimes first applied by
-- hand in the SQL editor, where nothing records that they ran, and a later
-- `supabase db push` then tries them again.
alter table demand_planner.cost_skus
  add column if not exists marinade_total_dose_g numeric(18,4);

do $$
begin
  if not exists (
    select 1 from pg_constraint
     where conname = 'cost_skus_marinade_dose_positive'
       and conrelid = 'demand_planner.cost_skus'::regclass
  ) then
    -- Zero is excluded rather than merely non-negative: it is the divisor.
    alter table demand_planner.cost_skus
      add constraint cost_skus_marinade_dose_positive
      check (marinade_total_dose_g is null or marinade_total_dose_g > 0);
  end if;
end $$;

comment on column demand_planner.cost_skus.marinade_total_dose_g is
  'Grams of marinade the recipe''s total cost is divided by. Null = the marinade cost was typed directly rather than built from ingredients.';

-- --- the ingredients -------------------------------------------------------
create table if not exists demand_planner.cost_sku_marinade_lines (
  id         uuid primary key default gen_random_uuid(),
  sku_id     uuid not null references demand_planner.cost_skus (id) on delete cascade,
  sort_order int  not null default 0,

  -- Free text, with the app offering every name already used as you type. A
  -- shared ingredient master would be the tidier answer, but it needs an admin
  -- screen to maintain and would block adding a SKU on someone else's data
  -- entry — which is the same reason SKUs themselves are not admin-only.
  ingredient text not null check (length(trim(ingredient)) > 0),

  qty_g            numeric(18,4) not null check (qty_g            >= 0),
  -- LKR throughout. The whole section is entered in rupees, because that is how
  -- ingredients are bought here; the conversion to USD happens once, at the end.
  price_lkr_per_kg numeric(18,4) not null check (price_lkr_per_kg >= 0),

  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index if not exists cost_sku_marinade_lines_sku_idx
  on demand_planner.cost_sku_marinade_lines (sku_id, sort_order);

do $$
begin
  if not exists (
    select 1 from pg_trigger
     where tgname = 'cost_sku_marinade_lines_touch'
       and tgrelid = 'demand_planner.cost_sku_marinade_lines'::regclass
  ) then
    create trigger cost_sku_marinade_lines_touch
      before update on demand_planner.cost_sku_marinade_lines
      for each row execute function demand_planner.touch_updated_at();
  end if;
end $$;

-- --- access ----------------------------------------------------------------
alter table demand_planner.cost_sku_marinade_lines enable row level security;

-- Ingredients follow their SKU's ownership exactly, the same way per-grade
-- yields do: whoever may edit the recipe may edit what is in it, and anyone who
-- may read costing may see it. Written as drop-then-create so re-running is safe.
drop policy if exists cost_sku_marinade_lines_read  on demand_planner.cost_sku_marinade_lines;
drop policy if exists cost_sku_marinade_lines_write on demand_planner.cost_sku_marinade_lines;

create policy cost_sku_marinade_lines_read on demand_planner.cost_sku_marinade_lines for select
  using (exists (
    select 1 from demand_planner.cost_skus s
    where s.id = sku_id and s.org_id = demand_planner.current_org_id()
  ) and demand_planner.can_read_costing());

create policy cost_sku_marinade_lines_write on demand_planner.cost_sku_marinade_lines for all
  using      (exists (
    select 1 from demand_planner.cost_skus s
    where s.id = sku_id and s.org_id = demand_planner.current_org_id()
      and (s.created_by = auth.uid() or demand_planner.can_admin_costing())))
  with check (exists (
    select 1 from demand_planner.cost_skus s
    where s.id = sku_id and s.org_id = demand_planner.current_org_id()
      and (s.created_by = auth.uid() or demand_planner.can_admin_costing())));

grant select, insert, update, delete on demand_planner.cost_sku_marinade_lines to authenticated;

-- --- verify ----------------------------------------------------------------
-- Fail here rather than in the UI, which would otherwise offer a builder whose
-- save the database silently refuses.
do $$
declare
  n int;
begin
  select count(*) into n
    from pg_policies
   where schemaname = 'demand_planner'
     and tablename  = 'cost_sku_marinade_lines';
  if n <> 2 then
    raise exception 'expected 2 cost_sku_marinade_lines policies (read/write), found %', n;
  end if;

  if not exists (
    select 1 from information_schema.columns
     where table_schema = 'demand_planner'
       and table_name   = 'cost_skus'
       and column_name  = 'marinade_total_dose_g'
  ) then
    raise exception 'cost_skus.marinade_total_dose_g was not created';
  end if;
end $$;
