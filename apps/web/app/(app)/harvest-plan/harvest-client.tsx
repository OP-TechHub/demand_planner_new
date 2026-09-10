'use client';

import { useMemo, useState, useTransition } from 'react';
import { useRouter } from 'next/navigation';
import Link from 'next/link';
import { Download, Upload, Boxes, Save, Factory } from 'lucide-react';
import { toast } from '@/components/ui/toast';
import { monthLabel, type Bucket, type HarvestCell, type HarvestRequestCell } from '@oceanpick/shared';
import { cn } from '@/lib/utils';
import { toCsv, downloadCsv } from '@/lib/csv';
import { Button } from '@/components/ui/button';
import { EmptyState } from '@/components/ui/empty-state';
import { ScrollX } from '@/components/ui/scroll-x';
import { WideGridImport } from '@/components/wide-grid-import';
import { HarvestEditor } from './harvest-editor';
import { importHarvest, saveHarvestRequest } from './actions';

export function HarvestClient({
  planId,
  planStartDate,
  horizon,
  buckets,
  harvestRows,
  canEdit,
  request,
  canEditRequest,
}: {
  planId: string;
  planStartDate: string;
  horizon: number;
  buckets: Bucket[];
  harvestRows: HarvestCell[];
  canEdit: boolean;
  /** Processing plant's requested kg WR, one row per month and size. */
  request: HarvestRequestCell[];
  canEditRequest: boolean;
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

  // Request plan: local edits until saved. Blank means nothing requested.
  // Keyed bucket:month, with an empty bucket standing for the sizeless rows
  // entered before the request carried a size — see the migration that added it.
  const reqKey = (bucketId: string | null, mo: number) => `${bucketId ?? ''}:${mo}`;
  const initialReq = useMemo(() => {
    const out: Record<string, string> = {};
    for (const r of request) out[reqKey(r.bucket_id, r.month_index)] = String(Math.round(r.quantity_kg_wr));
    return out;
  }, [request]);
  const [req, setReq] = useState<Record<string, string>>(initialReq);
  const [savingReq, startSaveReq] = useTransition();
  const reqDirty = useMemo(() => {
    const keys = new Set([...Object.keys(initialReq), ...Object.keys(req)]);
    for (const k of keys) if ((initialReq[k] ?? '') !== (req[k] ?? '')) return true;
    return false;
  }, [initialReq, req]);
  const reqValue = (bucketId: string | null, mo: number) => Number(req[reqKey(bucketId, mo)] ?? '') || 0;

  // The sizeless line only exists while there is something on it. Once the
  // plant restates those months by bucket and clears it, the row goes for good
  // — which is why it is driven by the live edits, not by what was loaded.
  const hasSizeless = useMemo(
    () => months.some((mo) => reqValue(null, mo) > 0),
    [months, req] // eslint-disable-line react-hooks/exhaustive-deps
  );

  const reqBucketTotal = (bucketId: string | null) =>
    visibleMonths.reduce((sum, mo) => sum + reqValue(bucketId, mo), 0);
  const reqMonthTotal = (mo: number) =>
    buckets.reduce((sum, b) => sum + reqValue(b.id, mo), 0) + reqValue(null, mo);

  function saveRequest() {
    // Every bucket in every month, so a cleared cell is deleted rather than left
    // behind at its old value. The sizeless row goes too, so it can be emptied.
    const entries = months.flatMap((mo) => [
      ...buckets.map((b) => ({ bucket_id: b.id, month_index: mo, quantity_kg_wr: reqValue(b.id, mo) })),
      { bucket_id: null, month_index: mo, quantity_kg_wr: reqValue(null, mo) },
    ]);
    startSaveReq(async () => {
      const res = await saveHarvestRequest(planId, entries);
      if (res.error) toast.error(res.error);
      else { toast.success('Request plan saved'); router.refresh(); }
    });
  }

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
        <ScrollX className="max-h-[70vh] rounded-lg border border-border">
          <table className="w-max text-xs">
            {/* Sticky month row — see the note in components/output-grid.tsx. */}
            <thead className="bg-muted text-muted-foreground">
              <tr>
                <th className={cn(stickyCol, 'sticky top-0 z-30 min-w-[10rem] border-b border-border bg-muted px-3 py-2 text-left font-semibold')}>Bucket</th>
                {visibleMonths.map((mo) => (
                  <th key={mo} className={cn('sticky top-0 z-20 min-w-[4.5rem] border-b border-border bg-muted px-2 py-2 text-right font-medium', yearStart(mo) && 'border-l border-border')}>{monthLabel(planStartDate, mo)}</th>
                ))}
                <th className="sticky top-0 z-20 min-w-[6rem] border-b border-l border-border bg-muted px-3 py-2 text-right font-semibold">
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

      {/* Harvest Plan — Request Plan: the processing plant's monthly requirement.
          Same month columns as the grid above, so the range filter lines them up. */}
      <section className="space-y-2">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <div>
            <h2 className="flex items-center gap-1.5 text-lg font-semibold">
              <Factory className="h-4 w-4 text-muted-foreground" /> Harvest Plan — Request Plan
            </h2>
            <p className="text-xs text-muted-foreground">
              Whole round the <b>processing plant</b> is requesting each month, by size bucket (kg WR). Same rows and
              months as the capacity grid above, so the two compare line for line. Maintained by the plant on its own
              permission, and not used by the calc engine.
            </p>
          </div>
          {canEditRequest && (
            <Button size="sm" onClick={saveRequest} disabled={savingReq || !reqDirty}>
              <Save className="h-4 w-4" /> {savingReq ? 'Saving…' : 'Save request'}
            </Button>
          )}
        </div>

        <ScrollX className="rounded-lg border border-border">
          <table className="w-max text-xs">
            <thead className="bg-muted text-muted-foreground">
              <tr>
                <th className={cn(stickyCol, 'sticky top-0 z-30 min-w-[10rem] border-b border-border bg-muted px-3 py-2 text-left font-semibold')}>
                  Bucket
                </th>
                {visibleMonths.map((mo) => (
                  <th key={mo} className={cn('sticky top-0 z-20 min-w-[4.5rem] border-b border-border bg-muted px-2 py-2 text-right font-medium', yearStart(mo) && 'border-l border-border')}>
                    {monthLabel(planStartDate, mo)}
                  </th>
                ))}
                <th className="sticky top-0 z-20 min-w-[6rem] border-b border-l border-border bg-muted px-3 py-2 text-right font-semibold">
                  {fullRange ? `${horizon}mo total` : 'Range total'}
                </th>
              </tr>
            </thead>
            <tbody>
              {[
                ...buckets.map((b) => ({ id: b.id as string | null, name: b.name })),
                // Kept last and only while it holds something: it is history, not
                // a bucket, and it must not read as one more size.
                ...(hasSizeless ? [{ id: null, name: 'No size stated' }] : []),
              ].map((row) => (
                <tr key={row.id ?? 'sizeless'} className="border-t hover:bg-muted/30">
                  <td
                    className={cn(
                      stickyCol,
                      'min-w-[10rem] border-r bg-card px-3 py-1.5 font-medium',
                      row.id === null && 'italic text-muted-foreground'
                    )}
                    title={
                      row.id === null
                        ? 'Requested before the plan carried sizes. Restate these months by bucket, then clear this row.'
                        : undefined
                    }
                  >
                    {row.name}
                  </td>
                  {visibleMonths.map((mo) => (
                    <td key={mo} className={cn('px-1 py-1 text-right tabular-nums', yearStart(mo) && 'border-l border-border/60')}>
                      {canEditRequest ? (
                        <input
                          type="number"
                          min={0}
                          step="1"
                          value={req[reqKey(row.id, mo)] ?? ''}
                          onChange={(e) =>
                            setReq((prev) => ({ ...prev, [reqKey(row.id, mo)]: e.target.value }))
                          }
                          placeholder="0"
                          aria-label={`Requested ${row.name} for ${monthLabel(planStartDate, mo)}`}
                          className="w-[4rem] rounded-md border px-1.5 py-0.5 text-right text-xs tabular-nums outline-none focus:ring-2 focus:ring-primary"
                        />
                      ) : (
                        <span className={cn(reqValue(row.id, mo) === 0 && 'text-muted-foreground/40')}>
                          {reqValue(row.id, mo).toLocaleString()}
                        </span>
                      )}
                    </td>
                  ))}
                  <td className="border-l px-3 py-1.5 text-right font-semibold tabular-nums">
                    {reqBucketTotal(row.id).toLocaleString()}
                  </td>
                </tr>
              ))}
              <tr className="border-t-2 bg-muted/40 font-semibold">
                <td className={cn(stickyCol, 'bg-muted/40 px-3 py-1.5')}>TOTAL</td>
                {visibleMonths.map((mo) => (
                  <td key={mo} className={cn('px-2 py-1.5 text-right tabular-nums', yearStart(mo) && 'border-l border-border/60')}>
                    {reqMonthTotal(mo).toLocaleString()}
                  </td>
                ))}
                <td className="border-l px-3 py-1.5 text-right tabular-nums">
                  {visibleMonths.reduce((sum, mo) => sum + reqMonthTotal(mo), 0).toLocaleString()}
                </td>
              </tr>
            </tbody>
          </table>
        </ScrollX>

        {!canEditRequest && (
          <p className="text-xs text-muted-foreground">
            Read-only — editing this needs the <b>Harvest Request Plan</b> permission on this plan (Admin → Plans → Access).
          </p>
        )}
      </section>

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
