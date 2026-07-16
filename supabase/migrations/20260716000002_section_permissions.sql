-- ============================================================================
-- Oceanpick Demand Planner — Per-section edit permissions
--
-- Lets an admin grant edit access to specific input sections per user, e.g. one
-- person owns Demand Plan, another owns Harvest Plan. Model:
--   • admin              → edits everything
--   • granted user       → edits ONLY the sections in users.edit_sections
--   • no grants / viewer → read-only
--   • scenario owner      → edits every section of their OWN scenario
--
-- Enforced in RLS (below) as well as in the app UI/actions.
-- ============================================================================

-- 1) Per-user grant list. Values come from EDITABLE_SECTIONS in the app:
--    'programs' | 'demand_plan' | 'harvest_plan' | 'buckets'
alter table demand_planner.users
  add column if not exists edit_sections text[] not null default '{}';

-- 2) Section-aware write check for plan-scoped tables. Replaces the blanket
--    is_editor() gate with an admin-or-granted check on the master plan, while
--    scenario owners keep full edit rights on their own fork.
create or replace function demand_planner.can_write_section(p_plan_id uuid, p_section text)
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
        (p.type = 'master' and (
          demand_planner.current_role_name() = 'admin'
          or exists (
            select 1 from demand_planner.users u
            where u.id = auth.uid() and u.is_active and p_section = any(u.edit_sections)
          )
        ))
        or
        (p.type = 'scenario' and p.owner_user_id = auth.uid())
      )
  );
$$;

-- 3) Org-scoped section check (for buckets, which have no plan_id).
create or replace function demand_planner.can_edit_section(p_section text)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select demand_planner.current_role_name() = 'admin'
    or exists (
      select 1 from demand_planner.users u
      where u.id = auth.uid() and u.is_active and p_section = any(u.edit_sections)
    );
$$;

-- 4) Recreate the plan-scoped write policies with the section name baked in.
drop policy if exists programs_write on demand_planner.programs;
create policy programs_write on demand_planner.programs for all
  using (demand_planner.can_write_section(plan_id, 'programs'))
  with check (demand_planner.can_write_section(plan_id, 'programs'));

drop policy if exists demand_plan_write on demand_planner.demand_plan;
create policy demand_plan_write on demand_planner.demand_plan for all
  using (demand_planner.can_write_section(plan_id, 'demand_plan'))
  with check (demand_planner.can_write_section(plan_id, 'demand_plan'));

drop policy if exists harvest_plan_write on demand_planner.harvest_plan;
create policy harvest_plan_write on demand_planner.harvest_plan for all
  using (demand_planner.can_write_section(plan_id, 'harvest_plan'))
  with check (demand_planner.can_write_section(plan_id, 'harvest_plan'));

-- 5) Buckets: admin or users granted the 'buckets' section.
drop policy if exists buckets_admin_write on demand_planner.buckets;
create policy buckets_write on demand_planner.buckets for all
  using (org_id = demand_planner.current_org_id() and demand_planner.can_edit_section('buckets'))
  with check (org_id = demand_planner.current_org_id() and demand_planner.can_edit_section('buckets'));
