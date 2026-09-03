-- ============================================================================
-- Costing SKUs: remember the port this SKU is quoted to
--
-- The SKU editor has an "Export to" picker. It was preview-only state: nothing
-- above FOB depends on the port, so the port was treated as a lens rather than
-- a property of the SKU. The consequence was that reopening a SKU showed
-- whichever destination happened to sort first, not the one that was picked —
-- which reads as the app silently changing the country.
--
-- It also stopped being only a lens. The port sets the freight that turns FOB
-- into CIF, and a CIF price is now quotable straight from this editor, so "the
-- port this SKU is normally sold to" is a real fact about the SKU and belongs
-- with it.
--
-- Nullable, and null keeps exactly the old behaviour (fall back to the first
-- active destination), so no existing SKU changes and no costed number moves.
-- ON DELETE SET NULL rather than cascade: retiring a port must not delete the
-- product recipes that were quoted to it.
-- ============================================================================

set search_path = demand_planner, public;

alter table demand_planner.cost_skus
  add column default_destination_id uuid
    references demand_planner.cost_destinations (id) on delete set null;

comment on column demand_planner.cost_skus.default_destination_id is
  'Port this SKU is normally quoted to — sets the freight behind CIF. Null falls back to the first active destination.';

create index cost_skus_default_destination_idx
  on demand_planner.cost_skus (default_destination_id)
  where default_destination_id is not null;

-- New columns are invisible to PostgREST until it reloads its schema cache, and
-- until it does, writing one fails with "Could not find the
-- 'default_destination_id' column ... in the schema cache" — which reads as if
-- the column were missing.
notify pgrst, 'reload schema';
