'use client';

import { COST_STATE_LABEL, type CostCosting, type CostCostingLine } from '@oceanpick/shared';
import { Meta, Row, S, SheetFooter, SheetHeader, asPct, moneyFor, num, rec } from '@/components/cost-sheet-parts';

export { COST_SHEET_ID } from '@/components/cost-sheet-parts';

/**
 * One saved SKU line's full cost build-up, laid out for paper and for Word.
 *
 * Everything here is read back from the line as it was SAVED — the stored chain
 * and whole-fish snapshot — so the sheet always says what was quoted, never
 * what today's assumptions would produce. Nothing is recomputed.
 */
export function CostSheet({
  costing,
  line,
  pinnedLabel,
  authorName,
  showBaseCost,
  gradeLabel,
  elementId,
}: {
  costing: CostCosting;
  line: CostCostingLine;
  pinnedLabel: string;
  authorName: string;
  /**
   * Whether the reader may see what the fish costs to grow. The whole-fish
   * cost itself stays — it is what the quote is built on — but the three lines
   * it decomposes into are base-cost figures, and the page has already stripped
   * them out of the stored outputs when this is false.
   */
  showBaseCost: boolean;
  /**
   * Set to COST_SHEET_ID on the copy that print and the Word export read.
   * The on-screen preview renders the same sheet without an id, so the two
   * can coexist and only one of them is ever the document.
   */
  /**
   * The grade the costing was built at, from the page, for a line saved before
   * the grade travelled with it. A line's own snapshot wins where it has one.
   */
  gradeLabel?: string | null;
  elementId?: string;
}) {
  // The line's own market, not the costing's: a costing can hold rupee
  // domestic lines beside dollar export ones, and this sheet is one line.
  const domestic = line.currency === 'LKR';
  const money = moneyFor(domestic);
  const unit = `${line.currency}/kg`;

  const out = rec(line.outputs);
  const chain = rec(out.chain);
  const wf = rec(out.wholeFish);
  const inputs = rec(line.inputs);
  // The port's duty & levy as snapshotted with the line. Missing on a port with
  // none entered, and on lines saved before DDP existed.
  const dutyLevyPct = num(rec(out.destination).dutyLevyPct);

  // Inputs typed over on this costing, as against the SKU master — so a reader
  // of the sheet knows these figures are this sheet's, not the recipe's.
  const edited = Array.isArray(inputs.edited_fields)
    ? (inputs.edited_fields as unknown[]).filter((k): k is string => typeof k === 'string').map((k) => EDITED_LABEL[k] ?? k)
    : [];
  const yieldUsed = num(chain.yieldUsed);
  const glazePct = num(inputs.glaze_pct) ?? 0;
  const pctFish = num(inputs.pct_fish);
  const pctMarinade = num(inputs.pct_marinade);
  const absorbed = inputs.raw_material_basis === 'absorbed';
  // Snapshots older than the composite basis have no such value, and read as
  // whatever they were.
  const composite = inputs.raw_material_basis === 'composite';
  // Older snapshots predate the ingredient basis and simply have neither key,
  // which reads as a fish product — which is what they were.
  const ingredientName =
    inputs.raw_material_basis === 'ingredient' && typeof inputs.primary_input_name === 'string'
      ? inputs.primary_input_name
      : null;

  // The stored line is ONE state, so the footer can say plainly whether this
  // figure includes glaze weight — the old wording claimed it never did.
  const glazedState = line.state === 'glazed' || line.state === 'frozen_glazed';
  const chainFinal = num(chain.finalCost);
  // The state's FINAL, not the chain's: for a glazed state the two differ by the
  // glaze dilution, and the difference is a real line on the build-up.
  const stateFinal = num(out.finalCost) ?? line.final_cost;
  const glazeCredit = chainFinal != null ? stateFinal - chainFinal : null;

  // The margins and adders as they applied to this line. Snapshotted with the
  // line since this section existed; an older line gives back what its own
  // figures imply, and a dash where nothing can be read back.
  const term = (k: string) => num(inputs[k]) ?? fallbackTerm(line, k);
  const text = (k: string) => (typeof inputs[k] === 'string' && (inputs[k] as string).trim() ? (inputs[k] as string) : null);
  const pctFmt = (n: number) => `${(n * 100).toFixed(1)}%`;

  return (
    <div id={elementId} style={S.sheet}>
      <SheetHeader
        title="Cost Breakdown"
        subtitle="Per kilogram of finished product"
        reference={costing.name}
        authorName={authorName}
      />

      <table style={S.metaTable}>
        <tbody>
          <Meta label="Product" value={line.sku_name} />
          {text('category') && <Meta label="Category" value={text('category')!} />}
          {text('customer') && <Meta label="Customer" value={text('customer')!} />}
          {text('pack_size') && <Meta label="Pack size" value={text('pack_size')!} />}
          <Meta label="Pack state" value={COST_STATE_LABEL[line.state]} />
          <Meta label="Market" value={domestic ? 'Domestic' : 'Export'} />
          {line.destination_name && <Meta label="Destination" value={line.destination_name} />}
          {dutyLevyPct != null && <Meta label="Duty & levy" value={`${asPct(dutyLevyPct)} of FOB`} />}
          <Meta label="Currency" value={`${line.currency} per kg finished product`} />
          {text('product_form') && (
            <Meta
              label="Sold as"
              value={
                text('product_form') === 'frozen' ? 'Frozen only'
                : text('product_form') === 'fresh' ? 'Fresh only (air)'
                : 'Frozen and fresh'
              }
            />
          )}
          <Meta
            label="Size grade"
            value={
              text('bucket_label') ?? gradeLabel ?? (inputs.bucket_id ? 'Sized — grade not recorded' : 'Reference size (no grade)')
            }
          />
          {yieldUsed != null && <Meta label="Yield used" value={asPct(yieldUsed)} />}
          {glazePct > 0 && <Meta label="Glaze" value={asPct(glazePct)} />}
          <Meta
            label="Raw material"
            value={
              absorbed ? 'Absorbed by-product'
              : composite ? 'Composite — sub-products costed separately'
              : ingredientName ? `Primary ingredient — ${ingredientName}`
              : 'Full fish'
            }
          />
          <Meta label="Assumptions" value={`Built on ${pinnedLabel}`} />
          {edited.length > 0 && <Meta label="Edited on this costing" value={edited.join(', ')} />}
        </tbody>
      </table>

      {/* A SKU built from a bought-in or transferred-in input never met a
          fish, so the farm build-up is replaced by the one price that did
          apply. Snapshotted at save time, like everything else on this page. */}
      {ingredientName ? (
        <>
          <h2 style={S.h2}>Primary ingredient</h2>
          <table style={S.table}>
            <tbody>
              <Row
                label={`${ingredientName} (${line.currency} per kg of input)`}
                value={num(inputs.primary_input_cost) ?? num(chain.inputCost)}
                fmt={money}
                emphasis
              />
            </tbody>
          </table>
        </>
      ) : (
        <>
      <h2 style={S.h2}>Whole fish, ex-farm</h2>
      <table style={S.table}>
        <tbody>
          {showBaseCost && (
            <>
              <Row label="Effective feed cost (USD/kg feed)" value={num(wf.effectiveFeedCostUsd)} fmt={(n) => n.toFixed(2)} />
              <Row label="FCR used" value={num(wf.fcrUsed)} fmt={(n) => n.toFixed(2)} />
              <Row label="Feed cost per kg fish (USD)" value={num(wf.feedCostPerKgFishUsd)} fmt={(n) => n.toFixed(2)} />
              <Row label="Other direct costs (USD)" value={num(wf.odcUsd)} fmt={(n) => n.toFixed(2)} />
            </>
          )}
          <Row
            label={`Whole fish cost (${line.currency})`}
            value={domestic ? num(wf.wholeFishLkr) : num(wf.wholeFishUsd)}
            fmt={money}
            emphasis
          />
        </tbody>
      </table>
        </>
      )}

      <h2 style={S.h2}>Cost build-up ({unit})</h2>
      <table style={S.table}>
        <tbody>
          {composite ? (
            <Row label="Sub-products — each costed separately, totalled" value={num(chain.compositeComponent)} fmt={money} />
          ) : (
            <>
              <Row
                label={
                  absorbed
                    ? 'Fish component — by-product, raw material absorbed by the main product'
                    : `${ingredientName ?? 'Fish'} component${pctFish != null ? ` — ${asPct(pctFish)} of pack, at ${asPct(yieldUsed)} yield` : ''}`
                }
                value={num(chain.fishComponent)}
                fmt={money}
              />
              <Row
                label={`Marinade / other input${pctMarinade != null && pctMarinade > 0 ? ` — ${asPct(pctMarinade)} of pack` : ''}`}
                value={num(chain.marinadeComponent)}
                fmt={money}
              />
            </>
          )}
          <Row label="Raw material" value={num(chain.rawMaterial)} fmt={money} subtotal />
          <Row label="Processing" value={num(chain.process)} fmt={money} />
          <Row label="Packing" value={num(chain.packing)} fmt={money} />
          <Row label="Cold hold" value={num(chain.coldHold)} fmt={money} />
          <Row label="Ex-factory" value={num(chain.exFactory)} fmt={money} subtotal />
          <Row label={domestic ? 'Transport' : 'Freight to port'} value={num(chain.freight)} fmt={money} />
          {glazeCredit != null && Math.abs(glazeCredit) >= 0.005 && (
            <Row
              label={`Glaze dilution at ${asPct(glazePct)} — added ice carries no fish cost`}
              value={glazeCredit}
              fmt={money}
            />
          )}
          <Row label="FINAL COST" value={stateFinal} fmt={money} total />
        </tbody>
      </table>

      {/*
        What the price was built on, as the SKU dialog sets them out: the
        margin, the adders that moved the cost above, and for export the
        ladder past FOB. A by-product has no margin to show — its cost is a
        floor — but its adders still applied.
      */}
      <h2 style={S.h2}>Margins and adders, as applied</h2>
      <table style={S.table}>
        <tbody>
          {domestic ? (
            <>
              {!absorbed && <Row label="Rack margin" value={term('rack_margin_pct')} fmt={pctFmt} />}
              <Row label="Transport (LKR/kg)" value={term('transport_lkr')} fmt={money} />
              <Row label="Cold holding (LKR/kg)" value={term('cold_hold_lkr')} fmt={money} />
            </>
          ) : (
            <>
              {!absorbed && <Row label="FOB margin" value={term('fob_margin_pct')} fmt={pctFmt} />}
              <Row label="Freight to port (USD/kg)" value={term('freight_to_port_usd')} fmt={money} />
              <Row label="Cold chain (USD/kg)" value={term('cold_chain_usd')} fmt={money} />
              <Row label="Importer clearing" value={term('importer_clearing_pct')} fmt={pctFmt} />
              <Row label="Importer markup" value={term('importer_markup_pct')} fmt={pctFmt} />
              <Row label="Distributor markup" value={term('distributor_markup_pct')} fmt={pctFmt} />
              <Row label="Duty & levy (of FOB)" value={term('duty_levy_pct')} fmt={pctFmt} />
            </>
          )}
        </tbody>
      </table>

      <h2 style={S.h2}>Price ({unit})</h2>
      <table style={S.table}>
        <tbody>
          {/*
            A by-product is priced on what the market bears, not cost-plus. The
            stored margin and the downstream chain were both built on the
            cost-plus price, so printing them beside the market price would put
            a margin next to a price it was never calculated from. Contribution
            is the honest figure here, and the only one shown.
          */}
          {absorbed ? (
            <>
              <Row label="Market price" value={line.selling_price} fmt={money} emphasis />
              <Row label="Contribution per kg" value={line.contribution_per_kg} fmt={money} total />
            </>
          ) : (
            <>
              {domestic ? (
                <>
                  <Row label="Rack rate (cost-plus)" value={num(out.rackRate)} fmt={money} />
                  <Row label="Selling price" value={line.selling_price} fmt={money} emphasis />
                </>
              ) : (
                <>
                  <Row label="FOB (cost-plus)" value={num(out.fob)} fmt={money} />
                  <Row label="Selling price (FOB)" value={line.selling_price} fmt={money} emphasis />
                  <Row label="Sea/air freight per kg" value={num(out.freightPerKg)} fmt={money} />
                  <Row label="CIF" value={num(out.cif)} fmt={money} />
                  <Row label="Importer price" value={num(out.importerPrice)} fmt={money} />
                  <Row label="Distributor (T3)" value={num(out.distributorT3)} fmt={money} />
                  {/* Absent on a port with no duty entered, and on lines saved before DDP existed. */}
                  {num(out.ddp) != null && (
                    <>
                      <Row
                        label={`Duty & levy${dutyLevyPct != null ? ` — ${asPct(dutyLevyPct)} of FOB` : ''}`}
                        value={num(out.dutyPerKg)}
                        fmt={money}
                      />
                      <Row
                        label="CIF + duty & levy"
                        value={(num(out.cif) ?? 0) + (num(out.dutyPerKg) ?? 0)}
                        fmt={money}
                      />
                      <Row label="DDP (duty paid)" value={num(out.ddp)} fmt={money} />
                    </>
                  )}
                </>
              )}
              <Row label="Gross margin" value={num(out.marginPct)} fmt={(n) => `${(n * 100).toFixed(1)}%`} />
              {/*
                The same margin read against the fish rather than the pack.
                Dashes on a line saved before this figure existed, rather than
                being recomputed — the sheet reports what was quoted.
              */}
              <Row
                label="Margin on whole round cost"
                value={num(out.wholeRoundMarginPct)}
                fmt={(n) => `${(n * 100).toFixed(1)}%`}
              />
              <Row label="Contribution per kg" value={line.contribution_per_kg} fmt={money} emphasis />
            </>
          )}
        </tbody>
      </table>

      {absorbed && (
        <p style={S.note}>
          This is a by-product. Its raw material cost is absorbed by the main product, so the figure above is a
          cost <em>floor</em> rather than a base for margin — the price is what the market bears, and contribution
          per kg is the number that matters.
        </p>
      )}

      <SheetFooter>
        {glazedState && glazePct > 0
          ? `Costs are per kilogram of the pack as shipped, including its ${asPct(glazePct)} glaze weight. `
          : 'Costs are per kilogram of finished product, excluding glaze weight. '}
        Figures are those calculated when this
        costing was saved, on {pinnedLabel}; later changes to assumptions are not reflected here. Prices are
        indicative and subject to written confirmation.
      </SheetFooter>
    </div>
  );
}

/** Plain names for the inputs a costing may edit over its SKU's recipe. */
const EDITED_LABEL: Record<string, string> = {
  yield_used: 'yield',
  glaze_pct: 'glaze',
  pct_fish: 'fish share',
  pct_marinade: 'marinade share',
  marinade_usd_per_kg: 'marinade cost',
  process_usd_per_kg: 'processing cost',
  packing_usd_per_kg: 'packing cost',
  primary_input_cost: 'input cost',
  rack_margin_pct: 'rack margin',
  fob_margin_pct: 'FOB margin',
  transport_lkr: 'transport',
  cold_hold_lkr: 'cold holding',
  freight_to_port_usd: 'freight to port',
  cold_chain_usd: 'cold chain',
  importer_clearing_pct: 'importer clearing',
  importer_markup_pct: 'importer markup',
  distributor_markup_pct: 'distributor markup',
  duty_levy_pct: 'duty & levy',
};

/**
 * A margin or adder read back from a line saved before they were snapshotted.
 * The margin is what the cost-plus price implies over the cost; the adders are
 * the chain's own lines, which are those figures in the line's currency. The
 * downstream percentages cannot be separated from the stored ladder, so they
 * stay null.
 */
export function fallbackTerm(line: CostCostingLine, key: string): number | null {
  const out = rec(line.outputs);
  const chain = rec(out.chain);
  const fin = num(out.finalCost) ?? line.final_cost;
  const implied = (p: number | null) => (p != null && p > 0 ? 1 - fin / p : null);
  switch (key) {
    case 'rack_margin_pct': return implied(num(out.rackRate));
    case 'fob_margin_pct': return implied(num(out.fob));
    case 'transport_lkr':
    case 'freight_to_port_usd': return num(chain.freight);
    case 'cold_hold_lkr':
    case 'cold_chain_usd': return num(chain.coldHold);
    case 'duty_levy_pct': return num(rec(out.destination).dutyLevyPct);
    default: return null;
  }
}

