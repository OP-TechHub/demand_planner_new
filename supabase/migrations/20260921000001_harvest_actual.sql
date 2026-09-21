-- ============================================================================
-- Harvest Plan — Actual Harvest
--
-- WHAT IT IS
--   What was actually landed, per month and size bucket (kg WR). The third
--   line of the same story the Harvest Plan page already tells: capacity is
--   what we planned to land, the request plan is what the processing plant
--   asked for, and this is what came out of the water. Same shape as both —
--   plan × bucket × month — so the three compare cell for cell.
--
-- NOT AN ENGINE INPUT
--   Nothing in rank / allocate / rolling reads this table, so recording an
--   actual never makes a plan stale and never changes a computed result. It is
--   a record of what happened, kept beside the plan it belongs to.
--
-- ITS OWN PERMISSION
--   'harvest_actual' is separately grantable, for the same reason
--   'harvest_request' is (20260813000005): recording what was harvested is the
--   farm's job, editing planned capacity is the planners', and stating a
--   requirement is the plant's. Deliberately NOT seeded from any existing
--   grant — nobody gains this until an admin ticks the box. Admins have it
--   automatically via can_write_section.
--
-- ALWAYS SIZED
--   bucket_id is NOT NULL here. harvest_request carries nullable buckets only
--   because it predates the size breakdown and its existing rows could not be
--   split by guessing; this table starts empty, so it has no such history and
--   should not invent one.
-- ============================================================================

set search_path = demand_planner, public;

alter table demand_planner.plan_editor_grants
  drop constraint if exists plan_editor_grants_section_check;
alter table demand_planner.plan_editor_grants
  add constraint plan_editor_grants_section_check
  check (section in ('programs', 'demand_plan', 'harvest_plan', 'inquiry', 'harvest_request', 'harvest_actual'));

create table if not exists demand_planner.harvest_actual (
  id             uuid primary key default gen_random_uuid(),
  plan_id        uuid not null references demand_planner.plans (id) on delete cascade,
  bucket_id      uuid not null references demand_planner.buckets (id),
  month_index    int  not null check (month_index between 1 and 60),
  quantity_kg_wr numeric(18,4) not null default 0 check (quantity_kg_wr >= 0),
  created_at     timestamptz not null default now(),
  updated_at     timestamptz not null default now(),
  created_by     uuid references demand_planner.users (id),
  updated_by     uuid references demand_planner.users (id),

  constraint harvest_actual_unique_cell unique (plan_id, bucket_id, month_index)
);

create index if not exists harvest_actual_plan_idx
  on demand_planner.harvest_actual (plan_id, month_index, bucket_id);

drop trigger if exists harvest_actual_touch on demand_planner.harvest_actual;
create trigger harvest_actual_touch
  before update on demand_planner.harvest_actual
  for each row execute function demand_planner.touch_updated_at();

alter table demand_planner.harvest_actual enable row level security;

-- Readable by anyone who can read the plan; written only with the
-- 'harvest_actual' grant (or by an admin), and never on a locked plan.
drop policy if exists harvest_actual_read on demand_planner.harvest_actual;
create policy harvest_actual_read on demand_planner.harvest_actual for select
  using (demand_planner.can_read_plan(plan_id));

drop policy if exists harvest_actual_write on demand_planner.harvest_actual;
create policy harvest_actual_write on demand_planner.harvest_actual for all
  using (demand_planner.can_write_section(plan_id, 'harvest_actual'))
  with check (demand_planner.can_write_section(plan_id, 'harvest_actual'));

grant select, insert, update, delete on demand_planner.harvest_actual to authenticated;

comment on table demand_planner.harvest_actual is
  'Whole round actually harvested per month and size bucket. Reference only — not an engine input.';

-- ============================================================================
-- The two plan-data routines learn about harvest_actual — AND stop dropping
-- harvest_request's bucket.
--
-- Both were last written (20260820000002) before harvest_request gained
-- bucket_id (20260910000002), so they still copy it column by column without
-- the bucket. Today that silently rewrites every sized request as a sizeless
-- one, and worse: two buckets in the same month both land on the partial
-- unique index harvest_request_sizeless_unique, so a roll or restore of any
-- plan holding more than one bucket in a month fails outright. Carrying the
-- column fixes both. Rewritten whole, as those migrations did.
-- ============================================================================

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

  delete from demand_planner.demand_plan where plan_id = p_plan_id;
  delete from demand_planner.harvest_plan where plan_id = p_plan_id;
  delete from demand_planner.harvest_request where plan_id = p_plan_id;
  delete from demand_planner.harvest_actual where plan_id = p_plan_id;
  delete from demand_planner.po_updates where plan_id = p_plan_id;
  delete from demand_planner.po_demand_baseline where plan_id = p_plan_id;

  insert into demand_planner.demand_plan (plan_id, program_id, month_index, demand_fp, created_by, updated_by)
    select plan_id, program_id, month_index - p_months, demand_fp, created_by, updated_by
    from pg_temp._roll_demand;

  insert into demand_planner.harvest_plan (plan_id, bucket_id, month_index, capacity_kg_wr, created_by, updated_by)
    select plan_id, bucket_id, month_index - p_months, capacity_kg_wr, created_by, updated_by
    from pg_temp._roll_harvest;

  -- bucket_id included: a sized request must stay sized (see the note above).
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
  if not exists (
    select 1 from information_schema.tables
     where table_schema = 'demand_planner' and table_name = 'harvest_actual'
  ) then
    raise exception 'harvest_actual was not created';
  end if;

  if not exists (
    select 1 from pg_policies
     where schemaname = 'demand_planner' and tablename = 'harvest_actual'
       and policyname = 'harvest_actual_write'
  ) then
    raise exception 'harvest_actual write policy missing';
  end if;

  -- The grant check must accept the new section, or nobody could ever be given it.
  if not exists (
    select 1 from pg_constraint
     where conrelid = 'demand_planner.plan_editor_grants'::regclass
       and conname = 'plan_editor_grants_section_check'
       and pg_get_constraintdef(oid) like '%harvest_actual%'
  ) then
    raise exception 'plan_editor_grants still rejects harvest_actual';
  end if;

  -- Both routines must now carry harvest_request's bucket.
  if (select prosrc from pg_proc where oid = 'demand_planner.roll_plan_forward(uuid,int)'::regprocedure)
       not like '%harvest_request (plan_id, bucket_id, month_index%' then
    raise exception 'roll_plan_forward still drops harvest_request.bucket_id';
  end if;
  if (select prosrc from pg_proc where oid = 'demand_planner.restore_plan_from_snapshot(uuid,uuid)'::regprocedure)
       not like '%harvest_request (plan_id, bucket_id, month_index%' then
    raise exception 'restore_plan_from_snapshot still drops harvest_request.bucket_id';
  end if;
end
$verify$;
