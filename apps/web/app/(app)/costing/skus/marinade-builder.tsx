'use client';

import { useEffect, useMemo, useState } from 'react';
import { Plus, X } from 'lucide-react';
import { marinadeCostFromLines, type CostMarinadeLineInput } from '@oceanpick/shared';
import { cn } from '@/lib/utils';

/**
 * Build a SKU's marinade cost from its ingredients.
 *
 * The chain, all of it on screen as it is entered:
 *
 *   line cost LKR = qty_g × LKR/kg ÷ 1000
 *   total LKR     = sum of the lines
 *   LKR per kg    = total ÷ total dose g × 1000
 *   USD per kg    = LKR per kg ÷ FX
 *
 * That last figure is what the SKU stores and the engine multiplies by
 * % marinade, so this screen changes nothing downstream — it fills in a box
 * people were otherwise working out in a spreadsheet and typing by hand.
 *
 * Fish is deliberately not enterable. The recipe sheets this replaces list it
 * first, but the cost sheet already carries fish as whole-fish cost ÷ yield, so
 * pricing it here as well would charge for it twice.
 */
export function MarinadeBuilder({
  initialLines,
  initialTotalDoseG,
  fxRate,
  knownIngredients,
  onCancel,
  onApply,
}: {
  initialLines: CostMarinadeLineInput[];
  initialTotalDoseG: number | null;
  fxRate: number;
  /** Every ingredient already used on any SKU, with its most recent price. */
  knownIngredients: { name: string; price: number }[];
  onCancel: () => void;
  onApply: (lines: CostMarinadeLineInput[], totalDoseG: number, usdPerKg: number) => void;
}) {
  const [rows, setRows] = useState<Row[]>(() =>
    initialLines.length
      ? initialLines.map((l) => ({
          key: nextKey(),
          ingredient: l.ingredient,
          qty: String(l.qty_g),
          price: String(l.price_lkr_per_kg),
        }))
      : [blank(), blank(), blank()]
  );

  /**
   * Whether the total dose is following the sum of the doses.
   *
   * It starts as the sum, which is right whenever nothing is lost in the batch,
   * and saves typing the same number twice. The moment it is edited by hand it
   * stops following and keeps what was typed — the divisor is often the
   * FINISHED weight, which is smaller than what went in.
   */
  const [doseEdited, setDoseEdited] = useState(initialTotalDoseG != null);
  const [dose, setDose] = useState(initialTotalDoseG != null ? String(initialTotalDoseG) : '');

  const filled = useMemo(
    () =>
      rows
        .filter((r) => r.ingredient.trim() !== '' && numOf(r.qty) > 0)
        .map((r) => ({
          ingredient: r.ingredient.trim(),
          qty_g: numOf(r.qty),
          price_lkr_per_kg: numOf(r.price),
        })),
    [rows]
  );

  const doseSum = useMemo(() => filled.reduce((s, l) => s + l.qty_g, 0), [filled]);
  const doseValue = doseEdited ? numOf(dose) : doseSum;
  const result = marinadeCostFromLines(filled, doseValue, fxRate);

  // Close on Escape, like any other layer. Cancel, never apply: leaving by the
  // quickest route should not commit a half-typed recipe.
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        e.stopPropagation();
        onCancel();
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [onCancel]);

  const priceOf = useMemo(() => {
    const m = new Map<string, number>();
    for (const k of knownIngredients) m.set(k.name.trim().toLowerCase(), k.price);
    return m;
  }, [knownIngredients]);

  function setRow(key: number, patch: Partial<Row>) {
    setRows((rs) => rs.map((r) => (r.key === key ? { ...r, ...patch } : r)));
  }

  /**
   * Fill the price from the last time this ingredient was used anywhere.
   *
   * Only into an empty box: silently rewriting a price somebody typed, because
   * the name beside it happened to match, would be a change they never made.
   */
  function nameChanged(row: Row, value: string) {
    const known = priceOf.get(value.trim().toLowerCase());
    setRow(row.key, {
      ingredient: value,
      ...(known != null && row.price.trim() === '' ? { price: String(known) } : {}),
    });
  }

  const canApply = filled.length > 0 && result != null && doseValue > 0;

  return (
    <div className="fixed inset-0 z-[60] flex items-start justify-center overflow-y-auto bg-black/50 p-4">
      <div className="my-8 w-full max-w-2xl space-y-4 rounded-lg border bg-card p-5 shadow-lg">
        <div className="flex items-start justify-between gap-4">
          <div>
            <h3 className="text-base font-semibold">Marinade cost</h3>
            <p className="mt-0.5 text-xs text-muted-foreground">
              Enter the ingredients in LKR. The cost per kg of marinade is worked out below and
              converted once, at FX {fxRate}.
            </p>
          </div>
          <button
            type="button"
            onClick={onCancel}
            aria-label="Close"
            title="Close without applying"
            className="-mr-1 -mt-1 rounded-md p-1 text-muted-foreground transition-colors hover:bg-muted hover:text-foreground"
          >
            <X className="h-4 w-4" />
          </button>
        </div>

        <div className="overflow-x-auto">
          <table className="w-full text-xs">
            <thead>
              <tr className="border-b text-left text-[11px] text-muted-foreground">
                <th className="py-1.5 pr-2 font-medium">Ingredient</th>
                <th className="w-24 px-2 py-1.5 text-right font-medium">Qty (g)</th>
                <th className="w-28 px-2 py-1.5 text-right font-medium">LKR / kg</th>
                <th className="w-28 py-1.5 pl-2 text-right font-medium">Cost LKR</th>
                <th className="w-8" />
              </tr>
            </thead>
            <tbody>
              {rows.map((r) => {
                const cost = (numOf(r.qty) * numOf(r.price)) / 1000;
                const started = r.ingredient.trim() !== '' || r.qty.trim() !== '';
                return (
                  <tr key={r.key} className="border-b last:border-0">
                    <td className="py-1 pr-2">
                      <input
                        value={r.ingredient}
                        onChange={(e) => nameChanged(r, e.target.value)}
                        list="marinade-ingredient-names"
                        type="text"
                        autoComplete="off"
                        placeholder="e.g. Chilli and garlic sauce"
                        className={cn(inputCls, 'w-full')}
                      />
                    </td>
                    <td className="px-2 py-1">
                      <input
                        value={r.qty}
                        onChange={(e) => setRow(r.key, { qty: e.target.value })}
                        type="number"
                        step="0.01"
                        min="0"
                        className={cn(inputCls, 'w-full text-right')}
                      />
                    </td>
                    <td className="px-2 py-1">
                      <input
                        value={r.price}
                        onChange={(e) => setRow(r.key, { price: e.target.value })}
                        type="number"
                        step="0.01"
                        min="0"
                        className={cn(inputCls, 'w-full text-right')}
                      />
                    </td>
                    <td className="py-1 pl-2 text-right tabular-nums">
                      {started ? money(cost) : <span className="text-muted-foreground">—</span>}
                    </td>
                    <td className="py-1 text-right">
                      <button
                        type="button"
                        onClick={() =>
                          setRows((rs) => (rs.length > 1 ? rs.filter((x) => x.key !== r.key) : [blank()]))
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
        </div>

        {/* Every ingredient anyone has already priced, so the second SKU using
            chilli powder does not have to look the price up again. */}
        <datalist id="marinade-ingredient-names">
          {knownIngredients.map((k) => (
            <option key={k.name} value={k.name}>
              {`LKR ${k.price}/kg`}
            </option>
          ))}
        </datalist>

        <button
          type="button"
          onClick={() => setRows((rs) => [...rs, blank()])}
          className="inline-flex items-center gap-1.5 rounded-md border px-2.5 py-1 text-xs font-medium hover:bg-muted"
        >
          <Plus className="h-3.5 w-3.5" /> Add ingredient
        </button>

        <p className="rounded-md bg-muted/50 px-3 py-2 text-[11px] text-muted-foreground">
          Fish does not belong here. The cost sheet already carries it as whole-fish cost ÷ yield, so
          adding it as an ingredient would charge for it twice.
        </p>

        <div className="rounded-md border p-3">
          <div className="flex items-baseline justify-between text-xs">
            <span className="font-medium">Total ingredient cost</span>
            <span className="font-semibold tabular-nums">LKR {money(result?.totalLkr ?? 0)}</span>
          </div>

          <label className="mt-3 block">
            <span className="text-xs font-medium">Total dose (g)</span>
            <input
              value={doseEdited ? dose : doseSum ? String(round4(doseSum)) : ''}
              onChange={(e) => {
                setDoseEdited(true);
                setDose(e.target.value);
              }}
              type="number"
              step="0.01"
              min="0"
              placeholder="0"
              className={cn(inputCls, 'mt-1 w-full sm:w-48')}
            />
            <span className="mt-0.5 block text-[10px] text-muted-foreground">
              {doseEdited ? (
                <>
                  the weight the total cost is divided by ·{' '}
                  <button
                    type="button"
                    onClick={() => {
                      setDoseEdited(false);
                      setDose('');
                    }}
                    className="underline hover:text-foreground"
                  >
                    use the {money(doseSum)} g entered above
                  </button>
                </>
              ) : (
                'following the quantities above — change it if the batch loses weight in cooking, so the marinade in the finished product weighs less than what went in'
              )}
            </span>
          </label>

          {/* The arithmetic spelled out. Anyone checking this against a recipe
              sheet needs to see the steps, not only the answer. */}
          {result && doseValue > 0 ? (
            <dl className="mt-3 space-y-1 border-t pt-3 text-xs">
              <Line
                label="LKR per g"
                detail={`${money(result.totalLkr)} ÷ ${money(doseValue)} g`}
                value={result.lkrPerKg / 1000}
                dp={4}
              />
              <Line label="LKR per kg of marinade" detail="× 1,000" value={result.lkrPerKg} dp={2} />
              <Line
                label="USD per kg of marinade"
                detail={`÷ FX ${fxRate}`}
                value={result.usdPerKg}
                dp={2}
                emphasis
              />
            </dl>
          ) : (
            <p className="mt-3 border-t pt-3 text-[11px] text-muted-foreground">
              Add at least one ingredient with a quantity, and a total dose above zero.
            </p>
          )}
        </div>

        <div className="flex items-center justify-between gap-3 border-t pt-3">
          <button
            type="button"
            onClick={onCancel}
            className="text-xs font-medium text-muted-foreground hover:underline"
          >
            Cancel
          </button>
          <button
            type="button"
            disabled={!canApply}
            onClick={() => {
              if (canApply && result) onApply(filled, doseValue, round4(result.usdPerKg));
            }}
            className="rounded-md bg-primary px-3 py-1.5 text-sm font-medium text-primary-foreground disabled:opacity-50"
          >
            {canApply && result ? `Use $${result.usdPerKg.toFixed(2)} / kg` : 'Use this cost'}
          </button>
        </div>
      </div>
    </div>
  );
}

function Line({
  label,
  detail,
  value,
  dp,
  emphasis,
}: {
  label: string;
  detail: string;
  value: number;
  dp: number;
  emphasis?: boolean;
}) {
  return (
    <div className={cn('flex items-baseline justify-between gap-3', emphasis && 'font-semibold text-primary')}>
      <dt>
        {label} <span className="text-[10px] font-normal text-muted-foreground">{detail}</span>
      </dt>
      <dd className="tabular-nums">
        {value.toLocaleString(undefined, { minimumFractionDigits: dp, maximumFractionDigits: dp })}
      </dd>
    </div>
  );
}

interface Row {
  key: number;
  ingredient: string;
  qty: string;
  price: string;
}

/** Row identity for React. Not the index: rows are inserted and removed. */
let keySeed = 0;
function nextKey() {
  return ++keySeed;
}

function blank(): Row {
  return { key: nextKey(), ingredient: '', qty: '', price: '' };
}

function numOf(s: string): number {
  const n = Number(s.trim());
  return Number.isFinite(n) && n >= 0 ? n : 0;
}

function round4(n: number): number {
  return Math.round(n * 1e4) / 1e4;
}

function money(n: number): string {
  return n.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 });
}

const inputCls = 'rounded-md border bg-background px-2 py-1 text-xs disabled:opacity-60';
