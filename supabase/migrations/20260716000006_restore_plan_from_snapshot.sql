-- ============================================================================
-- Oceanpick Demand Planner — Restore a plan from a snapshot
--
-- The inverse of roll_plan_forward: copies a snapshot's start date, demand and
-- harvest back onto a live plan. Used to undo a roll (the roll archives the
-- plan first, so the pre-roll state is always available to restore).
--
-- Programs are NOT replaced — a roll never touches them, and demand is remapped
-- onto the target's own programs by item_code (unique per plan).
--
-- Runs in one transaction: a failure leaves the target untouched.
-- ============================================================================

create or replace function demand_planner.restore_plan_from_snapshot(p_target uuid, p_source uuid)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_t record;
  v_s record;
begin
  select id, org_id, horizon_months, is_locked into v_t
  from demand_planner.plans where id = p_target and deleted_at is null;
  select id, org_id, horizon_months, plan_start_date into v_s
  from demand_planner.plans where id = p_source and deleted_at is null;

  if v_t.id is null then raise exception 'Target plan not found.'; end if;
  if v_s.id is null then raise exception 'Snapshot not found.'; end if;
  if v_t.is_locked then raise exception 'Target plan is locked (read-only).'; end if;
  if v_t.org_id <> v_s.org_id then raise exception 'Snapshot belongs to a different organisation.'; end if;
  if v_t.horizon_months <> v_s.horizon_months then
    raise exception 'Snapshot horizon (% months) does not match the plan (% months).', v_s.horizon_months, v_t.horizon_months;
  end if;
  if p_target = p_source then raise exception 'Cannot restore a plan from itself.'; end if;

  delete from demand_planner.demand_plan  where plan_id = p_target;
  delete from demand_planner.harvest_plan where plan_id = p_target;

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
