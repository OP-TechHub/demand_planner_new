-- ============================================================================
-- Harvest Plan — Request Plan, by harvest day
--
-- WHY
--   The farm harvests on fixed weekdays (twice a week), and before each harvest
--   the processing plant tells the farm how much whole round it needs. A monthly
--   figure cannot carry that, so the plant now states its request per harvest
--   day. The monthly grid stays: a month with daily figures reads as their sum,
--   and a month without them keeps its monthly figure — far-out months the
--   plant has not scheduled yet are still stated monthly.
--
-- TWO WAYS TO STATE IT
--   harvest_request_settings.mode picks how a plan's daily request is entered:
--   'by_date' is one total per day (bucket_id null), 'by_date_size' one figure
--   per bucket per day. Switching mode rewrites nothing — figures entered the
--   other way stay, and the page shows them for what they are.
--
-- ABSOLUTE DATES
--   Unlike every other plan table this is keyed by calendar date, not
--   month_index, because a harvest day is a day. A date before the plan's start
--   or past its horizon is simply outside the window; rolling the plan forward
--   leaves the dates where they are.
--
-- SAME PERMISSION, STILL NOT AN ENGINE INPUT
--   Both tables sit under the existing 'harvest_request' grant, so whoever may
--   state the monthly request may state the daily one and pick its weekdays.
--   Nothing in rank / allocate / rolling reads either, so writing here never
--   makes a plan stale.
-- ============================================================================

set search_path = demand_planner, public;

-- --- settings ----------------------------------------------------------------
create table if not exists demand_planner.harvest_request_settings (
  plan_id          uuid primary key references demand_planner.plans (id) on delete cascade,
  mode             text  not null default 'by_date_size'
                   check (mode in ('by_date', 'by_date_size')),
  harvest_weekdays int[] not null default '{2,5}'
                   check (harvest_weekdays <@ array[1,2,3,4,5,6,7]),
  created_at       timestamptz not null default now(),
  updated_at       timestamptz not null default now(),
  created_by       uuid references demand_planner.users (id),
  updated_by       uuid references demand_planner.users (id)
);

comment on table demand_planner.harvest_request_settings is
  'How a plan''s daily harvest request is stated (by date, or by date and size) and which ISO weekdays (1 = Mon … 7 = Sun) the farm harvests on.';

drop trigger if exists harvest_request_settings_touch on demand_planner.harvest_request_settings;
create trigger harvest_request_settings_touch
  before update on demand_planner.harvest_request_settings
  for each row execute function demand_planner.touch_updated_at();

-- --- daily request -----------------------------------------------------------
create table if not exists demand_planner.harvest_request_daily (
  id             uuid primary key default gen_random_uuid(),
  plan_id        uuid not null references demand_planner.plans (id) on delete cascade,
  harvest_date   date not null,
  bucket_id      uuid references demand_planner.buckets (id),
  quantity_kg_wr numeric(18,4) not null default 0 check (quantity_kg_wr >= 0),
  created_at     timestamptz not null default now(),
  updated_at     timestamptz not null default now(),
  created_by     uuid references demand_planner.users (id),
  updated_by     uuid references demand_planner.users (id),

  -- NULLS NOT DISTINCT: a day holds at most one sizeless total, and the one
  -- constraint serves as the upsert target for both shapes of row.
  constraint harvest_request_daily_unique_cell unique nulls not distinct (plan_id, harvest_date, bucket_id)
);

comment on table demand_planner.harvest_request_daily is
  'Processing plant''s requested whole round per harvest day, per size bucket or (bucket_id null) as a day total. Reference only — not an engine input.';
comment on column demand_planner.harvest_request_daily.bucket_id is
  'Size bucket this request is for. NULL is the day''s total with no size stated (a plan in by_date mode).';

drop trigger if exists harvest_request_daily_touch on demand_planner.harvest_request_daily;
create trigger harvest_request_daily_touch
  before update on demand_planner.harvest_request_daily
  for each row execute function demand_planner.touch_updated_at();

-- --- access: the same rule as harvest_request, in the once-per-query shape ----
alter table demand_planner.harvest_request_settings enable row level security;
alter table demand_planner.harvest_request_daily enable row level security;

do $$
declare
  t text;
begin
  foreach t in array array['harvest_request_settings', 'harvest_request_daily'] loop
    execute format('drop policy if exists %1$s_read on demand_planner.%1$s', t);
    execute format(
      'create policy %1$s_read on demand_planner.%1$s for select
         using (plan_id in (select demand_planner.readable_plan_ids()))', t);
    execute format('drop policy if exists %1$s_write on demand_planner.%1$s', t);
    execute format(
      'create policy %1$s_write on demand_planner.%1$s for all
         using      (plan_id in (select demand_planner.writable_section_plan_ids(%2$L)))
         with check (plan_id in (select demand_planner.writable_section_plan_ids(%2$L)))',
      t, 'harvest_request');
  end loop;
end;
$$;

grant select, insert, update, delete on demand_planner.harvest_request_settings to authenticated;
grant select, insert, update, delete on demand_planner.harvest_request_daily to authenticated;

-- --- verify ----------------------------------------------------------------
do $verify$
declare
  n int;
begin
  select count(*) into n
    from pg_policies
   where schemaname = 'demand_planner'
     and tablename in ('harvest_request_settings', 'harvest_request_daily');
  if n <> 4 then
    raise exception 'expected read and write policies on both daily-request tables, found %', n;
  end if;

  if not exists (
    select 1 from pg_constraint
     where conrelid = 'demand_planner.harvest_request_daily'::regclass
       and conname = 'harvest_request_daily_unique_cell'
  ) then
    raise exception 'harvest_request_daily is missing its unique cell constraint';
  end if;
end
$verify$;
