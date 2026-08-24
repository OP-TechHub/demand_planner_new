-- ============================================================================
-- Costing: correct the export inland transport rate
--
-- WHY
-- v11 prices the onward haulage out of the factory twice, differently:
--   domestic "Transport"        60 LKR/kg  = $0.1765 at FX 340
--   export   "Freight to port"  $0.10/kg
-- It is the same lorry. Factory → Colombo port is the same movement as
-- factory → domestic customer, so the export figure was a placeholder that was
-- never revisited, not a deliberate difference. Confirmed with the business:
-- one cost, priced too low on the export side.
--
-- (The farm → factory leg is separate and already shared by both markets as the
-- "transport - trinco/colombo" ODC component, 19 LKR/kg. It is untouched here —
-- raising freight-to-port covers the factory-onward leg only, so nothing is
-- counted twice.)
--
-- HOW
-- A DATA change, not an engine change. The engine already reads this figure per
-- market with a per-SKU override; only the number was wrong. That matters
-- because it means the v11 parity suite still passes untouched — parity locks
-- the engine to the workbook's arithmetic, not to the workbook's placeholders.
--
-- Published as a NEW version rather than an update in place: costings already
-- saved pinned v1 and must keep showing what was quoted
-- (costing_module/Costing_Module_Decisions.md §4). Anyone reopening an older
-- costing sees its original numbers, with "reprice at current assumptions"
-- showing this correction as a delta.
--
-- IMPACT, on skin-on fillet to Dubai:
--   FINAL   $7.1105 → $7.2870
--   FOB    $11.8508 → $12.1449
--   T3     $16.3385 → $16.7291   (+2.4% on the landed price)
--
-- The rate is derived from the domestic haulage figure rather than typed, so if
-- the real per-kg rate differs, set it on the Assumptions page — that publishes
-- a further version and leaves this one readable.
-- ============================================================================

set search_path = demand_planner, public;

do $$
declare
  src        demand_planner.cost_assumption_versions;
  new_id     uuid;
  corrected  numeric(18,4);
begin
  select v.* into src
  from demand_planner.cost_assumption_versions v
  join demand_planner.organizations o on o.id = v.org_id
  where o.slug = 'oceanpick' and v.is_current
  limit 1;

  if src.id is null then
    raise notice 'No current costing assumption version — nothing to correct. Run the costing seed first.';
    return;
  end if;

  corrected := round(src.domestic_transport_lkr / src.fx_rate, 4);

  -- Idempotent: re-running must not mint a pointless version, and must never
  -- pull the rate BACK DOWN if someone has since entered a real, higher figure.
  if src.export_freight_to_port_usd >= corrected then
    raise notice 'Export freight-to-port (%) already at or above the domestic haulage rate (%) — skipping.',
      src.export_freight_to_port_usd, corrected;
    return;
  end if;

  -- Only one version may be current (partial unique index), so stand the old
  -- one down first.
  update demand_planner.cost_assumption_versions
     set is_current = false
   where org_id = src.org_id and is_current;

  insert into demand_planner.cost_assumption_versions (
    org_id, version_no, label, notes, is_current, effective_from,
    feed_cost_per_kg, clearing_cost_per_kg, fcr_reference, fx_rate,
    import_tax_pct_domestic, import_tax_pct_export,
    domestic_transport_lkr, domestic_cold_hold_lkr,
    export_freight_to_port_usd, export_cold_chain_usd,
    rack_margin_pct, fob_margin_pct,
    importer_clearing_pct, importer_markup_pct, distributor_markup_pct,
    container_fill_kg, air_lot_kg,
    created_by, updated_by
  )
  values (
    src.org_id,
    (select coalesce(max(version_no), 0) + 1
       from demand_planner.cost_assumption_versions
      where org_id = src.org_id),
    'Export inland transport corrected',
    format(
      'Freight to port raised from $%s to $%s/kg, matching the domestic haulage rate of %s LKR/kg at FX %s. Same movement out of the factory, previously priced twice at different rates.',
      src.export_freight_to_port_usd, corrected, src.domestic_transport_lkr, src.fx_rate
    ),
    true,
    current_date,
    src.feed_cost_per_kg, src.clearing_cost_per_kg, src.fcr_reference, src.fx_rate,
    src.import_tax_pct_domestic, src.import_tax_pct_export,
    src.domestic_transport_lkr, src.domestic_cold_hold_lkr,
    corrected, src.export_cold_chain_usd,
    src.rack_margin_pct, src.fob_margin_pct,
    src.importer_clearing_pct, src.importer_markup_pct, src.distributor_markup_pct,
    src.container_fill_kg, src.air_lot_kg,
    src.created_by, src.updated_by
  )
  returning id into new_id;

  -- Children carry forward unchanged: a version is a complete, self-contained
  -- set, so a costing pinned to it resolves without reaching into another.
  insert into demand_planner.cost_odc_components (version_id, name, value, currency, basis, sort_order)
  select new_id, name, value, currency, basis, sort_order
    from demand_planner.cost_odc_components
   where version_id = src.id;

  insert into demand_planner.cost_destination_rates (version_id, destination_id, sea_rate_per_20ft, air_rate_per_lot)
  select new_id, destination_id, sea_rate_per_20ft, air_rate_per_lot
    from demand_planner.cost_destination_rates
   where version_id = src.id;

  raise notice 'Published assumptions version with export freight-to-port at $% (was $%).',
    corrected, src.export_freight_to_port_usd;
end $$;
