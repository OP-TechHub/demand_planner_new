'use client';

import { useEffect, useRef, useState } from 'react';
import { Download, Search, X } from 'lucide-react';
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
/** Sentinel for "no single program picked" — show every row. */
const ALL_ROWS = '__all__';

/** A row's searchable text: whatever the grid shows in its first column. */
const rowText = (r: GridRow) => `${r.label} ${r.sublabel ?? ''}`.toLowerCase();

export function MetricGrid({
  planStartDate,
  horizon,
  metrics,
  firstColLabel = 'Program',
  filenameBase = 'export',
  statusFilter = false,
  rowFilter = false,
  extraCols,
  onRangeChange,
}: {
  planStartDate: string;
  horizon: number;
  metrics: Metric[];
  firstColLabel?: string;
  filenameBase?: string;
  /** When true, show an Active / Pipeline / Combined filter over each row's `group`. */
  statusFilter?: boolean;
  /** When true, show a search box and a single-row picker over the grid's rows. */
  rowFilter?: boolean;
  /** Extra descriptive columns, filled from each row's `extra` array. */
  extraCols?: { label: string; align?: 'left' | 'right'; width?: string }[];
  /** Reports the grid's visible month range, for page-level totals. */
  onRangeChange?: (fromMonth: number, toMonth: number) => void;
}) {
  const [sel, setSel] = useState(metrics[0]?.key);
  const [status, setStatus] = useState<StatusFilter>('combined');
  const [part, setPart] = useState(ALL_PARTS);
  const [pick, setPick] = useState(ALL_ROWS);
  const m = metrics.find((x) => x.key === sel) ?? metrics[0];
  if (!m) return null;

  const parts = m.breakdown ?? [];
  const activePart = parts.find((p) => p.key === part);
  const baseRows = activePart?.rows ?? m.rows;
  const statusRows = statusFilter && status !== 'combined' ? baseRows.filter((r) => r.group === status) : baseRows;

  // A pick the status filter has since excluded is ignored rather than silently
  // emptying the grid.
  const picked = rowFilter && pick !== ALL_ROWS ? statusRows.find((r) => r.key === pick) : undefined;
  const rows = picked ? [picked] : statusRows;

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
          {rowFilter && (
            <RowPicker
              rows={statusRows}
              value={picked ? pick : ALL_ROWS}
              onChange={setPick}
              label={firstColLabel.toLowerCase()}
            />
          )}
        </div>
        <Button
          variant="outline"
          size="sm"
          onClick={() => downloadCsv(
            `${filenameBase}-${m.key}${activePart ? `-${activePart.key}` : ''}${statusFilter && status !== 'combined' ? `-${status}` : ''}.csv`,
            toCsv(gridCsvRows(firstColLabel, planStartDate, horizon, rows, true, extraCols?.map((c) => c.label) ?? []))
          )}
        >
          <Download />
          Export CSV
        </Button>
      </div>
      {rows.length === 0 ? (
        <p className="rounded-lg border border-dashed p-6 text-center text-sm text-muted-foreground">
          No {firstColLabel.toLowerCase()}s in this view.
        </p>
      ) : (
        <OutputGrid planStartDate={planStartDate} horizon={horizon} rows={rows} format={m.format} firstColLabel={firstColLabel} extraCols={extraCols} onRangeChange={onRangeChange} />
      )}
    </div>
  );
}

/**
 * One control that both searches and selects: type to narrow, pick to show a
 * single row, or choose "All …" to go back to the full grid. Keyboard-driven
 * (↑/↓/Enter/Esc) and closes on outside click.
 */
function RowPicker({
  rows,
  value,
  onChange,
  label,
}: {
  rows: GridRow[];
  value: string;
  onChange: (key: string) => void;
  label: string;
}) {
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState('');
  const [active, setActive] = useState(0);
  const wrapRef = useRef<HTMLDivElement>(null);
  const listRef = useRef<HTMLDivElement>(null);

  const selected = value !== ALL_ROWS ? rows.find((r) => r.key === value) ?? null : null;
  const q = query.trim().toLowerCase();
  const matches = q ? rows.filter((r) => rowText(r).includes(q)) : rows;
  const options = [{ key: ALL_ROWS, label: `All ${label}s (${rows.length})`, sublabel: '' }, ...matches];

  // Close on click outside.
  useEffect(() => {
    if (!open) return;
    const onDoc = (e: MouseEvent) => {
      if (wrapRef.current && !wrapRef.current.contains(e.target as Node)) { setOpen(false); setQuery(''); }
    };
    document.addEventListener('mousedown', onDoc);
    return () => document.removeEventListener('mousedown', onDoc);
  }, [open]);

  // Keep the highlighted row in view while arrowing.
  useEffect(() => {
    if (open) (listRef.current?.children[active] as HTMLElement | undefined)?.scrollIntoView({ block: 'nearest' });
  }, [active, open]);

  const choose = (key: string) => { onChange(key); setQuery(''); setOpen(false); };
  const display = selected ? `${selected.label}${selected.sublabel ? ` — ${selected.sublabel}` : ''}` : '';

  return (
    <div ref={wrapRef} className="relative">
      <Search className="pointer-events-none absolute left-2 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-muted-foreground" />
      <input
        type="text"
        role="combobox"
        aria-expanded={open}
        aria-label={label}
        value={open ? query : display}
        placeholder={selected ? '' : `Search ${label}…`}
        onFocus={() => { setQuery(''); setActive(0); setOpen(true); }}
        onChange={(e) => { setQuery(e.target.value); setActive(0); setOpen(true); }}
        onKeyDown={(e) => {
          if (e.key === 'ArrowDown') { e.preventDefault(); setActive((a) => Math.min(a + 1, options.length - 1)); }
          else if (e.key === 'ArrowUp') { e.preventDefault(); setActive((a) => Math.max(a - 1, 0)); }
          else if (e.key === 'Enter') { e.preventDefault(); const o = options[active]; if (o) choose(o.key); }
          else if (e.key === 'Escape') { setOpen(false); setQuery(''); }
        }}
        className="w-72 rounded-md border border-border bg-card py-1.5 pl-7 pr-7 text-sm outline-none focus:ring-2 focus:ring-primary"
      />
      {selected && !open && (
        <button
          type="button"
          onClick={() => choose(ALL_ROWS)}
          aria-label={`Show all ${label}s`}
          className="absolute right-1.5 top-1/2 -translate-y-1/2 rounded p-0.5 text-muted-foreground hover:bg-muted hover:text-foreground"
        >
          <X className="h-3.5 w-3.5" />
        </button>
      )}
      {open && (
        <div ref={listRef} className="absolute z-20 mt-1 max-h-72 w-full overflow-y-auto rounded-md border bg-card shadow-lg">
          {options.length === 1 && q ? (
            <div className="px-3 py-2 text-sm text-muted-foreground">No {label} matches “{query}”.</div>
          ) : (
            options.map((o, i) => (
              <button
                type="button"
                key={o.key}
                onMouseEnter={() => setActive(i)}
                onClick={() => choose(o.key)}
                className={cn(
                  'flex w-full flex-col items-start gap-0.5 px-3 py-1.5 text-left',
                  i === active ? 'bg-primary/10' : 'hover:bg-muted',
                  o.key === value && 'font-medium'
                )}
              >
                <span className="text-sm">{o.label}</span>
                {o.sublabel && <span className="text-xs text-muted-foreground">{o.sublabel}</span>}
              </button>
            ))
          )}
        </div>
      )}
    </div>
  );
}
