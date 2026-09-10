-- ============================================================================
-- Costing: repair the write policies on a costing and its children
--
-- THE SYMPTOM
--   Deleting a saved costing failed with
--     new row violates row-level security policy for table "cost_costings"
--   for the costing's own author, on a button the UI offered them.
--
-- THE CAUSE
--   Deleting a costing is a SOFT delete: the app updates the row to stamp
--   deleted_at and nothing is erased, so the bin stays recoverable. An UPDATE
--   under RLS checks USING against the OLD row and WITH CHECK against the NEW
--   one. The old row passed, or the statement would have matched nothing and
--   reported no error at all -- so the refusal can only have come from a
--   WITH CHECK that the stamped row fails. The one column that moved is
--   deleted_at, which makes a "deleted_at is null" term in the write policy the
--   cause. That test belongs on the READ policy, where 20260904000001 put it:
--   a deleted costing should be invisible, not undeletable.
--
--   No such term exists in this repository's write policies, in 20260824000001
--   or since. So the deployed database has drifted from the migrations. That is
--   a known hazard here -- this project has no linked Supabase CLI, so
--   migrations are applied by hand, and 20260824000004 exists for the same
--   class of failure on cost_skus.
--
-- SAFE FROM EITHER STATE
--   Every policy is dropped-if-exists and recreated, including the legacy
--   _write FOR ALL names these tables may still carry, so this migration is
--   idempotent and lands whether the database holds the drifted policies or the
--   ones the repository already describes.
--
-- THE RULE IS UNCHANGED (Costing_Module_Decisions.md section 5)
--   insert         -- any active member of the org, as themselves
--   update/delete  -- the costing's creator, or an admin
--   children       -- follow the parent costing
--
--   Read stays where 20260904000001 left it and is deliberately not touched
--   here: visibility is that migration's subject, and a costing's privacy must
--   not change as a side effect of fixing its delete button.
-- ============================================================================

set search_path = demand_planner, public;

-- --- cost_costings ---------------------------------------------------------
drop policy if exists cost_costings_write  on demand_planner.cost_costings;
drop policy if exists cost_costings_insert on demand_planner.cost_costings;
drop policy if exists cost_costings_update on demand_planner.cost_costings;
drop policy if exists cost_costings_delete on demand_planner.cost_costings;

create policy cost_costings_insert on demand_planner.cost_costings for insert
  with check (
    org_id = demand_planner.current_org_id()
    and demand_planner.can_read_costing()
    -- As yourself. This is what makes "only the owner may edit" enforceable,
    -- and what stops a costing being saved under someone else's name.
    and created_by = auth.uid()
  );

-- No deleted_at term on either side, deliberately. The USING clause has to let
-- an owner reach their live costing; the WITH CHECK has to let the row they
-- wrote keep whatever deleted_at they just stamped on it. What the two clauses
-- do police is the pair of columns that decide ownership, so neither an org
-- move nor a reassignment of authorship can ride in on an ordinary edit.
create policy cost_costings_update on demand_planner.cost_costings for update
  using      (org_id = demand_planner.current_org_id()
              and (created_by = auth.uid() or demand_planner.can_admin_costing()))
  with check (org_id = demand_planner.current_org_id()
              and (created_by = auth.uid() or demand_planner.can_admin_costing()));

-- Hard delete stays with the same people. The app only soft-deletes, but
-- saveCosting rolls back a costing whose every line failed to cost, and that
-- rollback is a real DELETE.
create policy cost_costings_delete on demand_planner.cost_costings for delete
  using (org_id = demand_planner.current_org_id()
         and (created_by = auth.uid() or demand_planner.can_admin_costing()));

-- --- children: follow the parent costing -----------------------------------
-- Recreated for the same reason, and because they are what the Products dialog
-- on a saved costing writes to: adding a product inserts lines, removing one
-- deletes them. A parent whose policies drifted is no evidence that the
-- children's did not.
drop policy if exists cost_costing_destinations_write on demand_planner.cost_costing_destinations;

create policy cost_costing_destinations_write on demand_planner.cost_costing_destinations for all
  using      (exists (select 1 from demand_planner.cost_costings c
              where c.id = costing_id and c.org_id = demand_planner.current_org_id()
                and (c.created_by = auth.uid() or demand_planner.can_admin_costing())))
  with check (exists (select 1 from demand_planner.cost_costings c
              where c.id = costing_id and c.org_id = demand_planner.current_org_id()
                and (c.created_by = auth.uid() or demand_planner.can_admin_costing())));

drop policy if exists cost_costing_lines_write on demand_planner.cost_costing_lines;

create policy cost_costing_lines_write on demand_planner.cost_costing_lines for all
  using      (exists (select 1 from demand_planner.cost_costings c
              where c.id = costing_id and c.org_id = demand_planner.current_org_id()
                and (c.created_by = auth.uid() or demand_planner.can_admin_costing())))
  with check (exists (select 1 from demand_planner.cost_costings c
              where c.id = costing_id and c.org_id = demand_planner.current_org_id()
                and (c.created_by = auth.uid() or demand_planner.can_admin_costing())));

-- --- verify ----------------------------------------------------------------
-- Fail here rather than leave the UI offering a button the database refuses.
-- That is the failure this migration exists to correct, and the last check is
-- the one that matters most: it asserts the cause is gone, not merely that some
-- policy now exists.
do $verify$
declare
  n int;
  bad text;
begin
  select count(*) into n
    from pg_policies
   where schemaname = 'demand_planner'
     and tablename = 'cost_costings'
     and policyname in ('cost_costings_read', 'cost_costings_insert',
                        'cost_costings_update', 'cost_costings_delete');
  if n <> 4 then
    raise exception 'expected 4 cost_costings policies (read/insert/update/delete), found %', n;
  end if;

  if exists (
    select 1 from pg_policies
     where schemaname = 'demand_planner' and tablename = 'cost_costings'
       and policyname = 'cost_costings_write'
  ) then
    raise exception 'the legacy cost_costings_write FOR ALL policy is still present';
  end if;

  -- The soft delete stamps deleted_at, so any write policy that tests it will
  -- refuse the delete. Read policies may and should test it; write policies
  -- must not.
  select policyname into bad
    from pg_policies
   where schemaname = 'demand_planner'
     and tablename in ('cost_costings', 'cost_costing_lines', 'cost_costing_destinations')
     and cmd in ('UPDATE', 'INSERT', 'ALL')
     and coalesce(with_check, '') like '%deleted_at%'
   limit 1;
  if bad is not null then
    raise exception
      'write policy % still tests deleted_at -- soft-deleting a costing will be refused', bad;
  end if;
end
$verify$;
