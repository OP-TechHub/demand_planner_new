-- ============================================================================
-- Oceanpick Demand Planner — Seed
--
-- Run ONCE after the initial migration, BEFORE anyone signs up.
-- Signup is gated on a matching organizations.allowed_email_domain row
-- existing (see handle_new_user()), so without this, every signup is rejected.
--
-- The first @oceanpick.com account to sign up becomes admin automatically.
-- ============================================================================

insert into demand_planner.organizations (name, slug, allowed_email_domain)
values ('Oceanpick', 'oceanpick', 'oceanpick.com')
on conflict (slug) do nothing;

-- ---------------------------------------------------------------------------
-- Size buckets, org-scoped and shared across all plans (data-model.md §3).
--
-- sort_order = bucket priority for the allocation cascade. Lower goes first.
-- Gaps of 10 are deliberate: they leave room to insert a new grade between
-- two existing ones without renumbering everything.
--
-- Read directly from the V30 workbook's Bucket Legend tab (rows 5-11), in
-- size order. If the team adds a grade to that tab, add it here too — the
-- app will not discover it on its own.
-- ---------------------------------------------------------------------------

insert into demand_planner.buckets (org_id, name, sort_order)
select o.id, b.name, b.sort_order
from demand_planner.organizations o,
     (values
        ('0-600g',     10),
        ('600-800g',   20),
        ('800-1100g',  30),
        ('1100-1500g', 40),
        ('1500-1800g', 50),
        ('1800-2200g', 60),
        ('2200-4000g', 70)
     ) as b(name, sort_order)
where o.slug = 'oceanpick'
on conflict (org_id, name) do nothing;

-- ---------------------------------------------------------------------------
-- The master plan.
--
-- Created without created_by, because no users exist yet at seed time.
-- plan_start_date = 2026-04-01 -> M1 = Apr 2026, M60 = Mar 2031, matching
-- both the workbook and the production model.
-- ---------------------------------------------------------------------------

insert into demand_planner.plans (
  org_id, type, name, description, plan_start_date, horizon_months,
  settings_margin_metric, settings_allocation_mode, settings_scope,
  settings_lookback_months
)
select
  o.id, 'master', 'Master Plan',
  'The controlled demand plan. Fork a scenario to run what-ifs.',
  date '2026-04-01', 60,
  'margin_wr', 'fill_what_you_can', 'active_pipeline', 2
from demand_planner.organizations o
where o.slug = 'oceanpick'
  and not exists (
    select 1 from demand_planner.plans p
    where p.org_id = o.id and p.type = 'master' and p.deleted_at is null
  );
