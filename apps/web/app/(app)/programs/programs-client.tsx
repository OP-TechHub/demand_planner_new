'use client';

import { useMemo, useState, useTransition } from 'react';
import { useRouter } from 'next/navigation';
import { PROGRAM_STATUS_META, type Bucket, type Program, type ProgramStatus } from '@oceanpick/shared';
import { cn } from '@/lib/utils';
import { toCsv, downloadCsv } from '@/lib/csv';
import { archiveProgram } from './actions';
import { ProgramPanel } from './program-panel';
import { ImportPrograms, PROGRAM_CSV_HEADER } from './import-programs';

type PanelState = null | { mode: 'new' } | { mode: 'edit'; program: Program };

export function ProgramsClient({
  planId,
  programs,
  buckets,
  canEdit,
}: {
  planId: string;
  programs: Program[];
  buckets: Bucket[];
  canEdit: boolean;
}) {
  const router = useRouter();
  const [panel, setPanel] = useState<PanelState>(null);
  const [importing, setImporting] = useState(false);
  const [isPending, startTransition] = useTransition();

  const [status, setStatus] = useState<'all' | ProgramStatus>('all');
  const [customer, setCustomer] = useState('all');
  const [search, setSearch] = useState('');

  const bucketName = useMemo(() => {
    const m = new Map(buckets.map((b) => [b.id, b.name]));
    return (id: string | null) => (id ? m.get(id) ?? '—' : '—');
  }, [buckets]);

  const customers = useMemo(
    () => Array.from(new Set(programs.map((p) => p.customer).filter(Boolean))).sort(),
    [programs]
  );

  const rows = useMemo(() => {
    const q = search.trim().toLowerCase();
    return programs.filter((p) => {
      if (status !== 'all' && p.status !== status) return false;
      if (customer !== 'all' && p.customer !== customer) return false;
      if (q && !`${p.item_code} ${p.item_description} ${p.customer}`.toLowerCase().includes(q)) return false;
      return true;
    });
  }, [programs, status, customer, search]);

  function onArchive(p: Program) {
    if (!confirm(`Archive "${p.item_description || p.item_code}"? It can be restored from the database.`)) return;
    const fd = new FormData();
    fd.set('id', p.id);
    startTransition(async () => {
      await archiveProgram(fd);
      router.refresh();
    });
  }

  function onSaved() {
    setPanel(null);
    router.refresh();
  }

  function onExport() {
    const nm = new Map(buckets.map((b) => [b.id, b.name]));
    const name = (id: string | null) => (id ? nm.get(id) ?? '' : '');
    const data = rows.map((p) => [
      p.status, p.item_code, p.item_description, p.customer, p.max_monthly_demand_fp,
      name(p.primary_bucket_id), p.primary_yield,
      name(p.secondary_bucket_id), p.secondary_yield ?? '',
      name(p.tertiary_bucket_id), p.tertiary_yield ?? '',
      p.price_per_fp, p.barra_cost_wr, p.packing_cost_fp, p.processing_cost_fp,
      p.storage_cost_fp, p.freight_cost_fp, p.other_costs_fp, p.locked,
    ]);
    downloadCsv('programs.csv', toCsv([[...PROGRAM_CSV_HEADER], ...data]));
  }

  return (
    <div className="mx-auto max-w-5xl space-y-4">
      <div className="flex items-center justify-between">
        <h1 className="text-2xl font-semibold tracking-tight">Programs</h1>
        <div className="flex items-center gap-2">
          <button onClick={onExport} className="rounded-md border px-3 py-1.5 text-sm hover:bg-muted">
            Export CSV
          </button>
          {canEdit && (
            <button onClick={() => setImporting(true)} className="rounded-md border px-3 py-1.5 text-sm hover:bg-muted">
              Import CSV
            </button>
          )}
          {canEdit && (
            <button
              onClick={() => setPanel({ mode: 'new' })}
              className="rounded-md bg-primary px-3 py-1.5 text-sm font-medium text-primary-foreground"
            >
              + New Program
            </button>
          )}
        </div>
      </div>

      <div className="flex flex-wrap items-center gap-2 text-sm">
        <select value={status} onChange={(e) => setStatus(e.target.value as typeof status)} className={filterCls}>
          <option value="all">All statuses</option>
          <option value="active">Active</option>
          <option value="pipeline">Pipeline</option>
          <option value="inactive">Inactive</option>
        </select>
        <select value={customer} onChange={(e) => setCustomer(e.target.value)} className={filterCls}>
          <option value="all">All customers</option>
          {customers.map((c) => (
            <option key={c} value={c}>{c}</option>
          ))}
        </select>
        <input
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          placeholder="Search code, product, customer…"
          className={cn(filterCls, 'min-w-[16rem] flex-1')}
        />
      </div>

      <div className="overflow-x-auto rounded-lg border">
        <table className="w-full text-sm">
          <thead className="border-b bg-muted/50 text-left text-xs uppercase tracking-wide text-muted-foreground">
            <tr>
              <th className="w-8 px-3 py-2" />
              <th className="px-3 py-2">Status</th>
              <th className="px-3 py-2">Customer</th>
              <th className="px-3 py-2">Product</th>
              <th className="px-3 py-2">Primary bucket</th>
              <th className="px-3 py-2 text-right">Demand (kg/mo)</th>
              {canEdit && <th className="px-3 py-2" />}
            </tr>
          </thead>
          <tbody>
            {rows.map((p) => (
              <tr key={p.id} className="border-b last:border-0 hover:bg-muted/30">
                <td className="px-3 py-2">{p.locked ? '🔒' : ''}</td>
                <td className="px-3 py-2"><StatusChip status={p.status} /></td>
                <td className="px-3 py-2">{p.customer}</td>
                <td className="max-w-[18rem] truncate px-3 py-2" title={p.item_description}>{p.item_description}</td>
                <td className="px-3 py-2">{bucketName(p.primary_bucket_id)}</td>
                <td className="px-3 py-2 text-right tabular-nums">{p.max_monthly_demand_fp.toLocaleString()}</td>
                {canEdit && (
                  <td className="px-3 py-2">
                    <div className="flex justify-end gap-2">
                      <button onClick={() => setPanel({ mode: 'edit', program: p })} className="text-primary hover:underline">Edit</button>
                      <button onClick={() => onArchive(p)} disabled={isPending} className="text-muted-foreground hover:text-destructive">Archive</button>
                    </div>
                  </td>
                )}
              </tr>
            ))}
          </tbody>
        </table>

        {rows.length === 0 && (
          <div className="p-8 text-center text-sm text-muted-foreground">
            {programs.length === 0
              ? 'No programs yet. Get started by adding your first program.'
              : 'No programs match these filters.'}
          </div>
        )}
      </div>

      <p className="text-xs text-muted-foreground">
        Showing {rows.length} of {programs.length} programs
      </p>

      {panel && canEdit && (
        <ProgramPanel
          planId={planId}
          buckets={buckets}
          program={panel.mode === 'edit' ? panel.program : null}
          onClose={() => setPanel(null)}
          onSaved={onSaved}
        />
      )}

      {importing && canEdit && (
        <ImportPrograms
          planId={planId}
          buckets={buckets}
          existingCodes={new Set(programs.map((p) => p.item_code))}
          onClose={() => setImporting(false)}
          onDone={() => { setImporting(false); router.refresh(); }}
        />
      )}
    </div>
  );
}

const filterCls = 'rounded-md border px-2.5 py-1.5 text-sm outline-none focus:ring-2 focus:ring-primary';

function StatusChip({ status }: { status: ProgramStatus }) {
  const tone = PROGRAM_STATUS_META[status].tone;
  const cls =
    tone === 'active'
      ? 'bg-green-100 text-green-800'
      : tone === 'pipeline'
        ? 'bg-blue-100 text-blue-800'
        : 'bg-gray-100 text-gray-600';
  return <span className={cn('rounded-full px-2 py-0.5 text-xs font-medium', cls)}>{PROGRAM_STATUS_META[status].label}</span>;
}
