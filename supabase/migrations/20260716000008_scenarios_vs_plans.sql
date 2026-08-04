-- ============================================================================
-- Split duplicates into official PLANS and private SCENARIOS (sandboxes)
--
--   • Official plan  (is_sandbox = false): master + admin-created copies.
--     Admin-only creation, per-tab grants, admin lock. Visible to the whole org.
--   • Scenario       (is_sandbox = true):  a user's private sandbox.
--     Any non-viewer creates their own; the OWNER edits every tab; visible only
--     to the owner + admins; never touches real plans.
--
-- Both remain rows in `plans` (type still 'master' | 'scenario'); the new
-- is_sandbox flag drives the different create / see / edit rules below.
-- ============================================================================

alter table demand_planner.plans
  add column if not exists is_sandbox boolean not null default false;

-- Backfill existing scenarios: unlocked ones were user sandboxes; locked ones
-- are the roll/restore archives, which stay official.
update demand_planner.plans
  set is_sandbox = true
  where type = 'scenario' and not is_locked;

-- 1) Edit rule: sandbox owner edits all tabs; official plan uses per-tab grants.
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
        demand_planner.current_role_name() = 'admin'
        or (p.is_sandbox and p.owner_user_id = auth.uid())
        or (not p.is_sandbox and exists (
          select 1 from demand_planner.plan_editor_grants g
          where g.plan_id = p.id and g.user_id = auth.uid() and g.section = p_section
        ))
      )
  );
$$;

-- 2) Read rule: official plans are visible to the whole org; a sandbox only to
--    its owner and admins.
drop policy if exists plans_read on demand_planner.plans;
create policy plans_read on demand_planner.plans for select
  using (
    org_id = demand_planner.current_org_id()
    and deleted_at is null
    and (
      not is_sandbox
      or owner_user_id = auth.uid()
      or demand_planner.current_role_name() = 'admin'
    )
  );

-- 3) Create rule:
--    • master        → admin
--    • sandbox        → any non-viewer, for themselves
--    • official copy  → admin, for themselves
drop policy if exists plans_insert on demand_planner.plans;
create policy plans_insert on demand_planner.plans for insert
  with check (
    org_id = demand_planner.current_org_id()
    and (
      (type = 'master' and demand_planner.current_role_name() = 'admin'
                       and parent_plan_id is null and owner_user_id is null)
      or
      (type = 'scenario' and is_sandbox = true
                         and owner_user_id = auth.uid()
                         and demand_planner.current_role_name() <> 'viewer')
      or
      (type = 'scenario' and is_sandbox = false
                         and demand_planner.current_role_name() = 'admin'
                         and owner_user_id = auth.uid())
    )
  );
