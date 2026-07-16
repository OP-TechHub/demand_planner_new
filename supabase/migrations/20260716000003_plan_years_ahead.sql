-- ============================================================================
-- Oceanpick Demand Planner — Admin setting: how many financial years ahead the
-- "New Plan" dialog offers. Stored on the master plan, edited in Plan Settings.
-- ============================================================================

alter table demand_planner.plans
  add column if not exists settings_plan_years_ahead int not null default 10;

alter table demand_planner.plans
  drop constraint if exists plans_years_ahead_range;
alter table demand_planner.plans
  add constraint plans_years_ahead_range check (settings_plan_years_ahead between 1 and 30);
