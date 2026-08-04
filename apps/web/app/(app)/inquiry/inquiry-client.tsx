'use client';

import { useMemo, useState, useTransition } from 'react';
import Link from 'next/link';
import { ClipboardCheck, CheckCircle2, AlertTriangle, Info, ChevronRight } from 'lucide-react';
import { monthLabel } from '@oceanpick/shared';
import { cn } from '@/lib/utils';
import { getInquiryContext, type InquiryContext, type InquiryPath } from './actions';

export type InquiryProgram = {
  id: string;
  item_code: string;
  item_description: string;
  customer: string;
  status: string;
};

type Loaded = Extract<InquiryContext, { ok: true }>;

const EPS = 1e-6;
const kg = (n: number) => `${Math.round(n).toLocaleString()} kg`;

/**
 * Cascade an FP inquiry through a program's paths (primary → secondary →
 * tertiary), drawing each path's WR from its bucket's spare (unallocated_wr).
 * Mirrors the engine's own-month allocation. Buckets shared across paths draw
 * from one shared pool so capacity is never double-counted.
 */
function cascade(qtyFp: number, paths: InquiryPath[]) {
  const remaining = new Map<string, number>();
  for (const p of paths) if (!remaining.has(p.bucket_id)) remaining.set(p.bucket_id, p.unallocated_wr);

  let residualFp = Math.max(0, qtyFp);
  const rows = paths.map((p) => {
    const availWr = remaining.get(p.bucket_id) ?? 0;
    const useWr = Math.min(residualFp / p.yield, availWr);
    const gotFp = useWr * p.yield;
    remaining.set(p.bucket_id, availWr - useWr);
    residualFp -= gotFp;
    return { path: p, useWr, gotFp };
  });

  const maxFp = Math.max(0, qtyFp) - residualFp;
  return { rows, maxFp, shortfallFp: Math.max(0, residualFp), canFulfil: residualFp <= EPS };
}

export function InquiryClient({
  planId,
  planStartDate,
  horizon,
  programs,
}: {
  planId: string;
  planStartDate: string;
  horizon: number;
  programs: InquiryProgram[];
}) {
  const [mode, setMode] = useState<'existing' | 'new'>('existing');
  const [programId, setProgramId] = useState('');
  const [fromMonth, setFromMonth] = useState(1);
  const [toMonth, setToMonth] = useState(1);
  // Per-month inquiry quantity (string for a friendly input), keyed by month_index.
  const [qtyByMonth, setQtyByMonth] = useState<Record<number, string>>({});
  const [setAll, setSetAll] = useState('');
  const [expanded, setExpanded] = useState<number | null>(null);
  const [ctx, setCtx] = useState<Loaded | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [pending, start] = useTransition();

  const months = useMemo(() => Array.from({ length: horizon }, (_, i) => i + 1), [horizon]);

  function load(nextProgram: string, from: number, to: number) {
    if (!nextProgram) { setCtx(null); return; }
    setError(null);
    start(async () => {
      const res = await getInquiryContext(planId, nextProgram, from, to);
      if (!res.ok) { setError(res.error); setCtx(null); return; }
      setCtx(res);
      // Prefill each month's quantity with its currently-planned demand (override baseline).
      const next: Record<number, string> = {};
      for (const m of res.months) next[m.month_index] = String(Math.round(m.current_demand_fp));
      setQtyByMonth(next);
      setExpanded(null);
    });
  }

  const onProgram = (id: string) => { setProgramId(id); load(id, fromMonth, toMonth); };
  const onFrom = (v: number) => {
    const to = v > toMonth ? v : toMonth;
    setFromMonth(v); setToMonth(to); load(programId, v, to);
  };
  const onTo = (v: number) => {
    const from = v < fromMonth ? v : fromMonth;
    setToMonth(v); setFromMonth(from); load(programId, from, v);
  };

  const applySetAll = () => {
    if (!ctx) return;
    const v = String(Math.max(0, Math.round(Number(setAll) || 0)));
    const next: Record<number, string> = {};
    for (const m of ctx.months) next[m.month_index] = v;
    setQtyByMonth(next);
  };

  // Per-month cascade result, plus range totals.
  const perMonth = useMemo(() => {
    if (!ctx || !ctx.computed) return null;
    return ctx.months.map((m) => {
      const qtyNum = Number(qtyByMonth[m.month_index]);
      const qty = Number.isFinite(qtyNum) && qtyNum > 0 ? qtyNum : 0;
      return { month: m, qty, ...cascade(qty, m.paths) };
    });
  }, [ctx, qtyByMonth]);

  const totals = useMemo(() => {
    if (!perMonth) return null;
    const inquired = perMonth.reduce((s, r) => s + r.qty, 0);
    const providable = perMonth.reduce((s, r) => s + r.maxFp, 0);
    const covered = perMonth.filter((r) => r.qty > 0 && r.canFulfil).length;
    const withQty = perMonth.filter((r) => r.qty > 0).length;
    return { inquired, providable, shortfall: inquired - providable, covered, withQty };
  }, [perMonth]);

  return (
    <div className="mx-auto max-w-4xl space-y-5">
      <div>
        <h1 className="flex items-center gap-2 text-2xl font-semibold tracking-tight">
          <ClipboardCheck className="h-6 w-6 text-primary" /> New Inquiry
        </h1>
        <p className="mt-1 text-sm text-muted-foreground">
          Check a customer request across one or more months against spare whole-round capacity, without changing the plan.
        </p>
      </div>

      <div className="flex w-max items-center gap-0.5 rounded-lg border border-border bg-muted/30 p-0.5 text-sm">
        {(['existing', 'new'] as const).map((m) => (
          <button
            key={m}
            type="button"
            onClick={() => setMode(m)}
            className={cn(
              'rounded-md px-3 py-1 font-medium transition-colors',
              mode === m ? 'bg-card text-foreground shadow-sm' : 'text-muted-foreground hover:text-foreground'
            )}
          >
            {m === 'existing' ? 'Existing program' : 'New program'}
          </button>
        ))}
      </div>

      {mode === 'new' ? (
        <div className="rounded-lg border border-dashed border-border bg-muted/20 p-6 text-sm text-muted-foreground">
          The new-program inquiry is coming next — we&apos;re building the existing-program flow first.
        </div>
      ) : (
        <div className="space-y-5">
          {/* Selection: program + month range */}
          <div className="grid gap-3 rounded-lg border bg-card p-4 sm:grid-cols-2">
            <label className="text-sm sm:col-span-2">
              <span className="mb-1 block font-medium">Program</span>
              <select value={programId} onChange={(e) => onProgram(e.target.value)} className={selectCls}>
                <option value="">Select a program…</option>
                {programs.map((p) => (
                  <option key={p.id} value={p.id}>
                    {p.customer} — {p.item_description} ({p.item_code}){p.status !== 'active' ? ` · ${p.status}` : ''}
                  </option>
                ))}
              </select>
            </label>
            <label className="text-sm">
              <span className="mb-1 block font-medium">From month</span>
              <select value={fromMonth} onChange={(e) => onFrom(Number(e.target.value))} className={selectCls}>
                {months.map((m) => <option key={m} value={m}>{monthLabel(planStartDate, m)}</option>)}
              </select>
            </label>
            <label className="text-sm">
              <span className="mb-1 block font-medium">To month</span>
              <select value={toMonth} onChange={(e) => onTo(Number(e.target.value))} className={selectCls}>
                {months.map((m) => <option key={m} value={m}>{monthLabel(planStartDate, m)}</option>)}
              </select>
            </label>
          </div>

          {error && <p role="alert" className="rounded-md bg-destructive/10 px-3 py-2 text-sm text-destructive">{error}</p>}
          {pending && <p className="text-sm text-muted-foreground">Loading…</p>}

          {ctx && !ctx.computed && (
            <div className="flex items-start gap-2 rounded-lg border border-warning/30 bg-warning/10 p-4 text-sm text-warning">
              <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0" />
              <div>
                <p className="font-medium">This plan hasn&apos;t been recalculated yet.</p>
                <p className="mt-1">
                  Availability is read from the computed unallocated whole-round capacity, which only exists after a
                  recompute. Run <span className="font-medium">Recalculate</span> (top bar), then try the inquiry again.
                </p>
              </div>
            </div>
          )}

          {ctx && ctx.computed && perMonth && totals && (
            <>
              {/* Program summary + set-all helper */}
              <div className="flex flex-wrap items-center justify-between gap-3 rounded-lg border bg-card p-4">
                <div>
                  <div className="text-sm font-semibold">{ctx.program.customer}</div>
                  <div className="text-sm text-muted-foreground">
                    {ctx.program.item_description} · {ctx.program.item_code} · ${ctx.program.price_per_fp.toLocaleString()}/kg FP
                  </div>
                </div>
                <div className="flex items-end gap-2 text-sm">
                  <label>
                    <span className="mb-1 block text-xs text-muted-foreground">Set every month to (kg FP)</span>
                    <input
                      type="number"
                      min={0}
                      value={setAll}
                      onChange={(e) => setSetAll(e.target.value)}
                      placeholder="e.g. 5000"
                      className={cn(selectCls, 'w-32 tabular-nums')}
                    />
                  </label>
                  <button type="button" onClick={applySetAll} className="rounded-md border px-3 py-1.5 text-sm font-medium hover:bg-muted">
                    Apply
                  </button>
                </div>
              </div>

              {/* Range summary */}
              <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
                <Stat label="Total inquired" value={kg(totals.inquired)} />
                <Stat label="We can provide" value={kg(totals.providable)} tone={totals.shortfall > EPS ? 'warn' : 'good'} />
                <Stat label="Shortfall" value={kg(Math.max(0, totals.shortfall))} tone={totals.shortfall > EPS ? 'bad' : 'good'} />
                <Stat label="Months fully covered" value={`${totals.covered} / ${totals.withQty}`} />
              </div>

              {/* Per-month allocation table */}
              <div className="overflow-x-auto rounded-lg border">
                <table className="w-full text-sm">
                  <thead className="bg-muted/50 text-muted-foreground">
                    <tr>
                      <th className="px-3 py-2 text-left font-medium">Month</th>
                      <th className="px-3 py-2 text-right font-medium">Planned</th>
                      <th className="px-3 py-2 text-right font-medium">Inquiry (kg FP)</th>
                      <th className="px-3 py-2 text-right font-medium">Max we can provide</th>
                      <th className="px-3 py-2 text-left font-medium">Verdict</th>
                    </tr>
                  </thead>
                  <tbody>
                    {perMonth.map((r) => {
                      const open = expanded === r.month.month_index;
                      const has = r.qty > EPS;
                      return (
                        <FragmentRow key={r.month.month_index}>
                          <tr
                            className={cn('border-t', has && 'cursor-pointer hover:bg-muted/30')}
                            onClick={has ? () => setExpanded(open ? null : r.month.month_index) : undefined}
                          >
                            <td className="px-3 py-2">
                              <span className="inline-flex items-center gap-1">
                                {has && <ChevronRight className={cn('h-3.5 w-3.5 text-muted-foreground transition-transform', open && 'rotate-90')} />}
                                {monthLabel(planStartDate, r.month.month_index)}
                              </span>
                            </td>
                            <td className="px-3 py-2 text-right tabular-nums text-muted-foreground">{kg(r.month.current_demand_fp)}</td>
                            <td className="px-3 py-1.5 text-right" onClick={(e) => e.stopPropagation()}>
                              <input
                                type="number"
                                min={0}
                                value={qtyByMonth[r.month.month_index] ?? ''}
                                onChange={(e) => setQtyByMonth((prev) => ({ ...prev, [r.month.month_index]: e.target.value }))}
                                className="w-28 rounded-md border px-2 py-1 text-right text-sm tabular-nums outline-none focus:ring-2 focus:ring-primary"
                              />
                            </td>
                            <td className="px-3 py-2 text-right tabular-nums font-medium">{has ? kg(r.maxFp) : '—'}</td>
                            <td className="px-3 py-2">
                              {!has ? (
                                <span className="text-muted-foreground">—</span>
                              ) : r.canFulfil ? (
                                <span className="inline-flex items-center gap-1 text-success"><CheckCircle2 className="h-4 w-4" /> Can fulfil</span>
                              ) : (
                                <span className="inline-flex items-center gap-1 text-destructive"><AlertTriangle className="h-4 w-4" /> Short by {kg(r.shortfallFp)}</span>
                              )}
                            </td>
                          </tr>
                          {open && (
                            <tr className="border-t bg-muted/20">
                              <td colSpan={5} className="px-3 py-2">
                                <div className="overflow-x-auto rounded-md border border-border/60 bg-card">
                                  <table className="w-full text-xs">
                                    <thead className="bg-muted/50 text-muted-foreground">
                                      <tr>
                                        <th className="px-3 py-1.5 text-left font-medium">Path</th>
                                        <th className="px-3 py-1.5 text-left font-medium">Bucket</th>
                                        <th className="px-3 py-1.5 text-right font-medium">Yield</th>
                                        <th className="px-3 py-1.5 text-right font-medium">Spare WR</th>
                                        <th className="px-3 py-1.5 text-right font-medium">FP from here</th>
                                      </tr>
                                    </thead>
                                    <tbody>
                                      {r.rows.map((br) => (
                                        <tr key={br.path.path} className="border-t">
                                          <td className="px-3 py-1.5 capitalize">{br.path.path}</td>
                                          <td className="px-3 py-1.5">{br.path.bucket_name}</td>
                                          <td className="px-3 py-1.5 text-right tabular-nums">{(br.path.yield * 100).toFixed(1)}%</td>
                                          <td className="px-3 py-1.5 text-right tabular-nums text-muted-foreground">{kg(br.path.unallocated_wr)}</td>
                                          <td className="px-3 py-1.5 text-right font-medium tabular-nums">{kg(br.gotFp)}</td>
                                        </tr>
                                      ))}
                                    </tbody>
                                  </table>
                                </div>
                              </td>
                            </tr>
                          )}
                        </FragmentRow>
                      );
                    })}
                  </tbody>
                </table>
              </div>

              <p className="flex items-center gap-1 text-[11px] text-muted-foreground">
                <Info className="h-3 w-3" />
                Each month is checked against its own spare whole-round capacity (capacity already committed to the plan is excluded). Click a month to see the per-bucket breakdown.
              </p>

              {/* Other active programs */}
              <div className="rounded-lg border bg-card p-4">
                <div className="text-sm font-semibold">Other active programs for {ctx.program.customer}</div>
                {ctx.otherActive.length === 0 ? (
                  <p className="mt-1 text-sm text-muted-foreground">None — this is the only active program for this customer.</p>
                ) : (
                  <ul className="mt-2 divide-y text-sm">
                    {ctx.otherActive.map((o) => (
                      <li key={o.item_code} className="flex items-center justify-between py-1.5">
                        <span><span className="text-muted-foreground">{o.item_code}</span> {o.item_description}</span>
                        <span className="tabular-nums text-muted-foreground">{kg(o.demand_fp)} over range</span>
                      </li>
                    ))}
                  </ul>
                )}
              </div>
            </>
          )}

          {!ctx && !pending && !error && (
            <p className="text-sm text-muted-foreground">
              Pick a program and a month range to check what we can supply.{' '}
              <Link href="/programs" className="text-primary hover:underline">Manage programs</Link>.
            </p>
          )}
        </div>
      )}
    </div>
  );
}

function Stat({ label, value, tone }: { label: string; value: string; tone?: 'good' | 'warn' | 'bad' }) {
  return (
    <div className="rounded-lg border bg-card px-3 py-2">
      <div className="text-xs text-muted-foreground">{label}</div>
      <div className={cn('text-lg font-semibold tabular-nums',
        tone === 'bad' && 'text-destructive', tone === 'warn' && 'text-warning', tone === 'good' && 'text-success')}>
        {value}
      </div>
    </div>
  );
}

/** Groups a month row with its optional detail row without an extra DOM node. */
function FragmentRow({ children }: { children: React.ReactNode }) {
  return <>{children}</>;
}

const selectCls = 'w-full rounded-md border px-2.5 py-1.5 text-sm outline-none focus:ring-2 focus:ring-primary';
