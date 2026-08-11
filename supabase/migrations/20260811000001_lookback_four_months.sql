-- Widen the forward-borrowing reach from 2 months to 4.
--
-- The engine's cascade (spec §5.2) was six channels — M-1 and M-2 × primary /
-- secondary / tertiary — and `rolling_results` had one column per channel. Going
-- to four months of lookback adds six more: M-3 and M-4 × the same three paths.
--
-- `plans.settings_lookback_months` already allowed 0–6, so no constraint change
-- is needed; what changes is that a setting of 3 or 4 now does something. The
-- app's settings dropdown offers 1–4, matching the columns that exist here.
--
-- Existing rows default to 0 on the new channels, which is the honest value for
-- results computed under the old two-month reach. They stay valid to read until
-- the plan is recalculated.

alter table demand_planner.rolling_results
  add column if not exists borrow_m3_prim_wr numeric(18,4) not null default 0,
  add column if not exists borrow_m3_alt_wr  numeric(18,4) not null default 0,
  add column if not exists borrow_m3_tert_wr numeric(18,4) not null default 0,
  add column if not exists borrow_m4_prim_wr numeric(18,4) not null default 0,
  add column if not exists borrow_m4_alt_wr  numeric(18,4) not null default 0,
  add column if not exists borrow_m4_tert_wr numeric(18,4) not null default 0;

comment on column demand_planner.rolling_results.borrow_m3_prim_wr is
  'WR borrowed from month M-3 in the program''s PRIMARY bucket.';
comment on column demand_planner.rolling_results.borrow_m3_alt_wr is
  'WR borrowed from month M-3 in the program''s SECONDARY bucket.';
comment on column demand_planner.rolling_results.borrow_m3_tert_wr is
  'WR borrowed from month M-3 in the program''s TERTIARY bucket.';
comment on column demand_planner.rolling_results.borrow_m4_prim_wr is
  'WR borrowed from month M-4 in the program''s PRIMARY bucket.';
comment on column demand_planner.rolling_results.borrow_m4_alt_wr is
  'WR borrowed from month M-4 in the program''s SECONDARY bucket.';
comment on column demand_planner.rolling_results.borrow_m4_tert_wr is
  'WR borrowed from month M-4 in the program''s TERTIARY bucket.';
