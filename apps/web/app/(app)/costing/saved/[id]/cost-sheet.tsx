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
  elementId,
}: {
  costing: CostCosting;
  line: CostCostingLine;
  pinnedLabel: string;
  authorName: string;
  /**
   * Set to COST_SHEET_ID on the copy that print and the Word export read.
   * The on-screen preview renders the same sheet without an id, so the two
   * can coexist and only one of them is ever the document.
   */
  elementId?: string;
}) {
  const domestic = costing.market === 'domestic';
  const money = moneyFor(domestic);
  const unit = `${line.currency}/kg`;

  const out = rec(line.outputs);
  const chain = rec(out.chain);
  const wf = rec(out.wholeFish);
  const inputs = rec(line.inputs);

  const yieldUsed = num(chain.yieldUsed);
  const glazePct = num(inputs.glaze_pct) ?? 0;
  const pctFish = num(inputs.pct_fish);
  const pctMarinade = num(inputs.pct_marinade);
  const absorbed = inputs.raw_material_basis === 'absorbed';

  const chainFinal = num(chain.finalCost);
  // The state's FINAL, not the chain's: for a glazed state the two differ by the
  // glaze dilution, and the difference is a real line on the build-up.
  const stateFinal = num(out.finalCost) ?? line.final_cost;
  const glazeCredit = chainFinal != null ? stateFinal - chainFinal : null;

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
          <Meta label="Pack state" value={COST_STATE_LABEL[line.state]} />
          <Meta label="Market" value={domestic ? 'Domestic' : 'Export'} />
          {line.destination_name && <Meta label="Destination" value={line.destination_name} />}
          <Meta label="Currency" value={`${line.currency} per kg finished product`} />
          {yieldUsed != null && <Meta label="Yield used" value={asPct(yieldUsed)} />}
          {glazePct > 0 && <Meta label="Glaze" value={asPct(glazePct)} />}
          <Meta label="Assumptions" value={`Built on ${pinnedLabel}`} />
        </tbody>
      </table>

      <h2 style={S.h2}>Whole fish, ex-farm</h2>
      <table style={S.table}>
        <tbody>
          <Row label="Effective feed cost (USD/kg feed)" value={num(wf.effectiveFeedCostUsd)} fmt={(n) => n.toFixed(2)} />
          <Row label="FCR used" value={num(wf.fcrUsed)} fmt={(n) => n.toFixed(2)} />
          <Row label="Feed cost per kg fish (USD)" value={num(wf.feedCostPerKgFishUsd)} fmt={(n) => n.toFixed(2)} />
          <Row label="Other direct costs (USD)" value={num(wf.odcUsd)} fmt={(n) => n.toFixed(2)} />
          <Row
            label={`Whole fish cost (${line.currency})`}
            value={domestic ? num(wf.wholeFishLkr) : num(wf.wholeFishUsd)}
            fmt={money}
            emphasis
          />
        </tbody>
      </table>

      <h2 style={S.h2}>Cost build-up ({unit})</h2>
      <table style={S.table}>
        <tbody>
          <Row
            label={
              absorbed
                ? 'Fish component — by-product, raw material absorbed by the main product'
                : `Fish component${pctFish != null ? ` — ${asPct(pctFish)} of pack, at ${asPct(yieldUsed)} yield` : ''}`
            }
            value={num(chain.fishComponent)}
            fmt={money}
          />
          <Row
            label={`Marinade / other input${pctMarinade != null && pctMarinade > 0 ? ` — ${asPct(pctMarinade)} of pack` : ''}`}
            value={num(chain.marinadeComponent)}
            fmt={money}
          />
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
                </>
              )}
              <Row label="Gross margin" value={num(out.marginPct)} fmt={(n) => `${(n * 100).toFixed(1)}%`} />
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
        Costs are per kilogram of finished product and exclude glaze weight. Figures are those calculated when this
        costing was saved, on {pinnedLabel}; later changes to assumptions are not reflected here. Prices are
        indicative and subject to written confirmation.
      </SheetFooter>
    </div>
  );
}
