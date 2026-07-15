-- ============================================================================
-- Oceanpick Demand Planner — Open signup (remove email-domain gate)
--
-- Supersedes the @oceanpick.com signup gate from 20260715000001.
--
-- DECISION: the tech team controls who can reach signup, so the hard
-- email-domain block is not needed. Single-org v1: every new user joins the
-- Oceanpick workspace regardless of email domain. First user in becomes admin;
-- everyone after defaults to viewer and must be promoted by that admin.
--
-- Note: auth.users is shared across all projects on this Supabase instance, so
-- with the block gone any email that completes signup here becomes an Oceanpick
-- viewer. That is intended. The seed guard below is kept so signup still fails
-- loudly (rather than silently) if the Oceanpick org row is missing.
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
  -- Single-org v1: attach every new user to the Oceanpick org. Domain is no
  -- longer consulted (was: organizations.allowed_email_domain lookup).
  select id into v_org_id
  from demand_planner.organizations
  where slug = 'oceanpick';

  if v_org_id is null then
    raise exception 'Signup blocked: Oceanpick organization is not seeded — run seed.sql'
      using errcode = 'P0001';
  end if;

  select not exists (select 1 from demand_planner.users where org_id = v_org_id)
    into v_is_first;

  insert into demand_planner.users (id, org_id, email, full_name, role)
  values (
    new.id,
    v_org_id,
    new.email,
    coalesce(new.raw_user_meta_data ->> 'full_name', ''),
    case when v_is_first then 'admin'::demand_planner.user_role else 'viewer'::demand_planner.user_role end
  );

  return new;
end;
$$;
