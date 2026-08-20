-- Teach the two plan-data routines about `po_updates` and `po_demand_baseline`.
--
-- Both are month-indexed and program-scoped, so they must travel with the rest of
-- the plan's inputs for exactly the reason harvest_request did. Without this:
--
--   • roll_plan_forward shifts demand by N months but leaves the POs behind, so
--     every received order would end up attributed to the WRONG calendar month —
--     and the stale baseline rows would restore the wrong figures on deletion.
--   • restore_plan_from_snapshot reverts demand but keeps the current POs, so the
--     next PO edit would immediately overwrite the restored demand again.
--
-- Both functions are rewritten whole (create or replace), with POs handled the
-- same way demand already is.

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

  create temporary table _roll_po on commit drop as
    select * from demand_planner.po_updates
    where plan_id = p_plan_id and month_index > p_months;

  create temporary table _roll_po_base on commit drop as
    select * from demand_planner.po_demand_baseline
    where plan_id = p_plan_id and month_index > p_months;

  delete from demand_planner.demand_plan where plan_id = p_plan_id;
  delete from demand_planner.harvest_plan where plan_id = p_plan_id;
  delete from demand_planner.harvest_request where plan_id = p_plan_id;
  delete from demand_planner.po_updates where plan_id = p_plan_id;
  delete from demand_planner.po_demand_baseline where plan_id = p_plan_id;

  insert into demand_planner.demand_plan (plan_id, program_id, month_index, demand_fp, created_by, updated_by)
    select plan_id, program_id, month_index - p_months, demand_fp, created_by, updated_by
    from pg_temp._roll_demand;

  insert into demand_planner.harvest_plan (plan_id, bucket_id, month_index, capacity_kg_wr, created_by, updated_by)
    select plan_id, bucket_id, month_index - p_months, capacity_kg_wr, created_by, updated_by
    from pg_temp._roll_harvest;

  insert into demand_planner.harvest_request (plan_id, month_index, quantity_kg_wr, created_by, updated_by)
    select plan_id, month_index - p_months, quantity_kg_wr, created_by, updated_by
    from pg_temp._roll_request;

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

  -- The processing plant's request plan is plan-scoped and keyed only by month,
  -- so it copies directly.
  insert into demand_planner.harvest_request (plan_id, month_index, quantity_kg_wr, created_by, updated_by)
  select p_target, sr.month_index, sr.quantity_kg_wr, sr.created_by, sr.updated_by
  from demand_planner.harvest_request sr
  where sr.plan_id = p_source;

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
