-- ============================================================================
-- Oceanpick Demand Planner — Background recompute jobs
--
-- Recompute used to run inline in a server action, blocking the request and
-- risking a serverless timeout. It now runs as a background job: the API route
-- records a job here, returns immediately, and the UI polls this table.
--
-- Rows are written by the service role (which bypasses RLS); clients only read.
-- ============================================================================

create table if not exists demand_planner.recompute_jobs (
  id            uuid primary key default gen_random_uuid(),
  plan_id       uuid not null references demand_planner.plans (id) on delete cascade,
  org_id        uuid not null references demand_planner.organizations (id),
  requested_by  uuid references demand_planner.users (id),
  status        text not null default 'queued' check (status in ('queued', 'running', 'done', 'error')),
  error         text,
  ms            int,
  created_at    timestamptz not null default now(),
  finished_at   timestamptz
);

create index if not exists recompute_jobs_plan_idx
  on demand_planner.recompute_jobs (plan_id, created_at desc);

alter table demand_planner.recompute_jobs enable row level security;

-- Readable within the org (so the UI can poll progress). Writes: service role only.
drop policy if exists recompute_jobs_read on demand_planner.recompute_jobs;
create policy recompute_jobs_read on demand_planner.recompute_jobs for select
  using (org_id = demand_planner.current_org_id());

grant select on demand_planner.recompute_jobs to authenticated;
