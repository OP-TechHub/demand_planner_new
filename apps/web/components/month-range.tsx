'use client';

import { createContext, useContext, useState } from 'react';
import { monthLabel } from '@oceanpick/shared';

export interface MonthRange {
  /** 1-based month index, inclusive. */
  from: number;
  to: number;
}

const MonthRangeCtx = createContext<MonthRange | null>(null);

/**
 * The month window a page's grids share. `null` when there is no provider above
 * — a grid then keeps its own filter, as every output page had before.
 */
export function useMonthRange(): MonthRange | null {
  return useContext(MonthRangeCtx);
}

/**
 * One month-range control for a whole page.
 *
 * Every OutputGrid below reads the range from context and drops its own
 * selector, so a page of several grids is filtered once rather than table by
 * table. Server-rendered children still see it: the grids are client components
 * sitting in this provider's subtree, whoever created the elements.
 */
export function MonthRangeProvider({
  planStartDate,
  horizon,
  children,
  note,
}: {
  planStartDate: string;
  horizon: number;
  children: React.ReactNode;
  /** What the range applies to, said once for the page. */
  note?: React.ReactNode;
}) {
  const [from, setFrom] = useState(1);
  const [to, setTo] = useState(horizon);
  const fullRange = from === 1 && to === horizon;

  /**
   * Picking a start month proposes the twelve months from it — the year is what
   * these figures are read in, and it is only a proposal: the end month can be
   * moved afterwards, and Reset puts the whole horizon back.
   */
  const onFrom = (v: number) => { setFrom(v); setTo(Math.min(v + 11, horizon)); };
  const onTo = (v: number) => { setTo(v); if (v < from) setFrom(v); };

  const months = Array.from({ length: horizon }, (_, i) => i + 1);

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-center gap-1.5 rounded-lg border bg-card px-3 py-2">
        <span className="text-xs font-medium text-muted-foreground">Months</span>
        <select value={from} onChange={(e) => onFrom(Number(e.target.value))} aria-label="From month" className={selectCls}>
          {months.map((mo) => <option key={mo} value={mo}>{monthLabel(planStartDate, mo)}</option>)}
        </select>
        <span className="text-xs text-muted-foreground">to</span>
        <select value={to} onChange={(e) => onTo(Number(e.target.value))} aria-label="To month" className={selectCls}>
          {months.map((mo) => <option key={mo} value={mo}>{monthLabel(planStartDate, mo)}</option>)}
        </select>
        {!fullRange && (
          <button
            type="button"
            onClick={() => { setFrom(1); setTo(horizon); }}
            className="text-xs font-medium text-primary hover:underline"
          >
            Reset
          </button>
        )}
        <span className="ml-1 text-xs text-muted-foreground">
          {fullRange
            ? `All ${horizon} months`
            : `${monthLabel(planStartDate, from)} – ${monthLabel(planStartDate, to)} · ${to - from + 1} of ${horizon} months`}
          {note ? <> · {note}</> : null}
        </span>
      </div>

      <MonthRangeCtx.Provider value={{ from, to }}>{children}</MonthRangeCtx.Provider>
    </div>
  );
}

const selectCls = 'rounded-md border px-2.5 py-1.5 text-sm outline-none focus:ring-2 focus:ring-primary';
