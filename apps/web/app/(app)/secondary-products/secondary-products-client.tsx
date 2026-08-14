'use client';

import { useActionState, useCallback, useEffect, useMemo, useState, useTransition } from 'react';
import { useRouter } from 'next/navigation';
import { Plus, Settings2 } from 'lucide-react';
import { monthLabel } from '@oceanpick/shared';
import { cn } from '@/lib/utils';
import { MetricGrid, type Metric } from '@/components/metric-grid';
import type { GridRow } from '@/lib/grid-csv';
import { saveSecondaryProduct, setSecondaryArchived, type SecondaryFormState } from './actions';

export type SecondaryDef = {
  id: string;
  /** 'program' = one product's feedstock; 'total_wr' = the plan's whole round. */
  basis: 'program' | 'total_wr';
  source_item_code: string | null;
  name: string;
  /** Fraction of feedstock whole round, e.g. 0.02 for 2%. */
  yield_pct: number;
  price_per_kg: number;
  sort_order: number;
  is_archived: boolean;
};
export type SourceOption = { item_code: string; item_description: string };

/** Form value standing in for "whole fish — the plan's total whole round". */
export const TOTAL_WR = '__total_wr__';

const kg = (n: number) => `${Math.round(n).toLocaleString()} kg`;
const usd = (n: number) => `$${Math.round(n).toLocaleString()}`;
/** 0.02 -> "2%", 0.0075 -> "0.75%". toFixed always leaves a dot, so the trailing-zero strip is safe. */
const pct = (y: number) => `${(y * 100).toFixed(2).replace(/\.?0+$/, '')}%`;

export function SecondaryProductsClient({
  orgId,
  planStartDate,
  horizon,
  definitions,
  feedstock,
  totalWr,
  sources,
  canEdit,
}: {
  orgId: string;
  planStartDate: string;
  horizon: number;
  definitions: SecondaryDef[];
  /** Whole round consumed by each source product, per month, keyed by item_code. */
  feedstock: Record<string, number[]>;
  /** The plan's total allocated whole round per month — group 2's feedstock. */
  totalWr: number[];
  sources: SourceOption[];
  canEdit: boolean;
}) {
  const router = useRouter();
  const [modal, setModal] = useState<null | { def: SecondaryDef | null }>(null);
  const [manage, setManage] = useState(false);
  const [isPending, startTransition] = useTransition();

  const live = useMemo(() => definitions.filter((d) => !d.is_archived), [definitions]);
  // Quantity is right the moment a by-product exists, but revenue needs a price.
  // Say so, rather than letting a correct-looking $0 be read as "earns nothing".
  const unpriced = useMemo(() => live.filter((d) => !(d.price_per_kg > 0)), [live]);
  const descOf = useMemo(() => new Map(sources.map((s) => [s.item_code, s.item_description])), [sources]);

  // quantity = feedstock WR x yield;  revenue = quantity x price.
  const perDef = useMemo(
    () =>
      live.map((d) => {
        const feed =
          d.basis === 'total_wr'
            ? totalWr
            : feedstock[d.source_item_code ?? ''] ?? new Array<number>(horizon).fill(0);
        const quantity = feed.map((wr) => wr * d.yield_pct);
        return { def: d, quantity, revenue: quantity.map((q) => q * d.price_per_kg) };
      }),
    [live, feedstock, totalWr, horizon]
  );

  const sourceLabel = (d: SecondaryDef) =>
    d.basis === 'total_wr'
      ? 'whole fish (total WR)'
      : descOf.get(d.source_item_code ?? '') ?? d.source_item_code ?? '—';

  const rowsOf = (pick: (r: (typeof perDef)[number]) => number[]): GridRow[] =>
    perDef.map((r) => ({
      key: r.def.id,
      label: r.def.name,
      // Source, yield and price get their own columns rather than being crammed
      // into the label, where they truncated.
      extra: [sourceLabel(r.def), pct(r.def.yield_pct), `$${r.def.price_per_kg.toFixed(2)}`],
      values: pick(r),
      group: r.def.basis,
    }));

  const metrics: Metric[] = useMemo(
    () => [
      { key: 'quantity', label: 'Quantity (kg)', format: 'num0', rows: rowsOf((r) => r.quantity) },
      { key: 'revenue', label: 'Revenue ($)', format: 'usd0', rows: rowsOf((r) => r.revenue) },
    ],
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [perDef, descOf]
  );

  // The grid owns the month filter, so it reports its visible window back here
  // and the headline totals cover exactly what's on screen.
  const [range, setRange] = useState({ from: 1, to: horizon });
  const onRangeChange = useCallback(
    (from: number, to: number) =>
      setRange((prev) => (prev.from === from && prev.to === to ? prev : { from, to })),
    []
  );
  const fullRange = range.from === 1 && range.to === horizon;
  const rangeText = `${monthLabel(planStartDate, range.from)} – ${monthLabel(planStartDate, range.to)}`;

  const totals = useMemo(() => {
    let q = 0, rev = 0;
    for (const r of perDef) {
      for (let i = range.from - 1; i < range.to; i++) {
        q += r.quantity[i] ?? 0;
        rev += r.revenue[i] ?? 0;
      }
    }
    return { quantity: q, revenue: rev };
  }, [perDef, range]);

  function onArchive(d: SecondaryDef, archived: boolean) {
    startTransition(async () => {
      await setSecondaryArchived(d.id, archived);
      router.refresh();
    });
  }

  const nextOrder = (Math.max(0, ...definitions.map((d) => d.sort_order)) || 0) + 10;

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div className="grid flex-1 grid-cols-2 gap-3 sm:max-w-md">
          <Stat
            label="Total quantity"
            value={kg(totals.quantity)}
            sub={fullRange ? `over ${horizon} months` : rangeText}
          />
          <Stat
            label="Total revenue"
            value={usd(totals.revenue)}
            sub={fullRange ? 'secondary products' : rangeText}
            tone="good"
          />
        </div>
        {canEdit && (
          <div className="flex items-center gap-2">
            <button
              onClick={() => setManage((v) => !v)}
              className="inline-flex items-center gap-1.5 rounded-md border px-3 py-1.5 text-sm font-medium hover:bg-muted"
            >
              <Settings2 className="h-4 w-4" /> {manage ? 'Hide definitions' : 'Manage by-products'}
            </button>
            <button
              onClick={() => setModal({ def: null })}
              className="inline-flex items-center gap-1.5 rounded-md bg-primary px-3 py-1.5 text-sm font-medium text-primary-foreground"
            >
              <Plus className="h-4 w-4" /> New by-product
            </button>
          </div>
        )}
      </div>

      {unpriced.length > 0 && (
        <p className="rounded-lg border border-warning/30 bg-warning/10 px-3 py-2 text-sm text-warning">
          {unpriced.length === 1 ? '1 by-product has' : `${unpriced.length} by-products have`} no price set
          {' '}({unpriced.map((d) => d.name).join(', ')}) — their quantities are correct, but revenue reads zero until
          {canEdit ? ' you set $/kg on them.' : ' an admin sets $/kg on them.'}
        </p>
      )}

      {manage && canEdit && (
        <DefinitionsTable
          definitions={definitions}
          sourceLabel={sourceLabel}
          isPending={isPending}
          onEdit={(d) => setModal({ def: d })}
          onArchive={onArchive}
        />
      )}

      {live.length === 0 ? (
        <p className="rounded-lg border border-dashed p-6 text-center text-sm text-muted-foreground">
          No by-products defined yet.
          {canEdit
            ? ' Use New by-product to add one — pick the product it comes off, its recovery rate, and its price.'
            : ' An admin can add them.'}
        </p>
      ) : (
        <MetricGrid
          planStartDate={planStartDate}
          horizon={horizon}
          metrics={metrics}
          firstColLabel="By-product"
          filenameBase="secondary-products"
          rowFilter
          onRangeChange={onRangeChange}
          extraCols={[
            { label: 'Recovered from', width: 'min-w-[13rem] max-w-[13rem] truncate' },
            { label: 'Yield', align: 'right' },
            { label: '$/kg', align: 'right' },
          ]}
        />
      )}

      <p className="text-xs text-muted-foreground">
        Quantity = the whole round actually consumed by the source product that month × the recovery rate; revenue =
        quantity × price. Feedstock is what the engine allocated (borrowings included), so unfulfilled demand yields no
        by-product. Recalculate after changing demand or harvest to refresh it.
      </p>

      {modal && canEdit && (
        <DefinitionModal
          orgId={orgId}
          def={modal.def}
          sources={sources}
          defaultOrder={nextOrder}
          onClose={() => setModal(null)}
          onSaved={() => { setModal(null); router.refresh(); }}
        />
      )}
    </div>
  );
}

function DefinitionsTable({
  definitions,
  sourceLabel,
  isPending,
  onEdit,
  onArchive,
}: {
  definitions: SecondaryDef[];
  sourceLabel: (d: SecondaryDef) => string;
  isPending: boolean;
  onEdit: (d: SecondaryDef) => void;
  onArchive: (d: SecondaryDef, archived: boolean) => void;
}) {
  return (
    <div className="overflow-x-auto rounded-lg border">
      <table className="w-full text-sm">
        <thead className="border-b bg-muted/50 text-left text-xs uppercase tracking-wide text-muted-foreground">
          <tr>
            <th className="px-3 py-2">By-product</th>
            <th className="px-3 py-2">Recovered from</th>
            <th className="px-3 py-2 text-right">Yield</th>
            <th className="px-3 py-2 text-right">Price ($/kg)</th>
            <th className="px-3 py-2" />
          </tr>
        </thead>
        <tbody>
          {definitions.length === 0 && (
            <tr><td colSpan={5} className="px-3 py-6 text-center text-muted-foreground">Nothing defined yet.</td></tr>
          )}
          {definitions.map((d) => (
            <tr key={d.id} className={cn('border-b last:border-0 hover:bg-muted/30', d.is_archived && 'opacity-50')}>
              <td className="px-3 py-2 font-medium">
                {d.name}
                {d.is_archived && <span className="ml-2 rounded-full bg-muted px-2 py-0.5 text-xs text-muted-foreground">archived</span>}
              </td>
              <td className="px-3 py-2 text-muted-foreground">{sourceLabel(d)}</td>
              <td className="px-3 py-2 text-right tabular-nums">{pct(d.yield_pct)}</td>
              <td className="px-3 py-2 text-right tabular-nums">{d.price_per_kg.toLocaleString()}</td>
              <td className="px-3 py-2">
                <div className="flex justify-end gap-3">
                  <button onClick={() => onEdit(d)} className="text-primary hover:underline">Edit</button>
                  <button
                    onClick={() => onArchive(d, !d.is_archived)}
                    disabled={isPending}
                    className="text-muted-foreground hover:text-foreground"
                  >
                    {d.is_archived ? 'Restore' : 'Archive'}
                  </button>
                </div>
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

const initial: SecondaryFormState = { error: null, ok: false };

function DefinitionModal({
  orgId,
  def,
  sources,
  defaultOrder,
  onClose,
  onSaved,
}: {
  orgId: string;
  def: SecondaryDef | null;
  sources: SourceOption[];
  defaultOrder: number;
  onClose: () => void;
  onSaved: () => void;
}) {
  const [state, formAction, pending] = useActionState(saveSecondaryProduct, initial);
  useEffect(() => { if (state.ok) onSaved(); }, [state.ok, onSaved]);

  return (
    <div className="fixed inset-0 z-40 flex items-center justify-center bg-black/50 p-4 backdrop-blur-sm" onClick={onClose}>
      <form action={formAction} className="w-full max-w-md rounded-lg bg-card p-5 text-sm shadow-xl" onClick={(e) => e.stopPropagation()}>
        <input type="hidden" name="org_id" value={orgId} />
        {def && <input type="hidden" name="id" value={def.id} />}
        <h2 className="mb-3 text-sm font-semibold">{def ? 'Edit by-product' : 'New by-product'}</h2>

        <label className="block">
          <span className="text-xs font-medium text-muted-foreground">Recovered from</span>
          <select
            name="source_item_code"
            defaultValue={def ? (def.basis === 'total_wr' ? TOTAL_WR : def.source_item_code ?? '') : ''}
            className={inputCls}
          >
            <option value="">Select…</option>
            <option value={TOTAL_WR}>Whole fish — total whole round (every fish processed)</option>
            {sources.map((s) => (
              <option key={s.item_code} value={s.item_code}>{s.item_description} ({s.item_code})</option>
            ))}
          </select>
        </label>

        <label className="mt-3 block">
          <span className="text-xs font-medium text-muted-foreground">By-product name</span>
          <input name="name" defaultValue={def?.name ?? ''} className={inputCls} placeholder="e.g. Belly flap" />
        </label>

        <div className="mt-3 grid grid-cols-2 gap-3">
          <label className="block">
            <span className="text-xs font-medium text-muted-foreground">Yield (% of whole round)</span>
            <input
              name="yield_pct"
              type="number"
              step="0.01"
              min={0}
              max={100}
              defaultValue={def ? +(def.yield_pct * 100).toFixed(4) : ''}
              className={inputCls}
              placeholder="e.g. 2"
            />
          </label>
          <label className="block">
            <span className="text-xs font-medium text-muted-foreground">Price ($/kg)</span>
            <input
              name="price_per_kg"
              type="number"
              step="0.01"
              min={0}
              defaultValue={def?.price_per_kg ?? ''}
              className={inputCls}
              placeholder="e.g. 1.80"
            />
          </label>
        </div>

        <label className="mt-3 block">
          <span className="text-xs font-medium text-muted-foreground">Order</span>
          <input name="sort_order" type="number" step="1" defaultValue={def?.sort_order ?? defaultOrder} className={inputCls} />
        </label>

        {state.error && <p role="alert" className="mt-3 rounded-md bg-destructive/10 px-3 py-2 text-sm text-destructive">{state.error}</p>}

        <div className="mt-4 flex justify-end gap-2">
          <button type="button" onClick={onClose} className="rounded-md border px-3 py-1.5 hover:bg-muted">Cancel</button>
          <button type="submit" disabled={pending} className="rounded-md bg-primary px-3 py-1.5 font-medium text-primary-foreground disabled:opacity-50">
            {pending ? 'Saving…' : def ? 'Save' : 'Create'}
          </button>
        </div>
      </form>
    </div>
  );
}

function Stat({ label, value, sub, tone }: { label: string; value: string; sub?: string; tone?: 'good' }) {
  return (
    <div className="rounded-lg border bg-card px-3 py-2">
      <div className="text-xs text-muted-foreground">{label}</div>
      <div className={cn('text-lg font-semibold tabular-nums', tone === 'good' && 'text-success')}>{value}</div>
      {sub && <div className="text-[11px] text-muted-foreground">{sub}</div>}
    </div>
  );
}

const inputCls = 'mt-1 w-full rounded-md border px-2.5 py-1.5 text-sm outline-none focus:ring-2 focus:ring-primary';
