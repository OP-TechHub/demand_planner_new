-- ============================================================================
-- Oceanpick Demand Planner — Roll a plan's window forward
--
-- Month data is stored RELATIVE to the plan start (M1 = plan_start_date), so
-- moving a plan from an Apr-2026 start to an Apr-2027 start is not just a date
-- change: every surviving row must shift down by the same number of months, or
-- the data silently re-labels itself a year late.
--
-- Rolling forward N months:
--   • months 1..N roll off (the elapsed period — the app snapshots the plan first)
--   • months N+1..horizon shift down to 1..horizon-N (calendar alignment preserved)
--   • the freed tail (horizon-N+1..horizon) is left empty to be planned
--   • computed results are cleared — they no longer match the inputs
--
-- Runs in one transaction, so a failure leaves the plan untouched.
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

  delete from demand_planner.demand_plan where plan_id = p_plan_id;
  delete from demand_planner.harvest_plan where plan_id = p_plan_id;

  insert into demand_planner.demand_plan (plan_id, program_id, month_index, demand_fp, created_by, updated_by)
    select plan_id, program_id, month_index - p_months, demand_fp, created_by, updated_by
    from pg_temp._roll_demand;

  insert into demand_planner.harvest_plan (plan_id, bucket_id, month_index, capacity_kg_wr, created_by, updated_by)
    select plan_id, bucket_id, month_index - p_months, capacity_kg_wr, created_by, updated_by
    from pg_temp._roll_harvest;

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
