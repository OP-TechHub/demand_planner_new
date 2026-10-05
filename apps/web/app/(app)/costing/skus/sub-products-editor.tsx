'use client';

import { Fragment, useEffect, useMemo, useState } from 'react';
import { ChevronDown, ListPlus, Plus, X } from 'lucide-react';
import {
  componentIngredientsLkr,
  compositeCostLkr,
  type CostComponentInput,
} from '@oceanpick/shared';
import { cn } from '@/lib/utils';

/**
 * The sub-products of a composite SKU — the rice, the chopsuey, the fish and
 * the curry in a rice pack — each costed on its own and totalled into the raw
 * material line.
 *
 * Every sub-product has its own price: "how much of it goes into ONE unit of
 * the finished product" x "what one of its own units costs". That is the main
 * thing, and it is always typed. Where other ingredients are used for it — the
 * garlic and vegetables cooked into the rice — they are listed under it and
 * their cost is ADDED to it. The list never replaces the price.
 *
 *     sub-product cost = qty x price + other ingredients ÷ units they cover
 *
 * All of it in LKR. Sub-products are bought and made in rupees; the export
 * chain converts the one total at the version's FX rate, so there is nothing
 * here to keep in step between two currencies.
 *
 * Lives inside the SKU form but posts nothing itself: it reports the cleaned
 * list upward and the form carries it in one hidden field, so the sub-products
 * save atomically with the SKU and Cancel discards them with everything else.
 */
export function SubProductsEditor({
  initial,
  finishedUnit,
  unitKg,
  fxRate,
  knownIngredients,
  onChange,
}: {
  initial: CostComponentInput[];
  /** What one unit of the finished product is called — "pack", "kg"… */
  finishedUnit: string;
  /** Kilograms in one finished unit, or null when its weight is not entered yet. */
  unitKg: number | null;
  fxRate: number;
  /** Every ingredient already priced on any SKU, with its most recent price. */
  knownIngredients: { name: string; price: number }[];
  /** The cleaned list and its total per finished unit, on every edit. */
  onChange: (parts: CostComponentInput[], totalLkrPerUnit: number) => void;
}) {
  const [rows, setRows] = useState<PartRow[]>(() =>
    initial.length ? initial.map(toRow) : [blankPart(), blankPart()]
  );

  const parts = useMemo(() => rows.map(toInput).filter((p): p is CostComponentInput => p != null), [rows]);
  const total = useMemo(() => compositeCostLkr(parts), [parts]);

  // Reported in an effect, not during render: the parent stores it in state.
  // `onChange` is deliberately not a dependency — the parent passes a fresh
  // closure each render, and re-reporting on that would loop.
  useEffect(() => {
    onChange(parts, total);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [parts, total]);

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

  const perKg = unitKg != null && unitKg > 0 ? total / unitKg : null;
  const plural = (n: number) => (n === 1 ? finishedUnit : `${finishedUnit}s`);

  return (
    <div className="mt-3 space-y-2" onKeyDown={noSubmit}>
      <div className="overflow-x-auto">
        <table className="w-full text-xs">
          <thead>
            <tr className="border-b text-left text-[11px] text-muted-foreground">
              <th className="py-1.5 pr-2 font-medium">Sub-product</th>
              <th className="w-24 px-2 py-1.5 text-right font-medium">Qty (per {finishedUnit})</th>
              <th className="w-20 px-2 py-1.5 font-medium">Unit</th>
              <th className="w-32 px-2 py-1.5 text-right font-medium">Price (LKR / unit)</th>
              <th className="w-32 py-1.5 pl-2 text-right font-medium">Cost (LKR / {finishedUnit})</th>
              <th className="w-16" />
            </tr>
          </thead>
          <tbody>
            {rows.map((r) => {
              const lines = filledLines(r);
              const hasIngredients = lines.length > 0;
              const covers = r.recipe ? numOf(r.recipe.output) : 0;
              const ingredientTotal = lines.reduce((s, l) => s + (l.qty_g * l.price_lkr_per_kg) / 1000, 0);
              // What the other ingredients add to one finished unit. Null while
              // the "covers" box is empty or zero — nothing to share it over.
              const extras = hasIngredients ? componentIngredientsLkr(lines, covers) : 0;
              const own = numOf(r.qty) * numOf(r.price);
              const cost = own + (extras ?? 0);
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
                        aria-label={`Quantity of ${label} per ${finishedUnit}`}
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
                            // Opening it for the first time starts a list, for
                            // one finished unit unless told otherwise.
                            recipe: r.recipe ?? { output: '1', lines: [blankLine(), blankLine()] },
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
                                <span className="text-muted-foreground">These quantities are for</span>
                                <input
                                  value={r.recipe.output}
                                  onChange={(e) => setPart(r.key, { recipe: { ...r.recipe!, output: e.target.value } })}
                                  type="number"
                                  step="any"
                                  min="0"
                                  aria-label={`How many ${finishedUnit}s the ingredient quantities above cover`}
                                  className={cn(inputCls, 'w-16 text-right', hasIngredients && !(covers > 0) && 'border-destructive')}
                                />
                                <span>{plural(covers)}</span>
                              </label>
                              <span className="tabular-nums">
                                <span className="text-muted-foreground">adds</span>{' '}
                                <span className="font-semibold">{extras != null ? `LKR ${money(extras)}` : '—'}</span>{' '}
                                <span className="text-muted-foreground">per {finishedUnit}</span>
                              </span>
                            </div>
                          </div>

                          {hasIngredients && !(covers > 0) ? (
                            <p className="mt-1.5 text-[11px] text-destructive">
                              Enter how many {finishedUnit}s these quantities are for — 1 if they are what goes
                              into a single {finishedUnit}, or the number one cooked batch makes.
                            </p>
                          ) : (
                            <p className="mt-1.5 text-[10px] text-muted-foreground">
                              Leave it at 1 if the quantities are for a single {finishedUnit}. If they are for a
                              whole cooked batch, enter how many {finishedUnit}s that batch makes and the cost is
                              shared across them.
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
          <tfoot>
            <tr className="font-medium">
              <td colSpan={4} className="py-1.5 pr-2 text-right">
                Total per {finishedUnit}
              </td>
              <td className="py-1.5 pl-2 text-right tabular-nums">LKR {money(total)}</td>
              <td />
            </tr>
          </tfoot>
        </table>
      </div>

      <datalist id="sub-product-units">
        {['kg', 'g', 'pcs', 'portion', 'pack', 'L', 'ml'].map((u) => (
          <option key={u} value={u} />
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

      <div className="flex flex-wrap items-center justify-between gap-2">
        <button
          type="button"
          onClick={() => setRows((rs) => [...rs, blankPart()])}
          className="inline-flex items-center gap-1.5 rounded-md border px-2.5 py-1 text-xs font-medium hover:bg-muted"
        >
          <Plus className="h-3.5 w-3.5" /> Add sub-product
        </button>
        <p className="text-[11px] tabular-nums text-muted-foreground">
          {finishedUnit === 'kg' ? (
            <>Raw material: LKR {money(total)} per kg</>
          ) : perKg != null ? (
            <>
              Raw material: LKR {money(total)} per {finishedUnit} = LKR {money(perKg)} per kg
            </>
          ) : (
            <>Enter the weight of one {finishedUnit} above to see this per kg</>
          )}
          {fxRate > 0 && (finishedUnit === 'kg' || perKg != null) && (
            <> · export: USD {((finishedUnit === 'kg' ? total : perKg!) / fxRate).toFixed(2)} per kg at FX {fxRate}</>
          )}
        </p>
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
  /** The other ingredients used for it; `output` is how many finished units they cover. */
  recipe: { output: string; lines: LineRow[] } | null;
  open: boolean;
};

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
