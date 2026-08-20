'use client';

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Check, ChevronDown, Download, Search, X } from 'lucide-react';
import { cn } from '@/lib/utils';
import { Button } from '@/components/ui/button';
import { OutputGrid } from '@/components/output-grid';
import { gridCsvRows, type GridRow } from '@/lib/grid-csv';
import { toCsv, downloadCsv } from '@/lib/csv';

/**
 * The order book's three states, as a row filter.
 *
 * They are properties of a program-month, not of a program, so a row qualifies on
 * whatever it does in the months currently on screen: narrow the grid to Q1 and a
 * program whose only PO lands in Q4 stops counting as "PO received" — which is
 * the whole point of asking the question over a window.
 */
const TABS = [
  { key: 'all', label: 'All' },
  { key: 'po', label: 'PO received' },
  { key: 'no_po', label: 'Active, no PO' },
  { key: 'pipeline', label: 'Pipeline' },
] as const;
type Tab = (typeof TABS)[number]['key'];

/** A row's searchable text: whatever the grid shows in its first column. */
const rowText = (r: GridRow) => `${r.label} ${r.sublabel ?? ''}`.toLowerCase();

export function OrderBookGrid({
  planStartDate,
  horizon,
  rows,
  poMonths,
  cellBg,
  cellTitle,
}: {
  planStartDate: string;
  horizon: number;
  /** `group` carries the program's status. */
  rows: GridRow[];
  /** Months (1-based) each row holds a PO for, keyed by row key. */
  poMonths: Record<string, number[]>;
  cellBg: Map<string, string>;
  cellTitle: Map<string, string>;
}) {
  const [tab, setTab] = useState<Tab>('all');
  // An empty set means "every program" — the picker flips back to that when the
  // last one is unchecked, rather than leaving an empty grid as a dead end.
  const [picked, setPicked] = useState<Set<string>>(new Set());
  // OutputGrid owns the month selectors and reports the window back up, so the
  // filter and its counts describe exactly what is on screen.
  const [range, setRange] = useState({ from: 1, to: horizon });
  const onRangeChange = useCallback(
    (from: number, to: number) =>
      setRange((prev) => (prev.from === from && prev.to === to ? prev : { from, to })),
    []
  );

  // Program choice applies first, so the tab counts always describe what clicking
  // that tab would actually show.
  const chosen = useMemo(
    () => (picked.size === 0 ? rows : rows.filter((r) => picked.has(r.key))),
    [rows, picked]
  );

  const matches = useCallback(
    (r: GridRow, t: Tab) => {
      if (t === 'all') return true;
      if (t === 'pipeline') return r.group === 'pipeline';
      const hasPo = (poMonths[r.key] ?? []).some((m) => m >= range.from && m <= range.to);
      if (t === 'po') return hasPo;
      return r.group === 'active' && !hasPo;
    },
    [poMonths, range]
  );

  const counts = useMemo(() => {
    const c = {} as Record<Tab, number>;
    for (const t of TABS) c[t.key] = chosen.filter((r) => matches(r, t.key)).length;
    return c;
  }, [chosen, matches]);

  const visible = useMemo(() => chosen.filter((r) => matches(r, tab)), [chosen, tab, matches]);

  return (
    <div className="space-y-3">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div className="flex flex-wrap items-center gap-2">
          <div className="inline-flex rounded-md border border-border bg-card p-0.5">
            {TABS.map((t) => (
              <button
                key={t.key}
                type="button"
                onClick={() => setTab(t.key)}
                className={cn(
                  'rounded px-3 py-1 text-sm font-medium transition-colors',
                  tab === t.key ? 'bg-muted text-foreground shadow-sm' : 'text-muted-foreground hover:text-foreground'
                )}
              >
                {t.label} <span className="tabular-nums opacity-60">{counts[t.key] ?? 0}</span>
              </button>
            ))}
          </div>
          <ProgramPicker rows={rows} picked={picked} onChange={setPicked} />
        </div>
        <Button
          variant="outline"
          size="sm"
          disabled={visible.length === 0}
          onClick={() =>
            downloadCsv(
              `order-book${tab === 'all' ? '' : `-${tab}`}.csv`,
              toCsv(gridCsvRows('Program', planStartDate, horizon, visible))
            )
          }
        >
          <Download />
          Export CSV
        </Button>
      </div>

      {visible.length === 0 ? (
        <p className="rounded-lg border border-dashed p-6 text-center text-sm text-muted-foreground">
          {picked.size > 0 && counts.all === 0
            ? 'None of the selected programs are in this plan view.'
            : `No programs are ${TABS.find((t) => t.key === tab)?.label.toLowerCase()} in these months.`}
        </p>
      ) : (
        <OutputGrid
          planStartDate={planStartDate}
          horizon={horizon}
          rows={visible}
          format="num0"
          firstColLabel="Program"
          rightLabel={`${horizon}mo total`}
          cellBg={cellBg}
          cellTitle={cellTitle}
          onRangeChange={onRangeChange}
        />
      )}
    </div>
  );
}

/**
 * Multi-select over the plan's programs: type to narrow, tick the ones you want.
 * Nothing ticked means everything, which is both the sensible default and where
 * unticking the last one lands you.
 */
function ProgramPicker({
  rows,
  picked,
  onChange,
}: {
  rows: GridRow[];
  picked: Set<string>;
  onChange: (next: Set<string>) => void;
}) {
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState('');
  const wrapRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!open) return;
    const onDoc = (e: MouseEvent) => {
      if (wrapRef.current && !wrapRef.current.contains(e.target as Node)) { setOpen(false); setQuery(''); }
    };
    document.addEventListener('mousedown', onDoc);
    return () => document.removeEventListener('mousedown', onDoc);
  }, [open]);

  const q = query.trim().toLowerCase();
  const matches = q ? rows.filter((r) => rowText(r).includes(q)) : rows;

  const toggle = (key: string) => {
    const next = new Set(picked);
    if (next.has(key)) next.delete(key); else next.add(key);
    onChange(next);
  };
  // Adds the search results to whatever is already ticked, so several searches
  // can build one selection up (e.g. two customers in turn).
  const addAllMatching = () => {
    const next = new Set(picked);
    for (const r of matches) next.add(r.key);
    onChange(next);
  };

  const all = picked.size === 0;
  const summary = all ? `All programs (${rows.length})` : `${picked.size} of ${rows.length} programs`;

  return (
    <div ref={wrapRef} className="relative">
      <button
        type="button"
        onClick={() => { setOpen((v) => !v); setQuery(''); }}
        aria-expanded={open}
        className={cn(
          'inline-flex items-center gap-1.5 rounded-md border border-border bg-card px-3 py-1.5 text-sm transition-colors hover:bg-muted',
          !all && 'border-primary/40 text-primary'
        )}
      >
        {summary}
        <ChevronDown className={cn('h-3.5 w-3.5 transition-transform', open && 'rotate-180')} />
      </button>
      {!all && (
        <button
          type="button"
          onClick={() => onChange(new Set())}
          aria-label="Show all programs"
          className="absolute -right-6 top-1/2 -translate-y-1/2 rounded p-0.5 text-muted-foreground hover:bg-muted hover:text-foreground"
        >
          <X className="h-3.5 w-3.5" />
        </button>
      )}

      {open && (
        <div className="absolute z-30 mt-1 w-80 rounded-md border bg-card shadow-lg">
          <div className="relative border-b p-2">
            <Search className="pointer-events-none absolute left-4 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-muted-foreground" />
            <input
              autoFocus
              type="text"
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              onKeyDown={(e) => { if (e.key === 'Escape') { setOpen(false); setQuery(''); } }}
              placeholder="Search customer or product…"
              aria-label="Search programs"
              className="w-full rounded-md border border-border bg-card py-1.5 pl-7 pr-2 text-sm outline-none focus:ring-2 focus:ring-primary"
            />
          </div>
          <div className="flex items-center justify-between border-b px-3 py-1.5 text-xs">
            <span className="text-muted-foreground">
              {q ? `${matches.length} match${matches.length === 1 ? '' : 'es'}` : `${rows.length} programs`}
            </span>
            <span className="flex gap-3">
              {q && matches.length > 0 && (
                <button type="button" onClick={addAllMatching} className="font-medium text-primary hover:underline">
                  Add these {matches.length}
                </button>
              )}
              <button
                type="button"
                onClick={() => onChange(new Set())}
                disabled={all}
                className="font-medium text-muted-foreground hover:text-foreground disabled:opacity-40"
              >
                Show all
              </button>
            </span>
          </div>
          <div className="max-h-72 overflow-y-auto py-1">
            {matches.length === 0 ? (
              <div className="px-3 py-2 text-sm text-muted-foreground">No program matches “{query}”.</div>
            ) : (
              matches.map((r) => {
                const on = picked.has(r.key);
                return (
                  <button
                    type="button"
                    key={r.key}
                    role="checkbox"
                    aria-checked={on}
                    onClick={() => toggle(r.key)}
                    className="flex w-full items-start gap-2 px-3 py-1.5 text-left hover:bg-muted"
                  >
                    <span
                      className={cn(
                        'mt-0.5 flex h-4 w-4 shrink-0 items-center justify-center rounded border',
                        on ? 'border-primary bg-primary text-primary-foreground' : 'border-border'
                      )}
                    >
                      {on && <Check className="h-3 w-3" />}
                    </span>
                    <span className="min-w-0">
                      <span className="block truncate text-sm">{r.label}</span>
                      {r.sublabel && <span className="block truncate text-xs text-muted-foreground">{r.sublabel}</span>}
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
