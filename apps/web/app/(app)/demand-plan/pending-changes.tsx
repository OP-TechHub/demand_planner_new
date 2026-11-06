'use client';

import { useState, useTransition } from 'react';
import { useRouter } from 'next/navigation';
import { Check, ChevronDown, ChevronRight, Clock, Undo2, X } from 'lucide-react';
import { monthLabel, type DemandCell, type Program } from '@oceanpick/shared';
import { cn } from '@/lib/utils';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { toast } from '@/components/ui/toast';
import { decideDemandRequest, withdrawDemandRequest } from './approval-actions';

export type DemandRequest = {
  id: string;
  requested_by: string;
  requester: string;
  source: 'editor' | 'grid' | 'import' | 'reset';
  cells: { program_id: string; month_index: number; demand_fp: number | null }[];
  cell_count: number;
  status: 'pending' | 'approved' | 'rejected' | 'withdrawn';
  created_at: string;
  decider: string | null;
  decided_at: string | null;
  decision_note: string | null;
};

const SOURCE_LABEL: Record<DemandRequest['source'], string> = {
  editor: 'Program editor',
  grid: 'Grid paste / clear',
  import: 'CSV import',
  reset: 'Reset to baseline',
};

const STATUS_BADGE = {
  approved: 'success',
  rejected: 'destructive',
  withdrawn: 'outline',
  pending: 'warning',
} as const;

function fmt(iso: string): string {
  return new Date(iso).toLocaleString(undefined, { day: '2-digit', month: 'short', hour: '2-digit', minute: '2-digit' });
}

/**
 * Demand Plan changes waiting for approval, above the grid. Approvers see every
 * pending request with Accept / Reject; a requester sees their own, can
 * withdraw them, and sees what happened to their recent ones.
 */
export function PendingChanges({
  requests,
  recent,
  meId,
  canApprove,
  programs,
  demandRows,
  planStartDate,
}: {
  requests: DemandRequest[];
  /** The viewer's own recently decided requests, so they learn the outcome here too. */
  recent: DemandRequest[];
  meId: string;
  canApprove: boolean;
  programs: Program[];
  demandRows: DemandCell[];
  planStartDate: string;
}) {
  const router = useRouter();
  const [open, setOpen] = useState<string | null>(null);
  const [notes, setNotes] = useState<Record<string, string>>({});
  const [busy, start] = useTransition();

  if (!requests.length && !recent.length) return null;

  const progById = new Map(programs.map((p) => [p.id, p]));
  const current = new Map(demandRows.map((r) => [`${r.program_id}:${r.month_index}`, Number(r.demand_fp)]));
  const effective = (programId: string, m: number) => {
    const p = progById.get(programId);
    return current.get(`${programId}:${m}`) ?? Number(p?.max_monthly_demand_fp ?? 0);
  };

  const decide = (id: string, approve: boolean) =>
    start(async () => {
      const res = await decideDemandRequest(id, approve, notes[id]);
      if (res.error) toast.error(res.error);
      else { toast.success(approve ? 'Change approved and applied' : 'Change rejected'); router.refresh(); }
    });
  const withdraw = (id: string) =>
    start(async () => {
      const res = await withdrawDemandRequest(id);
      if (res.error) toast.error(res.error);
      else { toast.success('Request withdrawn'); router.refresh(); }
    });

  const detail = (r: DemandRequest) => {
    const rows = [...r.cells].sort((a, b) => {
      const pa = progById.get(a.program_id), pb = progById.get(b.program_id);
      return (pa?.sort_order ?? 0) - (pb?.sort_order ?? 0) || a.month_index - b.month_index;
    });
    return (
      <div className="max-h-72 overflow-auto rounded-md border border-border bg-card">
        <table className="w-full text-xs">
          <thead className="sticky top-0 bg-muted text-muted-foreground">
            <tr>
              <th className="px-3 py-1.5 text-left font-medium">Program</th>
              <th className="px-3 py-1.5 text-left font-medium">Month</th>
              <th className="px-3 py-1.5 text-right font-medium">Now (kg FP)</th>
              <th className="px-3 py-1.5 text-right font-medium">Proposed (kg FP)</th>
            </tr>
          </thead>
          <tbody>
            {rows.map((c) => {
              const p = progById.get(c.program_id);
              const now = effective(c.program_id, c.month_index);
              const next = c.demand_fp ?? Number(p?.max_monthly_demand_fp ?? 0);
              return (
                <tr key={`${c.program_id}:${c.month_index}`} className="border-t border-border">
                  <td className="px-3 py-1">{p ? `${p.customer} · ${p.item_description}` : 'Removed program'}</td>
                  <td className="px-3 py-1">{monthLabel(planStartDate, c.month_index)}</td>
                  <td className="px-3 py-1 text-right tabular-nums">{now.toLocaleString()}</td>
                  <td className={cn('px-3 py-1 text-right font-semibold tabular-nums', next > now && 'text-success', next < now && 'text-destructive')}>
                    {next.toLocaleString()}
                    {c.demand_fp === null && <span className="ml-1 font-normal text-muted-foreground">(baseline)</span>}
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
    );
  };

  return (
    <div className="space-y-2 rounded-lg border border-warning/30 bg-warning/5 p-3">
      {requests.length > 0 && (
        <div className="flex items-center gap-2 text-sm font-medium text-warning">
          <Clock className="h-4 w-4" />
          {requests.length} demand change{requests.length === 1 ? '' : 's'} waiting for approval
          <span className="font-normal text-muted-foreground">
            — not in the plan until accepted{canApprove ? '' : ' by an approver'}.
          </span>
        </div>
      )}

      {requests.map((r) => {
        const mine = r.requested_by === meId;
        const isOpen = open === r.id;
        return (
          <div key={r.id} className="rounded-md border border-border bg-card p-2.5">
            <div className="flex flex-wrap items-center gap-2 text-sm">
              <button type="button" onClick={() => setOpen(isOpen ? null : r.id)} className="flex items-center gap-1 font-medium hover:underline">
                {isOpen ? <ChevronDown className="h-4 w-4" /> : <ChevronRight className="h-4 w-4" />}
                {r.cell_count} cell{r.cell_count === 1 ? '' : 's'}
              </button>
              <span className="text-muted-foreground">
                by {mine ? 'you' : r.requester} · {SOURCE_LABEL[r.source]} · {fmt(r.created_at)}
              </span>
              <div className="ml-auto flex items-center gap-2">
                {canApprove && !mine && (
                  <>
                    <input
                      value={notes[r.id] ?? ''}
                      onChange={(e) => setNotes((n) => ({ ...n, [r.id]: e.target.value }))}
                      placeholder="Note (optional)"
                      className="h-8 w-44 rounded-md border px-2 text-xs outline-none focus:ring-2 focus:ring-primary"
                    />
                    <Button size="sm" variant="success" disabled={busy} onClick={() => decide(r.id, true)}><Check />Approve</Button>
                    <Button size="sm" variant="outline" disabled={busy} onClick={() => decide(r.id, false)}><X />Reject</Button>
                  </>
                )}
                {mine && (
                  <Button size="sm" variant="ghost" disabled={busy} onClick={() => withdraw(r.id)}><Undo2 />Withdraw</Button>
                )}
                {canApprove && mine && <span className="text-xs text-muted-foreground">Another approver has to decide this.</span>}
              </div>
            </div>
            {isOpen && <div className="mt-2">{detail(r)}</div>}
          </div>
        );
      })}

      {recent.length > 0 && (
        <div className="space-y-1 pt-1">
          <div className="text-xs font-medium uppercase tracking-wide text-muted-foreground">Your recent requests</div>
          {recent.map((r) => (
            <div key={r.id} className="flex flex-wrap items-center gap-2 text-xs text-muted-foreground">
              <Badge variant={STATUS_BADGE[r.status]} className="capitalize">{r.status}</Badge>
              <span>{r.cell_count} cell{r.cell_count === 1 ? '' : 's'} · {SOURCE_LABEL[r.source]} · sent {fmt(r.created_at)}</span>
              {r.decider && r.status !== 'withdrawn' && r.decided_at && <span>· by {r.decider}, {fmt(r.decided_at)}</span>}
              {r.decision_note && <span className="italic">“{r.decision_note}”</span>}
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
