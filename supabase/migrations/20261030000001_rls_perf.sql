-- ============================================================================
-- ROW-LEVEL SECURITY THAT RUNS ONCE PER QUERY, NOT ONCE PER ROW
-- ============================================================================
-- Every plan-scoped policy called a helper with the row's plan_id —
-- can_read_plan(plan_id), can_write_section(plan_id, …) — and Postgres cannot
-- cache a function call whose argument changes per row. Each call did 3–4
-- lookups on users and plans, so reading the ~3,000 rolling_results rows of
-- one plan cost ~12,000 lookups, and a bulk save paid the write check twice
-- per row (USING and WITH CHECK).
--
-- The fix keeps every rule exactly as it was and changes only its shape: a
-- set-returning helper lists the plan ids the caller may read (or write, per
-- section), and the policy asks `plan_id in (select …)`. An uncorrelated
-- subquery is evaluated once per statement and hashed, so the cost no longer
-- grows with the number of rows.
--
-- The old boolean helpers (can_read_plan, can_write_section,
-- can_write_side_products) stay: other code may still call them, and the new
-- helpers must keep returning exactly the plans they accept.
--
-- Policy names and FOR ALL / FOR SELECT shapes are unchanged on purpose.
-- Splitting the FOR ALL write policies into insert/update/delete would stop
-- them from granting reads, and a user holding a section grant on an official
-- plan they could not otherwise read (a viewer with a grant) would lose access.
--
-- Also: (select …) wrapping on the org-scoped read policies, and the indexes
-- the freshness probe, the audit log and program cascade deletes were missing.
-- ============================================================================

set search_path = demand_planner, public;

-- --- set-returning access helpers -------------------------------------------

-- Same rule as can_read_plan(): same org, not deleted, and master, or owned by
-- the caller, or the caller is an active admin/planner. current_org_id() does
-- not check is_active; is_editor() does — mirrored here.
create or replace function demand_planner.readable_plan_ids()
returns setof uuid
language sql
stable
security definer
set search_path = ''
as $$
  select p.id
  from demand_planner.plans p
  join demand_planner.users u on u.id = auth.uid() and u.org_id = p.org_id
  where p.deleted_at is null
    and (
      p.type = 'master'
      or p.owner_user_id = auth.uid()
      or (u.is_active and u.role in ('admin', 'planner'))
    );
$$;

-- Same rule as can_write_section(plan_id, section).
create or replace function demand_planner.writable_section_plan_ids(p_section text)
returns setof uuid
language sql
stable
security definer
set search_path = ''
as $$
  select p.id
  from demand_planner.plans p
  join demand_planner.users u on u.id = auth.uid() and u.org_id = p.org_id
  where p.deleted_at is null
    and not p.is_locked
    and (
      (u.is_active and u.role = 'admin')
      or (p.is_sandbox and p.owner_user_id = auth.uid())
      or (not p.is_sandbox and exists (
        select 1 from demand_planner.plan_editor_grants g
        where g.plan_id = p.id and g.user_id = auth.uid() and g.section = p_section
      ))
    );
$$;

-- Same rule as can_write_side_products(plan_id).
create or replace function demand_planner.writable_side_product_plan_ids()
returns setof uuid
language sql
stable
security definer
set search_path = ''
as $$
  select p.id
  from demand_planner.plans p
  join demand_planner.users u on u.id = auth.uid() and u.org_id = p.org_id
  where p.deleted_at is null
    and not p.is_locked
    and (
      (u.is_active and u.role = 'admin')
      or (p.is_sandbox and p.owner_user_id = auth.uid())
      or (not p.is_sandbox and demand_planner.can_edit_section('secondary_products'))
    );
$$;

grant execute on function
  demand_planner.readable_plan_ids(),
  demand_planner.writable_section_plan_ids(text),
  demand_planner.writable_side_product_plan_ids()
  to authenticated;

-- --- plan-scoped read policies -----------------------------------------------
do $$
declare
  t text;
begin
  foreach t in array array[
    'programs', 'harvest_plan', 'demand_plan',
    'plan_rank', 'allocations', 'rolling_results',
    'unallocated_wr', 'pipeline_wr', 'plan_summary',
    'inquiries', 'harvest_request', 'harvest_actual',
    'po_updates', 'po_demand_baseline',
    'secondary_products', 'other_products', 'other_product_months'
  ] loop
    execute format('drop policy if exists %1$s_read on demand_planner.%1$s', t);
    execute format(
      'create policy %1$s_read on demand_planner.%1$s for select
         using (plan_id in (select demand_planner.readable_plan_ids()))', t);
  end loop;
end;
$$;

-- --- plan-scoped write policies (section grants) ----------------------------
do $$
declare
  r record;
begin
  for r in
    select * from (values
      ('programs',           'programs'),
      ('demand_plan',        'demand_plan'),
      ('harvest_plan',       'harvest_plan'),
      ('harvest_request',    'harvest_request'),
      ('harvest_actual',     'harvest_actual'),
      ('po_updates',         'demand_plan'),
      ('po_demand_baseline', 'demand_plan')
    ) as v(tbl, section)
  loop
    execute format('drop policy if exists %1$s_write on demand_planner.%1$s', r.tbl);
    execute format(
      'create policy %1$s_write on demand_planner.%1$s for all
         using      (plan_id in (select demand_planner.writable_section_plan_ids(%2$L)))
         with check (plan_id in (select demand_planner.writable_section_plan_ids(%2$L)))',
      r.tbl, r.section);
  end loop;
end;
$$;

-- --- side-product write policies --------------------------------------------
do $$
declare
  t text;
begin
  foreach t in array array['secondary_products', 'other_products', 'other_product_months'] loop
    execute format('drop policy if exists %1$s_write on demand_planner.%1$s', t);
    execute format(
      'create policy %1$s_write on demand_planner.%1$s for all
         using      (plan_id in (select demand_planner.writable_side_product_plan_ids()))
         with check (plan_id in (select demand_planner.writable_side_product_plan_ids()))', t);
  end loop;
end;
$$;

-- --- org-scoped read policies: evaluate the helpers once --------------------
drop policy if exists plans_read on demand_planner.plans;
create policy plans_read on demand_planner.plans for select
  using (
    org_id = (select demand_planner.current_org_id())
    and deleted_at is null
    and (
      not is_sandbox
      or owner_user_id = (select auth.uid())
      or (select demand_planner.current_role_name()) = 'admin'
    )
  );

drop policy if exists users_read on demand_planner.users;
create policy users_read on demand_planner.users for select
  using (org_id = (select demand_planner.current_org_id()));

drop policy if exists audit_read on demand_planner.audit_log;
create policy audit_read on demand_planner.audit_log for select
  using (org_id = (select demand_planner.current_org_id()));

-- --- missing indexes ----------------------------------------------------------
-- Freshness probe (lib/plan-freshness.ts): latest updated_at per plan.
create index if not exists programs_plan_updated_idx
  on demand_planner.programs (plan_id, updated_at desc);
create index if not exists demand_plan_plan_updated_idx
  on demand_planner.demand_plan (plan_id, updated_at desc);
create index if not exists harvest_plan_plan_updated_idx
  on demand_planner.harvest_plan (plan_id, updated_at desc);

-- Audit log: recent activity per org, and the plan-history filter.
create index if not exists audit_log_org_at_idx
  on demand_planner.audit_log (org_id, at desc);
create index if not exists audit_log_entity_type_at_idx
  on demand_planner.audit_log (entity_type, at desc);

-- Program deletes cascade into these; program_id is not a leading key column.
create index if not exists allocations_program_idx
  on demand_planner.allocations (program_id);
create index if not exists rolling_results_program_idx
  on demand_planner.rolling_results (program_id);
create index if not exists plan_rank_program_idx
  on demand_planner.plan_rank (program_id);

-- --- self-check -------------------------------------------------------------
do $$
begin
  if exists (
    select 1 from pg_policies
     where schemaname = 'demand_planner'
       and (qual like '%can_read_plan(%' or qual like '%can_write_section(%'
            or qual like '%can_write_side_products(%')
  ) then
    raise exception 'a plan-scoped policy still calls a per-row helper';
  end if;
end;
$$;
