'use client';

import type { ReactNode } from 'react';
import { NotComputed } from '@/components/output-grid';
import { MetricGrid, type Metric } from '@/components/metric-grid';

/** Everything the Revenue & Cost page shows, shaped server-side — serializable, so the offline copy can hold it. */
export type RevenueCostViewProps = {
  planStartDate: string;
  horizon: number;
  metrics: Metric[];
  /** Per-path margin only exists after a recompute on the new engine. */
  perPathReady: boolean;
  hasMargin: boolean;
  /** True when the plan has no programs/results yet — renders the empty state. */
  notComputed: boolean;
};

/**
 * The page's content, rendered purely from props. All the tabs, the status and
 * row filters, the cost-component dropdown and the Export menu run in the
 * browser, so they work identically on the saved offline copy. `staleNotice`
 * is the server-rendered freshness banner — online only, never serialized.
 */
export function RevenueCostView({
  planStartDate,
  horizon,
  metrics,
  perPathReady,
  hasMargin,
  notComputed,
  staleNotice,
}: RevenueCostViewProps & { staleNotice?: ReactNode }) {
  return (
    <div className="space-y-4">
      <h1 className="text-2xl font-semibold tracking-tight">Revenue &amp; Cost</h1>
      {staleNotice}
      <p className="text-xs text-muted-foreground">
        The per-program rows of revenue, cost and margin reproduce the V30 workbook to the dollar (parity-tested to ±$1). Cost charges every kilo
        at the program&apos;s <b>primary-path</b> rate, exactly as Excel does; <b>Margin (per-path)</b> re-costs each kilo at
        the path that actually supplied it, which on the V30 baseline shifts the plan total by about 0.1% and individual
        programs by more. Filter by status to see active or pipeline (inquiry) programs only. On <b>Cost</b>, the dropdown
        splits the total into its components — barra, packing, processing, storage, freight and other — which sum back to
        the total. <b>Revenue</b> and both <b>Margin</b> tabs carry a <b>Secondary products</b> row beneath the programs,
        taken from the Secondary products page. Secondary products carry no cost of their own, so every dollar they
        earn is also a dollar of margin. Beneath that, each <b>other product</b> from the same page (fingerling, or any
        other line traded outside the harvest plan) has its own row, named after the product, on <b>Revenue</b>,{' '}
        <b>Cost</b> and both <b>Margin</b> tabs: its typed-in quantity × the per-unit revenue and cost it was set up
        with. On <b>Cost</b> the dropdown gains an <b>Other products</b> component so the parts still sum to the total.
        Together these make the <b>TOTAL</b> row on each tab the plan&apos;s whole figure — programs, secondary products and
        other products — and match the Total rows on the Annual Summary. The program rows above are untouched, so the
        parity figures are still there to read.
      </p>
      <p className="text-xs text-muted-foreground">
        <b>Unit revenue</b>, <b>Unit cost</b> and <b>Unit margin</b> are the same three figures divided by the kilos of
        finished product behind them — the realised price per kg, the loaded cost per kg, and the difference. A rate
        can&apos;t be added up, so on these three tabs the total column and the bottom row are a{' '}
        <b>weighted average</b>: total dollars ÷ total kilos, which lets a large program pull the average its way
        instead of counting equally with a small one. A month a program ships nothing has no rate, so it reads $0.00 and
        is left out of the averages rather than dragging them down. <b>Unit cost</b> splits into the same six components
        through the dropdown. These three tabs carry <b>no Secondary products or other product rows</b>: by-products
        are recovered from round weight, and other products are counted in their own units, so neither has a kilo of
        finished product behind it and can&apos;t share this denominator — read them on the dollar tabs above.
      </p>
      {hasMargin && !perPathReady && (
        <p className="rounded-md border border-warning/30 bg-warning/10 px-3 py-2 text-xs text-warning">
          <b>Margin (per-path)</b> reads zero until the next Recalculate — it&apos;s a new figure and existing results
          predate it.
        </p>
      )}
      {notComputed ? <NotComputed /> : (
        <MetricGrid planStartDate={planStartDate} horizon={horizon} metrics={metrics} filenameBase="revenue-cost" statusFilter rowFilter />
      )}
    </div>
  );
}
