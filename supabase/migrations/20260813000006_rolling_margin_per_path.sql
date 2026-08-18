-- Per-path margin, alongside the Excel-parity figure.
--
-- `rolling_margin` charges every kilo at the program's PRIMARY path cost, which
-- is what Excel's Revenue & Cost tab does and what the ±$1 Annual Summary parity
-- test pins. That stays the canonical number.
--
-- The engine has always ALSO computed the more accurate decomposition (spec §5.5,
-- rolling.ts `rollingMargin`): each path's whole round valued at that path's own
-- yield and margin, so volume fulfilled through secondary/tertiary is costed at
-- the rate it actually incurred. It was computed and then discarded at
-- persistence. This column keeps it, so both can be read side by side:
--
--   rolling_margin          = revenue − cost   (primary-path, Excel parity)
--   rolling_margin_per_path = Σ path_wr × path_yield × path_margin_fp
--
-- On the V30 baseline the two differ by about 0.12% at plan level (−$17k on
-- $14.87M) because only ~0.8% of whole round routes through a non-primary path.
-- Individual programs diverge further — the largest single gap is −$38k — which
-- is the reason to expose it rather than pick one.
--
-- Existing rows default to 0, which is honest: the value is unknown until the
-- plan is recalculated. The Revenue & Cost page detects that and says so.

alter table demand_planner.rolling_results
  add column if not exists rolling_margin_per_path numeric(18,4) not null default 0;

comment on column demand_planner.rolling_results.rolling_margin_per_path is
  'Margin with each path costed at its own yield (spec §5.5). Compare with rolling_margin, which uses the primary path throughout for Excel parity.';
