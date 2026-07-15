'use client';

import { useMemo, useState } from 'react';
import { useRouter } from 'next/navigation';
import { monthLabel, type Bucket, type HarvestCell } from '@oceanpick/shared';
import { cn } from '@/lib/utils';
import { HarvestEditor } from './harvest-editor';

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
  const months = useMemo(() => Array.from({ length: horizon }, (_, i) => i + 1), [horizon]);

  const capacity = useMemo(() => {
    const m = new Map<string, number>();
    for (const r of harvestRows) m.set(`${r.bucket_id}:${r.month_index}`, r.capacity_kg_wr);
    return m;
  }, [harvestRows]);

  const cell = (bucketId: string, month: number) => capacity.get(`${bucketId}:${month}`) ?? 0;
  const bucketTotal = (b: Bucket) => months.reduce((s, mo) => s + cell(b.id, mo), 0);

  const monthTotals = useMemo(
    () => months.map((mo) => buckets.reduce((s, b) => s + cell(b.id, mo), 0)),
    [months, buckets, capacity] // eslint-disable-line react-hooks/exhaustive-deps
  );

  return (
    <div className="space-y-4">
      <h1 className="text-2xl font-semibold tracking-tight">Monthly Harvest Plan</h1>
      <p className="text-xs text-muted-foreground">
        Harvest capacity (kg WR) by bucket. Empty cells are 0.
        {canEdit ? ' Click a bucket to edit its timeline.' : ''}
      </p>

      {buckets.length === 0 ? (
        <div className="rounded-lg border p-8 text-center text-sm text-muted-foreground">
          No buckets found. Seed the buckets first.
        </div>
      ) : (
        <div className="overflow-x-auto rounded-lg border">
          <table className="w-max text-xs">
            <thead className="bg-muted/50 text-muted-foreground">
              <tr>
                <th className="sticky left-0 z-10 min-w-[10rem] bg-muted/50 px-3 py-2 text-left font-semibold">Bucket</th>
                {months.map((mo) => (
                  <th key={mo} className="min-w-[4.5rem] px-2 py-2 text-right font-medium">{monthLabel(planStartDate, mo)}</th>
                ))}
                <th className="min-w-[6rem] border-l bg-muted/50 px-3 py-2 text-right font-semibold">60mo total</th>
              </tr>
            </thead>
            <tbody>
              {buckets.map((b) => (
                <tr
                  key={b.id}
                  className={cn('border-t hover:bg-muted/30', canEdit && 'cursor-pointer')}
                  onClick={canEdit ? () => setEditing(b) : undefined}
                >
                  <td className="sticky left-0 z-10 min-w-[10rem] border-r bg-card px-3 py-1.5 font-medium">{b.name}</td>
                  {months.map((mo) => {
                    const v = cell(b.id, mo);
                    return (
                      <td key={mo} className={cn('px-2 py-1.5 text-right tabular-nums', v === 0 && 'text-muted-foreground/50')}>
                        {v.toLocaleString()}
                      </td>
                    );
                  })}
                  <td className="border-l px-3 py-1.5 text-right font-semibold tabular-nums">{bucketTotal(b).toLocaleString()}</td>
                </tr>
              ))}
              <tr className="border-t-2 bg-muted/40 font-semibold">
                <td className="sticky left-0 z-10 bg-muted/40 px-3 py-1.5">TOTAL</td>
                {monthTotals.map((t, i) => (
                  <td key={i} className="px-2 py-1.5 text-right tabular-nums">{t.toLocaleString()}</td>
                ))}
                <td className="border-l px-3 py-1.5 text-right tabular-nums">
                  {monthTotals.reduce((s, t) => s + t, 0).toLocaleString()}
                </td>
              </tr>
            </tbody>
          </table>
        </div>
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
    </div>
  );
}
