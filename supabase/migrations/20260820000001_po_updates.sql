-- PO Update — customer purchase orders as they are received.
--
-- A PO is a firm order. When one arrives for a program and month, that month's
-- demand is no longer a forecast, so the Demand Plan figure becomes the SUM of
-- the POs received for it:
--
--   demand_plan.demand_fp[program, month] = Σ po_updates.quantity_fp[program, month]
--
-- Storage is one row per (program, month) LINE. A PO covering Apr–Jun is three
-- lines sharing one `po_ref`; the UI groups them back together. That keeps the
-- per-month sum a plain group-by and lets a single month of a multi-month PO be
-- corrected on its own.
--
-- Two different POs CAN name the same program-month — that is the whole point of
-- summing — so the unique key includes `po_ref`. What it forbids is the same PO
-- landing on the same month twice.
--
-- NOT a separate engine input. The engine keeps reading demand_plan and knows
-- nothing about POs; this table drives that one derived write. That also means
-- recording a PO marks the plan stale exactly like any other demand edit.
--
-- PERMISSION: deliberately NOT its own grantable section. Recording a PO rewrites
-- the demand plan, so it is gated on the 'demand_plan' grant — anyone who may
-- record a PO may already change demand by definition, and a second grant that
-- silently conferred demand-plan write would be a hole, not a feature.

create table if not exists demand_planner.po_updates (
  id           uuid primary key default gen_random_uuid(),
  plan_id      uuid not null references demand_planner.plans (id) on delete cascade,
  program_id   uuid not null references demand_planner.programs (id) on delete cascade,
  month_index  int  not null check (month_index between 1 and 60),
  quantity_fp  numeric(18,4) not null default 0 check (quantity_fp >= 0),
  -- Customer's PO number. Groups the lines of one multi-month PO back together.
  po_ref       text not null check (length(trim(po_ref)) > 0),
  received_on  date,
  notes        text,
  created_at   timestamptz not null default now(),
  updated_at   timestamptz not null default now(),
  created_by   uuid references demand_planner.users (id),
  updated_by   uuid references demand_planner.users (id),

  constraint po_updates_line_unique unique (program_id, month_index, po_ref)
);

create index if not exists po_updates_plan_idx on demand_planner.po_updates (plan_id, month_index);
create index if not exists po_updates_ref_idx  on demand_planner.po_updates (plan_id, po_ref);

create trigger po_updates_touch
  before update on demand_planner.po_updates
  for each row execute function demand_planner.touch_updated_at();

-- What the month's demand was before any PO claimed it.
--
-- Without this, deleting the last PO for a month would have to guess: reverting
-- to programs.max_monthly_demand_fp would silently destroy a forecast a planner
-- had typed in the Demand Plan. So the first PO to touch a program-month records
-- what it displaced, and the last one to leave puts it back.
--
--   prev_demand_fp = null  ->  there was no override; the month fell back to the
--                              program baseline, and should again.
create table if not exists demand_planner.po_demand_baseline (
  id             uuid primary key default gen_random_uuid(),
  plan_id        uuid not null references demand_planner.plans (id) on delete cascade,
  program_id     uuid not null references demand_planner.programs (id) on delete cascade,
  month_index    int  not null check (month_index between 1 and 60),
  prev_demand_fp numeric(18,4),
  created_at     timestamptz not null default now(),

  constraint po_demand_baseline_unique unique (program_id, month_index)
);

create index if not exists po_demand_baseline_plan_idx
  on demand_planner.po_demand_baseline (plan_id, month_index);

alter table demand_planner.po_updates         enable row level security;
alter table demand_planner.po_demand_baseline enable row level security;

-- Readable by anyone who can read the plan; written by anyone who may edit its
-- demand, and never on a locked plan (can_write_section enforces both).
drop policy if exists po_updates_read on demand_planner.po_updates;
create policy po_updates_read on demand_planner.po_updates for select
  using (demand_planner.can_read_plan(plan_id));

drop policy if exists po_updates_write on demand_planner.po_updates;
create policy po_updates_write on demand_planner.po_updates for all
  using (demand_planner.can_write_section(plan_id, 'demand_plan'))
  with check (demand_planner.can_write_section(plan_id, 'demand_plan'));

drop policy if exists po_demand_baseline_read on demand_planner.po_demand_baseline;
create policy po_demand_baseline_read on demand_planner.po_demand_baseline for select
  using (demand_planner.can_read_plan(plan_id));

drop policy if exists po_demand_baseline_write on demand_planner.po_demand_baseline;
create policy po_demand_baseline_write on demand_planner.po_demand_baseline for all
  using (demand_planner.can_write_section(plan_id, 'demand_plan'))
  with check (demand_planner.can_write_section(plan_id, 'demand_plan'));

grant select, insert, update, delete on demand_planner.po_updates         to authenticated;
grant select, insert, update, delete on demand_planner.po_demand_baseline to authenticated;

comment on table demand_planner.po_updates is
  'Received customer POs, one row per program-month line. Their per-month sum becomes demand_plan.demand_fp.';
comment on table demand_planner.po_demand_baseline is
  'The demand a program-month held before its first PO, so removing the last PO restores it.';
