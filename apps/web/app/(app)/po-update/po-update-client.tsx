'use client';

import { Fragment, useActionState, useEffect, useMemo, useState, useTransition } from 'react';
import { useRouter } from 'next/navigation';
import { ChevronRight, Plus, Search, X } from 'lucide-react';
import { monthLabel } from '@oceanpick/shared';
import { cn } from '@/lib/utils';
import { num0 } from '@/lib/format';
import { Button } from '@/components/ui/button';
import { confirmDialog } from '@/components/ui/confirm';
import { toCsv, downloadCsv } from '@/lib/csv';
import { savePo, deletePo, type PoFormState } from './actions';

/** One stored row: a single month of one PO. */
export type PoLine = {
  id: string;
  program_id: string;
  month_index: number;
  quantity_fp: number;
  po_ref: string;
  received_on: string | null;
  notes: string | null;
};

/** A demand override. Months without one fall back to the program's baseline. */
export type DemandCell = { program_id: string; month_index: number; demand_fp: number };

export type ProgramRow = {
  id: string;
  item_code: string;
  item_description: string;
  customer: string;
  status: string;
  max_monthly_demand_fp: number;
};

/**
 * Programs are listed status by status. A PO against a pipeline program — an
 * inquiry that hasn't converted — is a different act from one against live
 * business, so the two never share a list. Anything else (inactive) keeps its own
 * group rather than being hidden: a program can be deactivated after POs were
 * recorded against it, and silently dropping those would be worse.
 */
const GROUPS = [
  { key: 'active', label: 'Active programs' },
  { key: 'pipeline', label: 'Pipeline programs' },
  { key: 'other', label: 'Other programs' },
] as const;
const groupOf = (status: string) => (status === 'active' || status === 'pipeline' ? status : 'other');

/** The lines of one PO, folded back into the thing the user actually entered. */
type Po = {
  key: string;
  programId: string;
  poRef: string;
  months: number[];
  /** Per-month quantity, or null when the months hold differing figures. */
  perMonth: number | null;
  total: number;
  receivedOn: string | null;
  notes: string | null;
};

/** A program with everything the list needs about it, for the current window. */
type Entry = {
  program: ProgramRow;
  pos: Po[];
  /** Forecast demand over the visible months (override where set, else baseline). */
  demandInRange: number;
  /** PO quantity over the visible months. */
  poInRange: number;
};

export function PoUpdateClient({
  planId,
  planStartDate,
  horizon,
  programs,
  lines,
  demand,
  canEdit,
}: {
  planId: string;
  planStartDate: string;
  horizon: number;
  programs: ProgramRow[];
  lines: PoLine[];
  demand: DemandCell[];
  canEdit: boolean;
}) {
  const router = useRouter();
  const [modal, setModal] = useState<null | { programId: string; po: Po | null }>(null);
  const [isPending, startTransition] = useTransition();
  const [from, setFrom] = useState(1);
  const [to, setTo] = useState(horizon);
  const [query, setQuery] = useState('');
  const [withPosOnly, setWithPosOnly] = useState(false);
  const [expanded, setExpanded] = useState<Set<string>>(new Set());

  const months = useMemo(() => Array.from({ length: horizon }, (_, i) => i + 1), [horizon]);

  // Keep the range coherent: dragging one end past the other pushes the other.
  const onFrom = (v: number) => { setFrom(v); if (v > to) setTo(v); };
  const onTo = (v: number) => { setTo(v); if (v < from) setFrom(v); };

  // Fold the per-month rows back into POs, keyed by program. Quantity is uniform
  // across a PO's months as entered, but a single month can later be corrected on
  // its own — so `perMonth` is null when they diverge, and the total is the true sum.
  const posByProgram = useMemo(() => {
    const byKey = new Map<string, PoLine[]>();
    for (const l of lines) {
      const k = `${l.program_id} ${l.po_ref}`;
      const arr = byKey.get(k);
      if (arr) arr.push(l); else byKey.set(k, [l]);
    }
    const out = new Map<string, Po[]>();
    for (const [key, group] of byKey) {
      group.sort((a, b) => a.month_index - b.month_index);
      const qtys = group.map((g) => Number(g.quantity_fp));
      const uniform = qtys.every((q) => q === qtys[0]);
      const po: Po = {
        key,
        programId: group[0].program_id,
        poRef: group[0].po_ref,
        months: group.map((g) => g.month_index),
        perMonth: uniform ? qtys[0] : null,
        total: qtys.reduce((s, q) => s + q, 0),
        receivedOn: group[0].received_on,
        notes: group[0].notes,
      };
      const list = out.get(po.programId);
      if (list) list.push(po); else out.set(po.programId, [po]);
    }
    for (const list of out.values()) {
      list.sort((a, b) => a.months[0] - b.months[0] || a.poRef.localeCompare(b.poRef));
    }
    return out;
  }, [lines]);

  // Demand overrides, keyed program:month. A month with no row uses the baseline.
  const overrides = useMemo(() => {
    const m = new Map<string, number>();
    for (const d of demand) m.set(`${d.program_id}:${d.month_index}`, Number(d.demand_fp));
    return m;
  }, [demand]);

  const q = query.trim().toLowerCase();
  const entries = useMemo(() => {
    const out: Entry[] = [];
    for (const program of programs) {
      if (q && !`${program.customer} ${program.item_description} ${program.item_code}`.toLowerCase().includes(q)) continue;
      const pos = posByProgram.get(program.id) ?? [];
      if (withPosOnly && pos.length === 0) continue;

      let demandInRange = 0;
      for (let m = from; m <= to; m++) {
        const o = overrides.get(`${program.id}:${m}`);
        demandInRange += o !== undefined ? o : program.max_monthly_demand_fp;
      }
      let poInRange = 0;
      for (const p of pos) {
        const n = p.months.filter((m) => m >= from && m <= to).length;
        poInRange += p.perMonth !== null ? p.perMonth * n : (p.total / p.months.length) * n;
      }

      out.push({ program, pos, demandInRange, poInRange });
    }
    return out;
  }, [programs, posByProgram, overrides, from, to, q, withPosOnly]);

  const sections = useMemo(
    () =>
      GROUPS.map((g) => ({
        ...g,
        entries: entries.filter((e) => groupOf(e.program.status) === g.key),
      })).filter((g) => g.entries.length > 0),
    [entries]
  );

  const totals = useMemo(() => {
    let po = 0, withPos = 0;
    for (const e of entries) { po += e.poInRange; if (e.pos.length) withPos += 1; }
    return { po, withPos, programs: entries.length };
  }, [entries]);

  const rangeText = `${monthLabel(planStartDate, from)} – ${monthLabel(planStartDate, to)}`;
  const fullRange = from === 1 && to === horizon;

  const monthsText = (p: Po) => {
    const first = monthLabel(planStartDate, p.months[0]);
    if (p.months.length === 1) return first;
    const last = monthLabel(planStartDate, p.months[p.months.length - 1]);
    // Contiguous ranges read as "Apr 26 – Jun 26"; a gapped PO says how many.
    const contiguous = p.months[p.months.length - 1] - p.months[0] + 1 === p.months.length;
    return contiguous ? `${first} – ${last}` : `${first} – ${last} (${p.months.length} months)`;
  };

  const toggle = (id: string) =>
    setExpanded((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id); else next.add(id);
      return next;
    });

  async function onDelete(e: Entry, p: Po) {
    const ok = await confirmDialog({
      title: `Delete PO ${p.poRef}?`,
      description: `${e.program.customer} · ${monthsText(p)} · ${num0(p.total)} kg. The demand each of those months held before this PO will be restored. Recalculate afterwards.`,
      confirmLabel: 'Delete PO',
      destructive: true,
    });
    if (!ok) return;
    startTransition(async () => {
      const res = await deletePo(planId, p.programId, p.poRef);
      if (res.error) window.alert(res.error);
      router.refresh();
    });
  }

  function exportCsv() {
    const rows: (string | number | null)[][] = [
      ['Status', 'Customer', 'Program', 'Item code', 'PO number', 'Month', 'Quantity (kg FP)', 'Received', 'Notes'],
    ];
    for (const g of sections) {
      for (const e of g.entries) {
        for (const p of e.pos) {
          for (const m of p.months) {
            if (m < from || m > to) continue;
            rows.push([
              e.program.status, e.program.customer, e.program.item_description, e.program.item_code,
              p.poRef, monthLabel(planStartDate, m),
              p.perMonth !== null ? p.perMonth : p.total / p.months.length,
              p.receivedOn ?? '', p.notes ?? '',
            ]);
          }
        }
      }
    }
    downloadCsv('po-update.csv', toCsv(rows));
  }

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div className="grid flex-1 grid-cols-3 gap-3 sm:max-w-lg">
          <Stat label="Programs" value={String(totals.programs)} sub={`${totals.withPos} with POs`} />
          <Stat label="PO quantity" value={`${num0(totals.po)} kg`} sub={fullRange ? 'FP, whole plan' : `FP, ${rangeText}`} />
          <Stat label="Months" value={fullRange ? `All ${horizon}` : String(to - from + 1)} sub={rangeText} />
        </div>
        <Button variant="outline" size="sm" onClick={exportCsv} disabled={totals.withPos === 0}>
          Export CSV
        </Button>
      </div>

      <div className="flex flex-wrap items-center gap-1.5">
        <span className="text-xs font-medium text-muted-foreground">Months</span>
        <select value={from} onChange={(e) => onFrom(Number(e.target.value))} className={filterCls} aria-label="From month">
          {months.map((m) => <option key={m} value={m}>{monthLabel(planStartDate, m)}</option>)}
        </select>
        <span className="text-xs text-muted-foreground">to</span>
        <select value={to} onChange={(e) => onTo(Number(e.target.value))} className={filterCls} aria-label="To month">
          {months.map((m) => <option key={m} value={m}>{monthLabel(planStartDate, m)}</option>)}
        </select>
        {!fullRange && (
          <button type="button" onClick={() => { setFrom(1); setTo(horizon); }} className="text-xs font-medium text-primary hover:underline">
            Reset
          </button>
        )}
        <div className="relative ml-1">
          <Search className="pointer-events-none absolute left-2 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-muted-foreground" />
          <input
            type="text"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder="Search customer or product…"
            aria-label="Search programs"
            className="w-64 rounded-md border border-border bg-card py-1.5 pl-7 pr-7 text-sm outline-none focus:ring-2 focus:ring-primary"
          />
          {query && (
            <button
              type="button"
              onClick={() => setQuery('')}
              aria-label="Clear search"
              className="absolute right-1.5 top-1/2 -translate-y-1/2 rounded p-0.5 text-muted-foreground hover:bg-muted hover:text-foreground"
            >
              <X className="h-3.5 w-3.5" />
            </button>
          )}
        </div>
        <label className="ml-1 inline-flex cursor-pointer items-center gap-1.5 text-xs text-muted-foreground">
          <input
            type="checkbox"
            checked={withPosOnly}
            onChange={(e) => setWithPosOnly(e.target.checked)}
            className="h-3.5 w-3.5 rounded border-border"
          />
          Only programs with POs
        </label>
      </div>

      {sections.length === 0 ? (
        <p className="rounded-lg border border-dashed p-6 text-center text-sm text-muted-foreground">
          {programs.length === 0
            ? 'This plan has no programs yet — add them on the Programs tab first.'
            : 'No programs match this search or filter.'}
        </p>
      ) : (
        sections.map((g) => (
          <section key={g.key} className="space-y-2">
            <h2 className="flex items-baseline gap-2 text-sm font-semibold">
              {g.label}
              <span className="text-xs font-normal text-muted-foreground">
                {g.entries.length} · {num0(g.entries.reduce((s, e) => s + e.poInRange, 0))} kg on PO
              </span>
            </h2>
            <div className="overflow-x-auto rounded-lg border">
              <table className="w-full text-sm">
                <thead className="border-b bg-muted/50 text-left text-xs uppercase tracking-wide text-muted-foreground">
                  <tr>
                    <th className="px-3 py-2">Customer</th>
                    <th className="px-3 py-2">Program</th>
                    <th className="px-3 py-2 text-right">Demand</th>
                    <th className="px-3 py-2 text-right">On PO</th>
                    <th className="px-3 py-2">POs</th>
                    <th className="px-3 py-2" />
                  </tr>
                </thead>
                <tbody>
                  {g.entries.map((e) => {
                    const open = expanded.has(e.program.id);
                    const product = `${e.program.item_description} (${e.program.item_code})`;
                    return (
                      <Fragment key={e.program.id}>
                        <tr className="border-b hover:bg-muted/30">
                          <td className="px-3 py-2 font-medium">{e.program.customer}</td>
                          <td className="max-w-[20rem] truncate px-3 py-2 text-muted-foreground" title={product}>{product}</td>
                          <td className="px-3 py-2 text-right tabular-nums">{num0(e.demandInRange)} kg</td>
                          <td className={cn('px-3 py-2 text-right tabular-nums', e.poInRange > 0 && 'font-medium text-success')}>
                            {e.poInRange > 0 ? `${num0(e.poInRange)} kg` : '—'}
                          </td>
                          <td className="px-3 py-2">
                            {e.pos.length === 0 ? (
                              <span className="text-muted-foreground">none</span>
                            ) : (
                              <button
                                type="button"
                                onClick={() => toggle(e.program.id)}
                                aria-expanded={open}
                                className="inline-flex items-center gap-1 text-primary hover:underline"
                              >
                                <ChevronRight className={cn('h-3.5 w-3.5 transition-transform', open && 'rotate-90')} />
                                {e.pos.length} PO{e.pos.length === 1 ? '' : 's'}
                              </button>
                            )}
                          </td>
                          <td className="px-3 py-2 text-right">
                            {canEdit && (
                              <Button size="sm" variant="outline" onClick={() => setModal({ programId: e.program.id, po: null })}>
                                <Plus /> PO received
                              </Button>
                            )}
                          </td>
                        </tr>
                        {open && e.pos.length > 0 && (
                          <tr className="border-b bg-muted/20">
                            <td />
                            <td colSpan={5} className="px-3 py-2">
                              <table className="w-full text-xs">
                                <thead className="text-left uppercase tracking-wide text-muted-foreground">
                                  <tr>
                                    <th className="py-1 pr-3 font-medium">PO number</th>
                                    <th className="py-1 pr-3 font-medium">Months</th>
                                    <th className="py-1 pr-3 text-right font-medium">Qty / month</th>
                                    <th className="py-1 pr-3 text-right font-medium">Total</th>
                                    <th className="py-1 pr-3 font-medium">Received</th>
                                    {canEdit && <th className="py-1" />}
                                  </tr>
                                </thead>
                                <tbody>
                                  {e.pos.map((p) => (
                                    <tr key={p.key} className="border-t border-border/60">
                                      <td className="py-1.5 pr-3 font-medium">
                                        {p.poRef}
                                        {p.notes && <div className="font-normal text-muted-foreground">{p.notes}</div>}
                                      </td>
                                      <td className="whitespace-nowrap py-1.5 pr-3">{monthsText(p)}</td>
                                      <td className="py-1.5 pr-3 text-right tabular-nums">
                                        {p.perMonth !== null ? `${num0(p.perMonth)} kg` : <span className="text-muted-foreground">mixed</span>}
                                      </td>
                                      <td className="py-1.5 pr-3 text-right font-medium tabular-nums">{num0(p.total)} kg</td>
                                      <td className="whitespace-nowrap py-1.5 pr-3 text-muted-foreground">{p.receivedOn ?? '—'}</td>
                                      {canEdit && (
                                        <td className="py-1.5">
                                          <div className="flex justify-end gap-3 whitespace-nowrap">
                                            <button onClick={() => setModal({ programId: e.program.id, po: p })} className="text-primary hover:underline">Edit</button>
                                            <button
                                              onClick={() => onDelete(e, p)}
                                              disabled={isPending}
                                              className="text-muted-foreground hover:text-destructive"
                                            >
                                              Delete
                                            </button>
                                          </div>
                                        </td>
                                      )}
                                    </tr>
                                  ))}
                                </tbody>
                              </table>
                            </td>
                          </tr>
                        )}
                      </Fragment>
                    );
                  })}
                </tbody>
              </table>
            </div>
          </section>
        ))
      )}

      <p className="text-xs text-muted-foreground">
        <b>Demand</b> is what the plan currently carries for the months on screen; <b>On PO</b> is how much of it is
        covered by orders you have received. A received PO is a firm order, so it replaces the forecast: every month a
        PO names takes the <b>sum of the POs held against it</b> as its Demand Plan quantity, and two POs on the same
        month add together. Deleting a PO restores whatever demand that month held beforehand — the forecast you had
        typed, or the program&apos;s baseline if there was none. Months no PO mentions are left alone. Recording a PO
        changes the plan&apos;s inputs, so <b>Recalculate</b> afterwards to see it in the outputs.
      </p>

      {modal && canEdit && (() => {
        const program = programs.find((p) => p.id === modal.programId);
        if (!program) return null;
        return (
          <PoModal
            planId={planId}
            planStartDate={planStartDate}
            horizon={horizon}
            program={program}
            po={modal.po}
            onClose={() => setModal(null)}
            onSaved={() => {
              // Leave the program open, so the PO just recorded is visible.
              setExpanded((prev) => new Set(prev).add(modal.programId));
              setModal(null);
              router.refresh();
            }}
          />
        );
      })()}
    </div>
  );
}

const initial: PoFormState = { error: null, ok: false };

function PoModal({
  planId,
  planStartDate,
  horizon,
  program,
  po,
  onClose,
  onSaved,
}: {
  planId: string;
  planStartDate: string;
  horizon: number;
  /** Chosen from the list, so the form never re-asks which program this is. */
  program: ProgramRow;
  po: Po | null;
  onClose: () => void;
  onSaved: () => void;
}) {
  const [state, formAction, pending] = useActionState(savePo, initial);
  useEffect(() => { if (state.ok) onSaved(); }, [state.ok, onSaved]);

  const months = Array.from({ length: horizon }, (_, i) => i + 1);
  // An edited PO reopens on the span it covers; a new one starts at month 1.
  const defFrom = po ? po.months[0] : 1;
  const defTo = po ? po.months[po.months.length - 1] : 1;
  // A "mixed" PO has no single per-month figure to show, so leave it blank rather
  // than silently proposing one of the months as the answer for all of them.
  const defQty = po ? (po.perMonth !== null ? po.perMonth : '') : '';

  return (
    <div className="fixed inset-0 z-40 flex items-center justify-center bg-black/50 p-4 backdrop-blur-sm" onClick={onClose}>
      <form action={formAction} className="max-h-full w-full max-w-lg overflow-y-auto rounded-lg bg-card p-5 text-sm shadow-xl" onClick={(e) => e.stopPropagation()}>
        <input type="hidden" name="plan_id" value={planId} />
        <input type="hidden" name="program_id" value={program.id} />
        {po && <input type="hidden" name="orig_program_id" value={po.programId} />}
        {po && <input type="hidden" name="orig_po_ref" value={po.poRef} />}

        <h2 className="text-sm font-semibold">{po ? `Edit PO ${po.poRef}` : 'PO received'}</h2>
        <div className="mt-2 rounded-md border bg-muted/40 px-3 py-2">
          <div className="font-medium">{program.customer}</div>
          <div className="text-xs text-muted-foreground">
            {program.item_description} ({program.item_code})
            {program.status !== 'active' && (
              <span className="ml-2 rounded-full bg-muted px-2 py-0.5 text-[10px] uppercase tracking-wide">{program.status}</span>
            )}
          </div>
        </div>

        <div className="mt-3 grid grid-cols-2 gap-3">
          <label className="block">
            <span className="text-xs font-medium text-muted-foreground">PO number</span>
            <input name="po_ref" defaultValue={po?.poRef ?? ''} className={inputCls} placeholder="e.g. PO-1043" />
          </label>
          <label className="block">
            <span className="text-xs font-medium text-muted-foreground">Received on</span>
            <input name="received_on" type="date" defaultValue={po?.receivedOn ?? ''} className={inputCls} />
          </label>
        </div>

        <div className="mt-3 grid grid-cols-2 gap-3">
          <label className="block">
            <span className="text-xs font-medium text-muted-foreground">First month</span>
            <select name="month_from" defaultValue={defFrom} className={inputCls}>
              {months.map((m) => <option key={m} value={m}>{monthLabel(planStartDate, m)}</option>)}
            </select>
          </label>
          <label className="block">
            <span className="text-xs font-medium text-muted-foreground">Last month</span>
            <select name="month_to" defaultValue={defTo} className={inputCls}>
              {months.map((m) => <option key={m} value={m}>{monthLabel(planStartDate, m)}</option>)}
            </select>
          </label>
        </div>
        <p className="mt-1 text-[11px] text-muted-foreground">Same month in both boxes for a single-month PO.</p>

        <label className="mt-3 block">
          <span className="text-xs font-medium text-muted-foreground">Quantity per month (kg FP)</span>
          <input
            name="quantity_fp"
            type="number"
            step="0.01"
            min={0}
            defaultValue={defQty}
            className={inputCls}
            placeholder="e.g. 8000"
          />
          <span className="mt-1 block text-[11px] text-muted-foreground">
            Applied to every month in the span above — a 3-month PO at 8,000 kg is 24,000 kg in total.
          </span>
        </label>

        <label className="mt-3 block">
          <span className="text-xs font-medium text-muted-foreground">Notes (optional)</span>
          <input name="notes" defaultValue={po?.notes ?? ''} className={inputCls} placeholder="e.g. split shipment, confirmed by email" />
        </label>

        {state.error && <p role="alert" className="mt-3 rounded-md bg-destructive/10 px-3 py-2 text-sm text-destructive">{state.error}</p>}

        <div className="mt-4 flex justify-end gap-2">
          <Button type="button" variant="outline" size="sm" onClick={onClose}>Cancel</Button>
          <Button type="submit" size="sm" disabled={pending}>{pending ? 'Saving…' : po ? 'Save PO' : 'Record PO'}</Button>
        </div>
      </form>
    </div>
  );
}

function Stat({ label, value, sub }: { label: string; value: string; sub?: string }) {
  return (
    <div className="rounded-lg border bg-card px-3 py-2">
      <div className="text-xs text-muted-foreground">{label}</div>
      <div className="text-lg font-semibold tabular-nums">{value}</div>
      {sub && <div className="text-[11px] text-muted-foreground">{sub}</div>}
    </div>
  );
}

const inputCls = 'mt-1 w-full rounded-md border px-2.5 py-1.5 text-sm outline-none focus:ring-2 focus:ring-primary';
const filterCls = 'rounded-md border px-2.5 py-1.5 text-sm outline-none focus:ring-2 focus:ring-primary';
