-- ============================================================================
-- Demand Plan — approval for non-admin changes
--
-- WHAT CHANGES
--   On an official plan (anything that is not a private sandbox), a non-admin's
--   Demand Plan edit no longer writes to demand_plan. It becomes a pending
--   request holding the proposed cells. An approver accepts it, which writes the
--   cells and audits the change against the requester, or rejects it, which
--   discards it. Admins' own edits apply directly, as before.
--
-- WHO APPROVES
--   Admins, plus anyone an admin grants 'demand_approve' (users.edit_sections,
--   ticked under Admin → Users). Nobody approves their own request.
--
-- SCOPE
--   The Demand Plan tab's own saves: the single-program editor, grid paste and
--   delete, and CSV import. Sandboxes are untouched: a scenario's owner still
--   edits it freely.
--
-- WHO WRITES
--   The service role only, from server actions that check the caller first.
--   Requesters read their own rows; approvers and admins read the org's.
-- ============================================================================

set search_path = demand_planner, public;

create table if not exists demand_planner.demand_change_requests (
  id             uuid primary key default gen_random_uuid(),
  org_id         uuid not null references demand_planner.organizations (id),
  plan_id        uuid not null references demand_planner.plans (id) on delete cascade,
  requested_by   uuid not null references demand_planner.users (id),
  -- Where the edit came from: 'editor' | 'grid' | 'import' | 'reset'.
  source         text not null check (source in ('editor', 'grid', 'import', 'reset')),
  -- The proposed cells: [{program_id, month_index, demand_fp}], where a null
  -- demand_fp clears the override so the month falls back to the baseline.
  cells          jsonb not null,
  cell_count     int not null default 0,
  note           text,
  status         text not null default 'pending' check (status in ('pending', 'approved', 'rejected', 'withdrawn')),
  decided_by     uuid references demand_planner.users (id),
  decided_at     timestamptz,
  decision_note  text,
  created_at     timestamptz not null default now()
);

create index if not exists demand_change_requests_plan_status_idx
  on demand_planner.demand_change_requests (plan_id, status, created_at desc);

-- Is the caller allowed to approve demand changes? SECURITY DEFINER so the RLS
-- policy below can read users without recursing into its own policies.
create or replace function demand_planner.can_approve_demand()
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select demand_planner.current_role_name() = 'admin'
    or exists (
      select 1 from demand_planner.users u
      where u.id = auth.uid() and u.is_active and 'demand_approve' = any(u.edit_sections)
    );
$$;

grant execute on function demand_planner.can_approve_demand() to authenticated;

alter table demand_planner.demand_change_requests enable row level security;

drop policy if exists demand_change_requests_read on demand_planner.demand_change_requests;
create policy demand_change_requests_read on demand_planner.demand_change_requests for select
  using (
    org_id = demand_planner.current_org_id()
    and (requested_by = auth.uid() or demand_planner.can_approve_demand())
  );

-- Reads only for signed-in users; every write goes through the service role.
revoke insert, update, delete on demand_planner.demand_change_requests from authenticated;
grant select on demand_planner.demand_change_requests to authenticated;
grant all on demand_planner.demand_change_requests to service_role;
