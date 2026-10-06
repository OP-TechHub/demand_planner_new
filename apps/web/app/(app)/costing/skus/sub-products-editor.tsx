'use client';

import { Fragment, useEffect, useMemo, useState } from 'react';
import { ChevronDown, ListPlus, Plus, X } from 'lucide-react';
import {
  componentIngredientsLkr,
  compositeBreakdownLkr,
  type CostComponentInput,
  type CostOverheadInput,
} from '@oceanpick/shared';
import { cn } from '@/lib/utils';

/**
 * What a composite SKU is made of and what making it costs — entered for one
 * BATCH, the way a kitchen works, and divided down to one finished unit.
 *
 *     batch cost    = sub-products + overheads
 *     cost per unit = batch cost ÷ units the batch makes
 *
 * SUB-PRODUCTS — the rice, the chopsuey, the fish, the gravy. Each has its own
 * price: how much of it the batch uses x what one of its own units costs. That
 * is the main thing and is always typed. Where other ingredients are used for
 * it — the garlic and butter cooked into the rice — they are listed under it
 * and their cost is ADDED to it. The list never replaces the price.
 *
 * An ingredient list says how many finished units it is enough for. Usually
 * that is this batch. When it is a sub-recipe made in bulk — a gravy that
 * fills 48 cups, of which this batch of 12 packs uses 12 — it is charged its
 * share: 12/48 of what the gravy cost.
 *
 * OVERHEADS — labour, electricity, gas, transport: flat amounts per batch that
 * belong to no ingredient.
 *
 * All of it in LKR; the export chain converts the one per-unit total at the
 * version's FX rate. The editor posts nothing itself: it reports the cleaned
 * lists upward and the SKU form carries them in hidden fields, so they save
 * atomically with the SKU and Cancel discards them with everything else.
 */
export function SubProductsEditor({
  initial,
  initialOverheads,
  batchUnits,
  finishedUnit,
  unitKg,
  fxRate,
  knownIngredients,
  onChange,
}: {
  initial: CostComponentInput[];
  initialOverheads: CostOverheadInput[];
  /** Finished units one batch makes, or null while that box is empty or zero. */
  batchUnits: number | null;
  /** What one unit of the finished product is called — "pack", "kg"… */
  finishedUnit: string;
  /** Kilograms in one finished unit, or null when its weight is not entered yet. */
  unitKg: number | null;
  fxRate: number;
  /** Every ingredient already priced on any SKU, with its most recent price. */
  knownIngredients: { name: string; price: number }[];
  /** The cleaned lists and the total per finished unit (null with no usable batch size). */
  onChange: (parts: CostComponentInput[], overheads: CostOverheadInput[], totalLkrPerUnit: number | null) => void;
}) {
  const [rows, setRows] = useState<PartRow[]>(() =>
    initial.length ? initial.map(toRow) : [blankPart(), blankPart()]
  );
  const [overheadRows, setOverheadRows] = useState<OverheadRow[]>(() =>
    initialOverheads.map((o) => ({ key: nextKey(), name: o.name, amount: String(o.amount_lkr) }))
  );

  const parts = useMemo(() => rows.map(toInput).filter((p): p is CostComponentInput => p != null), [rows]);
  const overheads = useMemo(
    () =>
      overheadRows
        .filter((o) => o.name.trim() !== '')
        .map((o) => ({ name: o.name.trim(), amount_lkr: numOf(o.amount) })),
    [overheadRows]
  );
  const breakdown = useMemo(
    () => (batchUnits != null ? compositeBreakdownLkr(parts, batchUnits, overheads) : null),
    [parts, overheads, batchUnits]
  );
  const total = breakdown?.perUnitLkr ?? null;

  // Reported in an effect, not during render: the parent stores it in state.
  // `onChange` is deliberately not a dependency — the parent passes a fresh
  // closure each render, and re-reporting on that would loop.
  useEffect(() => {
    onChange(parts, overheads, total);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [parts, overheads, total]);

  const priceOf = useMemo(() => {
    const m = new Map<string, number>();
    for (const k of knownIngredients) m.set(k.name.trim().toLowerCase(), k.price);
    return m;
  }, [knownIngredients]);

  const setPart = (key: number, patch: Partial<PartRow>) =>
    setRows((rs) => rs.map((r) => (r.key === key ? { ...r, ...patch } : r)));

  const setLine = (partKey: number, lineKey: number, patch: Partial<LineRow>) =>
    setRows((rs) =>
      rs.map((r) =>
        r.key === partKey && r.recipe
          ? { ...r, recipe: { ...r.recipe, lines: r.recipe.lines.map((l) => (l.key === lineKey ? { ...l, ...patch } : l)) } }
          : r
      )
    );

  /**
   * Fill an ingredient's price from the last time it was used anywhere — only
   * into an empty box, so a price somebody typed is never silently replaced.
   */
  function ingredientNamed(part: PartRow, line: LineRow, value: string) {
    const known = priceOf.get(value.trim().toLowerCase());
    setLine(part.key, line.key, {
      ingredient: value,
      ...(known != null && line.price.trim() === '' ? { price: String(known) } : {}),
    });
  }

  // These inputs sit inside the SKU form. Enter in a text box submits a form,
  // and saving the SKU is not what pressing Enter in an ingredient row means.
  const noSubmit = (e: React.KeyboardEvent) => {
    if (e.key === 'Enter') e.preventDefault();
  };

  // "Per batch" and "per unit" are one and the same at a batch of 1, so the
  // screen only talks about batches once there is one.
  const batched = batchUnits != null && batchUnits !== 1;
  const per = batched ? 'batch' : finishedUnit;
  const units = (n: number) => (n === 1 ? finishedUnit : finishedUnit === 'kg' ? 'kg' : `${finishedUnit}s`);
  const perKg = total != null && unitKg != null && unitKg > 0 ? total / unitKg : null;
  /** A batch figure shared down to one finished unit, when there is a batch size to share by. */
  const perUnit = (batchLkr: number) => (batchUnits != null ? batchLkr / batchUnits : null);

  return (
    <div className="mt-3 space-y-3" onKeyDown={noSubmit}>
      <div className="overflow-x-auto">
        <table className="w-full text-xs">
          <thead>
            <tr className="border-b text-left text-[11px] text-muted-foreground">
              <th className="py-1.5 pr-2 font-medium">Sub-product</th>
              <th className="w-24 px-2 py-1.5 text-right font-medium">Qty (per {per})</th>
              <th className="w-20 px-2 py-1.5 font-medium">Unit</th>
              <th className="w-32 px-2 py-1.5 text-right font-medium">Price (LKR / unit)</th>
              <th className="w-32 py-1.5 pl-2 text-right font-medium">Cost (LKR / {per})</th>
              <th className="w-16" />
            </tr>
          </thead>
          <tbody>
            {rows.map((r) => {
              const lines = filledLines(r);
              const hasIngredients = lines.length > 0;
              const covers = r.recipe ? numOf(r.recipe.output) : 0;
              const ingredientTotal = lines.reduce((s, l) => s + (l.qty_g * l.price_lkr_per_kg) / 1000, 0);
              // What the other ingredients add to ONE finished unit, then to
              // the batch. Null while "covers" is empty or zero — nothing to
              // share the list over — or while there is no batch size.
              const extrasPerUnit = hasIngredients ? componentIngredientsLkr(lines, covers) : 0;
              const extras = extrasPerUnit == null || batchUnits == null ? null : extrasPerUnit * batchUnits;
              const own = numOf(r.qty) * numOf(r.price);
              const cost = own + (extras ?? 0);
              const costPerUnit = perUnit(cost);
              const started = r.name.trim() !== '' || r.qty.trim() !== '' || r.price.trim() !== '' || hasIngredients;
              const unit = r.unit.trim() || 'kg';
              const label = r.name.trim() || 'this sub-product';
              return (
                <Fragment key={r.key}>
                  <tr className={cn('border-b', r.open && 'border-b-0 bg-muted/30')}>
                    <td className="py-1 pr-2">
                      <input
                        value={r.name}
                        onChange={(e) => setPart(r.key, { name: e.target.value })}
                        type="text"
                        autoComplete="off"
                        placeholder="e.g. Rice, Chicken curry"
                        aria-label="Sub-product name"
                        className={cn(inputCls, 'w-full')}
                      />
                    </td>
                    <td className="px-2 py-1">
                      <input
                        value={r.qty}
                        onChange={(e) => setPart(r.key, { qty: e.target.value })}
                        type="number"
                        step="any"
                        min="0"
                        aria-label={`Quantity of ${label} per ${per}`}
                        className={cn(inputCls, 'w-full text-right')}
                      />
                    </td>
                    <td className="px-2 py-1">
                      <input
                        value={r.unit}
                        onChange={(e) => setPart(r.key, { unit: e.target.value })}
                        type="text"
                        list="sub-product-units"
                        autoComplete="off"
                        placeholder="kg"
                        aria-label="Unit the sub-product is counted in"
                        className={cn(inputCls, 'w-full')}
                      />
                    </td>
                    <td className="px-2 py-1">
                      {/* Always typed: this is the sub-product's own price. The
                          ingredient list adds to the cost; it never stands in
                          for this figure. */}
                      <input
                        value={r.price}
                        onChange={(e) => setPart(r.key, { price: e.target.value })}
                        type="number"
                        step="any"
                        min="0"
                        aria-label={`Price of ${label} in LKR per ${unit}`}
                        className={cn(inputCls, 'w-full text-right')}
                      />
                    </td>
                    <td className="py-1 pl-2 text-right tabular-nums">
                      {started ? (
                        <>
                          {money(cost)}
                          {hasIngredients && (
                            <span className="block text-[10px] text-muted-foreground">
                              {money(own)} + {extras != null ? money(extras) : '—'} ingredients
                            </span>
                          )}
                          {batched && costPerUnit != null && (
                            <span className="block text-[10px] text-muted-foreground">
                              {money(costPerUnit)} per {finishedUnit}
                            </span>
                          )}
                        </>
                      ) : (
                        <span className="text-muted-foreground">—</span>
                      )}
                    </td>
                    <td className="py-1 text-right">
                      <button
                        type="button"
                        onClick={() =>
                          setPart(r.key, {
                            open: !r.open,
                            // Opening it for the first time starts a list that
                            // is for this batch, which is the usual case.
                            recipe: r.recipe ?? { output: String(batchUnits ?? 1), lines: [blankLine(), blankLine()] },
                          })
                        }
                        aria-expanded={r.open}
                        aria-label={`${r.open ? 'Hide' : 'Show'} the other ingredients used for ${label}`}
                        title={hasIngredients ? 'Other ingredients used for this' : 'Add other ingredients used for this'}
                        className={cn(
                          'rounded p-1 hover:bg-muted',
                          hasIngredients ? 'text-primary' : 'text-muted-foreground hover:text-foreground'
                        )}
                      >
                        {r.open ? <ChevronDown className="h-3.5 w-3.5 rotate-180" /> : <ListPlus className="h-3.5 w-3.5" />}
                      </button>
                      <button
                        type="button"
                        onClick={() => setRows((rs) => (rs.length > 1 ? rs.filter((x) => x.key !== r.key) : [blankPart()]))}
                        aria-label={`Remove ${label}`}
                        title="Remove"
                        className="rounded p-1 text-muted-foreground hover:bg-muted hover:text-destructive"
                      >
                        <X className="h-3.5 w-3.5" />
                      </button>
                    </td>
                  </tr>

                  {r.open && r.recipe && (
                    <tr className="border-b bg-muted/30">
                      <td colSpan={6} className="px-2 pb-3 pt-1">
                        <div className="rounded-md border bg-card p-2.5">
                          <div className="mb-1.5 text-[11px] font-medium">
                            Other ingredients used for {label}
                            <span className="ml-1.5 font-normal text-muted-foreground">
                              added on top of its own price — do not list {label} itself here
                            </span>
                          </div>
                          <table className="w-full text-xs">
                            <thead>
                              <tr className="border-b text-left text-[11px] text-muted-foreground">
                                <th className="py-1 pr-2 font-medium">Ingredient</th>
                                <th className="w-24 px-2 py-1 text-right font-medium">Qty (g)</th>
                                <th className="w-28 px-2 py-1 text-right font-medium">Price (LKR / kg)</th>
                                <th className="w-28 py-1 pl-2 text-right font-medium">Cost (LKR)</th>
                                <th className="w-8" />
                              </tr>
                            </thead>
                            <tbody>
                              {r.recipe.lines.map((l) => {
                                const lineCost = (numOf(l.qty) * numOf(l.price)) / 1000;
                                const lineStarted = l.ingredient.trim() !== '' || l.qty.trim() !== '';
                                return (
                                  <tr key={l.key} className="border-b last:border-0">
                                    <td className="py-1 pr-2">
                                      <input
                                        value={l.ingredient}
                                        onChange={(e) => ingredientNamed(r, l, e.target.value)}
                                        list="sub-product-ingredient-names"
                                        type="text"
                                        autoComplete="off"
                                        placeholder="e.g. Garlic, Mixed vegetables"
                                        aria-label="Ingredient"
                                        className={cn(inputCls, 'w-full')}
                                      />
                                    </td>
                                    <td className="px-2 py-1">
                                      <input
                                        value={l.qty}
                                        onChange={(e) => setLine(r.key, l.key, { qty: e.target.value })}
                                        type="number"
                                        step="any"
                                        min="0"
                                        aria-label="Ingredient quantity in grams"
                                        className={cn(inputCls, 'w-full text-right')}
                                      />
                                    </td>
                                    <td className="px-2 py-1">
                                      <input
                                        value={l.price}
                                        onChange={(e) => setLine(r.key, l.key, { price: e.target.value })}
                                        type="number"
                                        step="any"
                                        min="0"
                                        aria-label="Ingredient price in LKR per kg"
                                        className={cn(inputCls, 'w-full text-right')}
                                      />
                                    </td>
                                    <td className="py-1 pl-2 text-right tabular-nums">
                                      {lineStarted ? money(lineCost) : <span className="text-muted-foreground">—</span>}
                                    </td>
                                    <td className="py-1 text-right">
                                      <button
                                        type="button"
                                        onClick={() =>
                                          setPart(r.key, {
                                            recipe: {
                                              ...r.recipe!,
                                              lines:
                                                r.recipe!.lines.length > 1
                                                  ? r.recipe!.lines.filter((x) => x.key !== l.key)
                                                  : [blankLine()],
                                            },
                                          })
                                        }
                                        aria-label="Remove ingredient"
                                        title="Remove"
                                        className="rounded p-1 text-muted-foreground hover:bg-muted hover:text-destructive"
                                      >
                                        <X className="h-3.5 w-3.5" />
                                      </button>
                                    </td>
                                  </tr>
                                );
                              })}
                            </tbody>
                          </table>

                          <div className="mt-2 flex flex-wrap items-end justify-between gap-x-4 gap-y-2">
                            <button
                              type="button"
                              onClick={() => setPart(r.key, { recipe: { ...r.recipe!, lines: [...r.recipe!.lines, blankLine()] } })}
                              className="inline-flex items-center gap-1.5 rounded-md border px-2.5 py-1 text-xs font-medium hover:bg-muted"
                            >
                              <Plus className="h-3.5 w-3.5" /> Add ingredient
                            </button>

                            <div className="flex flex-wrap items-end gap-x-4 gap-y-2 text-xs">
                              <span className="tabular-nums">
                                <span className="text-muted-foreground">Ingredients total</span>{' '}
                                <span className="font-medium">LKR {money(ingredientTotal)}</span>
                              </span>
                              <label className="flex items-center gap-1.5">
                                <span className="text-muted-foreground">These quantities are enough for</span>
                                <input
                                  value={r.recipe.output}
                                  onChange={(e) => setPart(r.key, { recipe: { ...r.recipe!, output: e.target.value } })}
                                  type="number"
                                  step="any"
                                  min="0"
                                  aria-label={`How many ${units(2)} the ingredient quantities above are enough for`}
                                  className={cn(inputCls, 'w-16 text-right', hasIngredients && !(covers > 0) && 'border-destructive')}
                                />
                                <span>{units(covers)}</span>
                              </label>
                              <span className="tabular-nums">
                                <span className="text-muted-foreground">adds</span>{' '}
                                <span className="font-semibold">{extras != null ? `LKR ${money(extras)}` : '—'}</span>{' '}
                                <span className="text-muted-foreground">
                                  per {per}
                                  {batched && extrasPerUnit != null && ` · ${money(extrasPerUnit)} per ${finishedUnit}`}
                                </span>
                              </span>
                            </div>
                          </div>

                          {hasIngredients && !(covers > 0) ? (
                            <p className="mt-1.5 text-[11px] text-destructive">
                              Enter how many {units(2)} these quantities are enough for — the batch size if they
                              are this batch&apos;s quantities.
                            </p>
                          ) : (
                            <p className="mt-1.5 text-[10px] text-muted-foreground">
                              Normally the batch size{batchUnits != null ? ` (${batchUnits})` : ''}: the quantities are
                              what this batch uses. If this is made in bulk and only part is used here — a gravy
                              that fills 48 cups, one per {finishedUnit} — enter 48 and the batch is charged its share.
                            </p>
                          )}

                          {r.recipe.lines.some((l) => l.ingredient.trim() !== '' || l.qty.trim() !== '') && (
                            <div className="mt-2 flex justify-end">
                              <button
                                type="button"
                                onClick={() => setPart(r.key, { open: false, recipe: null })}
                                className="text-[11px] text-muted-foreground underline hover:text-foreground"
                              >
                                Remove these ingredients
                              </button>
                            </div>
                          )}
                        </div>
                      </td>
                    </tr>
                  )}
                </Fragment>
              );
            })}
          </tbody>
        </table>
      </div>

      <button
        type="button"
        onClick={() => setRows((rs) => [...rs, blankPart()])}
        className="inline-flex items-center gap-1.5 rounded-md border px-2.5 py-1 text-xs font-medium hover:bg-muted"
      >
        <Plus className="h-3.5 w-3.5" /> Add sub-product
      </button>

      {/* Flat costs per batch that belong to no ingredient. Their own table,
          so labour never reads as something that goes into the pack. */}
      <div>
        <div className="text-xs font-medium">
          Overheads
          <span className="ml-1.5 text-[11px] font-normal text-muted-foreground">
            flat costs per {per} — labour, electricity, gas, transport
          </span>
        </div>
        {overheadRows.length > 0 && (
          <table className="mt-1 w-full text-xs">
            <thead>
              <tr className="border-b text-left text-[11px] text-muted-foreground">
                <th className="py-1.5 pr-2 font-medium">Overhead</th>
                <th className="w-36 px-2 py-1.5 text-right font-medium">Amount (LKR / {per})</th>
                <th className="w-32 py-1.5 pl-2 text-right font-medium">
                  {batched ? `Cost (LKR / ${finishedUnit})` : ''}
                </th>
                <th className="w-16" />
              </tr>
            </thead>
            <tbody>
              {overheadRows.map((o) => {
                const each = perUnit(numOf(o.amount));
                return (
                  <tr key={o.key} className="border-b last:border-0">
                    <td className="py-1 pr-2">
                      <input
                        value={o.name}
                        onChange={(e) => setOverheadRows((os) => os.map((x) => (x.key === o.key ? { ...x, name: e.target.value } : x)))}
                        type="text"
                        list="overhead-names"
                        autoComplete="off"
                        placeholder="e.g. Labour"
                        aria-label="Overhead name"
                        className={cn(inputCls, 'w-full')}
                      />
                    </td>
                    <td className="px-2 py-1">
                      <input
                        value={o.amount}
                        onChange={(e) => setOverheadRows((os) => os.map((x) => (x.key === o.key ? { ...x, amount: e.target.value } : x)))}
                        type="number"
                        step="any"
                        min="0"
                        aria-label={`Amount of ${o.name || 'overhead'} in LKR per ${per}`}
                        className={cn(inputCls, 'w-full text-right')}
                      />
                    </td>
                    <td className="py-1 pl-2 text-right tabular-nums text-muted-foreground">
                      {batched && each != null && o.amount.trim() !== '' ? money(each) : ''}
                    </td>
                    <td className="py-1 text-right">
                      <button
                        type="button"
                        onClick={() => setOverheadRows((os) => os.filter((x) => x.key !== o.key))}
                        aria-label={`Remove ${o.name || 'overhead'}`}
                        title="Remove"
                        className="rounded p-1 text-muted-foreground hover:bg-muted hover:text-destructive"
                      >
                        <X className="h-3.5 w-3.5" />
                      </button>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        )}
        <button
          type="button"
          onClick={() => setOverheadRows((os) => [...os, { key: nextKey(), name: '', amount: '' }])}
          className="mt-1.5 inline-flex items-center gap-1.5 rounded-md border px-2.5 py-1 text-xs font-medium hover:bg-muted"
        >
          <Plus className="h-3.5 w-3.5" /> Add overhead
        </button>
      </div>

      <datalist id="sub-product-units">
        {['kg', 'g', 'pcs', 'portion', 'cup', 'pack', 'L', 'ml'].map((u) => (
          <option key={u} value={u} />
        ))}
      </datalist>
      <datalist id="overhead-names">
        {['Labour', 'Electricity', 'Gas', 'Transport'].map((n) => (
          <option key={n} value={n} />
        ))}
      </datalist>
      {/* Every ingredient anyone has already priced, marinades included, so the
          second product using chilli powder does not look the price up again. */}
      <datalist id="sub-product-ingredient-names">
        {knownIngredients.map((k) => (
          <option key={k.name} value={k.name}>
            {`LKR ${k.price}/kg`}
          </option>
        ))}
      </datalist>

      {/* The whole chain on screen: what the batch costs, what that is per
          unit, and what the engine will be handed per kg. */}
      <div className="rounded-md border p-3 text-xs">
        {breakdown ? (
          <table className="w-full tabular-nums">
            <tbody>
              <tr>
                <td className="py-0.5">Sub-products</td>
                <td className="py-0.5 text-right">LKR {money(breakdown.componentsBatchLkr)}</td>
              </tr>
              <tr>
                <td className="py-0.5">Overheads</td>
                <td className="py-0.5 text-right">LKR {money(breakdown.overheadsBatchLkr)}</td>
              </tr>
              <tr className="border-t font-medium">
                <td className="py-1">{batched ? `Batch cost — makes ${breakdown.batchUnits} ${units(breakdown.batchUnits)}` : `Cost per ${finishedUnit}`}</td>
                <td className="py-1 text-right">LKR {money(breakdown.batchLkr)}</td>
              </tr>
              {batched && (
                <tr className="font-semibold">
                  <td className="py-0.5">Cost per {finishedUnit} — batch ÷ {breakdown.batchUnits}</td>
                  <td className="py-0.5 text-right">LKR {money(breakdown.perUnitLkr)}</td>
                </tr>
              )}
            </tbody>
          </table>
        ) : (
          <p className="text-destructive">
            Enter how many {units(2)} one batch makes above — the batch cost is divided by it.
          </p>
        )}
        {breakdown && (
          <p className="mt-1.5 text-[11px] text-muted-foreground">
            {finishedUnit === 'kg' ? (
              <>This is the raw material per kg.</>
            ) : perKg != null ? (
              <>
                Raw material: LKR {money(breakdown.perUnitLkr)} per {finishedUnit} = LKR {money(perKg)} per kg
              </>
            ) : (
              <>Enter the weight of one {finishedUnit} above to see this per kg.</>
            )}
            {fxRate > 0 && (finishedUnit === 'kg' || perKg != null) && (
              <> · export: USD {((finishedUnit === 'kg' ? breakdown.perUnitLkr : perKg!) / fxRate).toFixed(2)} per kg at FX {fxRate}</>
            )}
          </p>
        )}
      </div>
    </div>
  );
}

// --- rows ------------------------------------------------------------------
// Strings while they are being typed, numbers only once they leave: a box
// holding "0." must not be rounded to 0 before the decimals can be reached.

type LineRow = { key: number; ingredient: string; qty: string; price: string };
type PartRow = {
  key: number;
  name: string;
  qty: string;
  unit: string;
  price: string;
  /** The other ingredients used for it; `output` is how many finished units they are enough for. */
  recipe: { output: string; lines: LineRow[] } | null;
  open: boolean;
};
type OverheadRow = { key: number; name: string; amount: string };

let keySeq = 0;
const nextKey = () => ++keySeq;

const blankLine = (): LineRow => ({ key: nextKey(), ingredient: '', qty: '', price: '' });
const blankPart = (): PartRow => ({ key: nextKey(), name: '', qty: '', unit: 'kg', price: '', recipe: null, open: false });

function toRow(c: CostComponentInput): PartRow {
  return {
    key: nextKey(),
    name: c.name,
    qty: String(c.qty),
    unit: c.unit,
    price: String(c.price_lkr_per_unit),
    recipe: c.recipe
      ? {
          output: String(c.recipe.output_qty),
          lines: c.recipe.lines.length
            ? c.recipe.lines.map((l) => ({
                key: nextKey(),
                ingredient: l.ingredient,
                qty: String(l.qty_g),
                price: String(l.price_lkr_per_kg),
              }))
            : [blankLine()],
        }
      : null,
    open: false,
  };
}

/** The ingredient lines that count: named, with a quantity. */
function filledLines(r: PartRow) {
  return (r.recipe?.lines ?? [])
    .filter((l) => l.ingredient.trim() !== '' && numOf(l.qty) > 0)
    .map((l) => ({ ingredient: l.ingredient.trim(), qty_g: numOf(l.qty), price_lkr_per_kg: numOf(l.price) }));
}

/**
 * A row as it will be saved, or null for one that is still blank.
 *
 * The price is the typed figure, always. An opened-but-empty ingredient list
 * is not a list, so the row is saved without one.
 */
function toInput(r: PartRow): CostComponentInput | null {
  const name = r.name.trim();
  if (!name) return null;
  const lines = filledLines(r);
  return {
    name,
    qty: numOf(r.qty),
    unit: r.unit.trim() || 'kg',
    price_lkr_per_unit: numOf(r.price),
    recipe: lines.length > 0 ? { output_qty: numOf(r.recipe!.output), lines } : null,
  };
}

function numOf(s: string): number {
  const n = Number(String(s).trim());
  return Number.isFinite(n) && n >= 0 ? n : 0;
}

const money = (n: number) => n.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 });

const inputCls = 'rounded-md border bg-background px-2 py-1 text-xs disabled:opacity-60';
