'use client';

import { useMemo, useState, useTransition } from 'react';
import { useRouter } from 'next/navigation';
import { CalendarDays, ChevronLeft, ChevronRight, Save } from 'lucide-react';
import { toast } from '@/components/ui/toast';
import {
  monthLabel,
  monthIndexOfDate,
  harvestDatesInMonth,
  harvestDayLabel,
  type Bucket,
  type HarvestRequestDailyCell,
  type HarvestRequestMode,
  type HarvestRequestSettings,
} from '@oceanpick/shared';
import { cn } from '@/lib/utils';
import { Button } from '@/components/ui/button';
import { ScrollX } from '@/components/ui/scroll-x';
import { useInputGridSelection, pasteCellCls } from '@/components/paste-grid';
import { saveHarvestRequestDaily, saveHarvestRequestSettings } from './actions';

const WEEKDAYS = [
  { iso: 1, label: 'Mon' },
  { iso: 2, label: 'Tue' },
  { iso: 3, label: 'Wed' },
  { iso: 4, label: 'Thu' },
  { iso: 5, label: 'Fri' },
  { iso: 6, label: 'Sat' },
  { iso: 7, label: 'Sun' },
];

const MODES: { value: HarvestRequestMode; label: string }[] = [
  { value: 'by_date', label: 'By date' },
  { value: 'by_date_size', label: 'By date & size' },
];

/** Today as 'YYYY-MM-DD' in the browser's own timezone — the plant's working day. */
export function todayIso(): string {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}

type Row = { id: string | null; name: string; legacy?: boolean };

/**
 * Daily request — what the processing plant asks the farm for before each
 * harvest, one month of harvest days at a time.
 *
 * The plan's mode decides the shape: 'by_date' is one total per day,
 * 'by_date_size' one figure per bucket per day. Switching mode rewrites
 * nothing. In size mode a day total entered by date shows on its own
 * "No size stated" line; in date mode a day already stated by size shows its
 * sum, read-only, rather than inviting a second figure on top of it.
 */
export function DailyRequestSection({
  planId,
  planStartDate,
  horizon,
  initialMonth,
  buckets,
  daily,
  settings,
  canEdit,
  stickyCol,
}: {
  planId: string;
  planStartDate: string;
  horizon: number;
  initialMonth: number;
  buckets: Bucket[];
  daily: HarvestRequestDailyCell[];
  settings: HarvestRequestSettings;
  canEdit: boolean;
  stickyCol: string;
}) {
  const router = useRouter();
  const [month, setMonth] = useState(Math.min(Math.max(initialMonth, 1), horizon));
  const [mode, setMode] = useState<HarvestRequestMode>(settings.mode);
  const [weekdays, setWeekdays] = useState<number[]>(settings.harvest_weekdays);
  const [savingSettings, startSaveSettings] = useTransition();
  const [saving, startSave] = useTransition();
  const today = todayIso();

  // Keyed bucket:date, with an empty bucket for a day total with no size.
  const key = (bucketId: string | null, date: string) => `${bucketId ?? ''}:${date}`;
  const initial = useMemo(() => {
    const out: Record<string, string> = {};
    for (const r of daily) out[key(r.bucket_id, r.harvest_date)] = String(Math.round(r.quantity_kg_wr));
    return out;
  }, [daily]);
  const [vals, setVals] = useState<Record<string, string>>(initial);
  const changedKeys = useMemo(() => {
    const keys = new Set([...Object.keys(initial), ...Object.keys(vals)]);
    return [...keys].filter((k) => (initial[k] ?? '') !== (vals[k] ?? ''));
  }, [initial, vals]);

  const value = (bucketId: string | null, date: string) => Number(vals[key(bucketId, date)] ?? '') || 0;
  const sizedSum = (date: string) => buckets.reduce((s, b) => s + value(b.id, date), 0);
  const dayTotal = (date: string) => sizedSum(date) + value(null, date);

  // The month's harvest days, plus any day that still holds a figure but is no
  // longer a harvest day — so changing the weekdays never hides a request.
  const scheduled = useMemo(
    () => harvestDatesInMonth(planStartDate, month, weekdays),
    [planStartDate, month, weekdays]
  );
  const dates = useMemo(() => {
    const set = new Set(scheduled);
    for (const k of Object.keys(vals)) {
      const date = k.slice(k.indexOf(':') + 1);
      if (!(Number(vals[k]) > 0) || set.has(date)) continue;
      if (monthIndexOfDate(planStartDate, date, horizon) === month) set.add(date);
    }
    return [...set].sort();
  }, [scheduled, vals, planStartDate, horizon, month]);
  const offSchedule = (date: string) => !scheduled.includes(date);

  const hasSizeless = dates.some((d) => value(null, d) > 0);
  const rows: Row[] =
    mode === 'by_date'
      ? [{ id: null, name: 'Requested' }]
      : [
          ...buckets.map((b) => ({ id: b.id as string | null, name: b.name })),
          ...(hasSizeless ? [{ id: null, name: 'No size stated', legacy: true }] : []),
        ];

  // In date mode a day already stated by size is shown as its sum, not edited.
  const lockedBySize = (row: Row, date: string) => mode === 'by_date' && row.id === null && sizedSum(date) > 0;
  const editable = (row: Row, date: string) => canEdit && !lockedBySize(row, date);
  const shown = (row: Row, date: string) => (lockedBySize(row, date) ? dayTotal(date) : value(row.id, date));

  const setCell = (r: number, c: number, v: string) => {
    const row = rows[r];
    const date = dates[c];
    if (!row || !date || !editable(row, date)) return;
    setVals((prev) => ({ ...prev, [key(row.id, date)]: v }));
  };
  const sel = useInputGridSelection({
    rows: rows.length,
    cols: dates.length,
    resetKey: `${mode}|${rows.length}|${dates.join()}`,
    clear: (r, c) => setCell(r, c, ''),
    paste: (r, c, v) => setCell(r, c, v === null ? '' : String(Math.round(v))),
  });

  const rowTotal = (row: Row) => dates.reduce((s, d) => s + shown(row, d), 0);
  const monthTotal = dates.reduce((s, d) => s + dayTotal(d), 0);

  function persistSettings(next: HarvestRequestSettings, revert: () => void) {
    startSaveSettings(async () => {
      const res = await saveHarvestRequestSettings(planId, next);
      if (res.error) { toast.error(res.error); revert(); return; }
      router.refresh();
    });
  }
  function onMode(next: HarvestRequestMode) {
    if (next === mode) return;
    const prev = mode;
    setMode(next);
    persistSettings({ mode: next, harvest_weekdays: weekdays }, () => setMode(prev));
  }
  function onWeekday(iso: number) {
    const prev = weekdays;
    const next = prev.includes(iso) ? prev.filter((d) => d !== iso) : [...prev, iso].sort((a, b) => a - b);
    if (!next.length) { toast.error('Keep at least one harvest day.'); return; }
    setWeekdays(next);
    persistSettings({ mode, harvest_weekdays: next }, () => setWeekdays(prev));
  }

  function save() {
    // Every changed cell in any month visited, so moving between months before
    // saving loses nothing. A cleared cell goes as zero, which deletes it.
    const entries = changedKeys.map((k) => {
      const i = k.indexOf(':');
      return {
        bucket_id: k.slice(0, i) || null,
        harvest_date: k.slice(i + 1),
        quantity_kg_wr: Number(vals[k] ?? '') || 0,
      };
    });
    startSave(async () => {
      const res = await saveHarvestRequestDaily(planId, entries);
      if (res.error) toast.error(res.error);
      else { toast.success('Daily request saved'); router.refresh(); }
    });
  }

  const dayHead = (date: string) => cn(
    'sticky top-0 z-20 min-w-[4.5rem] border-b border-border bg-muted px-2 py-2 text-right font-medium',
    date === today && 'bg-primary/15 text-foreground',
    date < today && 'text-muted-foreground/60',
    offSchedule(date) && 'bg-amber-100 text-amber-900'
  );

  return (
    <div className="space-y-2 pt-2">
      <div className="flex flex-wrap items-end justify-between gap-2">
        <div>
          <h3 className="flex items-center gap-1.5 text-base font-semibold">
            <CalendarDays className="h-4 w-4 text-muted-foreground" /> Daily request
          </h3>
          <p className="text-xs text-muted-foreground">
            What the plant asks the farm for before each harvest (kg WR). A month with anything here reads as its sum in
            the monthly grid above.
          </p>
        </div>
        {canEdit && (
          <Button size="sm" onClick={save} disabled={saving || changedKeys.length === 0}>
            <Save className="h-4 w-4" /> {saving ? 'Saving…' : 'Save daily request'}
          </Button>
        )}
      </div>

      <div className="flex flex-wrap items-center gap-x-4 gap-y-2 text-sm">
        <div className="flex items-center gap-1">
          <button
            type="button"
            onClick={() => setMonth((m) => Math.max(1, m - 1))}
            disabled={month <= 1}
            className="rounded-md border p-1.5 disabled:opacity-40"
            aria-label="Previous month"
          >
            <ChevronLeft className="h-4 w-4" />
          </button>
          <select
            value={month}
            onChange={(e) => setMonth(Number(e.target.value))}
            className="rounded-md border px-2.5 py-1.5 text-sm outline-none focus:ring-2 focus:ring-primary"
            aria-label="Month"
          >
            {Array.from({ length: horizon }, (_, i) => i + 1).map((mo) => (
              <option key={mo} value={mo}>{monthLabel(planStartDate, mo)}</option>
            ))}
          </select>
          <button
            type="button"
            onClick={() => setMonth((m) => Math.min(horizon, m + 1))}
            disabled={month >= horizon}
            className="rounded-md border p-1.5 disabled:opacity-40"
            aria-label="Next month"
          >
            <ChevronRight className="h-4 w-4" />
          </button>
        </div>

        <div className="flex items-center gap-1.5">
          <span className="text-xs font-medium text-muted-foreground">Request</span>
          <div className="inline-flex rounded-md border p-0.5" role="radiogroup" aria-label="Request mode">
            {MODES.map((m) => (
              <button
                key={m.value}
                type="button"
                role="radio"
                aria-checked={mode === m.value}
                disabled={!canEdit || savingSettings}
                onClick={() => onMode(m.value)}
                className={cn(
                  'rounded px-2.5 py-1 text-xs font-medium transition-colors',
                  mode === m.value ? 'bg-primary text-primary-foreground' : 'text-muted-foreground hover:bg-muted',
                  !canEdit && 'cursor-default'
                )}
              >
                {m.label}
              </button>
            ))}
          </div>
        </div>

        <div className="flex items-center gap-1.5">
          <span className="text-xs font-medium text-muted-foreground">Harvest days</span>
          <div className="flex gap-1">
            {WEEKDAYS.map((w) => {
              const on = weekdays.includes(w.iso);
              return (
                <button
                  key={w.iso}
                  type="button"
                  aria-pressed={on}
                  disabled={!canEdit || savingSettings}
                  onClick={() => onWeekday(w.iso)}
                  className={cn(
                    'rounded-full border px-2 py-0.5 text-xs font-medium transition-colors',
                    on ? 'border-primary bg-primary/10 text-primary' : 'text-muted-foreground hover:bg-muted',
                    !canEdit && 'cursor-default'
                  )}
                >
                  {w.label}
                </button>
              );
            })}
          </div>
        </div>
      </div>

      {dates.length === 0 ? (
        <p className="rounded-lg border border-dashed px-3 py-4 text-center text-xs text-muted-foreground">
          No harvest days in {monthLabel(planStartDate, month)}.
        </p>
      ) : (
        <ScrollX className="rounded-lg border border-border">
          <table className="w-max text-xs">
            <thead className="bg-muted text-muted-foreground">
              <tr>
                <th className={cn(stickyCol, 'sticky top-0 z-30 min-w-[10rem] border-b border-border bg-muted px-3 py-2 text-left font-semibold')}>
                  {mode === 'by_date' ? monthLabel(planStartDate, month) : 'Bucket'}
                </th>
                {dates.map((d) => (
                  <th
                    key={d}
                    className={dayHead(d)}
                    title={
                      offSchedule(d)
                        ? 'Not a harvest day any more, but it still holds a request. Clear it, or add the weekday back.'
                        : d === today ? 'Today' : undefined
                    }
                  >
                    {harvestDayLabel(d)}
                  </th>
                ))}
                <th className="sticky top-0 z-20 min-w-[6rem] border-b border-l border-border bg-muted px-3 py-2 text-right font-semibold">
                  Month total (kg WR)
                </th>
              </tr>
            </thead>
            <tbody>
              {rows.map((row, ri) => (
                <tr key={row.id ?? 'sizeless'} className="border-t hover:bg-muted/30">
                  <td
                    className={cn(
                      stickyCol,
                      'min-w-[10rem] border-r bg-card px-3 py-1.5 font-medium',
                      row.legacy && 'italic text-muted-foreground'
                    )}
                    title={row.legacy ? 'Day totals entered By date. Restate them by bucket, then clear this row.' : undefined}
                  >
                    {row.name}
                  </td>
                  {dates.map((d, ci) => (
                    <td
                      key={d}
                      className={cn('px-1 py-1 text-right tabular-nums', d === today && 'bg-primary/5')}
                      title={lockedBySize(row, d) ? 'Entered by size — switch to By date & size to edit.' : undefined}
                    >
                      {editable(row, d) ? (
                        <input
                          type="number"
                          min={0}
                          step="1"
                          value={vals[key(row.id, d)] ?? ''}
                          onChange={(e) => setVals((prev) => ({ ...prev, [key(row.id, d)]: e.target.value }))}
                          {...sel.inputProps(ri, ci)}
                          placeholder="0"
                          aria-label={`Requested ${row.name} for ${d}`}
                          className={cn(inputCellCls, sel.isSelected(ri, ci) && pasteCellCls.selected)}
                        />
                      ) : (
                        <span
                          className={cn(
                            'px-1.5',
                            shown(row, d) === 0 && 'text-muted-foreground/40',
                            lockedBySize(row, d) && 'italic'
                          )}
                        >
                          {shown(row, d).toLocaleString()}
                        </span>
                      )}
                    </td>
                  ))}
                  <td className="border-l px-3 py-1.5 text-right font-semibold tabular-nums">
                    {rowTotal(row).toLocaleString()}
                  </td>
                </tr>
              ))}
              {mode === 'by_date_size' && (
                <tr className="border-t-2 bg-muted/40 font-semibold">
                  <td className={cn(stickyCol, 'bg-muted/40 px-3 py-1.5')}>TOTAL</td>
                  {dates.map((d) => (
                    <td key={d} className="px-2 py-1.5 text-right tabular-nums">{dayTotal(d).toLocaleString()}</td>
                  ))}
                  <td className="border-l px-3 py-1.5 text-right tabular-nums">{monthTotal.toLocaleString()}</td>
                </tr>
              )}
            </tbody>
          </table>
        </ScrollX>
      )}

      {changedKeys.length > 0 && (
        <p className="text-xs text-amber-700">
          {changedKeys.length} unsaved change{changedKeys.length === 1 ? '' : 's'} — kept while you move between months.
        </p>
      )}
    </div>
  );
}

const inputCellCls = 'w-[4rem] rounded-md border px-1.5 py-0.5 text-right text-xs tabular-nums outline-none focus:ring-2 focus:ring-primary';
