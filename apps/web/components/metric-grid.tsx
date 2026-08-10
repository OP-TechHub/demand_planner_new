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
  /**
   * Optional component split, offered as a dropdown beside the tabs (e.g. Cost →
   * Barra / Packing / …). Each entry replaces the grid's rows; the parts are
   * expected to sum back to `rows`.
   */
  breakdown?: { key: string; label: string; rows: GridRow[] }[];
}

const STATUS_TABS = [
  { key: 'combined', label: 'Combined' },
  { key: 'active', label: 'Active' },
  { key: 'pipeline', label: 'Pipeline' },
] as const;
type StatusFilter = (typeof STATUS_TABS)[number]['key'];

/** Sentinel for "no component selected" — show the metric's own total rows. */
const ALL_PARTS = '__all__';

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
  const [part, setPart] = useState(ALL_PARTS);
  const m = metrics.find((x) => x.key === sel) ?? metrics[0];
  if (!m) return null;

  const parts = m.breakdown ?? [];
  const activePart = parts.find((p) => p.key === part);
  const baseRows = activePart?.rows ?? m.rows;
  const rows = statusFilter && status !== 'combined' ? baseRows.filter((r) => r.group === status) : baseRows;

  return (
    <div className="space-y-3">
      <div className="flex flex-wrap items-center justify-between gap-2 text-sm">
        <div className="flex flex-wrap items-center gap-2">
          <div className="inline-flex rounded-md border border-border bg-card p-0.5">
            {metrics.map((x) => (
              <button
                key={x.key}
                onClick={() => { setSel(x.key); setPart(ALL_PARTS); }}
                className={cn(
                  'rounded px-3 py-1 text-sm font-medium transition-colors',
                  sel === x.key ? 'bg-primary text-primary-foreground shadow-sm' : 'text-muted-foreground hover:text-foreground'
                )}
              >
                {x.label}
              </button>
            ))}
          </div>
          {parts.length > 0 && (
            <select
              value={part}
              onChange={(e) => setPart(e.target.value)}
              aria-label={`${m.label} component`}
              className="rounded-md border border-border bg-card px-2.5 py-1.5 text-sm outline-none focus:ring-2 focus:ring-primary"
            >
              <option value={ALL_PARTS}>All {m.label.toLowerCase()}s</option>
              {parts.map((p) => <option key={p.key} value={p.key}>{p.label}</option>)}
            </select>
          )}
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
            `${filenameBase}-${m.key}${activePart ? `-${activePart.key}` : ''}${statusFilter && status !== 'combined' ? `-${status}` : ''}.csv`,
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
