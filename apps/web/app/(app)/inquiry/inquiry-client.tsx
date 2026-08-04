'use client';

import { useEffect, useMemo, useRef, useState, useTransition, type Dispatch, type SetStateAction, type ReactNode } from 'react';
import Link from 'next/link';
import { ClipboardCheck, CheckCircle2, AlertTriangle, Info, ChevronRight, Plus, X } from 'lucide-react';
import { monthLabel } from '@oceanpick/shared';
import { cn } from '@/lib/utils';
import {
  getInquiryContext,
  getNewInquiryData,
  type InquiryContext,
  type InquiryPath,
  type InquiryMonth,
  type InquiryOtherProgram,
} from './actions';

export type InquiryProgram = {
  id: string;
  item_code: string;
  item_description: string;
  customer: string;
  status: string;
};
export type InquiryBucket = { id: string; name: string };

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

// ---------------------------------------------------------------------------
// Top-level: existing vs new
// ---------------------------------------------------------------------------

export function InquiryClient({
  planId,
  planStartDate,
  horizon,
  programs,
  buckets,
}: {
  planId: string;
  planStartDate: string;
  horizon: number;
  programs: InquiryProgram[];
  buckets: InquiryBucket[];
}) {
  const [mode, setMode] = useState<'existing' | 'new'>('existing');
  const customers = useMemo(
    () => Array.from(new Set(programs.map((p) => p.customer).filter(Boolean))).sort(),
    [programs]
  );

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

      {mode === 'existing' ? (
        <ExistingInquiry planId={planId} planStartDate={planStartDate} horizon={horizon} programs={programs} />
      ) : (
        <NewInquiry planId={planId} planStartDate={planStartDate} horizon={horizon} buckets={buckets} customers={customers} />
      )}
    </div>
  );
}

// ---------------------------------------------------------------------------
// Existing-program flow
// ---------------------------------------------------------------------------

type Loaded = Extract<InquiryContext, { ok: true }>;

function ExistingInquiry({
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
  const [programId, setProgramId] = useState('');
  const [selectedMonths, setSelectedMonths] = useState<number[]>([]);
  const [qtyByMonth, setQtyByMonth] = useState<Record<number, string>>({});
  const [ctx, setCtx] = useState<Loaded | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [pending, start] = useTransition();

  function load(id: string, monthList: number[]) {
    if (!id || monthList.length === 0) { setCtx(null); return; }
    setError(null);
    start(async () => {
      const res = await getInquiryContext(planId, id, monthList);
      if (!res.ok) { setError(res.error); setCtx(null); return; }
      setCtx(res);
      const next: Record<number, string> = {};
      for (const m of res.months) next[m.month_index] = String(Math.round(m.current_demand_fp));
      setQtyByMonth(next);
    });
  }

  const onMonths = (list: number[]) => { setSelectedMonths(list); load(programId, list); };
  const onProgram = (id: string) => { setProgramId(id); load(id, selectedMonths); };

  return (
    <div className="space-y-5">
      <div className="space-y-3 rounded-lg border bg-card p-4">
        <label className="block text-sm">
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
        <MonthSelector months={horizon} planStartDate={planStartDate} onChange={onMonths} />
      </div>

      {error && <p role="alert" className="rounded-md bg-destructive/10 px-3 py-2 text-sm text-destructive">{error}</p>}
      {pending && <p className="text-sm text-muted-foreground">Loading…</p>}

      {ctx && !ctx.computed && <RecalcNotice />}

      {ctx && ctx.computed && (
        <>
          <div className="rounded-lg border bg-card p-4">
            <div className="text-sm font-semibold">{ctx.program.customer}</div>
            <div className="text-sm text-muted-foreground">
              {ctx.program.item_description} · {ctx.program.item_code} · ${ctx.program.price_per_fp.toLocaleString()}/kg FP · {ctx.program.status}
            </div>
          </div>
          <AllocationTable months={ctx.months} qtyByMonth={qtyByMonth} setQtyByMonth={setQtyByMonth} planStartDate={planStartDate} />
          <OtherActivePanel customer={ctx.program.customer} otherActive={ctx.otherActive} />
        </>
      )}

      {!ctx && !pending && !error && <PickHint />}
    </div>
  );
}

// ---------------------------------------------------------------------------
// New-program flow
// ---------------------------------------------------------------------------

type PathInput = { bucketId: string; yield: string };

function NewInquiry({
  planId,
  planStartDate,
  horizon,
  buckets,
  customers,
}: {
  planId: string;
  planStartDate: string;
  horizon: number;
  buckets: InquiryBucket[];
  customers: string[];
}) {
  const [customer, setCustomer] = useState('');
  const [description, setDescription] = useState('');
  const [paths, setPaths] = useState<PathInput[]>([{ bucketId: '', yield: '' }]);
  const [selectedMonths, setSelectedMonths] = useState<number[]>([]);
  const [qtyByMonth, setQtyByMonth] = useState<Record<number, string>>({});
  const [computed, setComputed] = useState(true);
  const [unalloc, setUnalloc] = useState<Record<string, number>>({});
  const [otherActive, setOtherActive] = useState<InquiryOtherProgram[]>([]);
  const [pending, start] = useTransition();

  const bucketName = useMemo(() => new Map(buckets.map((b) => [b.id, b.name])), [buckets]);

  // Valid sourcing paths: a chosen bucket and a yield in (0, 1].
  const validPaths = useMemo(
    () =>
      paths
        .map((p, i) => ({ path: (['primary', 'secondary', 'tertiary'] as const)[i], bucketId: p.bucketId, yield: Number(p.yield) }))
        .filter((p) => p.bucketId && p.yield > 0 && p.yield <= 1),
    [paths]
  );
  const bucketIds = useMemo(() => [...new Set(validPaths.map((p) => p.bucketId))], [validPaths]);

  const bucketKey = bucketIds.join(',');
  const monthKey = selectedMonths.join(',');
  const custRef = useRef(customer);
  custRef.current = customer;

  // Refetch spare capacity + the customer's other programs whenever the chosen
  // buckets, months, or customer change.
  useEffect(() => {
    if (bucketIds.length === 0 || selectedMonths.length === 0) { setUnalloc({}); setOtherActive([]); return; }
    let cancelled = false;
    start(async () => {
      const res = await getNewInquiryData(planId, bucketKey ? bucketKey.split(',') : [], monthKey ? monthKey.split(',').map(Number) : [], custRef.current);
      if (cancelled || !res.ok) return;
      setComputed(res.computed);
      setUnalloc(res.unallocated);
      setOtherActive(res.otherActive);
    });
    return () => { cancelled = true; };
  }, [planId, bucketKey, monthKey, customer]);

  // Build the per-month picture the shared table expects, from user paths +
  // fetched spare capacity. A new program has no planned demand (baseline 0).
  const months: InquiryMonth[] = useMemo(
    () =>
      selectedMonths.map((m) => ({
        month_index: m,
        current_demand_fp: 0,
        paths: validPaths.map((p) => ({
          path: p.path,
          bucket_id: p.bucketId,
          bucket_name: bucketName.get(p.bucketId) ?? 'Bucket',
          yield: p.yield,
          unallocated_wr: unalloc[`${p.bucketId}:${m}`] ?? 0,
        })),
      })),
    [selectedMonths, validPaths, unalloc, bucketName]
  );

  const setPath = (i: number, patch: Partial<PathInput>) =>
    setPaths((prev) => prev.map((p, idx) => (idx === i ? { ...p, ...patch } : p)));
  const addPath = () => setPaths((prev) => (prev.length < 3 ? [...prev, { bucketId: '', yield: '' }] : prev));
  const removePath = (i: number) => setPaths((prev) => prev.filter((_, idx) => idx !== i));

  const ready = validPaths.length > 0 && selectedMonths.length > 0;

  return (
    <div className="space-y-5">
      <div className="space-y-4 rounded-lg border bg-card p-4">
        <div className="grid gap-3 sm:grid-cols-2">
          <label className="text-sm">
            <span className="mb-1 block font-medium">Customer</span>
            <input
              list="inquiry-customers"
              value={customer}
              onChange={(e) => setCustomer(e.target.value)}
              placeholder="New or existing customer"
              className={selectCls}
            />
            <datalist id="inquiry-customers">
              {customers.map((c) => <option key={c} value={c} />)}
            </datalist>
          </label>
          <label className="text-sm">
            <span className="mb-1 block font-medium">Product (optional)</span>
            <input value={description} onChange={(e) => setDescription(e.target.value)} placeholder="e.g. Barra Portions 6x1kg" className={selectCls} />
          </label>
        </div>

        {/* Sourcing paths */}
        <div>
          <div className="mb-1.5 text-sm font-medium">Sourcing — which buckets, at what yield</div>
          <div className="space-y-2">
            {paths.map((p, i) => (
              <div key={i} className="flex items-center gap-2">
                <span className="w-16 shrink-0 text-xs capitalize text-muted-foreground">{(['primary', 'secondary', 'tertiary'] as const)[i]}</span>
                <select value={p.bucketId} onChange={(e) => setPath(i, { bucketId: e.target.value })} className={cn(selectCls, 'flex-1')}>
                  <option value="">Select bucket…</option>
                  {buckets.map((b) => <option key={b.id} value={b.id}>{b.name}</option>)}
                </select>
                <input
                  type="number"
                  min={0}
                  max={1}
                  step="0.001"
                  value={p.yield}
                  onChange={(e) => setPath(i, { yield: e.target.value })}
                  placeholder="yield 0–1"
                  className={cn(selectCls, 'w-28 tabular-nums')}
                />
                {i > 0 ? (
                  <button type="button" onClick={() => removePath(i)} className="rounded-md p-1.5 text-muted-foreground hover:bg-muted" aria-label="Remove path">
                    <X className="h-4 w-4" />
                  </button>
                ) : (
                  <span className="w-8" />
                )}
              </div>
            ))}
          </div>
          {paths.length < 3 && (
            <button type="button" onClick={addPath} className="mt-2 inline-flex items-center gap-1 text-xs font-medium text-primary hover:underline">
              <Plus className="h-3.5 w-3.5" /> Add another bucket
            </button>
          )}
          <p className="mt-1 text-[11px] text-muted-foreground">
            Yield is finished product per whole round (e.g. 0.498). Paths fill in order — primary first, then secondary, then tertiary.
          </p>
        </div>

        <MonthSelector months={horizon} planStartDate={planStartDate} onChange={setSelectedMonths} />
      </div>

      {pending && <p className="text-sm text-muted-foreground">Loading…</p>}

      {ready && !computed && <RecalcNotice />}

      {ready && computed && (
        <>
          <AllocationTable months={months} qtyByMonth={qtyByMonth} setQtyByMonth={setQtyByMonth} planStartDate={planStartDate} />
          {customer.trim() && <OtherActivePanel customer={customer.trim()} otherActive={otherActive} />}
        </>
      )}

      {!ready && !pending && (
        <p className="text-sm text-muted-foreground">
          Add at least one bucket with a yield, and choose the month(s), to check what we can supply.
        </p>
      )}
    </div>
  );
}

// ---------------------------------------------------------------------------
// Shared pieces
// ---------------------------------------------------------------------------

/** Month chooser: a contiguous range, or hand-picked months. Emits the list. */
function MonthSelector({
  months,
  planStartDate,
  onChange,
}: {
  months: number;
  planStartDate: string;
  onChange: (list: number[]) => void;
}) {
  const all = useMemo(() => Array.from({ length: months }, (_, i) => i + 1), [months]);
  const [monthMode, setMonthMode] = useState<'range' | 'pick'>('range');
  const [fromMonth, setFromMonth] = useState(1);
  const [toMonth, setToMonth] = useState(1);
  const [picked, setPicked] = useState<number[]>([]);

  const range = (from: number, to: number) => {
    const lo = Math.min(from, to), hi = Math.max(from, to);
    return Array.from({ length: hi - lo + 1 }, (_, i) => lo + i);
  };
  const list = monthMode === 'range' ? range(fromMonth, toMonth) : [...picked].sort((a, b) => a - b);
  const key = list.join(',');

  // Emit the resolved list on mount and whenever it changes.
  const onChangeRef = useRef(onChange);
  onChangeRef.current = onChange;
  useEffect(() => { onChangeRef.current(key ? key.split(',').map(Number) : []); }, [key]);

  const onFrom = (v: number) => { setFromMonth(v); if (v > toMonth) setToMonth(v); };
  const onTo = (v: number) => { setToMonth(v); if (v < fromMonth) setFromMonth(v); };
  const togglePick = (m: number) => setPicked((prev) => (prev.includes(m) ? prev.filter((x) => x !== m) : [...prev, m]));

  return (
    <div className="space-y-2">
      <div className="flex flex-wrap items-center gap-2">
        <div className="flex w-max items-center gap-0.5 rounded-lg border border-border bg-muted/30 p-0.5 text-sm">
          {(['range', 'pick'] as const).map((m) => (
            <button
              key={m}
              type="button"
              onClick={() => setMonthMode(m)}
              className={cn(
                'rounded-md px-3 py-1 font-medium transition-colors',
                monthMode === m ? 'bg-card text-foreground shadow-sm' : 'text-muted-foreground hover:text-foreground'
              )}
            >
              {m === 'range' ? 'Month range' : 'Pick months'}
            </button>
          ))}
        </div>

        {monthMode === 'range' ? (
          <div className="flex items-center gap-1.5 text-sm">
            <select value={fromMonth} onChange={(e) => onFrom(Number(e.target.value))} className={selectCls} aria-label="From month">
              {all.map((m) => <option key={m} value={m}>{monthLabel(planStartDate, m)}</option>)}
            </select>
            <span className="text-xs text-muted-foreground">to</span>
            <select value={toMonth} onChange={(e) => onTo(Number(e.target.value))} className={selectCls} aria-label="To month">
              {all.map((m) => <option key={m} value={m}>{monthLabel(planStartDate, m)}</option>)}
            </select>
          </div>
        ) : (
          <span className="text-xs text-muted-foreground">
            {picked.length ? `${picked.length} month${picked.length > 1 ? 's' : ''} selected` : 'Tap the months the customer is asking for.'}
          </span>
        )}
      </div>

      {monthMode === 'pick' && (
        <div className="flex flex-wrap gap-1.5">
          {all.map((m) => {
            const on = picked.includes(m);
            return (
              <button
                key={m}
                type="button"
                onClick={() => togglePick(m)}
                className={cn(
                  'rounded-md border px-2 py-1 text-xs font-medium transition-colors',
                  on ? 'border-primary bg-primary/10 text-primary' : 'border-border text-muted-foreground hover:bg-muted'
                )}
              >
                {monthLabel(planStartDate, m)}
              </button>
            );
          })}
        </div>
      )}
    </div>
  );
}

/** The per-month allocation table + set-all helper + range summary. */
function AllocationTable({
  months,
  qtyByMonth,
  setQtyByMonth,
  planStartDate,
}: {
  months: InquiryMonth[];
  qtyByMonth: Record<number, string>;
  setQtyByMonth: Dispatch<SetStateAction<Record<number, string>>>;
  planStartDate: string;
}) {
  const [setAll, setSetAll] = useState('');
  const [expanded, setExpanded] = useState<number | null>(null);

  const perMonth = useMemo(
    () =>
      months.map((m) => {
        const qtyNum = Number(qtyByMonth[m.month_index]);
        const qty = Number.isFinite(qtyNum) && qtyNum > 0 ? qtyNum : 0;
        return { month: m, qty, ...cascade(qty, m.paths) };
      }),
    [months, qtyByMonth]
  );

  const totals = useMemo(() => {
    const inquired = perMonth.reduce((s, r) => s + r.qty, 0);
    const providable = perMonth.reduce((s, r) => s + r.maxFp, 0);
    const covered = perMonth.filter((r) => r.qty > 0 && r.canFulfil).length;
    const withQty = perMonth.filter((r) => r.qty > 0).length;
    return { inquired, providable, shortfall: inquired - providable, covered, withQty };
  }, [perMonth]);

  const applySetAll = () => {
    const v = String(Math.max(0, Math.round(Number(setAll) || 0)));
    setQtyByMonth(() => Object.fromEntries(months.map((m) => [m.month_index, v])));
  };

  return (
    <>
      <div className="flex flex-wrap items-end justify-end gap-2 text-sm">
        <label>
          <span className="mb-1 block text-xs text-muted-foreground">Set every month to (kg FP)</span>
          <input type="number" min={0} value={setAll} onChange={(e) => setSetAll(e.target.value)} placeholder="e.g. 5000" className={cn(selectCls, 'w-32 tabular-nums')} />
        </label>
        <button type="button" onClick={applySetAll} className="rounded-md border px-3 py-1.5 text-sm font-medium hover:bg-muted">Apply</button>
      </div>

      <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
        <Stat label="Total inquired" value={kg(totals.inquired)} />
        <Stat label="We can provide" value={kg(totals.providable)} tone={totals.shortfall > EPS ? 'warn' : 'good'} />
        <Stat label="Shortfall" value={kg(Math.max(0, totals.shortfall))} tone={totals.shortfall > EPS ? 'bad' : 'good'} />
        <Stat label="Months fully covered" value={`${totals.covered} / ${totals.withQty}`} />
      </div>

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
    </>
  );
}

function OtherActivePanel({ customer, otherActive }: { customer: string; otherActive: InquiryOtherProgram[] }) {
  return (
    <div className="rounded-lg border bg-card p-4">
      <div className="text-sm font-semibold">Other active programs for {customer}</div>
      {otherActive.length === 0 ? (
        <p className="mt-1 text-sm text-muted-foreground">None — no other active programs for this customer.</p>
      ) : (
        <ul className="mt-2 divide-y text-sm">
          {otherActive.map((o) => (
            <li key={o.item_code} className="flex items-center justify-between py-1.5">
              <span><span className="text-muted-foreground">{o.item_code}</span> {o.item_description}</span>
              <span className="tabular-nums text-muted-foreground">{kg(o.demand_fp)} over range</span>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}

function RecalcNotice() {
  return (
    <div className="flex items-start gap-2 rounded-lg border border-warning/30 bg-warning/10 p-4 text-sm text-warning">
      <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0" />
      <div>
        <p className="font-medium">This plan hasn&apos;t been recalculated yet.</p>
        <p className="mt-1">
          Availability is read from the computed unallocated whole-round capacity, which only exists after a recompute.
          Run <span className="font-medium">Recalculate</span> (top bar), then try the inquiry again.
        </p>
      </div>
    </div>
  );
}

function PickHint() {
  return (
    <p className="text-sm text-muted-foreground">
      Pick a program and the month(s) to check what we can supply.{' '}
      <Link href="/programs" className="text-primary hover:underline">Manage programs</Link>.
    </p>
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
function FragmentRow({ children }: { children: ReactNode }) {
  return <>{children}</>;
}

const selectCls = 'w-full rounded-md border px-2.5 py-1.5 text-sm outline-none focus:ring-2 focus:ring-primary';
