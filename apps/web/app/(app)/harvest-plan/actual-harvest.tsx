'use client';

import { useMemo, useState, useTransition } from 'react';
import { useRouter } from 'next/navigation';
import { ClipboardCheck, Plus, Save, Trash2 } from 'lucide-react';
import { toast } from '@/components/ui/toast';
import { monthLabel, type HarvestActualBucket, type HarvestActualCell } from '@oceanpick/shared';
import { cn } from '@/lib/utils';
import { Button } from '@/components/ui/button';
import { ScrollX } from '@/components/ui/scroll-x';
import { useInputGridSelection, pasteCellCls } from '@/components/paste-grid';
import { saveHarvestActual, saveActualBucket, removeActualBucket } from './actions';

type Row = { id: string | null; name: string; bucket?: HarvestActualBucket };

/**
 * Actual Harvest — what was really landed, per month, against the capacity
 * plan above it.
 *
 * Its sizes are its own list (harvest_actual_buckets): the farm grades what it
 * lands however it grades it, so a size added here never appears on the
 * capacity grid or the request plan, and theirs never appear here. Because the
 * two lists need not match, the comparison with plan is made on the month's
 * totals only. "No size stated" is always offered, for a landed total the farm
 * did not break down.
 *
 * Kept sparse: a blank cell means nothing recorded, not zero harvested — which
 * is why the variance line only counts months with something in them, rather
 * than showing the whole future as a shortfall.
 */
export function ActualHarvestTable({
  planId,
  planStartDate,
  horizon,
  months,
  visibleMonths,
  fullRange,
  buckets,
  actual,
  canEditActual,
  orgId,
  canEditBuckets,
  planMonthTotal,
  stickyCol,
  yearStart,
}: {
  planId: string;
  planStartDate: string;
  horizon: number;
  months: number[];
  visibleMonths: number[];
  fullRange: boolean;
  buckets: HarvestActualBucket[];
  actual: HarvestActualCell[];
  canEditActual: boolean;
  orgId: string;
  canEditBuckets: boolean;
  /** Planned capacity for a month, all planning buckets together. */
  planMonthTotal: (month: number) => number;
  stickyCol: string;
  yearStart: (mo: number) => boolean;
}) {
  const router = useRouter();
  // Keyed bucket:month, with an empty bucket for the "No size stated" line.
  const key = (bucketId: string | null, mo: number) => `${bucketId ?? ''}:${mo}`;
  const initial = useMemo(() => {
    const out: Record<string, string> = {};
    for (const r of actual) out[key(r.bucket_id, r.month_index)] = String(Math.round(r.quantity_kg_wr));
    return out;
  }, [actual]);
  const [vals, setVals] = useState<Record<string, string>>(initial);
  const [saving, startSave] = useTransition();
  // null = closed; 'new' = adding; a bucket = editing that one.
  const [bucketModal, setBucketModal] = useState<HarvestActualBucket | 'new' | null>(null);
  // Same default the Buckets page offers: after the last bucket, in steps of 10.
  const nextOrder = (Math.max(0, ...buckets.map((b) => b.sort_order)) || 0) + 10;
  const dirty = useMemo(() => {
    const keys = new Set([...Object.keys(initial), ...Object.keys(vals)]);
    for (const k of keys) if ((initial[k] ?? '') !== (vals[k] ?? '')) return true;
    return false;
  }, [initial, vals]);

  const rows: Row[] = [
    ...buckets.map((b) => ({ id: b.id as string | null, name: b.is_archived ? `${b.name} (removed)` : b.name, bucket: b })),
    { id: null, name: 'No size stated' },
  ];

  const value = (bucketId: string | null, mo: number) => Number(vals[key(bucketId, mo)] ?? '') || 0;
  const setCell = (row: number, col: number, v: string) =>
    setVals((prev) => ({ ...prev, [key(rows[row].id, visibleMonths[col])]: v }));
  // Drag or Shift+click across the boxes, then Delete clears them all; a paste lands at the top-left.
  const sel = useInputGridSelection({
    rows: rows.length,
    cols: visibleMonths.length,
    resetKey: `${rows.length}|${visibleMonths.join()}`,
    clear: (r, c) => setCell(r, c, ''),
    paste: (r, c, v) => setCell(r, c, v === null ? '' : String(Math.round(v))),
  });

  // A month counts as recorded once any line in it carries a figure. Variance
  // against a month nobody has reported yet would just be the whole plan.
  const recorded = (mo: number) => rows.some((r) => (vals[key(r.id, mo)] ?? '') !== '');
  const monthTotal = (mo: number) => rows.reduce((s, r) => s + value(r.id, mo), 0);
  const rowTotal = (bucketId: string | null) => visibleMonths.reduce((s, mo) => s + value(bucketId, mo), 0);
  const variance = (mo: number) => monthTotal(mo) - planMonthTotal(mo);

  const reportedMonths = visibleMonths.filter(recorded);
  const rangeActual = reportedMonths.reduce((s, mo) => s + monthTotal(mo), 0);
  const rangePlan = reportedMonths.reduce((s, mo) => s + planMonthTotal(mo), 0);
  const rangeVariance = rangeActual - rangePlan;

  function save() {
    // Every line in every month of the horizon, so a cleared cell is deleted
    // rather than left behind — the same contract the request plan saves under.
    const entries = months.flatMap((mo) =>
      rows.map((r) => ({ bucket_id: r.id, month_index: mo, quantity_kg_wr: value(r.id, mo) }))
    );
    startSave(async () => {
      const res = await saveHarvestActual(planId, entries);
      if (res.error) toast.error(res.error);
      else { toast.success('Actual harvest saved'); router.refresh(); }
    });
  }

  const varianceCell = (v: number, recordedMonth: boolean) => {
    if (!recordedMonth) return <span className="text-muted-foreground/40">—</span>;
    const sign = v > 0 ? '+' : '';
    return (
      <span className={cn(v > 0 && 'text-success', v < 0 && 'text-destructive')}>
        {sign}
        {v.toLocaleString()}
      </span>
    );
  };

  return (
    <section className="space-y-2">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div>
          <h2 className="flex items-center gap-1.5 text-lg font-semibold">
            <ClipboardCheck className="h-4 w-4 text-muted-foreground" /> Actual Harvest
          </h2>
          <p className="text-xs text-muted-foreground">
            Whole round <b>actually landed</b> each month (kg WR), by the farm&apos;s own size buckets — separate from the
            planning buckets above, so adding one here changes nothing else. The <b>vs plan</b> line compares the
            month&apos;s total against total harvest capacity — <span className="text-success">over</span> or{' '}
            <span className="text-destructive">under</span>. Months with nothing recorded are left blank rather than
            counted as a shortfall. Reference only, and not used by the calc engine.
          </p>
        </div>
        <div className="flex items-center gap-2">
          {canEditBuckets && (
            <Button
              size="sm"
              variant="outline"
              onClick={() => setBucketModal('new')}
              title="Add a size to the Actual Harvest list. It does not appear on the capacity grid or the request plan."
            >
              <Plus className="h-4 w-4" /> Add bucket
            </Button>
          )}
          {canEditActual && (
            <Button size="sm" onClick={save} disabled={saving || !dirty}>
              <Save className="h-4 w-4" /> {saving ? 'Saving…' : 'Save actuals'}
            </Button>
          )}
        </div>
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
                {fullRange ? `${horizon}mo total (kg WR)` : 'Range total (kg WR)'}
              </th>
            </tr>
          </thead>
          <tbody>
            {rows.map((row, ri) => (
              <tr key={row.id ?? 'sizeless'} className="border-t hover:bg-muted/30">
                <td
                  className={cn(
                    stickyCol,
                    'min-w-[10rem] border-r bg-card px-3 py-1.5 font-medium',
                    row.id === null && 'italic text-muted-foreground',
                    row.bucket?.is_archived && 'text-muted-foreground line-through decoration-muted-foreground/40'
                  )}
                  title={
                    row.id === null
                      ? 'A month’s landed total that was not broken down by size.'
                      : canEditBuckets ? 'Click to rename or remove this bucket.' : undefined
                  }
                >
                  {row.bucket && canEditBuckets ? (
                    <button type="button" className="text-left hover:underline" onClick={() => setBucketModal(row.bucket!)}>
                      {row.name}
                    </button>
                  ) : (
                    row.name
                  )}
                </td>
                {visibleMonths.map((mo, ci) => (
                  <td key={mo} className={cn('px-1 py-1 text-right tabular-nums', yearStart(mo) && 'border-l border-border/60')}>
                    {canEditActual ? (
                      <input
                        type="number"
                        min={0}
                        step="1"
                        value={vals[key(row.id, mo)] ?? ''}
                        onChange={(e) => setVals((prev) => ({ ...prev, [key(row.id, mo)]: e.target.value }))}
                        {...sel.inputProps(ri, ci)}
                        placeholder="—"
                        aria-label={`Actual ${row.name} for ${monthLabel(planStartDate, mo)}`}
                        className={cn(inputCellCls, sel.isSelected(ri, ci) && pasteCellCls.selected)}
                      />
                    ) : (
                      <span className={cn((vals[key(row.id, mo)] ?? '') === '' && 'text-muted-foreground/40')}>
                        {(vals[key(row.id, mo)] ?? '') === '' ? '—' : value(row.id, mo).toLocaleString()}
                      </span>
                    )}
                  </td>
                ))}
                <td className="border-l px-3 py-1.5 text-right font-semibold tabular-nums">
                  {rowTotal(row.id).toLocaleString()}
                </td>
              </tr>
            ))}
            <tr className="border-t-2 bg-muted/40 font-semibold">
              <td className={cn(stickyCol, 'bg-muted/40 px-3 py-1.5')}>TOTAL</td>
              {visibleMonths.map((mo) => (
                <td key={mo} className={cn('px-2 py-1.5 text-right tabular-nums', yearStart(mo) && 'border-l border-border/60')}>
                  {monthTotal(mo).toLocaleString()}
                </td>
              ))}
              <td className="border-l px-3 py-1.5 text-right tabular-nums">{rangeActual.toLocaleString()}</td>
            </tr>
            <tr className="border-t bg-muted/20">
              <td className={cn(stickyCol, 'bg-muted/20 px-3 py-1.5 font-medium')} title="Total actual minus total planned capacity, for months with something recorded.">
                vs plan (kg WR)
              </td>
              {visibleMonths.map((mo) => (
                <td
                  key={mo}
                  className={cn('px-2 py-1.5 text-right tabular-nums', yearStart(mo) && 'border-l border-border/60')}
                  title={recorded(mo) ? `Planned ${planMonthTotal(mo).toLocaleString()} · actual ${monthTotal(mo).toLocaleString()} kg WR` : 'Nothing recorded yet'}
                >
                  {varianceCell(variance(mo), recorded(mo))}
                </td>
              ))}
              <td
                className="border-l px-3 py-1.5 text-right font-semibold tabular-nums"
                title={`Recorded months only — planned ${rangePlan.toLocaleString()} · actual ${rangeActual.toLocaleString()} kg WR`}
              >
                {varianceCell(rangeVariance, reportedMonths.length > 0)}
              </td>
            </tr>
          </tbody>
        </table>
      </ScrollX>

      {(!canEditActual || !canEditBuckets) && (
        <p className="text-xs text-muted-foreground">
          {!canEditActual && <>Read-only — recording actuals needs the <b>Actual Harvest</b> permission on this plan (Admin → Plans → Access). </>}
          {!canEditBuckets && <>Adding a size here needs the <b>Actual Harvest</b> permission (Admin → Plans → Access).</>}
        </p>
      )}

      {/* A new bucket arrives through router.refresh() as one more row, with
          nothing recorded. Figures typed but not yet saved stay put: the row
          state is keyed by bucket id, not by position. */}
      {bucketModal && canEditBuckets && (
        <ActualBucketModal
          orgId={orgId}
          bucket={bucketModal === 'new' ? null : bucketModal}
          defaultOrder={nextOrder}
          onClose={() => setBucketModal(null)}
          onSaved={(msg) => { setBucketModal(null); toast.success(msg); router.refresh(); }}
        />
      )}
    </section>
  );
}

/** Add, rename or remove one size on the Actual Harvest list. */
function ActualBucketModal({
  orgId,
  bucket,
  defaultOrder,
  onClose,
  onSaved,
}: {
  orgId: string;
  bucket: HarvestActualBucket | null;
  defaultOrder: number;
  onClose: () => void;
  onSaved: (message: string) => void;
}) {
  const [name, setName] = useState(bucket?.name ?? '');
  const [order, setOrder] = useState(String(bucket?.sort_order ?? defaultOrder));
  const [error, setError] = useState<string | null>(null);
  const [pending, start] = useTransition();

  function submit(e: React.FormEvent) {
    e.preventDefault();
    start(async () => {
      const res = await saveActualBucket({ id: bucket?.id ?? null, orgId, name, sortOrder: Number(order) });
      if (res.error) setError(res.error);
      else onSaved(bucket ? 'Bucket updated' : 'Bucket added');
    });
  }
  function remove() {
    if (!bucket) return;
    start(async () => {
      const res = await removeActualBucket(bucket.id);
      if (res.error) setError(res.error);
      else onSaved(res.archived ? 'Bucket removed — figures already recorded against it are kept' : 'Bucket removed');
    });
  }

  return (
    <div className="fixed inset-0 z-40 flex items-center justify-center bg-black/50 p-4 backdrop-blur-sm" onClick={onClose}>
      <form onSubmit={submit} className="w-full max-w-sm rounded-lg bg-card p-5 text-sm shadow-xl" onClick={(e) => e.stopPropagation()}>
        <h2 className="text-sm font-semibold">{bucket ? 'Edit actual-harvest bucket' : 'New actual-harvest bucket'}</h2>
        <p className="mb-3 mt-1 text-xs text-muted-foreground">Only used by Actual Harvest — the planning buckets are not changed.</p>

        <label className="block">
          <span className="text-xs font-medium text-muted-foreground">Name</span>
          <input value={name} onChange={(e) => setName(e.target.value)} className={modalInputCls} placeholder="e.g. 800g up" autoFocus />
        </label>
        <label className="mt-3 block">
          <span className="text-xs font-medium text-muted-foreground">Order (lower shows first)</span>
          <input value={order} onChange={(e) => setOrder(e.target.value)} type="number" step="1" className={modalInputCls} />
        </label>

        {error && <p role="alert" className="mt-3 rounded-md bg-destructive/10 px-3 py-2 text-sm text-destructive">{error}</p>}

        <div className="mt-4 flex items-center justify-between gap-2">
          {bucket ? (
            <button
              type="button"
              onClick={remove}
              disabled={pending}
              className="inline-flex items-center gap-1 rounded-md px-2 py-1.5 text-destructive hover:bg-destructive/10 disabled:opacity-50"
              title="Removes it from the list. If figures were recorded against it, they are kept and it stays visible where they are."
            >
              <Trash2 className="h-4 w-4" /> Remove
            </button>
          ) : <span />}
          <div className="flex gap-2">
            <button type="button" onClick={onClose} className="rounded-md border px-3 py-1.5 hover:bg-muted">Cancel</button>
            <button type="submit" disabled={pending} className="rounded-md bg-primary px-3 py-1.5 font-medium text-primary-foreground disabled:opacity-50">
              {pending ? 'Saving…' : bucket ? 'Save' : 'Create'}
            </button>
          </div>
        </div>
      </form>
    </div>
  );
}

const inputCellCls = 'w-[4rem] rounded-md border px-1.5 py-0.5 text-right text-xs tabular-nums outline-none focus:ring-2 focus:ring-primary';
const modalInputCls = 'mt-1 w-full rounded-md border px-2.5 py-1.5 text-sm outline-none focus:ring-2 focus:ring-primary';
