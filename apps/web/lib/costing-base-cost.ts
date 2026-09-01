// Who may see the base fish cost, and what the rest of the app is allowed to
// send to the browser instead.
//
// Deliberately imports nothing at all — not even a type.
//
// Two reasons. The cost grid recomputes client-side, so this has to be safe in
// a browser bundle; and the identity the mask rests on (masked assumptions must
// price exactly like the real ones) is pinned by a test that lives with the
// engine, in another package. A module with imports drags those packages into
// the engine's compile with it. The row shapes are therefore described
// structurally here, and the callers' own types flow through unchanged.

/** The version fields the mask rewrites or reads. */
export interface BaseCostVersionFields {
  feed_cost_per_kg: number;
  clearing_cost_per_kg: number;
  import_tax_pct_domestic: number;
  import_tax_pct_export: number;
  fx_rate: number;
}

/** The ODC component fields the mask collapses. */
export interface OdcRowFields {
  id: string;
  name: string;
  value: number;
  currency: string;
  basis: string;
}

/**
 * The assumption fields that make up the two protected sections of the
 * Assumptions screen — "Base fish cost" and "Other direct costs".
 *
 * FX sits in the Base fish cost block on screen, so it is hidden and
 * un-overridable along with the rest of it. It is NOT masked out of the
 * payload, though: every LKR figure on every visible screen is a USD figure
 * times this rate, so concealing the rate itself would be pretence.
 */
export const BASE_COST_FIELDS: readonly string[] = [
  'feed_cost_per_kg',
  'clearing_cost_per_kg',
  'import_tax_pct_domestic',
  'import_tax_pct_export',
  'fcr_reference',
  'fx_rate',
];

const BASE_COST_FIELD_SET = new Set<string>(BASE_COST_FIELDS);

/** Is this an assumption field belonging to a protected section? */
export function isBaseCostField(field: string): boolean {
  return BASE_COST_FIELD_SET.has(field);
}

/** Drop a costing's overrides of protected fields before sending it down. */
export function stripBaseCostOverrides(
  overrides: Record<string, number> | null | undefined
): Record<string, number> {
  const out: Record<string, number> = {};
  for (const [k, v] of Object.entries(overrides ?? {})) {
    if (!isBaseCostField(k)) out[k] = v;
  }
  return out;
}

/** The lines a cost sheet reads back out of a stored line's whole-fish block. */
export const BASE_COST_OUTPUT_KEYS = [
  'effectiveFeedCostUsd',
  'feedCostPerKgFishUsd',
  'odcUsd',
  'fcrUsed',
] as const;

/**
 * Strip the whole-fish build-up a saved costing line stores, leaving the total.
 *
 * The stored `outputs.wholeFish` JSON carries the effective feed cost, the FCR
 * used, the feed cost per kg of fish and the ODC total. The whole-fish cost
 * itself stays — that is the number the quote is built on, and it is on screen
 * either way — but the figures it decomposes into come out.
 */
export function stripBaseCostOutputs(outputs: unknown): unknown {
  if (!outputs || typeof outputs !== 'object') return outputs;
  const o = { ...(outputs as Record<string, unknown>) };
  const wf = o.wholeFish;
  if (wf && typeof wf === 'object') {
    const clean = { ...(wf as Record<string, unknown>) };
    for (const k of BASE_COST_OUTPUT_KEYS) delete clean[k];
    o.wholeFish = clean;
  }
  return o;
}

/**
 * Rewrite the assumptions so the engine still produces exactly the same costs,
 * without carrying the supplier-level inputs into a browser that may not see
 * them.
 *
 * The grid, the SKU dialog and the sheet previews all cost in the browser, so
 * simply not rendering the numbers would leave them sitting in the page
 * payload. Instead the inputs are replaced with a set that is algebraically
 * equivalent for every market and every size bucket:
 *
 *   • effective feed = feed x (1 + tax) + clearing, per market. Publishing
 *     feed' = the EXPORT effective feed, clearing' = 0, export tax' = 0 and
 *     domestic tax' = effDomestic / effExport - 1 reproduces both markets from
 *     one pair of numbers, and reveals neither the feed price nor the tax rate.
 *   • ODC(bucket) = sum(per-kg) + sum(per-fish) / median kg, so the whole
 *     component table collapses to one per-kg and one per-fish total in USD.
 *     Names, currencies and individual values never leave the server.
 *
 * What this does NOT hide, and cannot: the whole-fish cost is on screen, so the
 * aggregates behind it can be read off it by anyone who cares to. The point is
 * the line items — what we pay for feed, what the tax position is, what a
 * fingerling costs.
 */
export function maskBaseCost<V extends BaseCostVersionFields, C extends OdcRowFields>(
  version: V,
  odc: readonly C[]
): { version: V; odc: C[] } {
  const effDomestic =
    version.feed_cost_per_kg * (1 + version.import_tax_pct_domestic) + version.clearing_cost_per_kg;
  const effExport =
    version.feed_cost_per_kg * (1 + version.import_tax_pct_export) + version.clearing_cost_per_kg;

  // Free feed is not a real state of the world, but a half-seeded database is:
  // fall back to carrying the domestic figure rather than dividing by zero.
  const taxDomestic = effExport > 0 ? effDomestic / effExport - 1 : 0;

  let perKgUsd = 0;
  let perFishUsd = 0;
  for (const c of odc) {
    const usd = c.currency === 'USD' ? c.value : c.value / version.fx_rate;
    if (c.basis === 'per_fish') perFishUsd += usd;
    else perKgUsd += usd;
  }

  return {
    version: {
      ...version,
      feed_cost_per_kg: effExport > 0 ? effExport : effDomestic,
      clearing_cost_per_kg: 0,
      import_tax_pct_export: 0,
      import_tax_pct_domestic: taxDomestic,
    },
    // No components in, none out — an empty table already totals zero, and
    // there is no row to model the replacements on.
    odc: odc.length === 0 ? [] : [
      masked(odc[0]!, 'masked-per-kg', 'Other direct costs', perKgUsd, 'per_kg'),
      masked(odc[0]!, 'masked-per-fish', 'Other direct costs (per fish)', perFishUsd, 'per_fish'),
    ],
  };
}

/**
 * One replacement component, shaped like the rows it replaces.
 *
 * Built from a real row so the caller's own type — including whatever columns
 * this module does not know about — survives. The cast is what pays for that:
 * `currency` and `basis` are narrower literal unions on the caller's type, and
 * 'USD' / 'per_kg' / 'per_fish' are members of them.
 */
function masked<C extends OdcRowFields>(
  template: C,
  id: string,
  name: string,
  value: number,
  basis: 'per_kg' | 'per_fish'
): C {
  return { ...template, id, name, value, currency: 'USD', basis } as C;
}
