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

const STATUS_TABS = [
  { key: 'combined', label: 'Combined' },
  { key: 'active', label: 'Active' },
  { key: 'pipeline', label: 'Pipeline' },
] as const;
type StatusFilter = (typeof STATUS_TABS)[number]['key'];

export function MetricGrid({
  planStartDate,
  horizon,
  metrics,
  firstColLabel = 'Program',
  filenameBase = 'export',
  statusFilter = false,
}: {
  planStartDate: string;
  horizon: number;
  metrics: Metric[];
  firstColLabel?: string;
  filenameBase?: string;
  /** When true, show an Active / Pipeline / Combined filter over each row's `group`. */
  statusFilter?: boolean;
}) {
  const [sel, setSel] = useState(metrics[0]?.key);
  const [status, setStatus] = useState<StatusFilter>('combined');
  const m = metrics.find((x) => x.key === sel) ?? metrics[0];
  if (!m) return null;

  const rows = statusFilter && status !== 'combined' ? m.rows.filter((r) => r.group === status) : m.rows;

  return (
    <div className="space-y-3">
      <div className="flex flex-wrap items-center justify-between gap-2 text-sm">
        <div className="flex flex-wrap items-center gap-2">
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
          {statusFilter && (
            <div className="inline-flex rounded-md border border-border bg-card p-0.5">
              {STATUS_TABS.map((t) => (
                <button
                  key={t.key}
                  onClick={() => setStatus(t.key)}
                  className={cn(
                    'rounded px-3 py-1 text-sm font-medium transition-colors',
                    status === t.key ? 'bg-muted text-foreground shadow-sm' : 'text-muted-foreground hover:text-foreground'
                  )}
                >
                  {t.label}
                </button>
              ))}
            </div>
          )}
        </div>
        <Button
          variant="outline"
          size="sm"
          onClick={() => downloadCsv(
            `${filenameBase}-${m.key}${statusFilter && status !== 'combined' ? `-${status}` : ''}.csv`,
            toCsv(gridCsvRows(firstColLabel, planStartDate, horizon, rows))
          )}
        >
          <Download />
          Export CSV
        </Button>
      </div>
      <OutputGrid planStartDate={planStartDate} horizon={horizon} rows={rows} format={m.format} firstColLabel={firstColLabel} />
    </div>
  );
}
