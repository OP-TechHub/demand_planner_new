'use client';

import { useEffect, useRef, useState } from 'react';
import { Check, Search, X } from 'lucide-react';
import { cn } from '@/lib/utils';
import { type Aggregate, type GridRow } from '@/lib/grid-csv';
import { rowLabel } from '@/lib/grid-export';
import { ExportMenu } from '@/components/export-menu';
import { OutputGrid, type FmtKey } from './output-grid';

export type { FmtKey };

export interface Metric {
  key: string;
  label: string;
  rows: GridRow[];
  format: FmtKey; // resolved client-side (functions aren't serializable across the RSC boundary)
  /** What the cells are measured in ("kg FP", "$", "$/kg FP" …); shown on the grid and in exports. */
  unit?: string;
  /**
   * 'ratio' for a per-kg rate, whose totals must be weighted averages over each
   * row's `weights` rather than sums. Defaults to 'sum'.
   */
  aggregate?: Aggregate;
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
/** Sentinel for "no programs picked" — show every row. */
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
  /** When true, show a search box and a multi-row picker over the grid's rows. */
  rowFilter?: boolean;
  /** Extra descriptive columns, filled from each row's `extra` array. */
  extraCols?: { label: string; align?: 'left' | 'right'; width?: string; unit?: string }[];
  /** Reports the grid's visible month range, for page-level totals. */
  onRangeChange?: (fromMonth: number, toMonth: number) => void;
}) {
  const [sel, setSel] = useState(metrics[0]?.key);
  const [status, setStatus] = useState<StatusFilter>('combined');
  const [part, setPart] = useState(ALL_PARTS);
  // Keys of the rows picked in the picker; empty means every row.
  const [picks, setPicks] = useState<string[]>([]);
  // Mirrors the grid's month selectors, so Export CSV carries the months on screen.
  const [range, setRange] = useState({ from: 1, to: horizon });
  const m = metrics.find((x) => x.key === sel) ?? metrics[0];
  if (!m) return null;

  const parts = m.breakdown ?? [];
  const activePart = parts.find((p) => p.key === part);
  const baseRows = activePart?.rows ?? m.rows;
  const statusRows = statusFilter && status !== 'combined' ? baseRows.filter((r) => r.group === status) : baseRows;

  // Picks the status filter has since excluded are ignored rather than silently
  // emptying the grid. Picked rows keep the grid's own order, not click order,
  // so the TOTAL beneath them reads as a sub-total of the sheet above.
  const pickSet = new Set(picks);
  const pickedRows = rowFilter && picks.length > 0 ? statusRows.filter((r) => pickSet.has(r.key)) : [];
  const rows = pickedRows.length > 0 ? pickedRows : statusRows;

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
              value={pickedRows.map((r) => r.key)}
              onChange={setPicks}
              label={firstColLabel.toLowerCase()}
            />
          )}
        </div>
        <ExportMenu
          disabled={rows.length === 0}
          build={() => ({
            filename: `${filenameBase}-${m.key}${activePart ? `-${activePart.key}` : ''}${statusFilter && status !== 'combined' ? `-${status}` : ''}`,
            title: [m.label, activePart?.label].filter(Boolean).join(' — '),
            subtitle: [
              m.unit ?? '',
              statusFilter && status !== 'combined' ? `${status[0]!.toUpperCase()}${status.slice(1)} only` : '',
              pickedRows.length > 0 ? pickedRows.map(rowLabel).join(', ') : '',
            ].filter(Boolean).join(' · ') || undefined,
            firstCol: firstColLabel,
            extraCols: extraCols?.map((c) => (c.unit ? `${c.label} (${c.unit})` : c.label)),
            planStartDate,
            horizon,
            rows,
            range,
            format: m.format,
            aggregate: m.aggregate ?? 'sum',
            rowTotals: true,
            columnTotals: true,
          })}
        />
      </div>
      {rows.length === 0 ? (
        <p className="rounded-lg border border-dashed p-6 text-center text-sm text-muted-foreground">
          No {firstColLabel.toLowerCase()}s in this view.
        </p>
      ) : (
        <OutputGrid planStartDate={planStartDate} horizon={horizon} rows={rows} format={m.format} aggregate={m.aggregate} firstColLabel={firstColLabel} unit={m.unit} extraCols={extraCols} onRangeChange={(from, to) => {
          setRange((prev) => (prev.from === from && prev.to === to ? prev : { from, to }));
          onRangeChange?.(from, to);
        }} />
      )}
    </div>
  );
}

/**
 * One control that both searches and selects: type to narrow, tick the rows to
 * show (any number of them), or choose "All …" to go back to the full grid.
 * The list stays open while ticking so several can be picked in one go; it
 * closes on Esc or an outside click. Keyboard-driven (↑/↓/Enter/Esc).
 */
function RowPicker({
  rows,
  value,
  onChange,
  label,
}: {
  rows: GridRow[];
  /** Keys of the picked rows; empty means all. */
  value: string[];
  onChange: (keys: string[]) => void;
  label: string;
}) {
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState('');
  const [active, setActive] = useState(0);
  const wrapRef = useRef<HTMLDivElement>(null);
  const listRef = useRef<HTMLDivElement>(null);

  const chosen = new Set(value);
  const selected = rows.filter((r) => chosen.has(r.key));
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

  const clear = () => { onChange([]); setQuery(''); setOpen(false); };
  // Toggling keeps the list open so the next pick is one click away. The
  // parent keeps the picked set in the grid's order, so click order is moot.
  const toggle = (key: string) => {
    if (key === ALL_ROWS) { clear(); return; }
    onChange(chosen.has(key) ? value.filter((k) => k !== key) : [...value, key]);
  };
  const display =
    selected.length === 0 ? ''
    : selected.length === 1 ? `${selected[0]!.label}${selected[0]!.sublabel ? ` — ${selected[0]!.sublabel}` : ''}`
    : `${selected.length} ${label}s selected`;

  return (
    <div ref={wrapRef} className="relative">
      <Search className="pointer-events-none absolute left-2 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-muted-foreground" />
      <input
        type="text"
        role="combobox"
        aria-expanded={open}
        aria-label={label}
        value={open ? query : display}
        placeholder={selected.length > 0 ? '' : `Search ${label}…`}
        onFocus={() => { setQuery(''); setActive(0); setOpen(true); }}
        onChange={(e) => { setQuery(e.target.value); setActive(0); setOpen(true); }}
        onKeyDown={(e) => {
          if (e.key === 'ArrowDown') { e.preventDefault(); setActive((a) => Math.min(a + 1, options.length - 1)); }
          else if (e.key === 'ArrowUp') { e.preventDefault(); setActive((a) => Math.max(a - 1, 0)); }
          else if (e.key === 'Enter') { e.preventDefault(); const o = options[active]; if (o) toggle(o.key); }
          else if (e.key === 'Escape') { setOpen(false); setQuery(''); }
        }}
        className="w-72 rounded-md border border-border bg-card py-1.5 pl-7 pr-7 text-sm outline-none focus:ring-2 focus:ring-primary"
      />
      {selected.length > 0 && !open && (
        <button
          type="button"
          onClick={clear}
          aria-label={`Show all ${label}s`}
          className="absolute right-1.5 top-1/2 -translate-y-1/2 rounded p-0.5 text-muted-foreground hover:bg-muted hover:text-foreground"
        >
          <X className="h-3.5 w-3.5" />
        </button>
      )}
      {open && (
        <div className="absolute z-20 mt-1 w-full rounded-md border bg-card shadow-lg">
          {selected.length > 0 && (
            <div className="flex items-center justify-between border-b px-3 py-1.5 text-xs text-muted-foreground">
              <span>{selected.length} of {rows.length} picked</span>
              <button type="button" onMouseDown={(e) => e.preventDefault()} onClick={clear} className="font-medium text-foreground hover:underline">
                Clear
              </button>
            </div>
          )}
          <div ref={listRef} className="max-h-72 overflow-y-auto">
            {options.length === 1 && q ? (
              <div className="px-3 py-2 text-sm text-muted-foreground">No {label} matches “{query}”.</div>
            ) : (
              options.map((o, i) => {
                const isAll = o.key === ALL_ROWS;
                const on = isAll ? selected.length === 0 : chosen.has(o.key);
                return (
                  <button
                    type="button"
                    key={o.key}
                    role="option"
                    aria-selected={on}
                    onMouseEnter={() => setActive(i)}
                    // Keep focus in the input so typing to narrow still works after a tick.
                    onMouseDown={(e) => e.preventDefault()}
                    onClick={() => toggle(o.key)}
                    className={cn(
                      'flex w-full items-start gap-2 px-3 py-1.5 text-left',
                      i === active ? 'bg-primary/10' : 'hover:bg-muted',
                      on && 'font-medium'
                    )}
                  >
                    <span className={cn('mt-0.5 flex h-4 w-4 shrink-0 items-center justify-center rounded border', on ? 'border-primary bg-primary text-primary-foreground' : 'border-border')}>
                      {on && <Check className="h-3 w-3" />}
                    </span>
                    <span className="flex flex-col items-start gap-0.5">
                      <span className="text-sm">{o.label}</span>
                      {o.sublabel && <span className="text-xs text-muted-foreground">{o.sublabel}</span>}
                    </span>
                  </button>
                );
              })
            )}
          </div>
        </div>
      )}
    </div>
  );
}
