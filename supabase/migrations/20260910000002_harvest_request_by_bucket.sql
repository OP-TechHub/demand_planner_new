-- ============================================================================
-- Harvest Plan — Request Plan, broken down by size bucket
--
-- WHY
--   The request was one figure a month for the whole plan, sitting under a
--   capacity grid that is per bucket. Comparing the two therefore only worked
--   at the total line: the plant could say it wanted 12,500 kg in January, but
--   not that it wanted them at 800-1100g, which is the question capacity is
--   already answering. Same shape on both sides makes the comparison real.
--
-- THE EXISTING FIGURES ARE KEPT
--   A monthly total cannot be split across buckets by guessing, so the rows
--   already entered are left exactly as they are, with a null bucket. They mean
--   what they always meant — a request for the month, no size stated — and the
--   UI shows them on their own "No size stated" line above the total. Once the
--   plant restates a month by bucket and clears that line, it disappears. No
--   figure is rewritten and none is silently dropped.
--
-- STILL NOT AN ENGINE INPUT
--   Nothing in rank / allocate / rolling reads this table, so a write here
--   still never makes a plan stale. It remains the plant's stated requirement,
--   for planners to compare against capacity.
-- ============================================================================

set search_path = demand_planner, public;

alter table demand_planner.harvest_request
  add column if not exists bucket_id uuid references demand_planner.buckets (id);

comment on column demand_planner.harvest_request.bucket_id is
  'Size bucket this request is for. NULL is a pre-breakdown monthly total: a request with no size stated.';

-- The old rule was one row per month. It is now one row per month per bucket,
-- plus at most one sizeless row per month for what was entered before.
alter table demand_planner.harvest_request
  drop constraint if exists harvest_request_unique_per_month;

-- Two partial indexes rather than one constraint over the three columns: in a
-- unique constraint NULLs do not collide, so the sizeless rows would not be
-- constrained at all and a month could quietly acquire several of them.
create unique index if not exists harvest_request_bucket_unique
  on demand_planner.harvest_request (plan_id, month_index, bucket_id)
  where bucket_id is not null;

create unique index if not exists harvest_request_sizeless_unique
  on demand_planner.harvest_request (plan_id, month_index)
  where bucket_id is null;

drop index if exists demand_planner.harvest_request_plan_idx;
create index if not exists harvest_request_plan_idx
  on demand_planner.harvest_request (plan_id, month_index, bucket_id);

comment on table demand_planner.harvest_request is
  'Processing plant''s requested whole round per month and size bucket. Reference only — not an engine input.';

-- The read and write policies are unchanged and deliberately not touched: the
-- 'harvest_request' grant still gates the whole table, and adding a column does
-- not change who may state a request.

-- --- verify ----------------------------------------------------------------
do $verify$
declare
  n int;
begin
  if not exists (
    select 1 from information_schema.columns
     where table_schema = 'demand_planner'
       and table_name = 'harvest_request'
       and column_name = 'bucket_id'
  ) then
    raise exception 'harvest_request.bucket_id was not added';
  end if;

  if exists (
    select 1 from pg_constraint
     where conrelid = 'demand_planner.harvest_request'::regclass
       and conname = 'harvest_request_unique_per_month'
  ) then
    raise exception 'the old one-row-per-month constraint is still present';
  end if;

  select count(*) into n
    from pg_indexes
   where schemaname = 'demand_planner'
     and indexname in ('harvest_request_bucket_unique', 'harvest_request_sizeless_unique');
  if n <> 2 then
    raise exception 'expected both partial unique indexes, found %', n;
  end if;
end
$verify$;
