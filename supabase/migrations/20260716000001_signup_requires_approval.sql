-- ============================================================================
-- Oceanpick Demand Planner — Signups require admin approval
--
-- Supersedes handle_new_user() from 20260715000002. New accounts are now
-- created INACTIVE (is_active = false) and cannot use the app until an admin
-- approves them on the Users page. The first user (workspace admin) is still
-- created active so there's someone who can approve everyone else.
--
-- The app enforces this: the shell blocks inactive users with an "Awaiting
-- approval" notice, and admins flip is_active via the Users page.
-- ============================================================================

create or replace function demand_planner.handle_new_user()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_org_id   uuid;
  v_is_first boolean;
begin
  select id into v_org_id
  from demand_planner.organizations
  where slug = 'oceanpick';

  if v_org_id is null then
    raise exception 'Signup blocked: Oceanpick organization is not seeded — run seed.sql'
      using errcode = 'P0001';
  end if;

  select not exists (select 1 from demand_planner.users where org_id = v_org_id)
    into v_is_first;

  insert into demand_planner.users (id, org_id, email, full_name, role, is_active)
  values (
    new.id,
    v_org_id,
    new.email,
    coalesce(new.raw_user_meta_data ->> 'full_name', ''),
    case when v_is_first then 'admin'::demand_planner.user_role else 'viewer'::demand_planner.user_role end,
    v_is_first  -- first user is active; everyone after is pending admin approval
  );

  return new;
end;
$$;
