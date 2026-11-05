-- ============================================================================
-- Actual Harvest — its own size buckets, and a "No size stated" line
--
-- WHY
--   Actual harvest was recorded against the org's planning buckets, so adding
--   a size from the Actual Harvest section added it to the capacity grid, the
--   request plan and the engine's bucket list too. What the farm lands is
--   graded however the farm grades it, which need not match the planning
--   sizes. So actuals get a bucket list of their own, and a size added there
--   stays there.
--
-- NOTHING MOVES
--   The new list is seeded with a copy of every existing bucket under the SAME
--   id, so every harvest_actual row already recorded points at its copy without
--   being rewritten. From here on the two lists are independent: renaming,
--   adding or archiving on one never touches the other.
--
-- ORG-WIDE, LIKE BUCKETS
--   Not per plan: clone, snapshot, roll and restore copy harvest_actual.bucket_id
--   as it is, which only stays valid if the bucket outlives any one plan.
--   Writable only by whoever may record actuals ('harvest_actual' grant on a
--   plan) and admins. The Buckets permission does NOT confer it: that is the
--   planning list, and this one belongs to the farm.
--
-- NO SIZE STATED
--   bucket_id becomes nullable: a NULL row is a month's landed total that the
--   farm did not break down by size. The unique cell becomes NULLS NOT DISTINCT
--   so a month still holds at most one such row, and the same constraint stays
--   the upsert target.
--
-- Still reference only — nothing in rank / allocate / rolling reads either table.
-- ============================================================================

set search_path = demand_planner, public;

create table if not exists demand_planner.harvest_actual_buckets (
  id          uuid primary key default gen_random_uuid(),
  org_id      uuid not null references demand_planner.organizations (id) on delete cascade,
  name        text not null,
  sort_order  int  not null default 0,
  is_archived boolean not null default false,
  created_at  timestamptz not null default now(),
  updated_at  timestamptz not null default now(),
  created_by  uuid references demand_planner.users (id),
  updated_by  uuid references demand_planner.users (id),

  constraint harvest_actual_buckets_unique_name unique (org_id, name)
);

comment on table demand_planner.harvest_actual_buckets is
  'Size buckets for recording actual harvest. Independent of the planning buckets; seeded from them once under the same ids.';

create index if not exists harvest_actual_buckets_org_sort_idx
  on demand_planner.harvest_actual_buckets (org_id, sort_order);

drop trigger if exists harvest_actual_buckets_touch on demand_planner.harvest_actual_buckets;
create trigger harvest_actual_buckets_touch
  before update on demand_planner.harvest_actual_buckets
  for each row execute function demand_planner.touch_updated_at();

-- Seed: one copy of every planning bucket, same id, so existing actuals hold.
insert into demand_planner.harvest_actual_buckets (id, org_id, name, sort_order, is_archived, created_by, updated_by)
select b.id, b.org_id, b.name, b.sort_order, b.is_archived, b.created_by, b.updated_by
from demand_planner.buckets b
on conflict (id) do nothing;

-- Repoint harvest_actual at the new list, and let it carry no size.
alter table demand_planner.harvest_actual
  drop constraint if exists harvest_actual_bucket_id_fkey;
alter table demand_planner.harvest_actual
  add constraint harvest_actual_bucket_id_fkey
  foreign key (bucket_id) references demand_planner.harvest_actual_buckets (id);
alter table demand_planner.harvest_actual
  alter column bucket_id drop not null;

alter table demand_planner.harvest_actual
  drop constraint if exists harvest_actual_unique_cell;
alter table demand_planner.harvest_actual
  add constraint harvest_actual_unique_cell unique nulls not distinct (plan_id, bucket_id, month_index);

comment on column demand_planner.harvest_actual.bucket_id is
  'Actual-harvest size bucket (harvest_actual_buckets). NULL is a month''s landed total with no size stated.';

-- --- access ------------------------------------------------------------------
alter table demand_planner.harvest_actual_buckets enable row level security;

drop policy if exists harvest_actual_buckets_read on demand_planner.harvest_actual_buckets;
create policy harvest_actual_buckets_read on demand_planner.harvest_actual_buckets for select
  using (org_id = (select demand_planner.current_org_id()));

drop policy if exists harvest_actual_buckets_write on demand_planner.harvest_actual_buckets;
create policy harvest_actual_buckets_write on demand_planner.harvest_actual_buckets for all
  using (
    org_id = (select demand_planner.current_org_id())
    and (
      (select demand_planner.current_role_name()) = 'admin'
      or exists (
        select 1 from demand_planner.plan_editor_grants g
        where g.user_id = (select auth.uid()) and g.section = 'harvest_actual'
      )
    )
  )
  with check (
    org_id = (select demand_planner.current_org_id())
    and (
      (select demand_planner.current_role_name()) = 'admin'
      or exists (
        select 1 from demand_planner.plan_editor_grants g
        where g.user_id = (select auth.uid()) and g.section = 'harvest_actual'
      )
    )
  );

grant select, insert, update, delete on demand_planner.harvest_actual_buckets to authenticated;

-- --- verify ----------------------------------------------------------------
do $verify$
begin
  if exists (
    select 1 from demand_planner.harvest_actual a
    where a.bucket_id is not null
      and not exists (select 1 from demand_planner.harvest_actual_buckets ab where ab.id = a.bucket_id)
  ) then
    raise exception 'an actual harvest row points at no actual-harvest bucket';
  end if;

  if (select is_nullable from information_schema.columns
       where table_schema = 'demand_planner' and table_name = 'harvest_actual' and column_name = 'bucket_id') <> 'YES' then
    raise exception 'harvest_actual.bucket_id is still NOT NULL';
  end if;
end
$verify$;
