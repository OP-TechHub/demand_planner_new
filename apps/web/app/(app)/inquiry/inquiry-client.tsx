'use client';

import { useEffect, useMemo, useRef, useState, useTransition, type Dispatch, type SetStateAction, type ReactNode } from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { ClipboardCheck, CheckCircle2, AlertTriangle, Info, ChevronRight, Plus, X, Save } from 'lucide-react';
import { monthLabel } from '@oceanpick/shared';
import { cn } from '@/lib/utils';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Dialog } from '@/components/ui/dialog';
import { toast } from '@/components/ui/toast';
import {
  getInquiryContext,
  getNewInquiryData,
  getPipelineCandidates,
  saveInquiryToPipeline,
  saveNewInquiry,
  type InquiryContext,
  type InquiryPath,
  type InquiryMonth,
  type InquiryOtherProgram,
  type InquiryEntry,
  type PipelineCandidate,
  type PipelineTrim,
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

/** Build the save payload from the per-month quantity inputs. */
function entriesFrom(monthList: number[], qtyByMonth: Record<number, string>): InquiryEntry[] {
  const out: InquiryEntry[] = [];
  for (const m of monthList) {
    const v = Number(qtyByMonth[m]);
    if (Number.isFinite(v) && v >= 0) out.push({ month_index: m, demand_fp: v });
  }
  return out;
}

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

/** Add freed WR (from pipeline trims) back into each bucket's spare, per month. */
function augmentMonths(months: InquiryMonth[], freed: Map<string, number>): InquiryMonth[] {
  if (freed.size === 0) return months;
  return months.map((m) => ({
    ...m,
    paths: m.paths.map((p) => ({ ...p, unallocated_wr: p.unallocated_wr + (freed.get(`${p.bucket_id}:${m.month_index}`) ?? 0) })),
  }));
}

/** Which months fall short at the given availability, for a set of quantities. */
function shortMonthsOf(months: InquiryMonth[], qtyByMonth: Record<number, string>): number[] {
  const out: number[] = [];
  for (const m of months) {
    const q = Number(qtyByMonth[m.month_index]);
    if (Number.isFinite(q) && q > 0 && cascade(q, m.paths).shortfallFp > EPS) out.push(m.month_index);
  }
  return out;
}

const bucketsOf = (months: InquiryMonth[]): string[] =>
  months.length ? [...new Set(months[0].paths.map((p) => p.bucket_id))] : [];

// ---------------------------------------------------------------------------
// Top-level: existing vs new
// ---------------------------------------------------------------------------

export function InquiryClient({
  planId,
  planStartDate,
  horizon,
  programs,
  buckets,
  canSave,
}: {
  planId: string;
  planStartDate: string;
  horizon: number;
  programs: InquiryProgram[];
  buckets: InquiryBucket[];
  canSave: boolean;
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
        <ExistingInquiry planId={planId} planStartDate={planStartDate} horizon={horizon} programs={programs} canSave={canSave} />
      ) : (
        <NewInquiry planId={planId} planStartDate={planStartDate} horizon={horizon} buckets={buckets} customers={customers} canSave={canSave} />
      )}
    </div>
  );
}

// ---------------------------------------------------------------------------
// Existing-program flow
// ---------------------------------------------------------------------------

type Loaded = Extract<InquiryContext, { ok: true }>;

/** Full label for a program option. */
function programLabel(p: InquiryProgram): string {
  return `${p.customer} — ${p.item_description} (${p.item_code})${p.status !== 'active' ? ` · ${p.status}` : ''}`;
}

/**
 * Searchable program picker: a text box that filters the program list by
 * customer, product, or item code, with a dropdown of matches. Keyboard-friendly
 * (↑/↓/Enter/Esc) and closes on outside click.
 */
function ProgramCombobox({
  programs,
  value,
  onChange,
}: {
  programs: InquiryProgram[];
  value: string;
  onChange: (id: string) => void;
}) {
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState('');
  const [active, setActive] = useState(0);
  const wrapRef = useRef<HTMLDivElement>(null);
  const listRef = useRef<HTMLDivElement>(null);

  const selected = programs.find((p) => p.id === value) ?? null;

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase();
    if (!q) return programs;
    return programs.filter(
      (p) =>
        p.customer.toLowerCase().includes(q) ||
        p.item_description.toLowerCase().includes(q) ||
        p.item_code.toLowerCase().includes(q)
    );
  }, [programs, query]);

  // Close on click outside.
  useEffect(() => {
    if (!open) return;
    const onDoc = (e: MouseEvent) => {
      if (wrapRef.current && !wrapRef.current.contains(e.target as Node)) setOpen(false);
    };
    document.addEventListener('mousedown', onDoc);
    return () => document.removeEventListener('mousedown', onDoc);
  }, [open]);

  // Keep the highlighted row in view while arrowing.
  useEffect(() => {
    if (open) (listRef.current?.children[active] as HTMLElement | undefined)?.scrollIntoView({ block: 'nearest' });
  }, [active, open]);

  const openList = () => { setQuery(''); setActive(0); setOpen(true); };
  const choose = (p: InquiryProgram) => { onChange(p.id); setQuery(''); setOpen(false); };

  return (
    <div ref={wrapRef} className="relative">
      <input
        type="text"
        role="combobox"
        aria-expanded={open}
        className={selectCls}
        placeholder="Search customer, product, or code…"
        value={open ? query : selected ? programLabel(selected) : ''}
        onFocus={openList}
        onChange={(e) => { setQuery(e.target.value); setActive(0); setOpen(true); }}
        onKeyDown={(e) => {
          if (e.key === 'ArrowDown') { e.preventDefault(); if (!open) openList(); else setActive((a) => Math.min(a + 1, filtered.length - 1)); }
          else if (e.key === 'ArrowUp') { e.preventDefault(); setActive((a) => Math.max(a - 1, 0)); }
          else if (e.key === 'Enter') { e.preventDefault(); const p = filtered[active]; if (p) choose(p); }
          else if (e.key === 'Escape') { setOpen(false); }
        }}
      />
      {open && (
        <div ref={listRef} className="absolute z-20 mt-1 max-h-64 w-full overflow-y-auto rounded-md border bg-card shadow-lg">
          {filtered.length === 0 ? (
            <div className="px-3 py-2 text-sm text-muted-foreground">No matching programs.</div>
          ) : (
            filtered.map((p, i) => (
              <button
                type="button"
                key={p.id}
                onMouseEnter={() => setActive(i)}
                onClick={() => choose(p)}
                className={cn(
                  'flex w-full flex-col items-start gap-0.5 px-3 py-1.5 text-left',
                  i === active ? 'bg-primary/10' : 'hover:bg-muted',
                  p.id === value && 'font-medium'
                )}
              >
                <span className="text-sm">{p.customer}</span>
                <span className="text-xs text-muted-foreground">
                  {p.item_description} · {p.item_code}{p.status !== 'active' ? ` · ${p.status}` : ''}
                </span>
              </button>
            ))
          )}
        </div>
      )}
    </div>
  );
}

function ExistingInquiry({
  planId,
  planStartDate,
  horizon,
  programs,
  canSave,
}: {
  planId: string;
  planStartDate: string;
  horizon: number;
  programs: InquiryProgram[];
  canSave: boolean;
}) {
  const router = useRouter();
  const [programId, setProgramId] = useState('');
  const [selectedMonths, setSelectedMonths] = useState<number[]>([]);
  const [qtyByMonth, setQtyByMonth] = useState<Record<number, string>>({});
  const [ctx, setCtx] = useState<Loaded | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [pending, start] = useTransition();
  const [saving, startSave] = useTransition();
  const [saveOpen, setSaveOpen] = useState(false);
  const [saveErr, setSaveErr] = useState<string | null>(null);
  const [details, setDetails] = useState<{ suggestedItemCode: string; price: number } | null>(null);
  const [freed, setFreed] = useState<Map<string, number>>(new Map());
  const [trims, setTrims] = useState<PipelineTrim[]>([]);

  const filledMonths = ctx ? entriesFrom(ctx.months.map((m) => m.month_index), qtyByMonth).filter((e) => e.demand_fp > 0) : [];
  // Availability after any pipeline trims fed back in, plus which months still
  // (originally) fall short — the trigger for the make-room panel.
  const effectiveMonths = useMemo(() => (ctx ? augmentMonths(ctx.months, freed) : []), [ctx, freed]);
  const shortMonths = useMemo(() => (ctx ? shortMonthsOf(ctx.months, qtyByMonth) : []), [ctx, qtyByMonth]);
  const inquiryBuckets = useMemo(() => (ctx ? bucketsOf(ctx.months) : []), [ctx]);

  // Add the additional volume to pipeline. The server accumulates onto the
  // program's pipeline twin (creating it once); if it needs the item code +
  // price for a first-time twin, it says so and we open the dialog.
  function save() {
    if (!ctx || filledMonths.length === 0) { toast.error('Enter an additional quantity first.'); return; }
    startSave(async () => {
      const res = await saveInquiryToPipeline(planId, programId, filledMonths, undefined, trims);
      if (res.ok) { toast.success('Added to pipeline.'); router.refresh(); return; }
      if (res.needsDetails) { setDetails(res.needsDetails); setSaveErr(null); setSaveOpen(true); return; }
      toast.error(res.error ?? 'Could not save.');
    });
  }

  function saveWithDetails(itemCode: string, price: number) {
    if (!ctx) return;
    setSaveErr(null);
    startSave(async () => {
      const res = await saveInquiryToPipeline(planId, programId, filledMonths, { itemCode, price }, trims);
      if (res.ok) { toast.success('Added to pipeline.'); setSaveOpen(false); router.refresh(); }
      else setSaveErr(res.error ?? 'Could not save.');
    });
  }

  function load(id: string, monthList: number[]) {
    if (!id || monthList.length === 0) { setCtx(null); return; }
    setError(null);
    start(async () => {
      const res = await getInquiryContext(planId, id, monthList);
      if (!res.ok) { setError(res.error); setCtx(null); return; }
      setCtx(res);
      // Additional-volume model: the quantity is the EXTRA on top of the plan,
      // so start blank rather than prefilling the current demand.
      setQtyByMonth({});
    });
  }

  const onMonths = (list: number[]) => { setSelectedMonths(list); load(programId, list); };
  const onProgram = (id: string) => { setProgramId(id); load(id, selectedMonths); };

  return (
    <div className="space-y-5">
      <div className="space-y-3 rounded-lg border bg-card p-4">
        <div className="block text-sm">
          <span className="mb-1 block font-medium">Program</span>
          <ProgramCombobox programs={programs} value={programId} onChange={onProgram} />
        </div>
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
            <p className="mt-2 text-xs text-muted-foreground">
              Enter the <span className="font-medium text-foreground">additional</span> volume on top of the current plan (the “Planned” column is for reference). It’s checked against spare capacity; saving adds it as pipeline and leaves the active demand untouched.
            </p>
          </div>
          <AllocationTable months={effectiveMonths} qtyByMonth={qtyByMonth} setQtyByMonth={setQtyByMonth} planStartDate={planStartDate} qtyLabel="Additional (kg FP)" />
          {shortMonths.length > 0 && (
            <MakeRoom planId={planId} bucketIds={inquiryBuckets} months={shortMonths} planStartDate={planStartDate} onChange={(f, t) => { setFreed(f); setTrims(t); }} />
          )}
          {canSave && (
            <div className="flex items-center justify-end gap-2">
              <span className="text-xs text-muted-foreground">Adds this as pipeline volume on top of the plan.</span>
              <Button onClick={save} disabled={saving}><Save className="h-4 w-4" /> {saving ? 'Saving…' : 'Add to pipeline'}</Button>
            </div>
          )}
          <OtherActivePanel customer={ctx.program.customer} otherActive={ctx.otherActive} />
        </>
      )}

      {ctx && details && (
        <PipelineSaveDialog
          open={saveOpen}
          onClose={() => setSaveOpen(false)}
          customer={ctx.program.customer}
          description={ctx.program.item_description}
          monthCount={filledMonths.length}
          defaultItemCode={details.suggestedItemCode}
          defaultPrice={String(details.price)}
          submitting={saving}
          error={saveErr}
          onSubmit={saveWithDetails}
        />
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
  canSave,
}: {
  planId: string;
  planStartDate: string;
  horizon: number;
  buckets: InquiryBucket[];
  customers: string[];
  canSave: boolean;
}) {
  const router = useRouter();
  const [customer, setCustomer] = useState('');
  const [description, setDescription] = useState('');
  const [paths, setPaths] = useState<PathInput[]>([{ bucketId: '', yield: '' }]);
  const [selectedMonths, setSelectedMonths] = useState<number[]>([]);
  const [qtyByMonth, setQtyByMonth] = useState<Record<number, string>>({});
  const [computed, setComputed] = useState(true);
  const [unalloc, setUnalloc] = useState<Record<string, number>>({});
  const [otherActive, setOtherActive] = useState<InquiryOtherProgram[]>([]);
  const [pending, start] = useTransition();

  // Save dialog state.
  const [saveOpen, setSaveOpen] = useState(false);
  const [saveErr, setSaveErr] = useState<string | null>(null);
  const [saving, startSave] = useTransition();
  const [freed, setFreed] = useState<Map<string, number>>(new Map());
  const [trims, setTrims] = useState<PipelineTrim[]>([]);

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

  const filledMonths = useMemo(
    () => entriesFrom(selectedMonths, qtyByMonth).filter((e) => e.demand_fp > 0),
    [selectedMonths, qtyByMonth]
  );
  const effectiveMonths = useMemo(() => augmentMonths(months, freed), [months, freed]);
  const shortMonths = useMemo(() => shortMonthsOf(months, qtyByMonth), [months, qtyByMonth]);
  const inquiryBuckets = useMemo(() => bucketsOf(months), [months]);

  function doSave(itemCode: string, price: number) {
    setSaveErr(null);
    startSave(async () => {
      const res = await saveNewInquiry({
        planId,
        customer: customer.trim(),
        itemCode,
        itemDescription: description.trim(),
        pricePerFp: price,
        paths: validPaths.map((p) => ({ bucket_id: p.bucketId, yield: p.yield })),
        entries: filledMonths,
        trims,
      });
      if (res.ok) { toast.success('Saved to pipeline.'); setSaveOpen(false); router.refresh(); }
      else setSaveErr(res.error ?? 'Could not save.');
    });
  }

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
          <AllocationTable months={effectiveMonths} qtyByMonth={qtyByMonth} setQtyByMonth={setQtyByMonth} planStartDate={planStartDate} />
          {shortMonths.length > 0 && (
            <MakeRoom planId={planId} bucketIds={inquiryBuckets} months={shortMonths} planStartDate={planStartDate} onChange={(f, t) => { setFreed(f); setTrims(t); }} />
          )}
          {canSave && (
            <div className="flex items-center justify-end gap-2">
              <span className="text-xs text-muted-foreground">Saving creates a pipeline program with this demand.</span>
              <Button onClick={() => { setSaveErr(null); setSaveOpen(true); }}><Save className="h-4 w-4" /> Save to pipeline</Button>
            </div>
          )}
          {customer.trim() && <OtherActivePanel customer={customer.trim()} otherActive={otherActive} />}
        </>
      )}

      {!ready && !pending && (
        <p className="text-sm text-muted-foreground">
          Add at least one bucket with a yield, and choose the month(s), to check what we can supply.
        </p>
      )}

      <PipelineSaveDialog
        open={saveOpen}
        onClose={() => setSaveOpen(false)}
        customer={customer.trim()}
        description={description.trim()}
        monthCount={filledMonths.length}
        defaultItemCode=""
        defaultPrice=""
        submitting={saving}
        error={saveErr}
        onSubmit={doSave}
      />
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
  qtyLabel = 'Inquiry (kg FP)',
}: {
  months: InquiryMonth[];
  qtyByMonth: Record<number, string>;
  setQtyByMonth: Dispatch<SetStateAction<Record<number, string>>>;
  planStartDate: string;
  qtyLabel?: string;
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
              <th className="px-3 py-2 text-right font-medium">{qtyLabel}</th>
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

/**
 * "Free up capacity" — lists pipeline programs on the inquiry's buckets and lets
 * the user reduce their demand for the short months. Emits the freed WR (per
 * bucket × month) to feed the inquiry's availability, and the trims to save.
 */
function MakeRoom({
  planId,
  bucketIds,
  months,
  planStartDate,
  onChange,
}: {
  planId: string;
  bucketIds: string[];
  months: number[];
  planStartDate: string;
  onChange: (freed: Map<string, number>, trims: PipelineTrim[]) => void;
}) {
  const [cands, setCands] = useState<PipelineCandidate[] | null>(null);
  const [newDemand, setNewDemand] = useState<Record<string, Record<number, string>>>({});
  const key = `${bucketIds.join(',')}|${months.join(',')}`;
  const onChangeRef = useRef(onChange);
  onChangeRef.current = onChange;

  useEffect(() => {
    let cancelled = false;
    getPipelineCandidates(planId, bucketIds, months).then((cs) => {
      if (cancelled) return;
      setCands(cs);
      const nd: Record<string, Record<number, string>> = {};
      for (const c of cs) { nd[c.id] = {}; for (const m of months) nd[c.id][m] = String(Math.round(c.demand[m] ?? 0)); }
      setNewDemand(nd);
    });
    return () => { cancelled = true; };
  }, [planId, key]); // eslint-disable-line react-hooks/exhaustive-deps

  useEffect(() => {
    if (!cands) return;
    const freed = new Map<string, number>();
    const trims: PipelineTrim[] = [];
    for (const c of cands) {
      const entries: InquiryEntry[] = [];
      for (const m of months) {
        const orig = c.demand[m] ?? 0;
        const nv = Number(newDemand[c.id]?.[m]);
        const val = Number.isFinite(nv) && nv >= 0 ? nv : orig;
        if (val < orig && c.primary_yield > 0) {
          const fk = `${c.primary_bucket_id}:${m}`;
          freed.set(fk, (freed.get(fk) ?? 0) + (orig - val) / c.primary_yield);
        }
        if (val !== orig) entries.push({ month_index: m, demand_fp: val });
      }
      if (entries.length) trims.push({ programId: c.id, entries });
    }
    onChangeRef.current(freed, trims);
  }, [cands, newDemand, months]);

  return (
    <div className="space-y-2 rounded-lg border border-warning/30 bg-warning/5 p-4">
      <div className="text-sm font-semibold text-warning">Free up capacity from pipeline</div>
      <p className="text-xs text-muted-foreground">
        Reduce speculative <b>pipeline</b> demand on the same buckets to make room — freed capacity feeds the inquiry above (estimate: trim ÷ yield). Committed active demand is never shown. A Recalculate confirms the exact figure.
      </p>
      {cands === null ? (
        <p className="text-sm text-muted-foreground">Loading pipeline on these buckets…</p>
      ) : cands.length === 0 ? (
        <p className="text-sm text-muted-foreground">No pipeline demand on these buckets to trim.</p>
      ) : (
        <div className="overflow-x-auto rounded-md border border-border/60 bg-card">
          <table className="w-full text-xs">
            <thead className="bg-muted/50 text-muted-foreground">
              <tr>
                <th className="px-2 py-1.5 text-left font-medium">Pipeline program</th>
                <th className="px-2 py-1.5 text-left font-medium">Frees</th>
                {months.map((m) => <th key={m} className="px-2 py-1.5 text-right font-medium">{monthLabel(planStartDate, m)}</th>)}
              </tr>
            </thead>
            <tbody>
              {cands.map((c) => (
                <tr key={c.id} className="border-t">
                  <td className="px-2 py-1.5"><span className="text-muted-foreground">{c.item_code}</span> {c.item_description}</td>
                  <td className="px-2 py-1.5 text-muted-foreground">{c.bucket_name}</td>
                  {months.map((m) => (
                    <td key={m} className="px-2 py-1 text-right">
                      <input
                        type="number"
                        min={0}
                        max={Math.round(c.demand[m] ?? 0)}
                        value={newDemand[c.id]?.[m] ?? ''}
                        onChange={(e) => setNewDemand((prev) => ({ ...prev, [c.id]: { ...prev[c.id], [m]: e.target.value } }))}
                        title={`Currently ${Math.round(c.demand[m] ?? 0).toLocaleString()} kg`}
                        className="w-20 rounded-md border px-1.5 py-0.5 text-right tabular-nums outline-none focus:ring-2 focus:ring-primary"
                      />
                    </td>
                  ))}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}

/** Collects the two schema-required fields (item code + price) to mint a pipeline program. */
function PipelineSaveDialog({
  open,
  onClose,
  customer,
  description,
  monthCount,
  defaultItemCode,
  defaultPrice,
  submitting,
  error,
  onSubmit,
}: {
  open: boolean;
  onClose: () => void;
  customer: string;
  description: string;
  monthCount: number;
  defaultItemCode: string;
  defaultPrice: string;
  submitting: boolean;
  error: string | null;
  onSubmit: (itemCode: string, price: number) => void;
}) {
  const [itemCode, setItemCode] = useState(defaultItemCode);
  const [price, setPrice] = useState(defaultPrice);
  // Reset to the fresh defaults each time the dialog opens.
  useEffect(() => { if (open) { setItemCode(defaultItemCode); setPrice(defaultPrice); } }, [open, defaultItemCode, defaultPrice]);

  return (
    <Dialog open={open} onClose={onClose} title="Save inquiry to pipeline" description="Creates a new pipeline program carrying the sourcing and demand above.">
      <div className="space-y-3">
        <div className="rounded-md bg-muted/40 px-3 py-2 text-xs text-muted-foreground">
          <div><span className="font-medium text-foreground">{customer || '—'}</span>{description ? ` · ${description}` : ''}</div>
          <div className="mt-0.5">demand in {monthCount} month{monthCount === 1 ? '' : 's'}</div>
        </div>
        <label className="block text-sm">
          <span className="mb-1 block font-medium">Item code</span>
          <Input value={itemCode} onChange={(e) => setItemCode(e.target.value)} placeholder="e.g. 7499" />
        </label>
        <label className="block text-sm">
          <span className="mb-1 block font-medium">Price ($/kg FP)</span>
          <Input type="number" min={0} step="0.01" value={price} onChange={(e) => setPrice(e.target.value)} placeholder="e.g. 7.95" />
        </label>
        {error && <p role="alert" className="rounded-md bg-destructive/10 px-3 py-2 text-sm text-destructive">{error}</p>}
        <div className="flex justify-end gap-2">
          <Button variant="outline" onClick={onClose}>Cancel</Button>
          <Button onClick={() => onSubmit(itemCode.trim(), Number(price))} disabled={submitting}>
            {submitting ? 'Saving…' : 'Create pipeline program'}
          </Button>
        </div>
      </div>
    </Dialog>
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
