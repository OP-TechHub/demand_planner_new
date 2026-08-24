-- ============================================================================
-- Costing SKUs: product form (frozen / fresh) and market scope
--
-- WHY
-- Two facts about a SKU that the workbook cannot express, because a spreadsheet
-- tab costs every row every way:
--
--   product_form  — a retail fresh fillet flown out and a frozen block are not
--                   the same product. It also fixes a nonsense: glaze is added
--                   ice, so it cannot apply to fresh product at all.
--   market_scope  — some SKUs only ever sell locally (a 500g retail bag) and
--                   some only ever export. Both currently appear in both grids.
--
-- Both default to 'both', which is exactly today's behaviour: every seeded SKU
-- keeps being costed for every market and every state. So this migration
-- changes no number anywhere — it only lets a SKU say something narrower about
-- itself, and the v11 parity suite is untouched (these columns never reach the
-- engine; they filter what the grid offers).
-- ============================================================================

set search_path = demand_planner, public;

-- 'both' exists so the default invents nothing. The workbook costs all 34 SKUs
-- frozen AND fresh, in domestic AND export, so 'both' is the truthful starting
-- point — not a guess that they are all one or the other.
create type demand_planner.cost_product_form as enum ('frozen', 'fresh', 'both');
create type demand_planner.cost_market_scope as enum ('domestic', 'export', 'both');

alter table demand_planner.cost_skus
  add column product_form demand_planner.cost_product_form not null default 'both',
  add column market_scope demand_planner.cost_market_scope not null default 'both';

comment on column demand_planner.cost_skus.product_form is
  'Frozen, fresh, or costed either way. Fresh product cannot carry glaze — glaze is added ice.';
comment on column demand_planner.cost_skus.market_scope is
  'Which market grid this SKU appears in. Recipe values are still shared across both (Decisions §2).';

-- A fresh-only SKU with a glaze percentage is contradictory rather than merely
-- odd: the engine would dilute its fish cost for ice it never carries.
alter table demand_planner.cost_skus
  add constraint cost_skus_fresh_has_no_glaze
  check (product_form <> 'fresh' or glaze_pct = 0);
