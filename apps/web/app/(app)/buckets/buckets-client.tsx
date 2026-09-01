'use client';

import { useActionState, useEffect, useMemo, useState, useTransition } from 'react';
import { useRouter } from 'next/navigation';
import { monthLabel, type Bucket } from '@oceanpick/shared';
import { cn } from '@/lib/utils';
import { saveBucket, setBucketArchived, type BucketFormState } from './actions';

/** `monthly` is harvest capacity per month (kg WR), length === horizon. */
export type BucketRow = { bucket: Bucket; usage: number; monthly: number[] };

export function BucketsClient({
  orgId,
  rows,
  planStartDate,
  horizon,
  canEdit,
}: {
  orgId: string;
  rows: BucketRow[];
  planStartDate: string;
  horizon: number;
  canEdit: boolean;
}) {
  const router = useRouter();
  const [modal, setModal] = useState<null | { bucket: Bucket | null }>(null);
  const [isPending, startTransition] = useTransition();

  const months = useMemo(() => Array.from({ length: horizon }, (_, i) => i + 1), [horizon]);
  const [fromMonth, setFromMonth] = useState(1);
  const [toMonth, setToMonth] = useState(horizon);
  const fullRange = fromMonth === 1 && toMonth === horizon;

  // Keep the range coherent: dragging one end past the other pushes the other end.
  const onFrom = (v: number) => { setFromMonth(v); if (v > toMonth) setToMonth(v); };
  const onTo = (v: number) => { setToMonth(v); if (v < fromMonth) setFromMonth(v); };

  const capacityOf = (r: BucketRow) =>
    r.monthly.slice(fromMonth - 1, toMonth).reduce((s, v) => s + v, 0);

  // An archived bucket's capacity is no longer allocatable, so it would inflate
  // a total that reads as "what this plan has to sell".
  const liveRows = rows.filter((r) => !r.bucket.is_archived);
  const totalCapacity = liveRows.reduce((s, r) => s + capacityOf(r), 0);
  const hasArchived = liveRows.length !== rows.length;

  const nextOrder = (Math.max(0, ...rows.map((r) => r.bucket.sort_order)) || 0) + 10;

  function onArchive(b: Bucket, archived: boolean) {
    startTransition(async () => {
      await setBucketArchived(b.id, archived);
      router.refresh();
    });
  }

  return (
    <div className="mx-auto max-w-4xl space-y-4">
      <div className="flex items-center justify-between">
        <h1 className="text-2xl font-semibold tracking-tight">Buckets</h1>
        {canEdit && (
          <button onClick={() => setModal({ bucket: null })} className="rounded-md bg-primary px-3 py-1.5 text-sm font-medium text-primary-foreground">
            + New Bucket
          </button>
        )}
      </div>

      <div className="flex flex-wrap items-center gap-1.5 text-sm">
        <span className="text-xs font-medium text-muted-foreground">Months</span>
        <select value={fromMonth} onChange={(e) => onFrom(Number(e.target.value))} className={filterCls} aria-label="From month">
          {months.map((mo) => <option key={mo} value={mo}>{monthLabel(planStartDate, mo)}</option>)}
        </select>
        <span className="text-xs text-muted-foreground">to</span>
        <select value={toMonth} onChange={(e) => onTo(Number(e.target.value))} className={filterCls} aria-label="To month">
          {months.map((mo) => <option key={mo} value={mo}>{monthLabel(planStartDate, mo)}</option>)}
        </select>
        {!fullRange && (
          <>
            <button
              type="button"
              onClick={() => { setFromMonth(1); setToMonth(horizon); }}
              className="text-xs font-medium text-primary hover:underline"
            >
              Reset
            </button>
            <span className="text-xs text-muted-foreground">
              Showing {toMonth - fromMonth + 1} of {horizon} months.
            </span>
          </>
        )}
      </div>

      <div className="overflow-x-auto rounded-lg border">
        <table className="w-full text-sm">
          <thead className="border-b bg-muted/50 text-left text-xs uppercase tracking-wide text-muted-foreground">
            <tr>
              <th className="px-3 py-2">Order</th>
              <th className="px-3 py-2">Name</th>
              <th className="px-3 py-2 text-right">Programs using</th>
              <th className="px-3 py-2 text-right">
                {fullRange
                  ? `${horizon}mo capacity (kg WR)`
                  : `${monthLabel(planStartDate, fromMonth)} – ${monthLabel(planStartDate, toMonth)} capacity (kg WR)`}
              </th>
              {canEdit && <th className="px-3 py-2" />}
            </tr>
          </thead>
          <tbody>
            {rows.map((r) => { const { bucket: b, usage } = r; return (
              <tr key={b.id} className={cn('border-b last:border-0 hover:bg-muted/30', b.is_archived && 'opacity-50')}>
                <td className="px-3 py-2 tabular-nums text-muted-foreground">{b.sort_order}</td>
                <td className="px-3 py-2 font-medium">
                  {b.name}
                  {b.is_archived && <span className="ml-2 rounded-full bg-gray-100 px-2 py-0.5 text-xs text-gray-600">archived</span>}
                </td>
                <td className="px-3 py-2 text-right tabular-nums">{usage}</td>
                <td className="px-3 py-2 text-right tabular-nums">{capacityOf(r).toLocaleString()}</td>
                {canEdit && (
                  <td className="px-3 py-2">
                    <div className="flex justify-end gap-3">
                      <button onClick={() => setModal({ bucket: b })} className="text-primary hover:underline">Edit</button>
                      <button
                        onClick={() => onArchive(b, !b.is_archived)}
                        disabled={isPending}
                        className="text-muted-foreground hover:text-foreground"
                      >
                        {b.is_archived ? 'Restore' : 'Archive'}
                      </button>
                    </div>
                  </td>
                )}
              </tr>
            ); })}
          </tbody>
          {rows.length > 0 && (
            <tfoot className="border-t-2 bg-muted/40 font-medium">
              <tr>
                <td className="px-3 py-2" />
                <td className="px-3 py-2">
                  Total
                  {hasArchived && <span className="ml-1.5 text-xs font-normal text-muted-foreground">(excludes archived)</span>}
                </td>
                {/* A bucket can be used on any of a program's three paths, so these
                    don't add up to a program count — no total to show. */}
                <td className="px-3 py-2" />
                <td className="px-3 py-2 text-right tabular-nums">{totalCapacity.toLocaleString()}</td>
                {canEdit && <td className="px-3 py-2" />}
              </tr>
            </tfoot>
          )}
        </table>
        {rows.length === 0 && (
          <div className="p-8 text-center text-sm text-muted-foreground">No buckets yet.</div>
        )}
      </div>

      <p className="text-xs text-muted-foreground">
        Order controls allocation priority (lower goes first). Buckets are shared across every plan and scenario.
      </p>

      {modal && canEdit && (
        <BucketModal
          orgId={orgId}
          bucket={modal.bucket}
          defaultOrder={nextOrder}
          onClose={() => setModal(null)}
          onSaved={() => { setModal(null); router.refresh(); }}
        />
      )}
    </div>
  );
}

const initial: BucketFormState = { error: null, ok: false };

function BucketModal({
  orgId,
  bucket,
  defaultOrder,
  onClose,
  onSaved,
}: {
  orgId: string;
  bucket: Bucket | null;
  defaultOrder: number;
  onClose: () => void;
  onSaved: () => void;
}) {
  const [state, formAction, pending] = useActionState(saveBucket, initial);
  useEffect(() => { if (state.ok) onSaved(); }, [state.ok, onSaved]);

  return (
    <div className="fixed inset-0 z-40 flex items-center justify-center bg-black/50 backdrop-blur-sm p-4" onClick={onClose}>
      <form action={formAction} className="w-full max-w-sm rounded-lg bg-card p-5 text-sm shadow-xl" onClick={(e) => e.stopPropagation()}>
        <input type="hidden" name="org_id" value={orgId} />
        {bucket && <input type="hidden" name="id" value={bucket.id} />}
        <h2 className="mb-3 text-sm font-semibold">{bucket ? 'Edit bucket' : 'New bucket'}</h2>

        <label className="block">
          <span className="text-xs font-medium text-muted-foreground">Name</span>
          <input name="name" defaultValue={bucket?.name ?? ''} className={inputCls} placeholder="e.g. 800-1100g" />
        </label>
        <label className="mt-3 block">
          <span className="text-xs font-medium text-muted-foreground">Order (lower = higher priority)</span>
          <input name="sort_order" type="number" step="1" defaultValue={bucket?.sort_order ?? defaultOrder} className={inputCls} />
        </label>

        {state.error && <p role="alert" className="mt-3 rounded-md bg-destructive/10 px-3 py-2 text-sm text-destructive">{state.error}</p>}

        <div className="mt-4 flex justify-end gap-2">
          <button type="button" onClick={onClose} className="rounded-md border px-3 py-1.5 hover:bg-muted">Cancel</button>
          <button type="submit" disabled={pending} className="rounded-md bg-primary px-3 py-1.5 font-medium text-primary-foreground disabled:opacity-50">
            {pending ? 'Saving…' : bucket ? 'Save' : 'Create'}
          </button>
        </div>
      </form>
    </div>
  );
}

const inputCls = 'mt-1 w-full rounded-md border px-2.5 py-1.5 text-sm outline-none focus:ring-2 focus:ring-primary';
const filterCls = 'rounded-md border px-2.5 py-1.5 text-sm outline-none focus:ring-2 focus:ring-primary';
