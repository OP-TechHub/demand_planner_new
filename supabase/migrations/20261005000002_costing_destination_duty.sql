-- ============================================================================
-- DESTINATION DUTY & LEVY — the input behind a DDP price
-- ============================================================================
-- The export ladder ran FOB -> CIF -> importer -> distributor with one generic
-- clearing percentage and no import duty at all. Duty is not generic: it is set
-- by the country the goods land in, so it belongs beside the freight rates,
-- one figure per port.
--
--     duty per kg = FOB x duty_levy_pct
--     DDP         = (CIF x (1 + clearing) + duty) x (1 + importer) x (1 + distributor)
--
-- The duty is worked out on the FOB price, so freight is not in its base, and
-- the amount is added to CIF. Nothing else moves: clearing stays a percentage
-- of CIF alone, and the importer and distributor markups apply exactly as they
-- do on the existing ladder.
--
-- OPTIONAL
-- Null means "not entered", and no DDP price is shown for that port. It is not
-- the same as 0, which says the port is duty-free and DDP equals the existing
-- distributor price. Nothing that exists today changes: FOB, CIF, importer and
-- distributor prices are computed as before, so v11 parity is untouched.
--
-- VERSIONED
-- On cost_destination_rates rather than cost_destinations, like the freight it
-- sits next to: a duty rate moves, and a costing already quoted has to keep the
-- one it was quoted on.
-- ============================================================================

set search_path = demand_planner, public;

alter table demand_planner.cost_destination_rates
  add column if not exists duty_levy_pct numeric(6,4);

do $$
begin
  if not exists (
    select 1 from pg_constraint
     where conname = 'cost_destination_rates_duty_levy_non_negative'
       and conrelid = 'demand_planner.cost_destination_rates'::regclass
  ) then
    alter table demand_planner.cost_destination_rates
      add constraint cost_destination_rates_duty_levy_non_negative
      check (duty_levy_pct is null or duty_levy_pct >= 0);
  end if;
end $$;

comment on column demand_planner.cost_destination_rates.duty_levy_pct is
  'Import duty and levies at this port, as a fraction of FOB (0.05 = 5%). Null means not entered: no DDP price is shown.';
