-- ============================================================================
-- Costing: SKU write access — "you own what you make"
--
-- WHY THIS IS A SEPARATE MIGRATION
-- The rule itself is also written into 20260824000001, but that file had
-- already been applied when the rule changed. An applied migration must never
-- be edited: the migration table records it as done, so the amendment never
-- reaches a database that already ran it. The symptom was
--   "new row violates row-level security policy for table cost_skus"
-- on any non-admin insert — the UI offered a button the database still refused.
--
-- This migration is the forward fix and is safe from EITHER state: a database
-- that has the original admin-only policy, or a fresh one that already picked
-- the new rules up from 20260824000001. Every policy is dropped-if-exists and
-- recreated, so running it is idempotent.
--
-- THE RULE (Costing_Module_Decisions.md §5)
--   read           — any active member of the org
--   insert         — any active member, as themselves
--   update/delete  — the row's creator, or an admin
--
-- Anyone may add a SKU: being unable to cost a product because it is not on an
-- admin-controlled list would contradict "anyone can do costing". But a recipe
-- other people's costings depend on must not be silently altered by someone
-- else, so editing stays with its author.
--
-- The seeded 34 workbook SKUs have created_by = null, so nobody owns them and
-- they remain admin-editable. That is deliberate — they are shared company
-- recipes, not one person's work.
-- ============================================================================

set search_path = demand_planner, public;

-- --- cost_skus -------------------------------------------------------------
-- The original blanket admin-only policy, plus any of the new ones that may
-- already exist, so the create statements below always land.
drop policy if exists cost_skus_write  on demand_planner.cost_skus;
drop policy if exists cost_skus_insert on demand_planner.cost_skus;
drop policy if exists cost_skus_update on demand_planner.cost_skus;
drop policy if exists cost_skus_delete on demand_planner.cost_skus;

create policy cost_skus_insert on demand_planner.cost_skus for insert
  with check (
    org_id = demand_planner.current_org_id()
    and demand_planner.can_read_costing()
    -- As yourself: this is what makes "own what you make" enforceable at all.
    and created_by = auth.uid()
  );

create policy cost_skus_update on demand_planner.cost_skus for update
  using      (org_id = demand_planner.current_org_id()
              and (created_by = auth.uid() or demand_planner.can_admin_costing()))
  with check (org_id = demand_planner.current_org_id()
              and (created_by = auth.uid() or demand_planner.can_admin_costing()));

create policy cost_skus_delete on demand_planner.cost_skus for delete
  using (org_id = demand_planner.current_org_id()
         and (created_by = auth.uid() or demand_planner.can_admin_costing()));

-- --- cost_sku_bucket_yields ------------------------------------------------
-- Yields follow their SKU's ownership: whoever may edit the recipe may set its
-- per-grade yields. Without this, a user could add a SKU and then be unable to
-- give it yields — including the placeholder rows the app seeds on create.
drop policy if exists cost_sku_bucket_yields_write on demand_planner.cost_sku_bucket_yields;

create policy cost_sku_bucket_yields_write on demand_planner.cost_sku_bucket_yields for all
  using      (exists (
    select 1 from demand_planner.cost_skus s
    where s.id = sku_id and s.org_id = demand_planner.current_org_id()
      and (s.created_by = auth.uid() or demand_planner.can_admin_costing())))
  with check (exists (
    select 1 from demand_planner.cost_skus s
    where s.id = sku_id and s.org_id = demand_planner.current_org_id()
      and (s.created_by = auth.uid() or demand_planner.can_admin_costing())));

-- --- verify ----------------------------------------------------------------
-- Fail loudly here rather than leaving the UI offering a button the database
-- refuses — that is the failure this migration exists to correct.
do $$
declare
  n int;
begin
  select count(*) into n
    from pg_policies
   where schemaname = 'demand_planner'
     and tablename = 'cost_skus'
     and policyname in ('cost_skus_read', 'cost_skus_insert', 'cost_skus_update', 'cost_skus_delete');
  if n <> 4 then
    raise exception 'expected 4 cost_skus policies (read/insert/update/delete), found %', n;
  end if;

  if exists (
    select 1 from pg_policies
     where schemaname = 'demand_planner' and tablename = 'cost_skus' and policyname = 'cost_skus_write'
  ) then
    raise exception 'the old admin-only cost_skus_write policy is still present';
  end if;
end $$;
