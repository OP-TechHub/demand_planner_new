-- ============================================================================
-- Assistant usage — one row per question answered by the in-app assistant
--
-- WHY A TABLE
--   The assistant bills per token. A cap that lives in server memory resets on
--   every deploy and is per instance, so it cannot hold a monthly budget. This
--   table is the ledger: the route adds a row after each question and refuses
--   the next one once the organisation's month is spent.
--
-- WHO WRITES
--   Only the service role (the route, after the answer streams). Users never
--   insert here — a client that could write its own usage could also write
--   none. Admins can read their organisation's rows for the usage page.
-- ============================================================================

set search_path = demand_planner, public;

create table if not exists demand_planner.chat_usage (
  id                 uuid primary key default gen_random_uuid(),
  org_id             uuid not null references demand_planner.organizations (id),
  user_id            uuid references demand_planner.users (id) on delete set null,
  model              text not null,
  input_tokens       int not null default 0,
  output_tokens      int not null default 0,
  cache_read_tokens  int not null default 0,
  cache_write_tokens int not null default 0,
  -- What this question cost at the model's list price, in US dollars.
  cost_usd           numeric(10, 6) not null default 0 check (cost_usd >= 0),
  tools              text[] not null default '{}',
  created_at         timestamptz not null default now()
);

comment on table demand_planner.chat_usage is
  'One row per assistant question: tokens used and their cost. Written by the service role only.';

-- The budget check asks "this org, this month" on every question.
create index if not exists chat_usage_org_month_idx
  on demand_planner.chat_usage (org_id, created_at desc);

alter table demand_planner.chat_usage enable row level security;

create policy chat_usage_admin_read on demand_planner.chat_usage for select
  using (org_id = demand_planner.current_org_id() and demand_planner.current_role_name() = 'admin');

grant select on demand_planner.chat_usage to authenticated;
grant all on demand_planner.chat_usage to service_role;
