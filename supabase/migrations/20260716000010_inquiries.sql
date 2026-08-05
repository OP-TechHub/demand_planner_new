-- ============================================================================
-- Inquiries register — one row per customer inquiry saved into a plan.
--
-- A saved inquiry already lands as pipeline demand; this table additionally
-- records it as a browsable event (who, when, customer/item, size) so the
-- Outputs → Inquiries tab can list and filter them. Rows are written by the
-- inquiry save action (service role); everyone who can read the plan can read
-- its inquiries.
-- ============================================================================

create table if not exists demand_planner.inquiries (
  id                 uuid primary key default gen_random_uuid(),
  org_id             uuid not null references demand_planner.organizations (id) on delete cascade,
  plan_id            uuid not null references demand_planner.plans (id) on delete cascade,
  created_by         uuid references demand_planner.users (id),
  created_at         timestamptz not null default now(),
  kind               text not null check (kind in ('existing', 'new')),
  customer           text not null default '',
  item_code          text not null default '',
  item_description   text not null default '',
  target_program_id  uuid,                       -- the pipeline program it landed on
  months             int not null default 0,     -- how many months got volume
  total_fp           numeric(18,4) not null default 0  -- total FP added across those months
);

create index if not exists inquiries_plan_idx on demand_planner.inquiries (plan_id, created_at desc);
create index if not exists inquiries_creator_idx on demand_planner.inquiries (created_by);

alter table demand_planner.inquiries enable row level security;

-- Readable by anyone who can read the plan (respects sandbox privacy).
drop policy if exists inquiries_read on demand_planner.inquiries;
create policy inquiries_read on demand_planner.inquiries for select
  using (demand_planner.can_read_plan(plan_id));

grant select on demand_planner.inquiries to authenticated;
grant all on demand_planner.inquiries to service_role;
