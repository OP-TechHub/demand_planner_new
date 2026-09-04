-- ============================================================================
-- Saved costings: private by choice, mine vs everyone's
-- ============================================================================
-- Everyone's costings landed in one undivided list, so finding your own meant
-- reading past everybody else's, and a half-finished draft was on show from the
-- moment it was saved. Visibility fixes the second problem; the owner column
-- that was always there fixes the first, once the UI groups by it.
--
-- Default is 'public' — that is what every existing row already was in effect,
-- and flipping the org's history to private overnight would hide work people
-- rely on seeing. You opt a costing out; you do not opt the rest in.

create type demand_planner.cost_visibility as enum ('public', 'private');

alter table demand_planner.cost_costings
  add column visibility demand_planner.cost_visibility not null default 'public';

comment on column demand_planner.cost_costings.visibility is
  'public: anyone who can read costings sees it. private: only the creator, plus admins.';

-- The Saved costings page now asks "mine, not deleted" as its first question.
create index cost_costings_owner_idx
  on demand_planner.cost_costings (org_id, created_by, deleted_at);

-- ---------------------------------------------------------------------------
-- Read policies
-- ---------------------------------------------------------------------------
-- Admins keep seeing everything, deliberately: they already override ownership
-- on delete and restore, and a private costing that nobody can reach after its
-- author leaves the company is a costing lost, not a costing protected.
--
-- The same predicate is repeated on the two child tables rather than left to
-- cascade through the parent's policy. Postgres does apply a referenced table's
-- RLS inside a policy subquery, so it would in fact cascade — but the lines are
-- the actual costed numbers, and a privacy rule that holds only by a chain of
-- inference is one refactor away from silently not holding.

drop policy cost_costings_read on demand_planner.cost_costings;
create policy cost_costings_read on demand_planner.cost_costings for select
  using (
    org_id = demand_planner.current_org_id()
    and demand_planner.can_read_costing()
    and deleted_at is null
    and (
      visibility = 'public'
      or created_by = auth.uid()
      or demand_planner.can_admin_costing()
    )
  );

drop policy cost_costing_lines_read on demand_planner.cost_costing_lines;
create policy cost_costing_lines_read on demand_planner.cost_costing_lines for select
  using (exists (
    select 1 from demand_planner.cost_costings c
    where c.id = costing_id
      and c.org_id = demand_planner.current_org_id()
      and c.deleted_at is null
      and (
        c.visibility = 'public'
        or c.created_by = auth.uid()
        or demand_planner.can_admin_costing()
      )
  ) and demand_planner.can_read_costing());

drop policy cost_costing_destinations_read on demand_planner.cost_costing_destinations;
create policy cost_costing_destinations_read on demand_planner.cost_costing_destinations for select
  using (exists (
    select 1 from demand_planner.cost_costings c
    where c.id = costing_id
      and c.org_id = demand_planner.current_org_id()
      and c.deleted_at is null
      and (
        c.visibility = 'public'
        or c.created_by = auth.uid()
        or demand_planner.can_admin_costing()
      )
  ) and demand_planner.can_read_costing());

-- The write policies are unchanged: they were already creator-or-admin, which
-- is exactly what flipping visibility should require.
