'use client';

import { useEffect, useState, useTransition } from 'react';
import { monthLabel } from '@oceanpick/shared';
import { Dialog } from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import { toast } from '@/components/ui/toast';
import { getPromoteContext, promoteInquiry, type PromoteContext } from './promote-actions';

const kg = (n: number) => `${Math.round(n).toLocaleString()} kg`;

/**
 * Move a pipeline program's demand into the active plan. Loads the program's
 * pipeline months and the customer's active programs; the user picks which
 * months to promote and the active target (or "make this program active").
 */
export function PromoteDialog({
  pipelineProgramId,
  planStartDate,
  onClose,
  onDone,
}: {
  pipelineProgramId: string;
  planStartDate: string;
  onClose: () => void;
  onDone: () => void;
}) {
  const [ctx, setCtx] = useState<PromoteContext | null>(null);
  const [picked, setPicked] = useState<Set<number>>(new Set());
  const [choice, setChoice] = useState<string>(''); // 'active:<id>' | 'make_active'
  const [err, setErr] = useState<string | null>(null);
  const [saving, startSave] = useTransition();

  useEffect(() => {
    let cancelled = false;
    getPromoteContext(pipelineProgramId).then((res) => {
      if (cancelled) return;
      setCtx(res);
      if (res.ok) {
        setPicked(new Set(res.months.map((m) => m.month_index)));
        setChoice(res.defaultTargetId ? `active:${res.defaultTargetId}` : 'make_active');
      }
    });
    return () => { cancelled = true; };
  }, [pipelineProgramId]);

  const makeActive = choice === 'make_active';

  function toggle(m: number) {
    setPicked((prev) => { const n = new Set(prev); if (n.has(m)) n.delete(m); else n.add(m); return n; });
  }

  function submit() {
    if (!ctx || !ctx.ok) return;
    setErr(null);
    startSave(async () => {
      const target = makeActive
        ? ({ kind: 'make_active' } as const)
        : ({ kind: 'move', activeProgramId: choice.slice('active:'.length) } as const);
      const res = await promoteInquiry(pipelineProgramId, makeActive ? [] : [...picked], target);
      if (res.ok) { toast.success('Promoted to active.'); onDone(); }
      else setErr(res.error ?? 'Could not promote.');
    });
  }

  return (
    <Dialog open onClose={onClose} title="Promote to active" description="Move this pipeline demand into the active plan.">
      {ctx === null ? (
        <p className="text-sm text-muted-foreground">Loading…</p>
      ) : !ctx.ok ? (
        <p role="alert" className="rounded-md bg-destructive/10 px-3 py-2 text-sm text-destructive">{ctx.error}</p>
      ) : (
        <div className="space-y-4">
          <div className="rounded-md bg-muted/40 px-3 py-2 text-xs text-muted-foreground">
            <div><span className="font-medium text-foreground">{ctx.program.customer}</span> · {ctx.program.item_description} ({ctx.program.item_code})</div>
          </div>

          {/* Target */}
          <div className="text-sm">
            <div className="mb-1 font-medium">Move into</div>
            <select value={choice} onChange={(e) => setChoice(e.target.value)} className="w-full rounded-md border px-2.5 py-1.5 text-sm outline-none focus:ring-2 focus:ring-primary">
              {ctx.targets.map((t) => (
                <option key={t.id} value={`active:${t.id}`}>{t.item_description} ({t.item_code})</option>
              ))}
              <option value="make_active">— Make this program active (all months) —</option>
            </select>
          </div>

          {/* Months */}
          {makeActive ? (
            <p className="rounded-md border border-warning/30 bg-warning/10 px-3 py-2 text-xs text-warning">
              This flips the whole program to active — every month it holds becomes active demand.
            </p>
          ) : ctx.months.length === 0 ? (
            <p className="text-sm text-muted-foreground">This program has no pipeline demand to promote.</p>
          ) : (
            <div className="text-sm">
              <div className="mb-1 flex items-center justify-between">
                <span className="font-medium">Months to promote</span>
                <div className="flex gap-2 text-xs">
                  <button type="button" onClick={() => setPicked(new Set(ctx.months.map((m) => m.month_index)))} className="text-primary hover:underline">All</button>
                  <button type="button" onClick={() => setPicked(new Set())} className="text-primary hover:underline">None</button>
                </div>
              </div>
              <div className="max-h-56 space-y-1 overflow-y-auto rounded-md border p-1">
                {ctx.months.map((m) => (
                  <label key={m.month_index} className="flex cursor-pointer items-center justify-between rounded px-2 py-1 hover:bg-muted">
                    <span className="flex items-center gap-2">
                      <input type="checkbox" checked={picked.has(m.month_index)} onChange={() => toggle(m.month_index)} className="h-4 w-4 accent-primary" />
                      {monthLabel(planStartDate, m.month_index)}
                    </span>
                    <span className="tabular-nums text-muted-foreground">{kg(m.demand_fp)}</span>
                  </label>
                ))}
              </div>
            </div>
          )}

          {err && <p role="alert" className="rounded-md bg-destructive/10 px-3 py-2 text-sm text-destructive">{err}</p>}
          <div className="flex justify-end gap-2">
            <Button variant="outline" onClick={onClose}>Cancel</Button>
            <Button onClick={submit} disabled={saving || (!makeActive && picked.size === 0)}>
              {saving ? 'Promoting…' : 'Promote'}
            </Button>
          </div>
        </div>
      )}
    </Dialog>
  );
}
