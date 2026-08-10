'use client';

import { useMemo, useState } from 'react';
import { useRouter } from 'next/navigation';
import Link from 'next/link';
import { Download, Upload, Boxes } from 'lucide-react';
import { monthLabel, type Bucket, type HarvestCell } from '@oceanpick/shared';
import { cn } from '@/lib/utils';
import { toCsv, downloadCsv } from '@/lib/csv';
import { Button } from '@/components/ui/button';
import { EmptyState } from '@/components/ui/empty-state';
import { ScrollX } from '@/components/ui/scroll-x';
import { WideGridImport } from '@/components/wide-grid-import';
import { HarvestEditor } from './harvest-editor';
import { importHarvest } from './actions';

export function HarvestClient({
  planId,
  planStartDate,
  horizon,
  buckets,
  harvestRows,
  canEdit,
}: {
  planId: string;
  planStartDate: string;
  horizon: number;
  buckets: Bucket[];
  harvestRows: HarvestCell[];
  canEdit: boolean;
}) {
  const router = useRouter();
  const [editing, setEditing] = useState<Bucket | null>(null);
  const [importing, setImporting] = useState(false);
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
  const stickyCol =
    'sticky left-0 z-10 transition-shadow group-data-[scrolled=true]/scrollx:shadow-[6px_0_8px_-6px_rgba(0,0,0,0.18)]';

  const capacity = useMemo(() => {
    const m = new Map<string, number>();
    for (const r of harvestRows) m.set(`${r.bucket_id}:${r.month_index}`, r.capacity_kg_wr);
    return m;
  }, [harvestRows]);

  // Capacity is stored numeric(18,4); whole kilos are the useful unit, so round
  // once here — every cell, total and export below derives from this, which keeps
  // the columns adding up exactly as shown.
  const cell = (bucketId: string, month: number) => Math.round(capacity.get(`${bucketId}:${month}`) ?? 0);
  // Totals cover the visible range, so the row total always matches the cells beside it.
  const bucketTotal = (b: Bucket) => visibleMonths.reduce((s, mo) => s + cell(b.id, mo), 0);

  const monthTotals = useMemo(
    () => visibleMonths.map((mo) => buckets.reduce((s, b) => s + cell(b.id, mo), 0)),
    [visibleMonths, buckets, capacity] // eslint-disable-line react-hooks/exhaustive-deps
  );

  // Exports what's on screen — the month range still round-trips through import,
  // which maps columns by their M<n> header rather than by position.
  function onExport() {
    const header = ['bucket', ...visibleMonths.map((mo) => monthLabel(planStartDate, mo))];
    const data = buckets.map((b) => [
      b.name,
      ...visibleMonths.map((mo) => { const v = cell(b.id, mo); return v === 0 ? '' : v; }),
    ]);
    downloadCsv('harvest-plan.csv', toCsv([header, ...data]));
  }

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <h1 className="text-2xl font-semibold tracking-tight">Monthly Harvest Plan</h1>
        <div className="flex items-center gap-2">
          <Button variant="outline" size="sm" onClick={onExport}><Download />Export CSV</Button>
          {canEdit && (
            <Button variant="outline" size="sm" onClick={() => setImporting(true)}><Upload />Import CSV</Button>
          )}
        </div>
      </div>
      <div className="flex flex-wrap items-center gap-2 text-sm">
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
          Harvest capacity (kg WR) by bucket. Empty cells are 0.
          {canEdit ? ' Click a bucket to edit its timeline.' : ''}
        </span>
      </div>

      {buckets.length === 0 ? (
        <EmptyState
          icon={Boxes}
          title="No supply buckets yet"
          description="Harvest capacity is entered per bucket. Create your buckets first, then set their monthly capacity here."
          action={
            <Link
              href="/buckets"
              className="inline-flex items-center gap-2 rounded-md bg-primary px-4 py-2 text-sm font-medium text-primary-foreground transition-colors hover:bg-primary/90"
            >
              Go to Buckets
            </Link>
          }
        />
      ) : (
        <ScrollX className="rounded-lg border border-border">
          <table className="w-max text-xs">
            <thead className="bg-muted/50 text-muted-foreground">
              <tr>
                <th className={cn(stickyCol, 'min-w-[10rem] bg-muted/50 px-3 py-2 text-left font-semibold')}>Bucket</th>
                {visibleMonths.map((mo) => (
                  <th key={mo} className={cn('min-w-[4.5rem] px-2 py-2 text-right font-medium', yearStart(mo) && 'border-l border-border')}>{monthLabel(planStartDate, mo)}</th>
                ))}
                <th className="min-w-[6rem] border-l bg-muted/50 px-3 py-2 text-right font-semibold">
                  {fullRange ? `${horizon}mo total` : 'Range total'}
                </th>
              </tr>
            </thead>
            <tbody>
              {buckets.map((b) => (
                <tr
                  key={b.id}
                  className={cn('border-t hover:bg-muted/30', canEdit && 'cursor-pointer')}
                  onClick={canEdit ? () => setEditing(b) : undefined}
                >
                  <td className={cn(stickyCol, 'min-w-[10rem] border-r bg-card px-3 py-1.5 font-medium')}>{b.name}</td>
                  {visibleMonths.map((mo) => {
                    const v = cell(b.id, mo);
                    return (
                      <td key={mo} className={cn('px-2 py-1.5 text-right tabular-nums', yearStart(mo) && 'border-l border-border/60', v === 0 && 'text-muted-foreground/40')}>
                        {v.toLocaleString()}
                      </td>
                    );
                  })}
                  <td className="border-l px-3 py-1.5 text-right font-semibold tabular-nums">{bucketTotal(b).toLocaleString()}</td>
                </tr>
              ))}
              <tr className="border-t-2 bg-muted/40 font-semibold">
                <td className={cn(stickyCol, 'bg-muted/40 px-3 py-1.5')}>TOTAL</td>
                {monthTotals.map((t, i) => (
                  <td key={visibleMonths[i]} className={cn('px-2 py-1.5 text-right tabular-nums', yearStart(visibleMonths[i]) && 'border-l border-border/60')}>{t.toLocaleString()}</td>
                ))}
                <td className="border-l px-3 py-1.5 text-right tabular-nums">
                  {monthTotals.reduce((s, t) => s + t, 0).toLocaleString()}
                </td>
              </tr>
            </tbody>
          </table>
        </ScrollX>
      )}

      <p className="text-xs text-muted-foreground">Utilization coloring arrives with the calc engine (Phase 2).</p>

      {editing && canEdit && (
        <HarvestEditor
          planId={planId}
          planStartDate={planStartDate}
          horizon={horizon}
          bucket={editing}
          rows={harvestRows.filter((r) => r.bucket_id === editing.id)}
          onClose={() => setEditing(null)}
          onSaved={() => { setEditing(null); router.refresh(); }}
        />
      )}

      {importing && canEdit && (
        <WideGridImport
          title="Import Monthly Harvest"
          keyColumn="bucket"
          keys={buckets.map((b) => ({ key: b.name }))}
          planStartDate={planStartDate}
          horizon={horizon}
          templateName="harvest-plan-template.csv"
          onImport={(rows) => importHarvest(planId, rows)}
          onClose={() => setImporting(false)}
          onDone={() => { setImporting(false); router.refresh(); }}
        />
      )}
    </div>
  );
}

const filterCls = 'rounded-md border px-2.5 py-1.5 text-sm outline-none focus:ring-2 focus:ring-primary';
