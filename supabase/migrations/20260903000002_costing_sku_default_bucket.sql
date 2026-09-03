-- ============================================================================
-- Costing SKUs: remember the size grade this SKU is costed at
--
-- The companion to default_destination_id, and the same complaint: the SKU
-- editor's "Cost at" picker was preview-only state, so reopening a SKU always
-- came back on the flat reference model however it was last costed.
--
-- Unlike the port, the grade moves the cost itself — it selects the FCR and the
-- per-grade yield — so a SKU that is only ever grown to one size band was being
-- re-read at a size it is never sold at. That is a property of the product, not
-- a view setting.
--
-- Nullable, and null IS the reference model: exactly the behaviour every SKU
-- has today, so no existing SKU changes and no costed number moves. ON DELETE
-- SET NULL returns a SKU to the reference model if its grade is removed, rather
-- than deleting the recipe.
-- ============================================================================

set search_path = demand_planner, public;

alter table demand_planner.cost_skus
  add column default_bucket_id uuid
    references demand_planner.cost_size_buckets (id) on delete set null;

comment on column demand_planner.cost_skus.default_bucket_id is
  'Size grade this SKU is normally costed at — selects the FCR and per-grade yield. Null is the flat reference model.';

create index cost_skus_default_bucket_idx
  on demand_planner.cost_skus (default_bucket_id)
  where default_bucket_id is not null;

-- New columns are invisible to PostgREST until it reloads its schema cache, and
-- until it does, writing one fails with "Could not find the 'default_bucket_id'
-- column ... in the schema cache" — which reads as if the column were missing.
notify pgrst, 'reload schema';
