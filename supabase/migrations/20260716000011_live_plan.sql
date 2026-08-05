-- ============================================================================
-- The "live plan" — the org's default working plan.
--
-- The app used to treat the master as the default everywhere. This adds an
-- is_live pointer (exactly one plan per org) so an admin can keep the master as
-- a frozen baseline and do all ongoing edits in a separate "Live plan" that the
-- Dashboard, API, and default plan resolution point at.
--
-- Backfilled to the master, so behaviour is unchanged until an admin designates
-- a different plan as live.
-- ============================================================================

alter table demand_planner.plans
  add column if not exists is_live boolean not null default false;

update demand_planner.plans
  set is_live = true
  where type = 'master' and deleted_at is null;

-- At most one live plan per org.
create unique index if not exists plans_one_live_per_org
  on demand_planner.plans (org_id) where is_live and deleted_at is null;
