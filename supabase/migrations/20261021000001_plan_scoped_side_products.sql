-- ============================================================================
-- SECONDARY PRODUCTS AND OTHER PRODUCTS BECOME PART OF THE PLAN
-- ============================================================================
-- Both tables were org-scoped: one set of by-product rates and one set of
-- traded lines, read by every plan alike, and so never cloned. That made them
-- the one input a plan could not vary — a sandbox could try a different demand
-- or harvest but not a different by-product price — and it left "New official
-- plan" quietly sharing what the dialog said it copied.
--
-- They now follow the same logic as programs, demand and harvest: each plan
-- holds its own rows, a clone copies them, a snapshot keeps them, a roll
-- forward shifts the monthly quantities, and a restore brings them back.
--
-- EXISTING DATA
-- Every plan alive today gets a copy of the org's current set, so nothing a
-- plan shows changes on migration day. The original rows go to the master
-- plan; every other plan gets copies with new ids.
--
-- ACCESS
-- Reads follow the plan (can_read_plan). Writes follow the plan the way every
-- other input does: never on a locked plan; an admin anywhere; the owner on
-- their own sandbox; and the 'secondary_products' grant on an official plan.
-- ============================================================================

set search_path = demand_planner, public;

-- --- the old uniqueness, which would reject the per-plan copies ---------------
alter table demand_planner.secondary_products
  drop constraint if exists secondary_products_unique_per_source;
drop index if exists demand_planner.secondary_products_total_wr_unique;
alter table demand_planner.other_products
  drop constraint if exists other_products_unique_name;

-- --- the plan column ----------------------------------------------------------
alter table demand_planner.secondary_products
  add column if not exists plan_id uuid references demand_planner.plans (id) on delete cascade;
alter table demand_planner.other_products
  add column if not exists plan_id uuid references demand_planner.plans (id) on delete cascade;
-- Carried on the months too, so their policies and the clone need no join.
alter table demand_planner.other_product_months
  add column if not exists plan_id uuid references demand_planner.plans (id) on delete cascade;

-- --- backfill: one set per plan -----------------------------------------------
-- Re-runnable: a second run finds no row without a plan and does nothing.
do $$
declare
  p record;
  v_first boolean;
  v_left int;
begin
  create temporary table _orig_sec on commit drop as
    select * from demand_planner.secondary_products where plan_id is null;
  create temporary table _orig_oth on commit drop as
    select * from demand_planner.other_products where plan_id is null;
  create temporary table _orig_oth_m on commit drop as
    select m.* from demand_planner.other_product_months m
    join pg_temp._orig_oth o on o.id = m.product_id;
  create temporary table _done_orgs (org_id uuid primary key) on commit drop;

  for p in
    select id, org_id
    from demand_planner.plans
    where deleted_at is null
    order by org_id, (type = 'master') desc, created_at
  loop
    v_first := not exists (select 1 from pg_temp._done_orgs d where d.org_id = p.org_id);

    if v_first then
      -- The master (or the oldest plan) keeps the original rows and their ids.
      insert into pg_temp._done_orgs values (p.org_id);
      update demand_planner.secondary_products s set plan_id = p.id
        where s.id in (select id from pg_temp._orig_sec where org_id = p.org_id);
      update demand_planner.other_products o set plan_id = p.id
        where o.id in (select id from pg_temp._orig_oth where org_id = p.org_id);
      update demand_planner.other_product_months m set plan_id = p.id
        where m.product_id in (select id from pg_temp._orig_oth where org_id = p.org_id);
    else
      insert into demand_planner.secondary_products
        (org_id, plan_id, basis, source_item_code, name, yield_pct, price_per_kg,
         sort_order, is_archived, created_by, updated_by)
      select org_id, p.id, basis, source_item_code, name, yield_pct, price_per_kg,
             sort_order, is_archived, created_by, updated_by
      from pg_temp._orig_sec where org_id = p.org_id;

      -- Other products get new ids, so their months need the old -> new map.
      create temporary table _map on commit drop as
        select o.id as old_id, gen_random_uuid() as new_id
        from pg_temp._orig_oth o where o.org_id = p.org_id;
      insert into demand_planner.other_products
        (id, org_id, plan_id, name, unit_cost, unit_revenue, unit_label,
         sort_order, is_archived, created_by, updated_by)
      select mp.new_id, o.org_id, p.id, o.name, o.unit_cost, o.unit_revenue, o.unit_label,
             o.sort_order, o.is_archived, o.created_by, o.updated_by
      from pg_temp._orig_oth o join pg_temp._map mp on mp.old_id = o.id;
      insert into demand_planner.other_product_months (product_id, org_id, plan_id, month_index, quantity)
      select mp.new_id, m.org_id, p.id, m.month_index, m.quantity
      from pg_temp._orig_oth_m m join pg_temp._map mp on mp.old_id = m.product_id;
      drop table pg_temp._map;
    end if;
  end loop;

  -- A row with no plan belongs to an organisation with no plans at all. Fail
  -- rather than guess: the column is about to become mandatory.
  select count(*) into v_left from demand_planner.secondary_products where plan_id is null;
  if v_left > 0 then
    raise exception 'plan-scoped side products: % secondary_products rows belong to an org with no plan', v_left;
  end if;
  select count(*) into v_left from demand_planner.other_products where plan_id is null;
  if v_left > 0 then
    raise exception 'plan-scoped side products: % other_products rows belong to an org with no plan', v_left;
  end if;
end $$;

alter table demand_planner.secondary_products   alter column plan_id set not null;
alter table demand_planner.other_products       alter column plan_id set not null;
alter table demand_planner.other_product_months alter column plan_id set not null;

-- --- uniqueness and indexes, now per plan -----------------------------------
alter table demand_planner.secondary_products
  add constraint secondary_products_unique_per_source unique (plan_id, source_item_code, name);
-- Two NULL source codes are distinct to a unique constraint, so the whole-fish
-- rows (basis = total_wr) are policed by this partial index instead.
create unique index secondary_products_total_wr_unique
  on demand_planner.secondary_products (plan_id, name)
  where source_item_code is null;
-- Keeps its name: the app matches it to say "already exists".
alter table demand_planner.other_products
  add constraint other_products_unique_name unique (plan_id, name);

create index if not exists secondary_products_plan_idx
  on demand_planner.secondary_products (plan_id, source_item_code);
create index if not exists other_products_plan_idx
  on demand_planner.other_products (plan_id);
create index if not exists other_product_months_plan_idx
  on demand_planner.other_product_months (plan_id, product_id);

comment on column demand_planner.secondary_products.plan_id is
  'The plan this by-product definition belongs to. Cloned, snapshotted and restored with the plan.';
comment on column demand_planner.other_products.plan_id is
  'The plan this traded line belongs to. Cloned, snapshotted and restored with the plan.';

-- --- access -------------------------------------------------------------------
-- The same shape as can_write_section(): never on a locked plan; an admin
-- anywhere; the owner on their own sandbox (which is also what lets a
-- non-admin's "New scenario" clone these rows into it); and on an official
-- plan, whoever holds the 'secondary_products' grant — the grant these tables
-- have used since 20260915000001, kept rather than moved onto per-plan grants.
create or replace function demand_planner.can_write_side_products(p_plan_id uuid)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select exists (
    select 1 from demand_planner.plans p
    where p.id = p_plan_id
      and p.org_id = demand_planner.current_org_id()
      and p.deleted_at is null
      and not p.is_locked
      and (
        demand_planner.current_role_name() = 'admin'
        or (p.is_sandbox and p.owner_user_id = auth.uid())
        or (not p.is_sandbox and demand_planner.can_edit_section('secondary_products'))
      )
  );
$$;

drop policy if exists secondary_products_read  on demand_planner.secondary_products;
drop policy if exists secondary_products_write on demand_planner.secondary_products;
create policy secondary_products_read on demand_planner.secondary_products for select
  using (demand_planner.can_read_plan(plan_id));
create policy secondary_products_write on demand_planner.secondary_products for all
  using      (demand_planner.can_write_side_products(plan_id))
  with check (demand_planner.can_write_side_products(plan_id));

drop policy if exists other_products_read  on demand_planner.other_products;
drop policy if exists other_products_write on demand_planner.other_products;
create policy other_products_read on demand_planner.other_products for select
  using (demand_planner.can_read_plan(plan_id));
create policy other_products_write on demand_planner.other_products for all
  using      (demand_planner.can_write_side_products(plan_id))
  with check (demand_planner.can_write_side_products(plan_id));

drop policy if exists other_product_months_read  on demand_planner.other_product_months;
drop policy if exists other_product_months_write on demand_planner.other_product_months;
create policy other_product_months_read on demand_planner.other_product_months for select
  using (demand_planner.can_read_plan(plan_id));
create policy other_product_months_write on demand_planner.other_product_months for all
  using      (demand_planner.can_write_side_products(plan_id))
  with check (demand_planner.can_write_side_products(plan_id));

-- --- plan routines ------------------------------------------------------------
-- Both are rewritten whole, as every earlier change to them was. The monthly
-- quantities of other products are plan-relative months like demand, so a roll
-- shifts them and a restore replaces them; the definitions themselves have no
-- month and are replaced on restore only.

create or replace function demand_planner.roll_plan_forward(p_plan_id uuid, p_months int)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_horizon int;
begin
  select horizon_months into v_horizon
  from demand_planner.plans
  where id = p_plan_id and deleted_at is null;

  if v_horizon is null then
    raise exception 'Plan not found.';
  end if;
  if p_months < 1 or p_months >= v_horizon then
    raise exception 'Roll months must be between 1 and %.', v_horizon - 1;
  end if;

  -- Copy the surviving rows aside, clear the plan's rows, then re-insert them
  -- shifted. A bulk UPDATE (month_index - N) can't be used: (program_id,
  -- month_index) is unique, so a row moving to a slot that a not-yet-shifted
  -- row still occupies would trip the constraint mid-statement.
  create temporary table _roll_demand on commit drop as
    select * from demand_planner.demand_plan
    where plan_id = p_plan_id and month_index > p_months;

  create temporary table _roll_harvest on commit drop as
    select * from demand_planner.harvest_plan
    where plan_id = p_plan_id and month_index > p_months;

  create temporary table _roll_request on commit drop as
    select * from demand_planner.harvest_request
    where plan_id = p_plan_id and month_index > p_months;

  create temporary table _roll_actual on commit drop as
    select * from demand_planner.harvest_actual
    where plan_id = p_plan_id and month_index > p_months;

  create temporary table _roll_po on commit drop as
    select * from demand_planner.po_updates
    where plan_id = p_plan_id and month_index > p_months;

  create temporary table _roll_po_base on commit drop as
    select * from demand_planner.po_demand_baseline
    where plan_id = p_plan_id and month_index > p_months;

  create temporary table _roll_other_m on commit drop as
    select * from demand_planner.other_product_months
    where plan_id = p_plan_id and month_index > p_months;

  delete from demand_planner.demand_plan where plan_id = p_plan_id;
  delete from demand_planner.harvest_plan where plan_id = p_plan_id;
  delete from demand_planner.harvest_request where plan_id = p_plan_id;
  delete from demand_planner.harvest_actual where plan_id = p_plan_id;
  delete from demand_planner.po_updates where plan_id = p_plan_id;
  delete from demand_planner.po_demand_baseline where plan_id = p_plan_id;
  delete from demand_planner.other_product_months where plan_id = p_plan_id;

  insert into demand_planner.demand_plan (plan_id, program_id, month_index, demand_fp, created_by, updated_by)
    select plan_id, program_id, month_index - p_months, demand_fp, created_by, updated_by
    from pg_temp._roll_demand;

  insert into demand_planner.harvest_plan (plan_id, bucket_id, month_index, capacity_kg_wr, created_by, updated_by)
    select plan_id, bucket_id, month_index - p_months, capacity_kg_wr, created_by, updated_by
    from pg_temp._roll_harvest;

  -- bucket_id included: a sized request must stay sized.
  insert into demand_planner.harvest_request (plan_id, bucket_id, month_index, quantity_kg_wr, created_by, updated_by)
    select plan_id, bucket_id, month_index - p_months, quantity_kg_wr, created_by, updated_by
    from pg_temp._roll_request;

  insert into demand_planner.harvest_actual (plan_id, bucket_id, month_index, quantity_kg_wr, created_by, updated_by)
    select plan_id, bucket_id, month_index - p_months, quantity_kg_wr, created_by, updated_by
    from pg_temp._roll_actual;

  insert into demand_planner.po_updates
    (plan_id, program_id, month_index, quantity_fp, po_ref, received_on, notes, created_by, updated_by)
    select plan_id, program_id, month_index - p_months, quantity_fp, po_ref, received_on, notes, created_by, updated_by
    from pg_temp._roll_po;

  insert into demand_planner.po_demand_baseline (plan_id, program_id, month_index, prev_demand_fp)
    select plan_id, program_id, month_index - p_months, prev_demand_fp
    from pg_temp._roll_po_base;

  -- The products keep their rows; only their month slots move.
  insert into demand_planner.other_product_months (product_id, org_id, plan_id, month_index, quantity)
    select product_id, org_id, plan_id, month_index - p_months, quantity
    from pg_temp._roll_other_m;

  -- Computed tables are derived from the inputs we just moved.
  delete from demand_planner.plan_rank      where plan_id = p_plan_id;
  delete from demand_planner.allocations    where plan_id = p_plan_id;
  delete from demand_planner.rolling_results where plan_id = p_plan_id;
  delete from demand_planner.unallocated_wr where plan_id = p_plan_id;
  delete from demand_planner.pipeline_wr    where plan_id = p_plan_id;
  delete from demand_planner.plan_summary   where plan_id = p_plan_id;

  update demand_planner.plans
     set plan_start_date  = (plan_start_date + (p_months || ' months')::interval)::date,
         last_computed_at = null
   where id = p_plan_id;
end;
$$;

create or replace function demand_planner.restore_plan_from_snapshot(p_target uuid, p_source uuid)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_t demand_planner.plans;
  v_s demand_planner.plans;
begin
  select * into v_t
  from demand_planner.plans where id = p_target and deleted_at is null;
  select * into v_s
  from demand_planner.plans where id = p_source and deleted_at is null;

  if v_t.id is null then raise exception 'Plan not found.'; end if;
  if v_s.id is null then raise exception 'Snapshot not found.'; end if;
  if v_t.is_locked then raise exception 'Target plan is locked (read-only).'; end if;
  if v_t.org_id <> v_s.org_id then raise exception 'Snapshot belongs to a different organisation.'; end if;
  if v_t.horizon_months <> v_s.horizon_months then
    raise exception 'Snapshot horizon (% months) does not match the plan (% months).', v_s.horizon_months, v_t.horizon_months;
  end if;
  if p_target = p_source then raise exception 'Cannot restore a plan from itself.'; end if;

  delete from demand_planner.demand_plan  where plan_id = p_target;
  delete from demand_planner.harvest_plan where plan_id = p_target;
  delete from demand_planner.harvest_request where plan_id = p_target;
  delete from demand_planner.harvest_actual where plan_id = p_target;
  delete from demand_planner.po_updates where plan_id = p_target;
  delete from demand_planner.po_demand_baseline where plan_id = p_target;
  delete from demand_planner.secondary_products where plan_id = p_target;
  -- Months go with their products (on delete cascade).
  delete from demand_planner.other_products where plan_id = p_target;

  -- Demand is program-scoped: remap the snapshot's programs onto the target's
  -- own rows via item_code (unique per plan among non-deleted programs).
  insert into demand_planner.demand_plan (plan_id, program_id, month_index, demand_fp, created_by, updated_by)
  select p_target, tp.id, sd.month_index, sd.demand_fp, sd.created_by, sd.updated_by
  from demand_planner.demand_plan sd
  join demand_planner.programs sp on sp.id = sd.program_id
  join demand_planner.programs tp
    on tp.plan_id = p_target and tp.item_code = sp.item_code and tp.deleted_at is null
  where sd.plan_id = p_source;

  -- Buckets are org-scoped and shared across plans, so ids carry over as-is.
  insert into demand_planner.harvest_plan (plan_id, bucket_id, month_index, capacity_kg_wr, created_by, updated_by)
  select p_target, sh.bucket_id, sh.month_index, sh.capacity_kg_wr, sh.created_by, sh.updated_by
  from demand_planner.harvest_plan sh
  where sh.plan_id = p_source;

  -- The plant's request and the farm's actuals are plan-scoped and bucketed the
  -- same way capacity is, so both copy directly, bucket included.
  insert into demand_planner.harvest_request (plan_id, bucket_id, month_index, quantity_kg_wr, created_by, updated_by)
  select p_target, sr.bucket_id, sr.month_index, sr.quantity_kg_wr, sr.created_by, sr.updated_by
  from demand_planner.harvest_request sr
  where sr.plan_id = p_source;

  insert into demand_planner.harvest_actual (plan_id, bucket_id, month_index, quantity_kg_wr, created_by, updated_by)
  select p_target, sa.bucket_id, sa.month_index, sa.quantity_kg_wr, sa.created_by, sa.updated_by
  from demand_planner.harvest_actual sa
  where sa.plan_id = p_source;

  -- POs and their displaced-demand baselines are program-scoped, so they remap
  -- through item_code exactly as demand does.
  insert into demand_planner.po_updates
    (plan_id, program_id, month_index, quantity_fp, po_ref, received_on, notes, created_by, updated_by)
  select p_target, tp.id, spo.month_index, spo.quantity_fp, spo.po_ref,
         spo.received_on, spo.notes, spo.created_by, spo.updated_by
  from demand_planner.po_updates spo
  join demand_planner.programs sp on sp.id = spo.program_id
  join demand_planner.programs tp
    on tp.plan_id = p_target and tp.item_code = sp.item_code and tp.deleted_at is null
  where spo.plan_id = p_source;

  insert into demand_planner.po_demand_baseline (plan_id, program_id, month_index, prev_demand_fp)
  select p_target, tp.id, sb.month_index, sb.prev_demand_fp
  from demand_planner.po_demand_baseline sb
  join demand_planner.programs sp on sp.id = sb.program_id
  join demand_planner.programs tp
    on tp.plan_id = p_target and tp.item_code = sp.item_code and tp.deleted_at is null
  where sb.plan_id = p_source;

  -- By-products are keyed by item_code already, so they copy as they are.
  insert into demand_planner.secondary_products
    (org_id, plan_id, basis, source_item_code, name, yield_pct, price_per_kg,
     sort_order, is_archived, created_by, updated_by)
  select ss.org_id, p_target, ss.basis, ss.source_item_code, ss.name, ss.yield_pct, ss.price_per_kg,
         ss.sort_order, ss.is_archived, ss.created_by, ss.updated_by
  from demand_planner.secondary_products ss
  where ss.plan_id = p_source;

  -- Other products get new ids on the target, so their months follow by name,
  -- which is unique within a plan.
  insert into demand_planner.other_products
    (org_id, plan_id, name, unit_cost, unit_revenue, unit_label, sort_order, is_archived, created_by, updated_by)
  select so.org_id, p_target, so.name, so.unit_cost, so.unit_revenue, so.unit_label,
         so.sort_order, so.is_archived, so.created_by, so.updated_by
  from demand_planner.other_products so
  where so.plan_id = p_source;

  insert into demand_planner.other_product_months (product_id, org_id, plan_id, month_index, quantity)
  select tpo.id, sm.org_id, p_target, sm.month_index, sm.quantity
  from demand_planner.other_product_months sm
  join demand_planner.other_products spo on spo.id = sm.product_id
  join demand_planner.other_products tpo on tpo.plan_id = p_target and tpo.name = spo.name
  where sm.plan_id = p_source;

  -- Computed tables describe the inputs we just replaced.
  delete from demand_planner.plan_rank       where plan_id = p_target;
  delete from demand_planner.allocations     where plan_id = p_target;
  delete from demand_planner.rolling_results where plan_id = p_target;
  delete from demand_planner.unallocated_wr  where plan_id = p_target;
  delete from demand_planner.pipeline_wr     where plan_id = p_target;
  delete from demand_planner.plan_summary    where plan_id = p_target;

  update demand_planner.plans
     set plan_start_date  = v_s.plan_start_date,
         last_computed_at = null
   where id = p_target;
end;
$$;

-- --- verify ----------------------------------------------------------------
do $verify$
begin
  if exists (
    select 1 from demand_planner.secondary_products where plan_id is null
  ) or exists (
    select 1 from demand_planner.other_products where plan_id is null
  ) then
    raise exception 'plan-scoped side products: rows without a plan remain';
  end if;

  if (select count(*) from pg_policies
       where schemaname = 'demand_planner'
         and tablename in ('secondary_products', 'other_products', 'other_product_months')) <> 6 then
    raise exception 'plan-scoped side products: expected 6 policies on the three tables';
  end if;

  if (select prosrc from pg_proc where oid = 'demand_planner.roll_plan_forward(uuid,int)'::regprocedure)
       not like '%_roll_other_m%' then
    raise exception 'roll_plan_forward does not shift other_product_months';
  end if;
  if (select prosrc from pg_proc where oid = 'demand_planner.restore_plan_from_snapshot(uuid,uuid)'::regprocedure)
       not like '%secondary_products%' then
    raise exception 'restore_plan_from_snapshot does not restore secondary_products';
  end if;
end
$verify$;
