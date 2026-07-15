'use client';

import { useState } from 'react';
import { cn } from '@/lib/utils';
import { kg, usd, num0, pct } from '@/lib/format';
import { OutputGrid, type GridRow } from './output-grid';

const FMT = { kg, usd, num0, pct } as const;
export type FmtKey = keyof typeof FMT;

export interface Metric {
  key: string;
  label: string;
  rows: GridRow[];
  format: FmtKey; // resolved client-side (functions aren't serializable across the RSC boundary)
}

export function MetricGrid({
  planStartDate,
  horizon,
  metrics,
  firstColLabel,
}: {
  planStartDate: string;
  horizon: number;
  metrics: Metric[];
  firstColLabel?: string;
}) {
  const [sel, setSel] = useState(metrics[0]?.key);
  const m = metrics.find((x) => x.key === sel) ?? metrics[0];
  if (!m) return null;

  return (
    <div className="space-y-3">
      <div className="flex gap-2 text-sm">
        {metrics.map((x) => (
          <button
            key={x.key}
            onClick={() => setSel(x.key)}
            className={cn('rounded-md border px-3 py-1.5', sel === x.key ? 'bg-primary text-primary-foreground' : 'hover:bg-muted')}
          >
            {x.label}
          </button>
        ))}
      </div>
      <OutputGrid planStartDate={planStartDate} horizon={horizon} rows={m.rows} format={FMT[m.format]} firstColLabel={firstColLabel} />
    </div>
  );
}
