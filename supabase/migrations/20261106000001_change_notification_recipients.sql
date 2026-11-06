-- ============================================================================
-- Change notifications — per-user recipients, per input tab
--
-- WHAT CHANGES
--   Until now the only change email was the Harvest Plan digest, sent to every
--   active user when an official plan was recalculated. Each user now carries a
--   list of the input tabs they want to hear about, and an admin sets it under
--   Admin → Users. Only users with a tab in their list are emailed about it.
--
-- DEFAULT KEEPS TODAY'S BEHAVIOUR
--   The column defaults to '{harvest_plan}', for existing rows and for anyone
--   who registers later, so the Harvest Plan email still reaches everyone until
--   an admin unticks them. The other tabs reach nobody until ticked.
--
-- WHEN EACH TAB IS REPORTED
--   Programs, Demand Plan, Harvest Plan and PO Update feed the engine, so their
--   changes are reported when the plan is recalculated (as before). Harvest
--   Request and Actual Harvest never make a plan stale, so waiting for a
--   recalculation could mean never; they are reported as soon as a save lands.
--
-- THE LEDGER
--   change_notifications records, per plan and tab, the latest audit entry a
--   digest has covered. The next digest starts after it, so a change is
--   reported at most once however it was triggered. Written by the service
--   role only; admins can read it.
-- ============================================================================

set search_path = demand_planner, public;

alter table demand_planner.users
  add column if not exists notify_sections text[] not null default '{harvest_plan}';

comment on column demand_planner.users.notify_sections is
  'Input tabs whose change digests this user is emailed about. Values from NOTIFY_SECTIONS in the app.';

create table if not exists demand_planner.change_notifications (
  id          uuid primary key default gen_random_uuid(),
  plan_id     uuid not null references demand_planner.plans (id) on delete cascade,
  section     text not null,
  -- "trigger" is a reserved word; this is what prompted the digest.
  reason      text not null check (reason in ('recompute', 'save')),
  -- The latest audit_log.at this digest covered; the next one starts after it.
  through_at  timestamptz not null,
  changes     int not null default 0,
  recipients  int not null default 0,
  created_at  timestamptz not null default now()
);

comment on table demand_planner.change_notifications is
  'One row per change digest sent (or skipped for want of recipients): which plan and tab, and how far the audit log was covered.';

create index if not exists change_notifications_plan_section_idx
  on demand_planner.change_notifications (plan_id, section, created_at desc);

alter table demand_planner.change_notifications enable row level security;

drop policy if exists change_notifications_admin_read on demand_planner.change_notifications;
create policy change_notifications_admin_read on demand_planner.change_notifications for select
  using (
    demand_planner.current_role_name() = 'admin'
    and exists (
      select 1 from demand_planner.plans p
      where p.id = plan_id and p.org_id = demand_planner.current_org_id()
    )
  );

grant select on demand_planner.change_notifications to authenticated;
grant all on demand_planner.change_notifications to service_role;
