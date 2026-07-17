'use client';

import { useState, useTransition } from 'react';
import { useRouter } from 'next/navigation';
import { CalendarArrowUp } from 'lucide-react';
import { monthLabel } from '@oceanpick/shared';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { toast } from '@/components/ui/toast';
import { confirmDialog } from '@/components/ui/confirm';
import { rollPlanForward } from '../plan-actions';

/** Add n months to a 'YYYY-MM' value. */
function addMonths(ym: string, n: number): string {
  const m = /^(\d{4})-(\d{2})$/.exec(ym);
  if (!m) return '';
  const total = Number(m[1]) * 12 + (Number(m[2]) - 1) + n;
  return `${Math.floor(total / 12)}-${String((total % 12) + 1).padStart(2, '0')}`;
}
function monthsBetween(a: string, b: string): number {
  const m1 = /^(\d{4})-(\d{2})$/.exec(a);
  const m2 = /^(\d{4})-(\d{2})$/.exec(b);
  if (!m1 || !m2) return NaN;
  return (Number(m2[1]) - Number(m1[1])) * 12 + (Number(m2[2]) - Number(m1[2]));
}

export function RollForwardCard({
  planId,
  planName,
  planStartDate,
  horizon,
}: {
  planId: string;
  planName: string;
  planStartDate: string;
  horizon: number;
}) {
  const router = useRouter();
  const [pending, start] = useTransition();
  const currentYM = planStartDate.slice(0, 7);
  // Default to a one-financial-year roll.
  const [newStart, setNewStart] = useState(() => addMonths(currentYM, 12));

  const months = monthsBetween(currentYM, newStart);
  const valid = Number.isFinite(months) && months >= 1 && months < horizon;

  const label = (ym: string, offset: number) => monthLabel(`${ym}-01`, offset);
  const rollsOffTo = valid ? label(currentYM, months) : '';
  const newEnd = valid ? label(newStart, horizon) : '';
  const tailFrom = valid ? label(newStart, horizon - months + 1) : '';

  async function onRoll() {
    const ok = await confirmDialog({
      title: `Roll “${planName}” forward ${months} month${months === 1 ? '' : 's'}?`,
      description: `${label(currentYM, 1)} – ${rollsOffTo} rolls off this plan (a read-only snapshot is saved first). The window becomes ${label(newStart, 1)} – ${newEnd}, and ${tailFrom} onward starts empty. Computed results are cleared — you'll need to Recalculate.`,
      confirmLabel: 'Snapshot & roll forward',
      destructive: true,
    });
    if (!ok) return;
    start(async () => {
      const res = await rollPlanForward(planId, newStart);
      if (res.error) toast.error(res.error);
      else {
        toast.success(`Rolled forward ${res.months} months — snapshot saved. Recalculate to refresh results.`);
        router.refresh();
      }
    });
  }

  return (
    <div className="rounded-lg border border-border bg-card p-5 text-sm">
      <div className="mb-1 flex items-center gap-2">
        <CalendarArrowUp className="h-4 w-4 text-muted-foreground" />
        <h2 className="text-sm font-semibold">Roll plan forward</h2>
      </div>
      <p className="text-xs text-muted-foreground">
        Move this plan&apos;s {horizon}-month window to a later start once a year has elapsed. Surviving months keep their
        calendar position, so nothing shifts a year out of place.
      </p>

      <div className="mt-4 grid gap-3 sm:grid-cols-2">
        <div className="space-y-1.5">
          <span className="text-xs font-medium text-muted-foreground">Current window</span>
          <p className="font-medium">{label(currentYM, 1)} – {label(currentYM, horizon)}</p>
        </div>
        <label className="block space-y-1.5">
          <span className="text-xs font-medium text-muted-foreground">New start month</span>
          <Input type="month" value={newStart} min={addMonths(currentYM, 1)} onChange={(e) => setNewStart(e.target.value)} />
        </label>
      </div>

      {valid ? (
        <ul className="mt-4 space-y-1 rounded-md border border-warning/30 bg-warning/10 px-3 py-2.5 text-xs text-warning">
          <li>• <b>{label(currentYM, 1)} – {rollsOffTo}</b> ({months} month{months === 1 ? '' : 's'}) rolls off — saved to a read-only snapshot first.</li>
          <li>• New window: <b>{label(newStart, 1)} – {newEnd}</b>.</li>
          <li>• <b>{tailFrom} – {newEnd}</b> starts empty (baseline demand, no harvest).</li>
          <li>• Computed results are cleared — Recalculate afterwards.</li>
        </ul>
      ) : (
        <p className="mt-4 rounded-md bg-destructive/10 px-3 py-2 text-xs text-destructive">
          Pick a start month after {label(currentYM, 1)} and within {horizon - 1} months of it.
        </p>
      )}

      <div className="mt-4">
        <Button variant="destructive" onClick={onRoll} disabled={!valid || pending}>
          {pending ? 'Rolling…' : 'Snapshot & roll forward'}
        </Button>
      </div>
    </div>
  );
}
