'use client';

import { useMemo, useState, useTransition } from 'react';
import Link from 'next/link';
import { ClipboardCheck, CheckCircle2, AlertTriangle, Info } from 'lucide-react';
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

/** kg with thousands separators, no decimals for readability. */
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
    const neededWr = residualFp / p.yield;
    const useWr = Math.min(neededWr, availWr);
    const gotFp = useWr * p.yield;
    remaining.set(p.bucket_id, availWr - useWr);
    residualFp -= gotFp;
    return { path: p, availWr, useWr, gotFp };
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
  const [monthIndex, setMonthIndex] = useState(1);
  const [qty, setQty] = useState('');
  const [ctx, setCtx] = useState<Loaded | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [pending, start] = useTransition();

  const months = useMemo(() => Array.from({ length: horizon }, (_, i) => i + 1), [horizon]);

  // Load context whenever both a program and month are chosen. Resets the qty
  // to the currently-planned demand so the user "overrides" from that baseline.
  function load(nextProgram: string, nextMonth: number) {
    if (!nextProgram || !nextMonth) { setCtx(null); return; }
    setError(null);
    start(async () => {
      const res = await getInquiryContext(planId, nextProgram, nextMonth);
      if (!res.ok) { setError(res.error); setCtx(null); return; }
      setCtx(res);
      setQty(String(Math.round(res.program.current_demand_fp)));
    });
  }

  const onProgram = (id: string) => { setProgramId(id); load(id, monthIndex); };
  const onMonth = (m: number) => { setMonthIndex(m); load(programId, m); };

  const qtyNum = Number(qty);
  const result = ctx && ctx.computed && Number.isFinite(qtyNum) && qtyNum > 0 ? cascade(qtyNum, ctx.paths) : null;

  return (
    <div className="mx-auto max-w-3xl space-y-5">
      <div>
        <h1 className="flex items-center gap-2 text-2xl font-semibold tracking-tight">
          <ClipboardCheck className="h-6 w-6 text-primary" /> New Inquiry
        </h1>
        <p className="mt-1 text-sm text-muted-foreground">
          Check a customer request against spare whole-round capacity, without changing the plan.
        </p>
      </div>

      {/* Existing vs new */}
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
          {/* Selection */}
          <div className="grid gap-3 rounded-lg border bg-card p-4 sm:grid-cols-2">
            <label className="text-sm">
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
              <span className="mb-1 block font-medium">Inquiry month</span>
              <select value={monthIndex} onChange={(e) => onMonth(Number(e.target.value))} className={selectCls}>
                {months.map((m) => (
                  <option key={m} value={m}>{monthLabel(planStartDate, m)}</option>
                ))}
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

          {ctx && ctx.computed && (
            <>
              {/* Program summary + override qty */}
              <div className="rounded-lg border bg-card p-4">
                <div className="flex flex-wrap items-baseline justify-between gap-2">
                  <div>
                    <div className="text-sm font-semibold">{ctx.program.customer}</div>
                    <div className="text-sm text-muted-foreground">
                      {ctx.program.item_description} · {ctx.program.item_code}
                    </div>
                  </div>
                  <div className="text-right text-xs text-muted-foreground">
                    ${ctx.program.price_per_fp.toLocaleString()} / kg FP · {ctx.program.status}
                  </div>
                </div>

                <div className="mt-4 grid gap-3 sm:grid-cols-2">
                  <div className="rounded-md bg-muted/40 px-3 py-2 text-sm">
                    <div className="text-xs text-muted-foreground">Currently planned ({monthLabel(planStartDate, monthIndex)})</div>
                    <div className="font-semibold tabular-nums">{kg(ctx.program.current_demand_fp)}</div>
                  </div>
                  <label className="text-sm">
                    <span className="mb-1 block font-medium">Inquiry quantity (kg FP) — override</span>
                    <input
                      type="number"
                      min={0}
                      value={qty}
                      onChange={(e) => setQty(e.target.value)}
                      className={cn(selectCls, 'tabular-nums')}
                    />
                  </label>
                </div>
              </div>

              {/* Verdict */}
              {result && (
                <div
                  className={cn(
                    'rounded-lg border p-4',
                    result.canFulfil ? 'border-success/30 bg-success/10' : 'border-destructive/30 bg-destructive/10'
                  )}
                >
                  <div className="flex items-center gap-2">
                    {result.canFulfil ? (
                      <CheckCircle2 className="h-5 w-5 text-success" />
                    ) : (
                      <AlertTriangle className="h-5 w-5 text-destructive" />
                    )}
                    <div className={cn('font-semibold', result.canFulfil ? 'text-success' : 'text-destructive')}>
                      {result.canFulfil
                        ? `Can fulfil ${kg(qtyNum)} in ${monthLabel(planStartDate, monthIndex)}.`
                        : `Can't fulfil ${kg(qtyNum)} — short by ${kg(result.shortfallFp)}.`}
                    </div>
                  </div>
                  {!result.canFulfil && (
                    <p className="mt-1 text-sm text-destructive">
                      Maximum we can provide: <span className="font-semibold">{kg(result.maxFp)}</span>.
                    </p>
                  )}

                  {/* Per-bucket breakdown */}
                  <div className="mt-3 overflow-x-auto rounded-md border border-border/60 bg-card">
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
                        {result.rows.map((r) => (
                          <tr key={r.path.path} className="border-t">
                            <td className="px-3 py-1.5 capitalize">{r.path.path}</td>
                            <td className="px-3 py-1.5">{r.path.bucket_name}</td>
                            <td className="px-3 py-1.5 text-right tabular-nums">{(r.path.yield * 100).toFixed(1)}%</td>
                            <td className="px-3 py-1.5 text-right tabular-nums text-muted-foreground">{kg(r.path.unallocated_wr)}</td>
                            <td className="px-3 py-1.5 text-right font-medium tabular-nums">{kg(r.gotFp)}</td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                  <p className="mt-2 flex items-center gap-1 text-[11px] text-muted-foreground">
                    <Info className="h-3 w-3" />
                    Checked against spare whole-round capacity for {monthLabel(planStartDate, monthIndex)} only — capacity already committed to the plan is excluded.
                  </p>
                </div>
              )}

              {/* Other active programs for the customer */}
              <div className="rounded-lg border bg-card p-4">
                <div className="text-sm font-semibold">Other active programs for {ctx.program.customer}</div>
                {ctx.otherActive.length === 0 ? (
                  <p className="mt-1 text-sm text-muted-foreground">None — this is the only active program for this customer.</p>
                ) : (
                  <ul className="mt-2 divide-y text-sm">
                    {ctx.otherActive.map((o) => (
                      <li key={o.item_code} className="flex items-center justify-between py-1.5">
                        <span>
                          <span className="text-muted-foreground">{o.item_code}</span> {o.item_description}
                        </span>
                        <span className="tabular-nums text-muted-foreground">
                          {kg(o.demand_fp)} · {monthLabel(planStartDate, monthIndex)}
                        </span>
                      </li>
                    ))}
                  </ul>
                )}
              </div>
            </>
          )}

          {!ctx && !pending && !error && (
            <p className="text-sm text-muted-foreground">
              Pick a program and a month to check what we can supply.{' '}
              <Link href="/programs" className="text-primary hover:underline">Manage programs</Link>.
            </p>
          )}
        </div>
      )}
    </div>
  );
}

const selectCls = 'w-full rounded-md border px-2.5 py-1.5 text-sm outline-none focus:ring-2 focus:ring-primary';
