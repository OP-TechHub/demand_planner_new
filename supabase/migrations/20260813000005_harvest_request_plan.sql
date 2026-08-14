-- Harvest Plan — Request Plan.
--
-- The processing plant's monthly request: how much whole round it wants landed
-- each month, alongside (and independent of) the harvest capacity the planners
-- maintain. One figure per month for the whole plan — not per bucket.
--
-- It is NOT an engine input. Nothing in rank / allocate / rolling reads it, so
-- writing here never changes a computed result and never makes a plan stale.
-- It sits beside the harvest plan as the plant's stated requirement, for
-- planners to compare against.
--
-- SEPARATE PERMISSION. 'harvest_request' is its own grantable section, so the
-- processing plant can be given this and nothing else. Deliberately NOT seeded
-- from existing 'harvest_plan' grants: the whole point is that editing capacity
-- and stating a request are different jobs held by different people. Admins get
-- it automatically via can_write_section.

alter table demand_planner.plan_editor_grants
  drop constraint if exists plan_editor_grants_section_check;
alter table demand_planner.plan_editor_grants
  add constraint plan_editor_grants_section_check
  check (section in ('programs', 'demand_plan', 'harvest_plan', 'inquiry', 'harvest_request'));

create table if not exists demand_planner.harvest_request (
  id            uuid primary key default gen_random_uuid(),
  plan_id       uuid not null references demand_planner.plans (id) on delete cascade,
  month_index   int  not null check (month_index between 1 and 60),
  quantity_kg_wr numeric(18,4) not null default 0 check (quantity_kg_wr >= 0),
  created_at    timestamptz not null default now(),
  updated_at    timestamptz not null default now(),
  created_by    uuid references demand_planner.users (id),
  updated_by    uuid references demand_planner.users (id),

  constraint harvest_request_unique_per_month unique (plan_id, month_index)
);

create index if not exists harvest_request_plan_idx
  on demand_planner.harvest_request (plan_id, month_index);

create trigger harvest_request_touch
  before update on demand_planner.harvest_request
  for each row execute function demand_planner.touch_updated_at();

alter table demand_planner.harvest_request enable row level security;

-- Readable by anyone who can read the plan; written only with the
-- 'harvest_request' grant (or by an admin), and never on a locked plan.
drop policy if exists harvest_request_read on demand_planner.harvest_request;
create policy harvest_request_read on demand_planner.harvest_request for select
  using (demand_planner.can_read_plan(plan_id));

drop policy if exists harvest_request_write on demand_planner.harvest_request;
create policy harvest_request_write on demand_planner.harvest_request for all
  using (demand_planner.can_write_section(plan_id, 'harvest_request'))
  with check (demand_planner.can_write_section(plan_id, 'harvest_request'));

grant select, insert, update, delete on demand_planner.harvest_request to authenticated;

comment on table demand_planner.harvest_request is
  'Processing plant''s requested whole round per month. Reference only — not an engine input.';
