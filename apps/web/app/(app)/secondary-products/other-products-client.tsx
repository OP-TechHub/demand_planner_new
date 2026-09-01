'use client';

import { useActionState, useCallback, useEffect, useMemo, useState, useTransition } from 'react';
import { useRouter } from 'next/navigation';
import { Download, Plus, Settings2, Upload } from 'lucide-react';
import { monthLabel } from '@oceanpick/shared';
import { cn } from '@/lib/utils';
import { Button } from '@/components/ui/button';
import { OutputGrid, type FmtKey } from '@/components/output-grid';
import { toCsv, downloadCsv } from '@/lib/csv';
import { gridCsvRows, type Aggregate, type GridRow } from '@/lib/grid-csv';
import { WideGridImport } from '@/components/wide-grid-import';
import { saveOtherProduct, setOtherArchived, saveOtherQuantities, importOtherQuantities, type OtherFormState } from './other-actions';

export type OtherProduct = {
  id: string;
  name: string;
  /** What the quantity is counted in — kg, cases, units. */
  unit_label: string;
  unit_cost: number;
  unit_revenue: number;
  sort_order: number;
  is_archived: boolean;
};

/** One figure the grid can show — product rows, month columns. */
type OtherMetric = { key: string; label: string; format: FmtKey; rows: GridRow[]; aggregate?: Aggregate };

const usd0 = (n: number) => `$${Math.round(n).toLocaleString()}`;
const usd2 = (n: number) => `$${n.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
const num0 = (n: number) => Math.round(n).toLocaleString();

export function OtherProductsClient({
  orgId,
  planStartDate,
  horizon,
  products,
  quantities,
  canEdit,
}: {
  orgId: string;
  planStartDate: string;
  horizon: number;
  products: OtherProduct[];
  /** Monthly quantity per product id, length === horizon. */
  quantities: Record<string, number[]>;
  canEdit: boolean;
}) {
  const router = useRouter();
  const [modal, setModal] = useState<null | { product: OtherProduct | null }>(null);
  const [qtyFor, setQtyFor] = useState<OtherProduct | null>(null);
  const [manage, setManage] = useState(false);
  const [importing, setImporting] = useState(false);
  const [metricKey, setMetricKey] = useState('total_revenue');
  const [isPending, startTransition] = useTransition();

  const live = useMemo(() => products.filter((p) => !p.is_archived), [products]);

  // quantity × rate, month by month. The unit rates are flat across the horizon
  // — they are properties of the product, not of a month — but they are shown
  // per month so a rate can be read beside the figures it produced.
  const per = useMemo(
    () =>
      live.map((p) => {
        const qty = quantities[p.id] ?? new Array<number>(horizon).fill(0);
        const margin = p.unit_revenue - p.unit_cost;
        return {
          product: p,
          qty,
          unitCost: qty.map(() => p.unit_cost),
          unitRevenue: qty.map(() => p.unit_revenue),
          unitMargin: qty.map(() => margin),
          totalCost: qty.map((q) => q * p.unit_cost),
          totalRevenue: qty.map((q) => q * p.unit_revenue),
          totalMargin: qty.map((q) => q * margin),
        };
      }),
    [live, quantities, horizon]
  );

  type Row = (typeof per)[number];
  const rowsOf = (pick: (r: Row) => number[], rate = false): GridRow[] =>
    per.map((r) => ({
      key: r.product.id,
      label: r.product.name,
      sublabel: rate ? `per ${r.product.unit_label}` : undefined,
      values: pick(r),
      // A rate can only be totalled as an average weighted by the quantity behind it.
      weights: rate ? r.qty : undefined,
    }));

  const metrics: OtherMetric[] = useMemo(
    () => [
      { key: 'quantity', label: 'Quantity', format: 'num0', rows: rowsOf((r) => r.qty) },
      { key: 'unit_cost', label: 'Unit cost', format: 'usd2', aggregate: 'ratio', rows: rowsOf((r) => r.unitCost, true) },
      { key: 'unit_revenue', label: 'Unit revenue', format: 'usd2', aggregate: 'ratio', rows: rowsOf((r) => r.unitRevenue, true) },
      { key: 'unit_margin', label: 'Unit margin', format: 'usd2', aggregate: 'ratio', rows: rowsOf((r) => r.unitMargin, true) },
      { key: 'total_cost', label: 'Total cost', format: 'usd0', rows: rowsOf((r) => r.totalCost) },
      { key: 'total_revenue', label: 'Total revenue', format: 'usd0', rows: rowsOf((r) => r.totalRevenue) },
      { key: 'total_margin', label: 'Total margin', format: 'usd0', rows: rowsOf((r) => r.totalMargin) },
    ],
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [per]
  );
  const metric = metrics.find((m) => m.key === metricKey) ?? metrics[0];

  // The grid owns the month filter and reports its window back, so the headline
  // figures cover exactly what is on screen.
  const [range, setRange] = useState({ from: 1, to: horizon });
  const onRangeChange = useCallback(
    (from: number, to: number) => setRange((prev) => (prev.from === from && prev.to === to ? prev : { from, to })),
    []
  );
  const fullRange = range.from === 1 && range.to === horizon;
  const rangeText = `${monthLabel(planStartDate, range.from)} – ${monthLabel(planStartDate, range.to)}`;

  const totals = useMemo(() => {
    let cost = 0, revenue = 0;
    for (const r of per) {
      for (let i = range.from - 1; i < range.to; i++) {
        cost += r.totalCost[i] ?? 0;
        revenue += r.totalRevenue[i] ?? 0;
      }
    }
    return { cost, revenue, margin: revenue - cost };
  }, [per, range]);

  function onArchive(p: OtherProduct, archived: boolean) {
    startTransition(async () => {
      await setOtherArchived(p.id, archived);
      router.refresh();
    });
  }

  const nextOrder = (Math.max(0, ...products.map((p) => p.sort_order)) || 0) + 10;
  const unquantified = live.filter((p) => !(quantities[p.id] ?? []).some((q) => q > 0));

  return (
    <div className="space-y-4">
      <div>
        <h2 className="text-lg font-semibold">Other products</h2>
        <p className="mt-1 text-sm text-muted-foreground">
          Lines that sit outside the harvest plan — quantity is entered month by month, and cost and revenue are the
          rates you sell them at.
        </p>
      </div>

      <div className="flex flex-wrap items-center justify-between gap-2">
        <div className="grid flex-1 grid-cols-3 gap-3 sm:max-w-xl">
          <Stat label="Total cost" value={usd0(totals.cost)} sub={fullRange ? `over ${horizon} months` : rangeText} />
          <Stat label="Total revenue" value={usd0(totals.revenue)} sub={fullRange ? 'other products' : rangeText} />
          <Stat
            label="Total margin"
            value={usd0(totals.margin)}
            sub={totals.revenue > 0 ? `GP ${((totals.margin / totals.revenue) * 100).toFixed(1)}%` : '—'}
            tone={totals.margin >= 0 ? 'good' : 'bad'}
          />
        </div>
        {canEdit && (
          <div className="flex items-center gap-2">
            <button
              onClick={() => setManage((v) => !v)}
              className="inline-flex items-center gap-1.5 rounded-md border px-3 py-1.5 text-sm font-medium hover:bg-muted"
            >
              <Settings2 className="h-4 w-4" /> {manage ? 'Hide products' : 'Manage products'}
            </button>
            <button
              onClick={() => setImporting(true)}
              disabled={live.length === 0}
              title={live.length === 0 ? 'Add a product first — the file is matched on product name.' : undefined}
              className="inline-flex items-center gap-1.5 rounded-md border px-3 py-1.5 text-sm font-medium hover:bg-muted disabled:opacity-50"
            >
              <Upload className="h-4 w-4" /> Import CSV
            </button>
            <button
              onClick={() => setModal({ product: null })}
              className="inline-flex items-center gap-1.5 rounded-md bg-primary px-3 py-1.5 text-sm font-medium text-primary-foreground"
            >
              <Plus className="h-4 w-4" /> Add product
            </button>
          </div>
        )}
      </div>

      {unquantified.length > 0 && (
        <p className="rounded-lg border border-warning/30 bg-warning/10 px-3 py-2 text-sm text-warning">
          {unquantified.length === 1 ? '1 product has' : `${unquantified.length} products have`} no monthly quantity
          {' '}({unquantified.map((p) => p.name).join(', ')}) — their rates are set, but every figure reads zero until
          {canEdit ? ' you enter quantities.' : ' an admin enters quantities.'}
        </p>
      )}

      {manage && canEdit && (
        <ProductsTable
          products={products}
          quantities={quantities}
          isPending={isPending}
          onEdit={(p) => setModal({ product: p })}
          onQuantities={(p) => setQtyFor(p)}
          onArchive={onArchive}
        />
      )}

      {live.length === 0 ? (
        <p className="rounded-lg border border-dashed p-6 text-center text-sm text-muted-foreground">
          No other products yet.
          {canEdit
            ? ' Use Add product to enter one — its unit cost and unit revenue, then its quantity month by month.'
            : ' An admin can add them.'}
        </p>
      ) : (
        <div className="space-y-3">
          <div className="flex flex-wrap items-center justify-between gap-2">
            <label className="flex items-center gap-2 text-sm">
              <span className="text-xs font-medium text-muted-foreground">Show</span>
              <select
                value={metric.key}
                onChange={(e) => setMetricKey(e.target.value)}
                aria-label="Figure to show"
                className="rounded-md border border-border bg-card px-2.5 py-1.5 text-sm outline-none focus:ring-2 focus:ring-primary"
              >
                {metrics.map((m) => <option key={m.key} value={m.key}>{m.label}</option>)}
              </select>
            </label>
            <Button
              variant="outline"
              size="sm"
              onClick={() =>
                downloadCsv(
                  `other-products-${metric.key}.csv`,
                  toCsv(gridCsvRows('Product', planStartDate, horizon, metric.rows, true, [], metric.aggregate ?? 'sum'))
                )
              }
            >
              <Download />
              Export CSV
            </Button>
          </div>
          <OutputGrid
            planStartDate={planStartDate}
            horizon={horizon}
            rows={metric.rows}
            format={metric.format}
            aggregate={metric.aggregate}
            firstColLabel="Product"
            onRangeChange={onRangeChange}
          />
          {metric.aggregate === 'ratio' && (
            <p className="text-xs text-muted-foreground">
              A rate is the same in every month it applies to; its Total is the average weighted by the quantity behind
              it, not the twelve months added together.
            </p>
          )}
        </div>
      )}

      {modal && canEdit && (
        <ProductModal
          orgId={orgId}
          product={modal.product}
          planStartDate={planStartDate}
          horizon={horizon}
          defaultOrder={nextOrder}
          onClose={() => setModal(null)}
          onSaved={() => { setModal(null); router.refresh(); }}
        />
      )}

      {importing && canEdit && (
        <WideGridImport
          title="Import monthly quantities"
          keyColumn="product"
          keys={live.map((p) => ({ key: p.name, note: p.unit_label }))}
          noteColumn="unit"
          planStartDate={planStartDate}
          horizon={horizon}
          templateName="other-products-template.csv"
          onImport={(rows) => importOtherQuantities(orgId, rows)}
          onClose={() => setImporting(false)}
          onDone={() => { setImporting(false); router.refresh(); }}
        />
      )}

      {qtyFor && canEdit && (
        <QuantityEditor
          orgId={orgId}
          product={qtyFor}
          planStartDate={planStartDate}
          horizon={horizon}
          months={quantities[qtyFor.id] ?? new Array<number>(horizon).fill(0)}
          onClose={() => setQtyFor(null)}
          onSaved={() => { setQtyFor(null); router.refresh(); }}
        />
      )}
    </div>
  );
}

function ProductsTable({
  products,
  quantities,
  isPending,
  onEdit,
  onQuantities,
  onArchive,
}: {
  products: OtherProduct[];
  quantities: Record<string, number[]>;
  isPending: boolean;
  onEdit: (p: OtherProduct) => void;
  onQuantities: (p: OtherProduct) => void;
  onArchive: (p: OtherProduct, archived: boolean) => void;
}) {
  // A header row with nothing under it says less than the empty state below it.
  if (products.length === 0) return null;
  return (
    <div className="overflow-x-auto rounded-lg border">
      <table className="w-full text-sm">
        <thead className="border-b bg-muted/50 text-left text-xs uppercase tracking-wide text-muted-foreground">
          <tr>
            <th className="px-3 py-2">Order</th>
            <th className="px-3 py-2">Product</th>
            <th className="px-3 py-2">Unit</th>
            <th className="px-3 py-2 text-right">Unit cost</th>
            <th className="px-3 py-2 text-right">Unit revenue</th>
            <th className="px-3 py-2 text-right">Unit margin</th>
            <th className="px-3 py-2 text-right">Total quantity</th>
            <th className="px-3 py-2" />
          </tr>
        </thead>
        <tbody>
          {products.map((p) => {
            const qty = (quantities[p.id] ?? []).reduce((s, v) => s + v, 0);
            const margin = p.unit_revenue - p.unit_cost;
            return (
              <tr key={p.id} className={cn('border-b last:border-0 hover:bg-muted/30', p.is_archived && 'opacity-50')}>
                <td className="px-3 py-2 tabular-nums text-muted-foreground">{p.sort_order}</td>
                <td className="px-3 py-2 font-medium">
                  {p.name}
                  {p.is_archived && <span className="ml-2 rounded-full bg-muted px-2 py-0.5 text-xs text-muted-foreground">archived</span>}
                </td>
                <td className="px-3 py-2 text-muted-foreground">{p.unit_label}</td>
                <td className="px-3 py-2 text-right tabular-nums">{usd2(p.unit_cost)}</td>
                <td className="px-3 py-2 text-right tabular-nums">{usd2(p.unit_revenue)}</td>
                <td className={cn('px-3 py-2 text-right tabular-nums', margin < 0 && 'text-destructive')}>{usd2(margin)}</td>
                <td className="px-3 py-2 text-right tabular-nums">{num0(qty)}</td>
                <td className="px-3 py-2">
                  <div className="flex justify-end gap-3">
                    <button onClick={() => onQuantities(p)} className="text-primary hover:underline">Quantities</button>
                    <button onClick={() => onEdit(p)} className="text-primary hover:underline">Edit</button>
                    <button
                      onClick={() => onArchive(p, !p.is_archived)}
                      disabled={isPending}
                      className="text-muted-foreground hover:text-foreground"
                    >
                      {p.is_archived ? 'Restore' : 'Archive'}
                    </button>
                  </div>
                </td>
              </tr>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}

const initial: OtherFormState = { error: null, ok: false };

function ProductModal({
  orgId,
  product,
  planStartDate,
  horizon,
  defaultOrder,
  onClose,
  onSaved,
}: {
  orgId: string;
  product: OtherProduct | null;
  planStartDate: string;
  horizon: number;
  defaultOrder: number;
  onClose: () => void;
  onSaved: () => void;
}) {
  const [state, formAction, pending] = useActionState(saveOtherProduct, initial);
  useEffect(() => { if (state.ok) onSaved(); }, [state.ok, onSaved]);

  const monthList = useMemo(() => Array.from({ length: horizon }, (_, i) => i + 1), [horizon]);
  // The months the opening quantity lands in. They move together the way every
  // other range in the app does: a start month proposes the year from it.
  const [from, setFrom] = useState(1);
  const [to, setTo] = useState(Math.min(12, horizon));
  const onFrom = (v: number) => { setFrom(v); setTo(Math.min(v + 11, horizon)); };
  const onTo = (v: number) => { setTo(v); if (v < from) setFrom(v); };

  return (
    <div className="fixed inset-0 z-40 flex items-center justify-center bg-black/50 p-4 backdrop-blur-sm" onClick={onClose}>
      <form action={formAction} className="w-full max-w-md rounded-lg bg-card p-5 text-sm shadow-xl" onClick={(e) => e.stopPropagation()}>
        <input type="hidden" name="org_id" value={orgId} />
        {product && <input type="hidden" name="id" value={product.id} />}
        <h2 className="mb-3 text-sm font-semibold">{product ? 'Edit product' : 'Add other product'}</h2>

        <label className="block">
          <span className="text-xs font-medium text-muted-foreground">Product name</span>
          <input name="name" defaultValue={product?.name ?? ''} className={inputCls} placeholder="e.g. Traded shrimp" />
        </label>

        <label className="mt-3 block">
          <span className="text-xs font-medium text-muted-foreground">Unit (what the quantity counts)</span>
          <input name="unit_label" defaultValue={product?.unit_label ?? 'kg'} className={inputCls} placeholder="kg" />
        </label>

        <div className="mt-3 grid grid-cols-2 gap-3">
          <label className="block">
            <span className="text-xs font-medium text-muted-foreground">Unit cost ($)</span>
            <input name="unit_cost" type="number" step="0.01" min={0} defaultValue={product?.unit_cost ?? ''} className={inputCls} placeholder="e.g. 4.20" />
          </label>
          <label className="block">
            <span className="text-xs font-medium text-muted-foreground">Unit revenue ($)</span>
            <input name="unit_revenue" type="number" step="0.01" min={0} defaultValue={product?.unit_revenue ?? ''} className={inputCls} placeholder="e.g. 6.50" />
          </label>
        </div>

        <div className="mt-4 rounded-md border p-3">
          <p className="text-xs font-medium text-muted-foreground">Quantity (optional)</p>
          <div className="mt-2 grid grid-cols-3 gap-2">
            <label className="block">
              <span className="text-[11px] text-muted-foreground">Per month</span>
              <input name="quantity" type="number" step="any" min={0} className={inputCls} placeholder="e.g. 1,200" />
            </label>
            <label className="block">
              <span className="text-[11px] text-muted-foreground">From</span>
              <select name="from_month" value={from} onChange={(e) => onFrom(Number(e.target.value))} className={inputCls}>
                {monthList.map((mo) => <option key={mo} value={mo}>{monthLabel(planStartDate, mo)}</option>)}
              </select>
            </label>
            <label className="block">
              <span className="text-[11px] text-muted-foreground">To</span>
              <select name="to_month" value={to} onChange={(e) => onTo(Number(e.target.value))} className={inputCls}>
                {monthList.map((mo) => <option key={mo} value={mo}>{monthLabel(planStartDate, mo)}</option>)}
              </select>
            </label>
          </div>
          <p className="mt-2 text-xs text-muted-foreground">
            Fills those months with that quantity. Leave it blank and nothing is written; either way the months can be
            edited one by one under <b>Quantities</b> afterwards.
          </p>
        </div>

        <label className="mt-3 block">
          <span className="text-xs font-medium text-muted-foreground">Order</span>
          <input name="sort_order" type="number" step="1" defaultValue={product?.sort_order ?? defaultOrder} className={inputCls} />
        </label>

        {state.error && <p role="alert" className="mt-3 rounded-md bg-destructive/10 px-3 py-2 text-sm text-destructive">{state.error}</p>}

        <div className="mt-4 flex justify-end gap-2">
          <button type="button" onClick={onClose} className="rounded-md border px-3 py-1.5 hover:bg-muted">Cancel</button>
          <button type="submit" disabled={pending} className="rounded-md bg-primary px-3 py-1.5 font-medium text-primary-foreground disabled:opacity-50">
            {pending ? 'Saving…' : product ? 'Save' : 'Create'}
          </button>
        </div>
      </form>
    </div>
  );
}

/**
 * The monthly quantity row, edited month by month. Blank and zero mean the same
 * thing — nothing planned that month — and are stored as no row at all.
 */
function QuantityEditor({
  orgId,
  product,
  planStartDate,
  horizon,
  months,
  onClose,
  onSaved,
}: {
  orgId: string;
  product: OtherProduct;
  planStartDate: string;
  horizon: number;
  months: number[];
  onClose: () => void;
  onSaved: () => void;
}) {
  const monthList = useMemo(() => Array.from({ length: horizon }, (_, i) => i + 1), [horizon]);
  const [values, setValues] = useState<Record<number, string>>(() => {
    const v: Record<number, string> = {};
    for (const mo of monthList) {
      const q = months[mo - 1] ?? 0;
      v[mo] = q > 0 ? String(q) : '';
    }
    return v;
  });
  const [fill, setFill] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [isPending, startTransition] = useTransition();

  const qtyOf = (mo: number) => {
    const raw = (values[mo] ?? '').trim();
    if (raw === '') return 0;
    const n = Number(raw);
    return Number.isFinite(n) ? n : 0;
  };
  const total = monthList.reduce((s, mo) => s + qtyOf(mo), 0);
  const margin = product.unit_revenue - product.unit_cost;

  function onSave() {
    setError(null);
    const payload: { month_index: number; quantity: number }[] = [];
    for (const mo of monthList) {
      const raw = (values[mo] ?? '').trim();
      if (raw === '') continue;
      const n = Number(raw);
      if (!Number.isFinite(n) || n < 0) {
        setError(`${monthLabel(planStartDate, mo)}: quantity must be zero or greater.`);
        return;
      }
      payload.push({ month_index: mo, quantity: n });
    }
    startTransition(async () => {
      const res = await saveOtherQuantities(product.id, orgId, payload);
      if (res.error) setError(res.error);
      else onSaved();
    });
  }

  return (
    <div className="fixed inset-0 z-40 flex items-center justify-center bg-black/50 p-4 backdrop-blur-sm" onClick={onClose}>
      <div className="flex max-h-[90vh] w-full max-w-2xl flex-col rounded-lg bg-card shadow-xl" onClick={(e) => e.stopPropagation()}>
        <div className="flex items-center justify-between border-b px-5 py-3">
          <div>
            <h2 className="text-sm font-semibold">Quantities — {product.name}</h2>
            <p className="text-xs text-muted-foreground">
              {usd2(product.unit_cost)} cost · {usd2(product.unit_revenue)} revenue · {usd2(margin)} margin per {product.unit_label}
            </p>
          </div>
          <button onClick={onClose} className="text-muted-foreground hover:text-foreground">✕</button>
        </div>

        <div className="flex flex-wrap items-center gap-2 border-b px-5 py-2 text-sm">
          <input
            type="number"
            step="any"
            min={0}
            value={fill}
            onChange={(e) => setFill(e.target.value)}
            placeholder="Quantity"
            className="w-28 rounded-md border px-2 py-1 text-right text-sm outline-none focus:ring-2 focus:ring-primary"
          />
          <button
            onClick={() => {
              const raw = fill.trim();
              if (raw === '') return;
              setValues(Object.fromEntries(monthList.map((mo) => [mo, raw])));
            }}
            className="rounded-md border px-2.5 py-1 hover:bg-muted"
          >
            Apply to every month
          </button>
          <button onClick={() => setValues({})} className="rounded-md border px-2.5 py-1 hover:bg-muted">
            Clear all
          </button>
        </div>

        <div className="flex-1 overflow-y-auto px-5 py-3">
          <table className="w-full text-sm">
            <thead className="sticky top-0 bg-card text-left text-xs uppercase tracking-wide text-muted-foreground">
              <tr>
                <th className="py-1">Month</th>
                <th className="py-1 text-right">Quantity</th>
                <th className="py-1 text-right">Cost</th>
                <th className="py-1 text-right">Revenue</th>
                <th className="py-1 text-right">Margin</th>
              </tr>
            </thead>
            <tbody>
              {monthList.map((mo) => {
                const q = qtyOf(mo);
                return (
                  <tr key={mo} className="border-t">
                    <td className="py-1">{monthLabel(planStartDate, mo)}</td>
                    <td className="py-1 text-right">
                      <input
                        type="number"
                        step="any"
                        min={0}
                        value={values[mo] ?? ''}
                        onChange={(e) => setValues((prev) => ({ ...prev, [mo]: e.target.value }))}
                        placeholder="—"
                        className="w-28 rounded-md border px-2 py-1 text-right text-sm outline-none focus:ring-2 focus:ring-primary"
                      />
                    </td>
                    <td className="py-1 text-right tabular-nums text-muted-foreground">{usd0(q * product.unit_cost)}</td>
                    <td className="py-1 text-right tabular-nums text-muted-foreground">{usd0(q * product.unit_revenue)}</td>
                    <td className={cn('py-1 text-right tabular-nums', q * margin < 0 && 'text-destructive')}>{usd0(q * margin)}</td>
                  </tr>
                );
              })}
            </tbody>
            <tfoot className="border-t-2 font-medium">
              <tr>
                <td className="py-1">Total</td>
                <td className="py-1 text-right tabular-nums">{num0(total)}</td>
                <td className="py-1 text-right tabular-nums">{usd0(total * product.unit_cost)}</td>
                <td className="py-1 text-right tabular-nums">{usd0(total * product.unit_revenue)}</td>
                <td className={cn('py-1 text-right tabular-nums', total * margin < 0 && 'text-destructive')}>{usd0(total * margin)}</td>
              </tr>
            </tfoot>
          </table>
        </div>

        {error && <p role="alert" className="mx-5 mb-2 rounded-md bg-destructive/10 px-3 py-2 text-sm text-destructive">{error}</p>}

        <div className="flex items-center justify-end gap-2 border-t px-5 py-3">
          <button onClick={onClose} className="rounded-md border px-3 py-1.5 text-sm hover:bg-muted">Cancel</button>
          <button onClick={onSave} disabled={isPending} className="rounded-md bg-primary px-3 py-1.5 text-sm font-medium text-primary-foreground disabled:opacity-50">
            {isPending ? 'Saving…' : 'Save'}
          </button>
        </div>
      </div>
    </div>
  );
}

function Stat({ label, value, sub, tone }: { label: string; value: string; sub?: string; tone?: 'good' | 'bad' }) {
  return (
    <div className="rounded-lg border bg-card p-4">
      <div className="text-xs uppercase tracking-wide text-muted-foreground">{label}</div>
      <div className={cn('mt-1 text-lg font-semibold', tone === 'good' && 'text-success', tone === 'bad' && 'text-destructive')}>{value}</div>
      {sub && <div className="mt-0.5 text-xs text-muted-foreground">{sub}</div>}
    </div>
  );
}

const inputCls = 'mt-1 w-full rounded-md border px-2.5 py-1.5 text-sm outline-none focus:ring-2 focus:ring-primary';
