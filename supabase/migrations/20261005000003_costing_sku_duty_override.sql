-- ============================================================================
-- PER-SKU DUTY & LEVY OVERRIDE
-- ============================================================================
-- Duty & levy is entered per destination, beside the freight rates. But a duty
-- rate follows the product as much as the port — fillets and whole fish do not
-- always fall under the same tariff line — so a SKU can carry its own, the same
-- way it can carry its own clearing and trade markups.
--
-- Null inherits the duty & levy % of the port the SKU is costed to, which may
-- itself be empty (no DDP shown). A number here applies at every port.
-- ============================================================================

set search_path = demand_planner, public;

alter table demand_planner.cost_skus
  add column if not exists override_duty_levy_pct numeric(6,4);

do $$
begin
  if not exists (
    select 1 from pg_constraint
     where conname = 'cost_skus_duty_levy_override_nonneg'
       and conrelid = 'demand_planner.cost_skus'::regclass
  ) then
    alter table demand_planner.cost_skus
      add constraint cost_skus_duty_levy_override_nonneg
      check (override_duty_levy_pct is null or override_duty_levy_pct >= 0);
  end if;
end $$;

comment on column demand_planner.cost_skus.override_duty_levy_pct is
  'Null inherits cost_destination_rates.duty_levy_pct for the port costed to. Fraction of FOB.';
