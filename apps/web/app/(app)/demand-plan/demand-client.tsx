'use client';

import { useMemo, useState, type CSSProperties } from 'react';
import { useRouter } from 'next/navigation';
import Link from 'next/link';
import { Download, Upload, LineChart } from 'lucide-react';
import { monthLabel, type DemandCell, type Program } from '@oceanpick/shared';
import { cn } from '@/lib/utils';
import { toCsv, downloadCsv } from '@/lib/csv';
import { Button } from '@/components/ui/button';
import { EmptyState } from '@/components/ui/empty-state';
import { ScrollX } from '@/components/ui/scroll-x';
import { WideGridImport } from '@/components/wide-grid-import';
import { DemandEditor } from './demand-editor';
import { importDemand } from './actions';

export type FulfilCell = { program_id: string; month_index: number; demand_fp: number; rolling_fp: number };

export function DemandClient({
  planId,
  planStartDate,
  horizon,
  programs,
  demandRows,
  fulfilment,
  canEdit,
}: {
  planId: string;
  planStartDate: string;
  horizon: number;
  programs: Program[];
  demandRows: DemandCell[];
  fulfilment: FulfilCell[];
  canEdit: boolean;
}) {
  const router = useRouter();
  const [editing, setEditing] = useState<Program | null>(null);
  const [importing, setImporting] = useState(false);
  const [customer, setCustomer] = useState('all');
  const [search, setSearch] = useState('');
  const [statusView, setStatusView] = useState<StatusView>('active');
  const [fromMonth, setFromMonth] = useState(1);
  const [toMonth, setToMonth] = useState(horizon);

  const months = useMemo(() => Array.from({ length: horizon }, (_, i) => i + 1), [horizon]);
  // The columns actually rendered — the month-range filter narrows the 60-wide grid.
  const visibleMonths = useMemo(
    () => months.filter((m) => m >= fromMonth && m <= toMonth),
    [months, fromMonth, toMonth]
  );
  const fullRange = fromMonth === 1 && toMonth === horizon;

  // Keep the range coherent: dragging one end past the other pushes the other end.
  const onFrom = (v: number) => { setFromMonth(v); if (v > toMonth) setToMonth(v); };
  const onTo = (v: number) => { setToMonth(v); if (v < fromMonth) setFromMonth(v); };

  const yearStart = (mo: number) => mo > 1 && (mo - 1) % 12 === 0;
  // Two frozen left columns: Customer (left-0, 12rem) then Product (left-12rem,
  // 16rem). The scroll shadow rides the rightmost (Product) column only.
  const custCol = 'sticky left-0 z-10 min-w-[12rem] max-w-[12rem]';
  const prodCol =
    'sticky left-[12rem] z-10 min-w-[16rem] max-w-[16rem] transition-shadow group-data-[scrolled=true]/scrollx:shadow-[6px_0_8px_-6px_rgba(0,0,0,0.18)]';

  // override lookup: `${programId}:${month}` -> demand_fp
  const overrides = useMemo(() => {
    const m = new Map<string, number>();
    for (const r of demandRows) m.set(`${r.program_id}:${r.month_index}`, r.demand_fp);
    return m;
  }, [demandRows]);

  const effective = (p: Program, month: number) =>
    overrides.get(`${p.id}:${month}`) ?? p.max_monthly_demand_fp;

  // Fulfilment from the last recompute: `${programId}:${month}` -> {demand, fulfilled}.
  const fulfil = useMemo(() => {
    const m = new Map<string, { demand: number; fulfilled: number }>();
    for (const f of fulfilment) m.set(`${f.program_id}:${f.month_index}`, { demand: f.demand_fp, fulfilled: f.rolling_fp });
    return m;
  }, [fulfilment]);
  const hasFulfil = fulfilment.length > 0;

  // A green→red gradient cell (green = fulfilled fraction) + hover breakdown.
  const fulfilCell = (p: Program, mo: number): { style?: CSSProperties; title?: string } => {
    const f = fulfil.get(`${p.id}:${mo}`);
    if (!f || f.demand <= 0) return {};
    const ful = Math.min(f.fulfilled, f.demand);
    const s = Math.round(Math.max(0, Math.min(1, ful / f.demand)) * 100);
    return {
      style: { background: `linear-gradient(90deg, #bbf7d0 0 ${s}%, #fecaca ${s}% 100%)`, color: '#1e293b' },
      title: `Fulfilled ${Math.round(ful).toLocaleString()} of ${Math.round(f.demand).toLocaleString()} kg (${s}%) — short ${Math.round(f.demand - ful).toLocaleString()} kg`,
    };
  };

  const customers = useMemo(
    () => Array.from(new Set(programs.map((p) => p.customer).filter(Boolean))).sort(),
    [programs]
  );

  // Row counts per status view, for the tab badges.
  const counts = useMemo(
    () => ({
      active: programs.filter((p) => p.status === 'active').length,
      pipeline: programs.filter((p) => p.status === 'pipeline').length,
      all: programs.length,
    }),
    [programs]
  );

  const visible = useMemo(() => {
    const q = search.trim().toLowerCase();
    return programs.filter((p) => {
      if (statusView !== 'all' && p.status !== statusView) return false;
      if (customer !== 'all' && p.customer !== customer) return false;
      if (q && !`${p.item_code} ${p.item_description} ${p.customer}`.toLowerCase().includes(q)) return false;
      return true;
    });
  }, [programs, statusView, customer, search]);

  // TOTAL row: sum of effective demand across in-scope (non-inactive) visible
  // programs — so the 'All' view still excludes inactive from the total.
  const totals = useMemo(
    () => visibleMonths.map((mo) => visible.filter((p) => p.status !== 'inactive').reduce((s, p) => s + effective(p, mo), 0)),
    [visibleMonths, visible, overrides] // eslint-disable-line react-hooks/exhaustive-deps
  );
  const totalLabel =
    statusView === 'active' ? 'TOTAL (Active)'
    : statusView === 'pipeline' ? 'TOTAL (Pipeline)'
    : 'TOTAL (Active + Pipeline)';

  // Exports the currently visible set — so the status tab splits it: Active,
  // Pipeline, or All export separately (filename reflects which). Values are the
  // effective demand shown on screen (override where set, else baseline). The
  // month range round-trips through import, which maps columns by month heading.
  function onExport() {
    const header = ['item_code', 'item_description', ...visibleMonths.map((mo) => monthLabel(planStartDate, mo))];
    const data = visible.map((p) => [
      p.item_code,
      p.item_description,
      ...visibleMonths.map((mo) => effective(p, mo)),
    ]);
    downloadCsv(`demand-plan-${statusView}.csv`, toCsv([header, ...data]));
  }

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <h1 className="text-2xl font-semibold tracking-tight">Monthly Demand Plan</h1>
        <div className="flex items-center gap-2">
          <Button variant="outline" size="sm" onClick={onExport} title={`Export the ${EXPORT_LABEL[statusView]} programs shown`}>
            <Download />Export {EXPORT_LABEL[statusView]}
          </Button>
          {canEdit && (
            <Button variant="outline" size="sm" onClick={() => setImporting(true)}><Upload />Import CSV</Button>
          )}
        </div>
      </div>

      <div className="flex w-max items-center gap-0.5 rounded-lg border border-border bg-muted/30 p-0.5 text-sm">
        {STATUS_TABS.map((t) => (
          <button
            key={t.key}
            type="button"
            onClick={() => setStatusView(t.key)}
            className={cn(
              'rounded-md px-3 py-1 font-medium transition-colors',
              statusView === t.key ? 'bg-card text-foreground shadow-sm' : 'text-muted-foreground hover:text-foreground'
            )}
          >
            {t.label}
            <span className={cn('ml-1.5 text-xs', statusView === t.key ? 'text-muted-foreground' : 'opacity-70')}>
              {counts[t.key]}
            </span>
          </button>
        ))}
      </div>

      <div className="flex flex-wrap items-center gap-2 text-sm">
        <select value={customer} onChange={(e) => setCustomer(e.target.value)} className={filterCls}>
          <option value="all">All customers</option>
          {customers.map((c) => <option key={c} value={c}>{c}</option>)}
        </select>
        <input
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          placeholder="Search customer or product…"
          className={cn(filterCls, 'min-w-[14rem]')}
        />

        <div className="flex items-center gap-1.5">
          <span className="text-xs font-medium text-muted-foreground">Months</span>
          <select value={fromMonth} onChange={(e) => onFrom(Number(e.target.value))} className={filterCls} aria-label="From month">
            {months.map((mo) => <option key={mo} value={mo}>{monthLabel(planStartDate, mo)}</option>)}
          </select>
          <span className="text-xs text-muted-foreground">to</span>
          <select value={toMonth} onChange={(e) => onTo(Number(e.target.value))} className={filterCls} aria-label="To month">
            {months.map((mo) => <option key={mo} value={mo}>{monthLabel(planStartDate, mo)}</option>)}
          </select>
          {!fullRange && (
            <button
              type="button"
              onClick={() => { setFromMonth(1); setToMonth(horizon); }}
              className="text-xs font-medium text-primary hover:underline"
            >
              Reset
            </button>
          )}
        </div>

        <span className="text-xs text-muted-foreground">
          {!fullRange && <>Showing {visibleMonths.length} of {horizon} months. </>}
          Effective demand (override where set, else program baseline).
          {canEdit ? ' Click a program to edit its timeline.' : ''}
        </span>
      </div>

      {programs.length === 0 ? (
        <EmptyState
          icon={LineChart}
          title="No programs to plan demand for"
          description="Demand is set per program. Add programs first, then set their monthly demand here."
          action={
            <Link
              href="/programs"
              className="inline-flex items-center gap-2 rounded-md bg-primary px-4 py-2 text-sm font-medium text-primary-foreground transition-colors hover:bg-primary/90"
            >
              Go to Programs
            </Link>
          }
        />
      ) : (
        <ScrollX className="rounded-lg border border-border">
          <table className="w-max text-xs">
            <thead className="bg-muted/50 text-muted-foreground">
              <tr>
                <th className={cn(custCol, 'bg-muted/50 px-3 py-2 text-left font-semibold')}>
                  Customer
                </th>
                <th className={cn(prodCol, 'bg-muted/50 px-3 py-2 text-left font-semibold')}>
                  Product
                </th>
                {visibleMonths.map((mo) => (
                  <th key={mo} className={cn('min-w-[4.5rem] px-2 py-2 text-right font-medium', yearStart(mo) && 'border-l border-border')}>
                    {monthLabel(planStartDate, mo)}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {visible.map((p) => (
                <tr
                  key={p.id}
                  className={cn('border-t hover:bg-muted/30', canEdit && 'cursor-pointer', p.status === 'inactive' && 'opacity-60')}
                  onClick={canEdit ? () => setEditing(p) : undefined}
                >
                  <td
                    className={cn(
                      custCol,
                      'truncate border-l-4 border-r bg-card px-3 py-1.5 font-medium',
                      STATUS_ACCENT[p.status]
                    )}
                    title={`${p.customer} · ${p.status}`}
                  >
                    {p.customer}
                  </td>
                  <td
                    className={cn(prodCol, 'truncate border-r bg-card px-3 py-1.5 text-muted-foreground')}
                    title={p.item_description}
                  >
                    {p.item_description}
                    {statusView === 'all' && (
                      <span className={cn(
                        'ml-1.5 rounded px-1 py-0.5 text-[10px] font-medium uppercase tracking-wide',
                        STATUS_BADGE[p.status]
                      )}>
                        {p.status}
                      </span>
                    )}
                  </td>
                  {visibleMonths.map((mo) => {
                    const isOverride = overrides.has(`${p.id}:${mo}`);
                    const f = fulfilCell(p, mo);
                    return (
                      <td
                        key={mo}
                        style={f.style}
                        className={cn('px-2 py-1.5 text-right tabular-nums', yearStart(mo) && 'border-l border-border/60', isOverride && !f.style && 'font-semibold text-primary')}
                        title={f.title ?? (isOverride ? 'Overridden (baseline: ' + p.max_monthly_demand_fp.toLocaleString() + ')' : 'Baseline')}
                      >
                        {effective(p, mo).toLocaleString()}
                      </td>
                    );
                  })}
                </tr>
              ))}
              <tr className="border-t-2 bg-muted/40 font-semibold">
                <td colSpan={2} className={cn('sticky left-0 z-10 min-w-[28rem] bg-muted/40 px-3 py-1.5 transition-shadow group-data-[scrolled=true]/scrollx:shadow-[6px_0_8px_-6px_rgba(0,0,0,0.18)]')}>{totalLabel}</td>
                {totals.map((t, i) => (
                  <td key={visibleMonths[i]} className={cn('px-2 py-1.5 text-right tabular-nums', yearStart(visibleMonths[i]) && 'border-l border-border/60')}>{t.toLocaleString()}</td>
                ))}
              </tr>
            </tbody>
          </table>
        </ScrollX>
      )}

      {hasFulfil ? (
        <p className="flex flex-wrap items-center gap-x-2 gap-y-1 text-xs text-muted-foreground">
          Cells are shaded by fulfilment from the last recalculation —
          <span className="rounded px-1" style={{ background: '#bbf7d0', color: '#1e293b' }}>fully met</span>,
          <span className="rounded px-1" style={{ background: '#fecaca', color: '#1e293b' }}>short</span>,
          or a green/red split for partial. Hover a cell for the fulfilled vs short split.
        </p>
      ) : (
        <p className="text-xs text-muted-foreground">
          Recalculate to shade cells by fulfilment (green = met, red = short). Pipeline fulfilment shows only when the plan&apos;s scope includes pipeline.
        </p>
      )}

      {editing && canEdit && (
        <DemandEditor
          planId={planId}
          planStartDate={planStartDate}
          horizon={horizon}
          program={editing}
          rows={demandRows.filter((r) => r.program_id === editing.id)}
          onClose={() => setEditing(null)}
          onSaved={() => { setEditing(null); router.refresh(); }}
        />
      )}

      {importing && canEdit && (
        <WideGridImport
          title="Import Monthly Demand"
          keyColumn="item_code"
          keys={programs.map((p) => ({ key: p.item_code, note: p.item_description }))}
          noteColumn="item_description"
          planStartDate={planStartDate}
          horizon={horizon}
          templateName="demand-plan-template.csv"
          onImport={(rows) => importDemand(planId, rows)}
          onClose={() => setImporting(false)}
          onDone={() => { setImporting(false); router.refresh(); }}
        />
      )}
    </div>
  );
}

const filterCls = 'rounded-md border px-2.5 py-1.5 text-sm outline-none focus:ring-2 focus:ring-primary';

type StatusView = 'active' | 'pipeline' | 'all';
const STATUS_TABS: { key: StatusView; label: string }[] = [
  { key: 'active', label: 'Active' },
  { key: 'pipeline', label: 'Pipeline' },
  { key: 'all', label: 'All programs' },
];
// Short labels for the export button + filename (one word each).
const EXPORT_LABEL: Record<StatusView, string> = { active: 'Active', pipeline: 'Pipeline', all: 'All' };

// Colour cues used in the All view: active = green, pipeline = yellow,
// inactive = muted grey. Left accent bar + matching badge on each row.
const STATUS_ACCENT: Record<string, string> = {
  active: 'border-l-success',
  pipeline: 'border-l-warning',
  inactive: 'border-l-border',
};
const STATUS_BADGE: Record<string, string> = {
  active: 'bg-success/10 text-success',
  pipeline: 'bg-warning/10 text-warning',
  inactive: 'bg-muted text-muted-foreground',
};
