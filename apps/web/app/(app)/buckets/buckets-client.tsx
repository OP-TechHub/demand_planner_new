'use client';

import { useActionState, useEffect, useState, useTransition } from 'react';
import { useRouter } from 'next/navigation';
import type { Bucket } from '@oceanpick/shared';
import { cn } from '@/lib/utils';
import { saveBucket, setBucketArchived, type BucketFormState } from './actions';

export type BucketRow = { bucket: Bucket; usage: number; capacity: number };

export function BucketsClient({
  orgId,
  rows,
  canEdit,
}: {
  orgId: string;
  rows: BucketRow[];
  canEdit: boolean;
}) {
  const router = useRouter();
  const [modal, setModal] = useState<null | { bucket: Bucket | null }>(null);
  const [isPending, startTransition] = useTransition();

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

      <div className="overflow-x-auto rounded-lg border">
        <table className="w-full text-sm">
          <thead className="border-b bg-muted/50 text-left text-xs uppercase tracking-wide text-muted-foreground">
            <tr>
              <th className="px-3 py-2">Order</th>
              <th className="px-3 py-2">Name</th>
              <th className="px-3 py-2 text-right">Programs using</th>
              <th className="px-3 py-2 text-right">60mo capacity (kg WR)</th>
              {canEdit && <th className="px-3 py-2" />}
            </tr>
          </thead>
          <tbody>
            {rows.map(({ bucket: b, usage, capacity }) => (
              <tr key={b.id} className={cn('border-b last:border-0 hover:bg-muted/30', b.is_archived && 'opacity-50')}>
                <td className="px-3 py-2 tabular-nums text-muted-foreground">{b.sort_order}</td>
                <td className="px-3 py-2 font-medium">
                  {b.name}
                  {b.is_archived && <span className="ml-2 rounded-full bg-gray-100 px-2 py-0.5 text-xs text-gray-600">archived</span>}
                </td>
                <td className="px-3 py-2 text-right tabular-nums">{usage}</td>
                <td className="px-3 py-2 text-right tabular-nums">{capacity.toLocaleString()}</td>
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
            ))}
          </tbody>
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
    <div className="fixed inset-0 z-40 flex items-center justify-center bg-black/30 p-4" onClick={onClose}>
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
