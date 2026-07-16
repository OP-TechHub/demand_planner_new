'use client';

import { useMemo, useState, useTransition } from 'react';
import { monthLabel, type DemandCell, type Program } from '@oceanpick/shared';
import { cn } from '@/lib/utils';
import { MonthlyLineChart } from '@/components/charts/monthly-line-chart';
import { saveDemandOverrides } from './actions';

type Overrides = Record<number, string>; // month -> override string ('' = none)

export function DemandEditor({
  planId,
  planStartDate,
  horizon,
  program,
  rows,
  onClose,
  onSaved,
}: {
  planId: string;
  planStartDate: string;
  horizon: number;
  program: Program;
  rows: DemandCell[];
  onClose: () => void;
  onSaved: () => void;
}) {
  const baseline = program.max_monthly_demand_fp;
  const months = useMemo(() => Array.from({ length: horizon }, (_, i) => i + 1), [horizon]);

  const original = useMemo(() => {
    const o: Overrides = {};
    for (const r of rows) o[r.month_index] = String(r.demand_fp);
    return o;
  }, [rows]);

  const [overrides, setOverrides] = useState<Overrides>(original);
  const [error, setError] = useState<string | null>(null);
  const [pattern, setPattern] = useState(false);
  const [isPending, startTransition] = useTransition();

  const setMonth = (mo: number, val: string) =>
    setOverrides((prev) => ({ ...prev, [mo]: val }));

  const effective = (mo: number) => {
    const raw = overrides[mo];
    if (raw !== undefined && raw.trim() !== '' && Number.isFinite(Number(raw))) return Number(raw);
    return baseline;
  };

  function onSave() {
    setError(null);
    const upserts: { month_index: number; demand_fp: number }[] = [];
    const deletes: number[] = [];
    for (const mo of months) {
      const raw = (overrides[mo] ?? '').trim();
      const had = original[mo] !== undefined;
      if (raw === '') {
        if (had) deletes.push(mo);
        continue;
      }
      const n = Number(raw);
      if (!Number.isFinite(n) || n < 0) {
        setError(`Month ${monthLabel(planStartDate, mo)}: demand must be zero or greater.`);
        return;
      }
      if (!had || Number(original[mo]) !== n) upserts.push({ month_index: mo, demand_fp: n });
    }
    if (upserts.length === 0 && deletes.length === 0) {
      onClose();
      return;
    }
    startTransition(async () => {
      const res = await saveDemandOverrides(planId, program.id, upserts, deletes);
      if (res.error) setError(res.error);
      else onSaved();
    });
  }

  return (
    <div className="fixed inset-0 z-40 flex items-center justify-center bg-black/50 backdrop-blur-sm p-4" onClick={onClose}>
      <div className="flex max-h-[90vh] w-full max-w-2xl flex-col rounded-lg bg-card shadow-xl" onClick={(e) => e.stopPropagation()}>
        <div className="flex items-center justify-between border-b px-5 py-3">
          <div>
            <h2 className="text-sm font-semibold">Edit demand — {program.customer} · {program.item_description}</h2>
            <p className="text-xs text-muted-foreground">Baseline {baseline.toLocaleString()} kg FP/month. Blank override = use baseline.</p>
          </div>
          <button onClick={onClose} className="text-muted-foreground hover:text-foreground">✕</button>
        </div>

        <div className="flex items-center gap-2 border-b px-5 py-2 text-sm">
          <button onClick={() => setOverrides({})} className="rounded-md border px-2.5 py-1 hover:bg-muted">
            Reset all overrides
          </button>
          <button onClick={() => setPattern(true)} className="rounded-md border px-2.5 py-1 hover:bg-muted">
            Apply pattern…
          </button>
        </div>

        <div className="border-b px-5 py-2">
          <MonthlyLineChart
            height={150}
            data={months.map((mo) => ({ label: monthLabel(planStartDate, mo), baseline, effective: effective(mo) }))}
            series={[
              { key: 'baseline', name: 'Baseline', color: '#94a3b8', dashed: true },
              { key: 'effective', name: 'Effective', color: '#2a78d6' },
            ]}
          />
        </div>

        <div className="flex-1 overflow-y-auto px-5 py-3">
          <table className="w-full text-sm">
            <thead className="sticky top-0 bg-card text-left text-xs uppercase tracking-wide text-muted-foreground">
              <tr>
                <th className="py-1">Month</th>
                <th className="py-1 text-right">Baseline</th>
                <th className="py-1 text-right">Override</th>
                <th className="py-1 text-right">Effective</th>
              </tr>
            </thead>
            <tbody>
              {months.map((mo) => {
                const raw = overrides[mo] ?? '';
                const overridden = raw.trim() !== '';
                return (
                  <tr key={mo} className="border-t">
                    <td className="py-1">{monthLabel(planStartDate, mo)}</td>
                    <td className="py-1 text-right tabular-nums text-muted-foreground">{baseline.toLocaleString()}</td>
                    <td className="py-1 text-right">
                      <input
                        type="number"
                        step="any"
                        value={raw}
                        onChange={(e) => setMonth(mo, e.target.value)}
                        placeholder="—"
                        className="w-24 rounded-md border px-2 py-1 text-right text-sm outline-none focus:ring-2 focus:ring-primary"
                      />
                    </td>
                    <td className={cn('py-1 text-right tabular-nums', overridden && 'font-semibold text-primary')}>
                      {effective(mo).toLocaleString()}
                    </td>
                  </tr>
                );
              })}
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
            baseline={baseline}
            horizon={horizon}
            onClose={() => setPattern(false)}
            onApply={(next) => { setOverrides((prev) => ({ ...prev, ...next })); setPattern(false); }}
          />
        )}
      </div>
    </div>
  );
}

function PatternModal({
  baseline,
  horizon,
  onClose,
  onApply,
}: {
  baseline: number;
  horizon: number;
  onClose: () => void;
  onApply: (next: Overrides) => void;
}) {
  const [mode, setMode] = useState<'fixed' | 'scale' | 'range' | 'ramp'>('fixed');
  const [fixed, setFixed] = useState('');
  const [scale, setScale] = useState('100');
  const [rFrom, setRFrom] = useState('1');
  const [rTo, setRTo] = useState(String(horizon));
  const [rVal, setRVal] = useState('');
  const [rampFrom, setRampFrom] = useState('');
  const [rampToVal, setRampToVal] = useState('');
  const [rampMFrom, setRampMFrom] = useState('1');
  const [rampMTo, setRampMTo] = useState(String(horizon));

  function clampMonth(n: number) { return Math.min(horizon, Math.max(1, n)); }

  function apply() {
    const next: Overrides = {};
    if (mode === 'fixed') {
      const v = Number(fixed);
      if (!Number.isFinite(v)) return;
      for (let m = 1; m <= horizon; m++) next[m] = String(v);
    } else if (mode === 'scale') {
      const p = Number(scale);
      if (!Number.isFinite(p)) return;
      for (let m = 1; m <= horizon; m++) next[m] = String(Math.round(baseline * (p / 100) * 10000) / 10000);
    } else if (mode === 'range') {
      const a = clampMonth(Number(rFrom)), b = clampMonth(Number(rTo)), v = Number(rVal);
      if (!Number.isFinite(v)) return;
      for (let m = Math.min(a, b); m <= Math.max(a, b); m++) next[m] = String(v);
    } else if (mode === 'ramp') {
      const a = clampMonth(Number(rampMFrom)), b = clampMonth(Number(rampMTo));
      const v1 = Number(rampFrom), v2 = Number(rampToVal);
      if (!Number.isFinite(v1) || !Number.isFinite(v2)) return;
      const lo = Math.min(a, b), hi = Math.max(a, b);
      const span = hi - lo;
      for (let m = lo; m <= hi; m++) {
        const t = span === 0 ? 0 : (m - lo) / span;
        next[m] = String(Math.round((v1 + (v2 - v1) * t) * 10000) / 10000);
      }
    }
    onApply(next);
  }

  const row = 'flex items-center gap-2 py-1.5';
  const inp = 'w-24 rounded-md border px-2 py-1 text-sm outline-none focus:ring-2 focus:ring-primary';

  return (
    <div className="absolute inset-0 z-50 flex items-center justify-center bg-black/50 backdrop-blur-sm p-4" onClick={onClose}>
      <div className="w-full max-w-sm rounded-lg bg-card p-5 text-sm shadow-xl" onClick={(e) => e.stopPropagation()}>
        <h3 className="mb-3 text-sm font-semibold">Apply pattern</h3>
        <div className="space-y-1">
          <label className={row}>
            <input type="radio" checked={mode === 'fixed'} onChange={() => setMode('fixed')} />
            <span>Set all to</span>
            <input className={inp} value={fixed} onChange={(e) => setFixed(e.target.value)} placeholder="value" />
          </label>
          <label className={row}>
            <input type="radio" checked={mode === 'scale'} onChange={() => setMode('scale')} />
            <span>Scale baseline by</span>
            <input className={inp} value={scale} onChange={(e) => setScale(e.target.value)} /> %
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
            ramp over months
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
