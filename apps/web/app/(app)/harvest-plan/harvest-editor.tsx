'use client';

import { useMemo, useState, useTransition } from 'react';
import { monthLabel, type Bucket, type HarvestCell } from '@oceanpick/shared';
import { MonthlyLineChart } from '@/components/charts/monthly-line-chart';
import { toast } from '@/components/ui/toast';
import { saveHarvestCapacity } from './actions';

type Cells = Record<number, string>; // month -> capacity string ('' = 0/none)

export function HarvestEditor({
  planId,
  planStartDate,
  horizon,
  bucket,
  rows,
  onClose,
  onSaved,
}: {
  planId: string;
  planStartDate: string;
  horizon: number;
  bucket: Bucket;
  rows: HarvestCell[];
  onClose: () => void;
  onSaved: () => void;
}) {
  const months = useMemo(() => Array.from({ length: horizon }, (_, i) => i + 1), [horizon]);
  // Shown in whole kilos. A month left untouched keeps its stored value — the
  // save below only writes months whose rounded value actually differs.
  const original = useMemo(() => {
    const o: Cells = {};
    for (const r of rows) o[r.month_index] = String(Math.round(r.capacity_kg_wr));
    return o;
  }, [rows]);

  const [cells, setCells] = useState<Cells>(original);
  const [error, setError] = useState<string | null>(null);
  const [pattern, setPattern] = useState(false);
  const [isPending, startTransition] = useTransition();

  const setMonth = (mo: number, val: string) => setCells((prev) => ({ ...prev, [mo]: val }));

  function onSave() {
    setError(null);
    const upserts: { month_index: number; capacity_kg_wr: number }[] = [];
    const deletes: number[] = [];
    for (const mo of months) {
      const raw = (cells[mo] ?? '').trim();
      const had = original[mo] !== undefined;
      const entered = raw === '' ? 0 : Number(raw);
      if (!Number.isFinite(entered) || entered < 0) {
        setError(`Month ${monthLabel(planStartDate, mo)}: capacity must be zero or greater.`);
        return;
      }
      const n = Math.round(entered); // capacity is kept in whole kg WR
      if (n === 0) {
        if (had) deletes.push(mo);
        continue;
      }
      if (!had || Number(original[mo]) !== n) upserts.push({ month_index: mo, capacity_kg_wr: n });
    }
    if (upserts.length === 0 && deletes.length === 0) {
      onClose();
      return;
    }
    startTransition(async () => {
      const res = await saveHarvestCapacity(planId, bucket.id, upserts, deletes);
      if (res.error) setError(res.error);
      else { toast.success('Harvest updated'); onSaved(); }
    });
  }

  return (
    <div className="fixed inset-0 z-40 flex items-center justify-center bg-black/50 backdrop-blur-sm p-4" onClick={onClose}>
      <div className="flex max-h-[90vh] w-full max-w-lg flex-col rounded-lg bg-card shadow-xl" onClick={(e) => e.stopPropagation()}>
        <div className="flex items-center justify-between border-b px-5 py-3">
          <div>
            <h2 className="text-sm font-semibold">Edit harvest capacity — {bucket.name}</h2>
            <p className="text-xs text-muted-foreground">Capacity in kg WR. Blank = 0 (no capacity).</p>
          </div>
          <button onClick={onClose} className="text-muted-foreground hover:text-foreground">✕</button>
        </div>

        <div className="flex items-center gap-2 border-b px-5 py-2 text-sm">
          <button onClick={() => setCells({})} className="rounded-md border px-2.5 py-1 hover:bg-muted">Clear all</button>
          <button onClick={() => setPattern(true)} className="rounded-md border px-2.5 py-1 hover:bg-muted">Apply pattern…</button>
        </div>

        <div className="border-b px-5 py-2">
          <MonthlyLineChart
            height={150}
            data={months.map((mo) => ({ label: monthLabel(planStartDate, mo), capacity: Number(cells[mo] ?? '') || 0 }))}
            series={[{ key: 'capacity', name: 'Capacity (kg WR)', color: '#1baf7a' }]}
          />
        </div>

        <div className="flex-1 overflow-y-auto px-5 py-3">
          <table className="w-full text-sm">
            <thead className="sticky top-0 bg-card text-left text-xs uppercase tracking-wide text-muted-foreground">
              <tr>
                <th className="py-1">Month</th>
                <th className="py-1 text-right">Capacity (kg WR)</th>
              </tr>
            </thead>
            <tbody>
              {months.map((mo) => (
                <tr key={mo} className="border-t">
                  <td className="py-1">{monthLabel(planStartDate, mo)}</td>
                  <td className="py-1 text-right">
                    <input
                      type="number"
                      step="1"
                      min={0}
                      value={cells[mo] ?? ''}
                      onChange={(e) => setMonth(mo, e.target.value)}
                      placeholder="0"
                      className="w-28 rounded-md border px-2 py-1 text-right text-sm outline-none focus:ring-2 focus:ring-primary"
                    />
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>

        {error && <p role="alert" className="mx-5 mb-2 rounded-md bg-destructive/10 px-3 py-2 text-sm text-destructive">{error}</p>}

        <div className="flex justify-end gap-2 border-t px-5 py-3">
          <button onClick={onClose} className="rounded-md border px-3 py-1.5 text-sm hover:bg-muted">Cancel</button>
          <button onClick={onSave} disabled={isPending} className="rounded-md bg-primary px-3 py-1.5 text-sm font-medium text-primary-foreground disabled:opacity-50">
            {isPending ? 'Saving…' : 'Save'}
          </button>
        </div>

        {pattern && (
          <PatternModal
            horizon={horizon}
            onClose={() => setPattern(false)}
            onApply={(next) => { setCells((prev) => ({ ...prev, ...next })); setPattern(false); }}
          />
        )}
      </div>
    </div>
  );
}

function PatternModal({
  horizon,
  onClose,
  onApply,
}: {
  horizon: number;
  onClose: () => void;
  onApply: (next: Cells) => void;
}) {
  const [mode, setMode] = useState<'fixed' | 'range' | 'ramp'>('fixed');
  const [fixed, setFixed] = useState('');
  const [rFrom, setRFrom] = useState('1');
  const [rTo, setRTo] = useState(String(horizon));
  const [rVal, setRVal] = useState('');
  const [rampFrom, setRampFrom] = useState('');
  const [rampToVal, setRampToVal] = useState('');
  const [rampMFrom, setRampMFrom] = useState('1');
  const [rampMTo, setRampMTo] = useState(String(horizon));

  const clamp = (n: number) => Math.min(horizon, Math.max(1, n));

  function apply() {
    const next: Cells = {};
    if (mode === 'fixed') {
      const v = Number(fixed);
      if (!Number.isFinite(v)) return;
      for (let m = 1; m <= horizon; m++) next[m] = String(Math.round(v));
    } else if (mode === 'range') {
      const a = clamp(Number(rFrom)), b = clamp(Number(rTo)), v = Number(rVal);
      if (!Number.isFinite(v)) return;
      for (let m = Math.min(a, b); m <= Math.max(a, b); m++) next[m] = String(Math.round(v));
    } else {
      const a = clamp(Number(rampMFrom)), b = clamp(Number(rampMTo));
      const v1 = Number(rampFrom), v2 = Number(rampToVal);
      if (!Number.isFinite(v1) || !Number.isFinite(v2)) return;
      const lo = Math.min(a, b), hi = Math.max(a, b), span = hi - lo;
      for (let m = lo; m <= hi; m++) {
        const t = span === 0 ? 0 : (m - lo) / span;
        next[m] = String(Math.round(v1 + (v2 - v1) * t));
      }
    }
    onApply(next);
  }

  const row = 'flex items-center gap-2 py-1.5';

  return (
    <div className="absolute inset-0 z-50 flex items-center justify-center bg-black/50 backdrop-blur-sm p-4" onClick={onClose}>
      <div className="w-full max-w-sm rounded-lg bg-card p-5 text-sm shadow-xl" onClick={(e) => e.stopPropagation()}>
        <h3 className="mb-3 text-sm font-semibold">Apply pattern</h3>
        <div className="space-y-1">
          <label className={row}>
            <input type="radio" checked={mode === 'fixed'} onChange={() => setMode('fixed')} />
            <span>Set all to</span>
            <input className="w-24 rounded-md border px-2 py-1" value={fixed} onChange={(e) => setFixed(e.target.value)} placeholder="value" />
          </label>
          <label className={row}>
            <input type="radio" checked={mode === 'range'} onChange={() => setMode('range')} />
            <span>Months</span>
            <input className="w-12 rounded-md border px-1 py-1 text-center" value={rFrom} onChange={(e) => setRFrom(e.target.value)} />
            to
            <input className="w-12 rounded-md border px-1 py-1 text-center" value={rTo} onChange={(e) => setRTo(e.target.value)} />
            =
            <input className="w-20 rounded-md border px-1 py-1" value={rVal} onChange={(e) => setRVal(e.target.value)} />
          </label>
          <label className={row}>
            <input type="radio" checked={mode === 'ramp'} onChange={() => setMode('ramp')} />
            <span>Ramp</span>
            <input className="w-16 rounded-md border px-1 py-1" value={rampFrom} onChange={(e) => setRampFrom(e.target.value)} placeholder="from" />
            <input className="w-16 rounded-md border px-1 py-1" value={rampToVal} onChange={(e) => setRampToVal(e.target.value)} placeholder="to" />
          </label>
          <div className="pl-6 text-xs text-muted-foreground">
            over months
            <input className="mx-1 w-10 rounded border px-1 text-center" value={rampMFrom} onChange={(e) => setRampMFrom(e.target.value)} />
            to
            <input className="mx-1 w-10 rounded border px-1 text-center" value={rampMTo} onChange={(e) => setRampMTo(e.target.value)} />
          </div>
        </div>
        <div className="mt-4 flex justify-end gap-2">
          <button onClick={onClose} className="rounded-md border px-3 py-1.5 hover:bg-muted">Cancel</button>
          <button onClick={apply} className="rounded-md bg-primary px-3 py-1.5 font-medium text-primary-foreground">Apply</button>
        </div>
      </div>
    </div>
  );
}
