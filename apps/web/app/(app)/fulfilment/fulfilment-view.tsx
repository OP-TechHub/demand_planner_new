'use client';

import type { ReactNode } from 'react';
import { OutputGrid, NotComputed } from '@/components/output-grid';
import type { GridRow } from '@/lib/grid-csv';

/** Everything the Program Fulfilment page shows, shaped server-side — serializable, so the offline copy can hold it. */
export type FulfilmentViewProps = {
  planStartDate: string;
  horizon: number;
  planName: string;
  rows: GridRow[];
};

/**
 * The page's content, rendered purely from props. The grid, its month-range
 * filter and the Export menu (CSV / Excel / PDF) all run in the browser, so
 * they work identically on the saved offline copy. `staleNotice` is the
 * server-rendered freshness banner — online only, never serialized.
 */
export function FulfilmentView({
  planStartDate,
  horizon,
  planName,
  rows,
  staleNotice,
}: FulfilmentViewProps & { staleNotice?: ReactNode }) {
  return (
    <div className="space-y-4">
      {staleNotice}
      <h1 className="text-2xl font-semibold tracking-tight">Program Fulfilment</h1>
      {rows.length === 0 ? (
        <NotComputed />
      ) : (
        <>
          <p className="text-xs text-muted-foreground">Fulfilment % by program × month. Green ≥ 95%, amber 80–95%, red &lt; 80%. Blank = no demand.</p>
          <OutputGrid planStartDate={planStartDate} horizon={horizon} rows={rows} format="pct" colorFor="fulfilment" unit="% of demand" hideTotals exportAs={{ filename: "program-fulfilment", title: "Program Fulfilment", subtitle: `${planName} · fulfilment %` }} />
        </>
      )}
    </div>
  );
}
