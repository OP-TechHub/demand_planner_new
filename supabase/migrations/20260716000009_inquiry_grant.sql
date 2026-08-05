-- ============================================================================
-- Add 'inquiry' as a per-plan grant.
--
-- 'inquiry' is the right to SAVE customer inquiries into a plan's pipeline —
-- separate from editing programs/demand directly, so someone can raise
-- inquiries without being able to change the base plan. It isn't a table; the
-- inquiry save action re-checks it in app code and writes via the service role.
-- ============================================================================

alter table demand_planner.plan_editor_grants
  drop constraint if exists plan_editor_grants_section_check;
alter table demand_planner.plan_editor_grants
  add constraint plan_editor_grants_section_check
  check (section in ('programs', 'demand_plan', 'harvest_plan', 'inquiry'));

-- Carry over existing ability: anyone who could already save inquiries (they had
-- BOTH programs and demand_plan on a plan) keeps it via a matching 'inquiry' grant.
insert into demand_planner.plan_editor_grants (plan_id, user_id, section)
select g.plan_id, g.user_id, 'inquiry'
from demand_planner.plan_editor_grants g
where g.section = 'programs'
  and exists (
    select 1 from demand_planner.plan_editor_grants d
    where d.plan_id = g.plan_id and d.user_id = g.user_id and d.section = 'demand_plan'
  )
on conflict do nothing;
