'use client';

import { useState, useTransition } from 'react';
import { useRouter } from 'next/navigation';
import { History } from 'lucide-react';
import { monthLabel } from '@oceanpick/shared';
import { Button } from '@/components/ui/button';
import { Select } from '@/components/ui/select';
import { toast } from '@/components/ui/toast';
import { confirmDialog } from '@/components/ui/confirm';
import { restorePlanFromSnapshot } from '../plan-actions';

export interface SnapshotOption {
  id: string;
  name: string;
  planStartDate: string;
  horizon: number;
}

export function RestoreSnapshotCard({
  planId,
  planName,
  planStartDate,
  horizon,
  snapshots,
}: {
  planId: string;
  planName: string;
  planStartDate: string;
  horizon: number;
  snapshots: SnapshotOption[];
}) {
  const router = useRouter();
  const [pending, start] = useTransition();
  const [sel, setSel] = useState(snapshots[0]?.id ?? '');
  const chosen = snapshots.find((s) => s.id === sel);

  const window = (startDate: string) => `${monthLabel(startDate, 1)} – ${monthLabel(startDate, horizon)}`;

  async function onRestore() {
    if (!chosen) return;
    const ok = await confirmDialog({
      title: `Restore “${planName}” from “${chosen.name}”?`,
      description: `The plan's window becomes ${window(chosen.planStartDate)}, and its demand + harvest are replaced by the snapshot's. The current state (${window(planStartDate)}) is snapshotted first, so this is reversible. Programs are unchanged. Computed results are cleared — you'll need to Recalculate.`,
      confirmLabel: 'Snapshot & restore',
      destructive: true,
    });
    if (!ok) return;
    start(async () => {
      const res = await restorePlanFromSnapshot(planId, chosen.id);
      if (res.error) toast.error(res.error);
      else {
        toast.success(`Restored from “${chosen.name}” — Recalculate to refresh results.`);
        router.refresh();
      }
    });
  }

  if (snapshots.length === 0) return null;

  return (
    <div className="rounded-lg border border-border bg-card p-5 text-sm">
      <div className="mb-1 flex items-center gap-2">
        <History className="h-4 w-4 text-muted-foreground" />
        <h2 className="text-sm font-semibold">Restore from snapshot</h2>
      </div>
      <p className="text-xs text-muted-foreground">
        Put this plan back to a saved snapshot — this is how you undo a roll forward. The current state is snapshotted
        first, so you can flip between windows.
      </p>

      <div className="mt-4 grid gap-3 sm:grid-cols-2">
        <div className="space-y-1.5">
          <span className="text-xs font-medium text-muted-foreground">Current window</span>
          <p className="font-medium">{window(planStartDate)}</p>
        </div>
        <label className="block space-y-1.5">
          <span className="text-xs font-medium text-muted-foreground">Snapshot</span>
          <Select value={sel} onChange={(e) => setSel(e.target.value)}>
            {snapshots.map((s) => (
              <option key={s.id} value={s.id}>{s.name}</option>
            ))}
          </Select>
        </label>
      </div>

      {chosen && (
        <ul className="mt-4 space-y-1 rounded-md border border-warning/30 bg-warning/10 px-3 py-2.5 text-xs text-warning">
          <li>• Window becomes <b>{window(chosen.planStartDate)}</b>.</li>
          <li>• Demand &amp; harvest are <b>replaced</b> by the snapshot&apos;s. Programs are unchanged.</li>
          <li>• The current state is snapshotted first — this is reversible.</li>
          <li>• Computed results are cleared — Recalculate afterwards.</li>
        </ul>
      )}

      <div className="mt-4">
        <Button variant="destructive" onClick={onRestore} disabled={!chosen || pending}>
          {pending ? 'Restoring…' : 'Snapshot & restore'}
        </Button>
      </div>
    </div>
  );
}
