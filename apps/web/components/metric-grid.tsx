'use client';

import { useState } from 'react';
import { Download } from 'lucide-react';
import { cn } from '@/lib/utils';
import { toCsv, downloadCsv } from '@/lib/csv';
import { gridCsvRows, type GridRow } from '@/lib/grid-csv';
import { Button } from '@/components/ui/button';
import { OutputGrid, type FmtKey } from './output-grid';

export type { FmtKey };

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
  firstColLabel = 'Program',
  filenameBase = 'export',
}: {
  planStartDate: string;
  horizon: number;
  metrics: Metric[];
  firstColLabel?: string;
  filenameBase?: string;
}) {
  const [sel, setSel] = useState(metrics[0]?.key);
  const m = metrics.find((x) => x.key === sel) ?? metrics[0];
  if (!m) return null;

  return (
    <div className="space-y-3">
      <div className="flex flex-wrap items-center justify-between gap-2 text-sm">
        <div className="inline-flex rounded-md border border-border bg-card p-0.5">
          {metrics.map((x) => (
            <button
              key={x.key}
              onClick={() => setSel(x.key)}
              className={cn(
                'rounded px-3 py-1 text-sm font-medium transition-colors',
                sel === x.key ? 'bg-primary text-primary-foreground shadow-sm' : 'text-muted-foreground hover:text-foreground'
              )}
            >
              {x.label}
            </button>
          ))}
        </div>
        <Button
          variant="outline"
          size="sm"
          onClick={() => downloadCsv(`${filenameBase}-${m.key}.csv`, toCsv(gridCsvRows(firstColLabel, planStartDate, horizon, m.rows)))}
        >
          <Download />
          Export CSV
        </Button>
      </div>
      <OutputGrid planStartDate={planStartDate} horizon={horizon} rows={m.rows} format={m.format} firstColLabel={firstColLabel} />
    </div>
  );
}
