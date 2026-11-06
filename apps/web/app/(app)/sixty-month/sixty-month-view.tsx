'use client';

import type { ReactNode } from 'react';
import { NotComputed } from '@/components/output-grid';
import { MetricGrid, type Metric } from '@/components/metric-grid';

/** Everything the 60-Month Summary shows, shaped server-side — serializable, so the offline copy can hold it. */
export type SixtyMonthViewProps = {
  planStartDate: string;
  horizon: number;
  metrics: Metric[];
  /** True when the plan has no programs/results yet — renders the empty state. */
  notComputed: boolean;
};

/**
 * The page's content, rendered purely from props. The metric tabs, month-range
 * filter and Export menu all run in the browser, so they work identically on
 * the saved offline copy. `staleNotice` is the server-rendered freshness
 * banner — online only, never serialized.
 */
export function SixtyMonthView({
  planStartDate,
  horizon,
  metrics,
  notComputed,
  staleNotice,
}: SixtyMonthViewProps & { staleNotice?: ReactNode }) {
  return (
    <div className="space-y-4">
      <h1 className="text-2xl font-semibold tracking-tight">60-Month Summary</h1>
      {staleNotice}
      {notComputed ? <NotComputed /> : (
        <MetricGrid planStartDate={planStartDate} horizon={horizon} metrics={metrics} filenameBase="60-month" />
      )}
    </div>
  );
}
