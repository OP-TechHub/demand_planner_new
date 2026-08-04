-- ============================================================================
-- Per-plan input-tab edit permissions + admin-only plan creation
--
-- Every plan carries its own grants: who may edit which input tab ON THAT PLAN.
-- Replaces the old model (master = global user grants, scenario = owner-only)
-- for the three plan-scoped tabs (programs, demand_plan, harvest_plan).
--   • admin        → edits any unlocked plan
-- 	• granted user → edits only the (plan, tab) pairs granted to them
--   • locked plan  → read-only for everyone
-- Buckets stay org-wide (they have no plan_id) and keep the global grant model.
--
-- Plan creation is now admin-only.
-- ============================================================================

-- 1) Per-plan grant table. section ∈ programs | demand_plan | harvest_plan.
create table if not exists demand_planner.plan_editor_grants (
  plan_id     uuid not null references demand_planner.plans (id) on delete cascade,
  user_id     uuid not null references demand_planner.users (id) on delete cascade,
  section     text not null check (section in ('programs', 'demand_plan', 'harvest_plan')),
  created_at  timestamptz not null default now(),
  created_by  uuid references demand_planner.users (id),
  primary key (plan_id, user_id, section)
);

create index if not exists plan_editor_grants_user_idx
  on demand_planner.plan_editor_grants (user_id, plan_id);

alter table demand_planner.plan_editor_grants enable row level security;

-- Anyone in the org may READ grants (the app checks its own access from them);
-- only admins may change them.
drop policy if exists plan_editor_grants_read on demand_planner.plan_editor_grants;
create policy plan_editor_grants_read on demand_planner.plan_editor_grants for select
  using (exists (
    select 1 from demand_planner.plans p
    where p.id = plan_id and p.org_id = demand_planner.current_org_id()
  ));

drop policy if exists plan_editor_grants_admin_write on demand_planner.plan_editor_grants;
create policy plan_editor_grants_admin_write on demand_planner.plan_editor_grants for all
  using (
    demand_planner.current_role_name() = 'admin'
    and exists (select 1 from demand_planner.plans p where p.id = plan_id and p.org_id = demand_planner.current_org_id())
  )
  with check (
    demand_planner.current_role_name() = 'admin'
    and exists (select 1 from demand_planner.plans p where p.id = plan_id and p.org_id = demand_planner.current_org_id())
  );

grant select, insert, update, delete on demand_planner.plan_editor_grants to authenticated;
grant all on demand_planner.plan_editor_grants to service_role;

-- 2) Section write check now consults the per-plan grants.
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
        or exists (
          select 1 from demand_planner.plan_editor_grants g
          where g.plan_id = p.id and g.user_id = auth.uid() and g.section = p_section
        )
      )
  );
$$;

-- 3) Seed grants so nobody loses access on day one.
--    a) Master plan: from each active user's existing global edit_sections
--       (the three plan-scoped ones only; 'buckets' stays global).
insert into demand_planner.plan_editor_grants (plan_id, user_id, section)
select p.id, u.id, s.section
from demand_planner.plans p
join demand_planner.users u on u.org_id = p.org_id and u.is_active
cross join lateral unnest(u.edit_sections) as s(section)
where p.type = 'master' and p.deleted_at is null
  and s.section in ('programs', 'demand_plan', 'harvest_plan')
on conflict do nothing;

--    b) Scenario/other plans: their owner had full edit — grant all three tabs.
insert into demand_planner.plan_editor_grants (plan_id, user_id, section)
select p.id, p.owner_user_id, s.section
from demand_planner.plans p
cross join (values ('programs'), ('demand_plan'), ('harvest_plan')) as s(section)
where p.type <> 'master' and p.owner_user_id is not null and p.deleted_at is null
on conflict do nothing;

-- 4) Plan creation is admin-only.
drop policy if exists plans_insert on demand_planner.plans;
create policy plans_insert on demand_planner.plans for insert
  with check (
    org_id = demand_planner.current_org_id()
    and demand_planner.current_role_name() = 'admin'
    and (
      (type = 'master'   and parent_plan_id is null and owner_user_id is null)
      or
      (type = 'scenario' and owner_user_id = auth.uid())
    )
  );
