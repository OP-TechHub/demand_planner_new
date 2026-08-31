-- ============================================================================
-- Costing SKUs: per-SKU overrides for the downstream export chain
--
-- A SKU could already override the margins and the adders that build its own
-- FINAL cost and FOB. What it could NOT override was anything past FOB —
-- importer clearing, importer markup and distributor markup were read straight
-- off the assumption version for every SKU alike, so the CIF → importer → T3
-- ladder was the same shape whatever was being sold.
--
-- That is wrong in practice: clearing and trade markups are negotiated per
-- product and per channel. A retail pack moving through a distributor does not
-- carry the same markup as a foodservice line sold direct, and an importer's
-- clearing on a high-value fresh item is not the clearing on frozen trim.
--
-- Null keeps inheriting the version's value, exactly as before — including when
-- an admin changes it later. So every existing SKU is untouched, no stored
-- number moves, and the v11 parity suite is unaffected.
--
-- These are markups, not margins: unlike rack/FOB they are multiplied by rather
-- than divided into a price, so they are allowed to exceed 100% and carry no
-- upper bound. Matching the version-level columns they shadow.
-- ============================================================================

set search_path = demand_planner, public;

-- Written to be safe to re-run. An inline `check` on `add column` cannot be
-- guarded, and an unguarded `add column` aborts the whole migration the second
-- time it meets a column it already created — which is exactly what happens
-- when this is first applied by hand in the SQL editor, where nothing records
-- that it ran, and `supabase db push` then tries it again.
alter table demand_planner.cost_skus
  add column if not exists override_importer_clearing_pct  numeric(6,4),
  add column if not exists override_importer_markup_pct    numeric(6,4),
  add column if not exists override_distributor_markup_pct numeric(6,4);

-- Named so they can be guarded; the columns above carried these inline when
-- this migration was first written, so an early database may already have them
-- under the system-generated name. Adding them by name is still correct there:
-- a duplicate non-negativity check costs nothing and rejects nothing extra.
do $$
begin
  if not exists (
    select 1 from pg_constraint where conname = 'cost_skus_downstream_overrides_nonneg'
  ) then
    alter table demand_planner.cost_skus
      add constraint cost_skus_downstream_overrides_nonneg
      check (
        coalesce(override_importer_clearing_pct,  0) >= 0
        and coalesce(override_importer_markup_pct,    0) >= 0
        and coalesce(override_distributor_markup_pct, 0) >= 0
      );
  end if;
end $$;

comment on column demand_planner.cost_skus.override_importer_clearing_pct is
  'Null inherits cost_assumption_versions.importer_clearing_pct. Markup on CIF.';
comment on column demand_planner.cost_skus.override_importer_markup_pct is
  'Null inherits cost_assumption_versions.importer_markup_pct. Importer to distributor.';
comment on column demand_planner.cost_skus.override_distributor_markup_pct is
  'Null inherits cost_assumption_versions.distributor_markup_pct. Distributor to T3 / foodservice.';

-- New columns are invisible to PostgREST until it reloads its schema cache, and
-- until it does, writing one fails with "Could not find the column ... in the
-- schema cache" — which reads as if the column were missing.
notify pgrst, 'reload schema';
