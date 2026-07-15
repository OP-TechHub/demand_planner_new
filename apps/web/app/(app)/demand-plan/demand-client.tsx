'use client';

import { useMemo, useState } from 'react';
import { useRouter } from 'next/navigation';
import { monthLabel, type DemandCell, type Program } from '@oceanpick/shared';
import { cn } from '@/lib/utils';
import { toCsv, downloadCsv } from '@/lib/csv';
import { WideGridImport } from '@/components/wide-grid-import';
import { DemandEditor } from './demand-editor';
import { importDemand } from './actions';

export function DemandClient({
  planId,
  planStartDate,
  horizon,
  programs,
  demandRows,
  canEdit,
}: {
  planId: string;
  planStartDate: string;
  horizon: number;
  programs: Program[];
  demandRows: DemandCell[];
  canEdit: boolean;
}) {
  const router = useRouter();
  const [editing, setEditing] = useState<Program | null>(null);
  const [importing, setImporting] = useState(false);
  const [customer, setCustomer] = useState('all');
  const [search, setSearch] = useState('');

  const months = useMemo(() => Array.from({ length: horizon }, (_, i) => i + 1), [horizon]);

  // override lookup: `${programId}:${month}` -> demand_fp
  const overrides = useMemo(() => {
    const m = new Map<string, number>();
    for (const r of demandRows) m.set(`${r.program_id}:${r.month_index}`, r.demand_fp);
    return m;
  }, [demandRows]);

  const effective = (p: Program, month: number) =>
    overrides.get(`${p.id}:${month}`) ?? p.max_monthly_demand_fp;

  const customers = useMemo(
    () => Array.from(new Set(programs.map((p) => p.customer).filter(Boolean))).sort(),
    [programs]
  );

  const visible = useMemo(() => {
    const q = search.trim().toLowerCase();
    return programs.filter((p) => {
      if (customer !== 'all' && p.customer !== customer) return false;
      if (q && !`${p.item_code} ${p.item_description} ${p.customer}`.toLowerCase().includes(q)) return false;
      return true;
    });
  }, [programs, customer, search]);

  // TOTAL row: sum of effective demand across in-scope (non-inactive) visible programs.
  const totals = useMemo(
    () => months.map((mo) => visible.filter((p) => p.status !== 'inactive').reduce((s, p) => s + effective(p, mo), 0)),
    [months, visible, overrides] // eslint-disable-line react-hooks/exhaustive-deps
  );

  function onExport() {
    const header = ['item_code', 'item_description', ...months.map((mo) => `M${mo}`)];
    const data = programs.map((p) => [
      p.item_code,
      p.item_description,
      ...months.map((mo) => overrides.get(`${p.id}:${mo}`) ?? ''),
    ]);
    downloadCsv('demand-plan.csv', toCsv([header, ...data]));
  }

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <h1 className="text-2xl font-semibold tracking-tight">Monthly Demand Plan</h1>
        <div className="flex items-center gap-2">
          <button onClick={onExport} className="rounded-md border px-3 py-1.5 text-sm hover:bg-muted">Export CSV</button>
          {canEdit && (
            <button onClick={() => setImporting(true)} className="rounded-md border px-3 py-1.5 text-sm hover:bg-muted">Import CSV</button>
          )}
        </div>
      </div>

      <div className="flex flex-wrap items-center gap-2 text-sm">
        <select value={customer} onChange={(e) => setCustomer(e.target.value)} className={filterCls}>
          <option value="all">All customers</option>
          {customers.map((c) => <option key={c} value={c}>{c}</option>)}
        </select>
        <input
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          placeholder="Search program…"
          className={cn(filterCls, 'min-w-[14rem]')}
        />
        <span className="text-xs text-muted-foreground">
          Effective demand (override where set, else program baseline).
          {canEdit ? ' Click a program to edit its timeline.' : ''}
        </span>
      </div>

      {programs.length === 0 ? (
        <div className="rounded-lg border p-8 text-center text-sm text-muted-foreground">
          No programs yet. Add programs first, then set their monthly demand here.
        </div>
      ) : (
        <div className="overflow-x-auto rounded-lg border">
          <table className="w-max text-xs">
            <thead className="bg-muted/50 text-muted-foreground">
              <tr>
                <th className="sticky left-0 z-10 min-w-[16rem] bg-muted/50 px-3 py-2 text-left font-semibold">
                  Program
                </th>
                {months.map((mo) => (
                  <th key={mo} className="min-w-[4.5rem] px-2 py-2 text-right font-medium">
                    {monthLabel(planStartDate, mo)}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {visible.map((p) => (
                <tr
                  key={p.id}
                  className={cn('border-t hover:bg-muted/30', canEdit && 'cursor-pointer')}
                  onClick={canEdit ? () => setEditing(p) : undefined}
                >
                  <td className="sticky left-0 z-10 min-w-[16rem] max-w-[16rem] truncate border-r bg-card px-3 py-1.5" title={`${p.customer} — ${p.item_description}`}>
                    <span className="font-medium">{p.customer}</span>{' '}
                    <span className="text-muted-foreground">{p.item_description}</span>
                  </td>
                  {months.map((mo) => {
                    const isOverride = overrides.has(`${p.id}:${mo}`);
                    return (
                      <td
                        key={mo}
                        className={cn('px-2 py-1.5 text-right tabular-nums', isOverride && 'font-semibold text-primary')}
                        title={isOverride ? 'Overridden (baseline: ' + p.max_monthly_demand_fp.toLocaleString() + ')' : 'Baseline'}
                      >
                        {effective(p, mo).toLocaleString()}
                      </td>
                    );
                  })}
                </tr>
              ))}
              <tr className="border-t-2 bg-muted/40 font-semibold">
                <td className="sticky left-0 z-10 bg-muted/40 px-3 py-1.5">TOTAL (Active + Pipeline)</td>
                {totals.map((t, i) => (
                  <td key={i} className="px-2 py-1.5 text-right tabular-nums">{t.toLocaleString()}</td>
                ))}
              </tr>
            </tbody>
          </table>
        </div>
      )}

      <p className="text-xs text-muted-foreground">
        Fulfilment coloring arrives with the calc engine (Phase 2).
      </p>

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
          knownKeys={new Set(programs.map((p) => p.item_code))}
          horizon={horizon}
          onImport={(rows) => importDemand(planId, rows)}
          onClose={() => setImporting(false)}
          onDone={() => { setImporting(false); router.refresh(); }}
        />
      )}
    </div>
  );
}

const filterCls = 'rounded-md border px-2.5 py-1.5 text-sm outline-none focus:ring-2 focus:ring-primary';
