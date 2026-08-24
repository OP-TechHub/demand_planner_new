-- ============================================================================
-- Costing SKUs: customer, and pricing on a target rather than on margin
--
-- CUSTOMER
-- A free-text name for now. A customer master arrives later as its own
-- standalone, and a quote will pick from it (Costing_Module_Decisions.md §2) —
-- at which point this column becomes the thing to migrate FROM, not a second
-- competing store. Deliberately not a foreign key to the demand planner's
-- programs.customer: costing stays data-independent.
--
-- PRICING MODE
-- The workbook only prices one way: price = FINAL / (1 - margin). That answers
-- "what should we charge given our cost". It cannot answer the question that
-- actually comes up in a negotiation — "the buyer will pay X; does that clear
-- our cost, and by how much".
--
--   margin  — cost-plus. The default, and exactly today's behaviour.
--   target  — the price is named, and the margin is derived from it.
--
-- The target price reuses market_price_lkr / market_price_usd rather than
-- adding another pair of columns: "what we intend to sell at" and "what the
-- market bears" are the same number wearing two hats, and two columns holding
-- one fact is how they drift apart. For absorbed by-products it keeps driving
-- contribution exactly as before (§7).
--
-- Defaults leave every existing SKU on cost-plus, so no number moves and the
-- v11 parity suite is untouched.
-- ============================================================================

set search_path = demand_planner, public;

create type demand_planner.cost_pricing_mode as enum ('margin', 'target');

alter table demand_planner.cost_skus
  add column customer     text not null default '',
  add column pricing_mode demand_planner.cost_pricing_mode not null default 'margin';

comment on column demand_planner.cost_skus.customer is
  'Free text until the customer master exists; then migrate from here.';
comment on column demand_planner.cost_skus.pricing_mode is
  'margin = cost-plus (price = FINAL / (1 - margin)); target = price named, margin derived.';

-- A SKU priced on a target needs a target to price on. Enforced per market:
-- domestic reads the LKR figure, export the USD one, and market_scope says
-- which of those actually gets used.
alter table demand_planner.cost_skus
  add constraint cost_skus_target_needs_a_price
  check (
    pricing_mode <> 'target'
    or (market_scope in ('domestic', 'both') and market_price_lkr is not null and market_price_lkr > 0)
    or (market_scope in ('export',   'both') and market_price_usd is not null and market_price_usd > 0)
  );

create index cost_skus_customer_idx
  on demand_planner.cost_skus (org_id, customer)
  where customer <> '';

-- New columns are invisible to PostgREST until it reloads its schema cache, and
-- until it does, writing one fails with "Could not find the 'customer' column
-- ... in the schema cache" — which reads as if the column were missing.
notify pgrst, 'reload schema';
