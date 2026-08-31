'use client';

import type { CostChain, DomesticOutput, ExportOutput, WholeFishCost } from '@oceanpick/engine';
import { Meta, Row, S, SheetFooter, SheetHeader, asPct, moneyFor } from '@/components/cost-sheet-parts';

/**
 * This SKU's cost build-up as it stands right now, laid out for paper and Word.
 *
 * The saved-costing sheet reports one stored line at the assumptions it was
 * pinned to. This one is the opposite: a live document off the editor's own
 * preview, covering every market and pack state the SKU is scoped to, at
 * today's assumptions. It says so in the footer, because a sheet that looks
 * like a quote but moves under you is the dangerous kind.
 */
export function SkuCostSheet({
  skuName,
  category,
  customer,
  assumptionsLabel,
  authorName,
  glazePct,
  absorbed,
  pctFish,
  pctMarinade,
  domestic,
  domesticWholeFish,
  exportOut,
  exportWholeFish,
  destinationName,
  elementId,
}: {
  skuName: string;
  category: string;
  customer: string;
  assumptionsLabel: string;
  authorName?: string | null;
  glazePct: number;
  absorbed: boolean;
  pctFish: number;
  pctMarinade: number;
  domestic: DomesticOutput | null;
  domesticWholeFish: WholeFishCost | null;
  exportOut: ExportOutput | null;
  exportWholeFish: WholeFishCost | null;
  /**
   * The port these export figures were costed to. The SKU editor has none —
   * its preview uses the first destination only as a stand-in for freight, so
   * anything past FOB there would be misleading and is left out. The Cost Grid
   * does have a real one, and then CIF and the trade ladder are shown.
   */
  destinationName?: string | null;
  /** Set on the copy that print and the Word export read. */
  elementId?: string;
}) {
  return (
    <div id={elementId} style={S.sheet}>
      <SheetHeader
        title="Cost Breakdown"
        subtitle="Per kilogram of finished product, at current assumptions"
        reference={skuName}
        authorName={authorName}
      />

      <table style={S.metaTable}>
        <tbody>
          <Meta label="Product" value={skuName} />
          {category && <Meta label="Category" value={category} />}
          {customer && <Meta label="Customer" value={customer} />}
          {destinationName && <Meta label="Destination" value={destinationName} />}
          {glazePct > 0 && <Meta label="Glaze" value={asPct(glazePct)} />}
          <Meta label="Raw material" value={absorbed ? 'Absorbed by-product' : 'Full fish'} />
          <Meta label="Assumptions" value={assumptionsLabel} />
        </tbody>
      </table>

      {domestic && (
        <MarketSection
          heading="Domestic"
          currency="LKR"
          isDomestic
          chain={domestic.chain}
          wholeFish={domesticWholeFish}
          glazePct={glazePct}
          absorbed={absorbed}
          pctFish={pctFish}
          pctMarinade={pctMarinade}
          states={[
            { label: glazePct > 0 ? 'No glaze' : 'Per kg', s: domestic.unglazed },
            ...(glazePct > 0 ? [{ label: `With ${asPct(glazePct)} glaze`, s: domestic.glazed }] : []),
          ].map(({ label, s }) => ({
            label,
            finalCost: s.finalCost,
            // Rack rate and selling price are the same number unless a target
            // price overrode the cost-plus one, so the extra row only earns its
            // place when they actually differ.
            rows: [
              { label: 'Rack rate (cost-plus)', value: s.rackRate },
              ...(Math.abs(s.sellingPrice - s.rackRate) >= 0.005
                ? [{ label: 'Selling price (target)', value: s.sellingPrice, emphasis: true }]
                : []),
              { label: 'Gross margin', value: s.marginPct, pct: true },
              { label: 'Contribution per kg', value: s.contributionPerKg },
            ],
          }))}
        />
      )}

      {exportOut && (
        <MarketSection
          heading="Export"
          currency="USD"
          isDomestic={false}
          chain={exportOut.chain}
          wholeFish={exportWholeFish}
          glazePct={glazePct}
          absorbed={absorbed}
          pctFish={pctFish}
          pctMarinade={pctMarinade}
          states={[
            { label: glazePct > 0 ? 'Frozen, no glaze' : 'Frozen', s: exportOut.frozenPlain },
            ...(glazePct > 0 ? [{ label: `Frozen, ${asPct(glazePct)} glaze`, s: exportOut.frozenGlazed }] : []),
            { label: 'Fresh (air)', s: exportOut.fresh },
          ].map(({ label, s }) => ({
            label,
            finalCost: s.finalCost,
            rows: [
              { label: 'FOB (cost-plus)', value: s.fob },
              ...(Math.abs(s.sellingPrice - s.fob) >= 0.005
                ? [{ label: 'Selling price (target)', value: s.sellingPrice, emphasis: true }]
                : []),
              { label: 'Gross margin', value: s.marginPct, pct: true },
              { label: 'Contribution per kg', value: s.contributionPerKg },
              ...(destinationName
                ? [
                    { label: `Freight per kg (${destinationName})`, value: s.freightPerKg },
                    { label: 'CIF', value: s.cif },
                    { label: 'Importer price', value: s.importerPrice },
                    { label: 'Distributor (T3)', value: s.distributorT3 },
                  ]
                : []),
            ],
          }))}
        />
      )}

      {!domestic && !exportOut && (
        <p style={S.note}>
          This SKU could not be costed — check that % fish and % marinade total 100%, and that a destination is set
          up if it is sold for export. No figures are shown rather than figures that would be wrong.
        </p>
      )}

      {absorbed && (
        <p style={S.note}>
          This is a by-product. Its raw material cost is absorbed by the main product, so the cost above is a
          <em> floor</em> rather than a base for margin — the price is what the market bears, and contribution per
          kg is the number that matters.
        </p>
      )}

      <SheetFooter>
        Costs are per kilogram of finished product and exclude glaze weight. These figures are calculated live from{' '}
        {assumptionsLabel} and will move if the assumptions or this recipe change — save the costing to pin them.{' '}
        {destinationName
          ? `Export figures are costed to ${destinationName}; another port carries different freight and a different CIF.`
          : 'Export figures stop at FOB; CIF and downstream prices depend on the destination and are quoted separately.'}{' '}
        Prices are indicative and subject to written confirmation.
      </SheetFooter>
    </div>
  );
}

interface SheetStateRow {
  label: string;
  value: number | null;
  pct?: boolean;
  emphasis?: boolean;
}

/** The build-up for one market, then each pack state's FINAL and price. */
function MarketSection({
  heading,
  currency,
  isDomestic,
  chain,
  wholeFish,
  glazePct,
  absorbed,
  pctFish,
  pctMarinade,
  states,
}: {
  heading: string;
  currency: 'LKR' | 'USD';
  isDomestic: boolean;
  chain: CostChain;
  wholeFish: WholeFishCost | null;
  glazePct: number;
  absorbed: boolean;
  pctFish: number;
  pctMarinade: number;
  states: { label: string; finalCost: number; rows: SheetStateRow[] }[];
}) {
  const money = moneyFor(isDomestic);
  const unit = `${currency}/kg`;

  return (
    <>
      <h2 style={S.h2}>
        {heading} — {unit}
      </h2>

      {wholeFish && (
        <>
          <h3 style={S.h3}>Whole fish, ex-farm</h3>
          <table style={S.table}>
            <tbody>
              <Row label="Effective feed cost (USD/kg feed)" value={wholeFish.effectiveFeedCostUsd} fmt={(n) => n.toFixed(2)} />
              <Row label="FCR used" value={wholeFish.fcrUsed} fmt={(n) => n.toFixed(2)} />
              <Row label="Feed cost per kg fish (USD)" value={wholeFish.feedCostPerKgFishUsd} fmt={(n) => n.toFixed(2)} />
              <Row label="Other direct costs (USD)" value={wholeFish.odcUsd} fmt={(n) => n.toFixed(2)} />
              <Row
                label={`Whole fish cost (${currency})`}
                value={isDomestic ? wholeFish.wholeFishLkr : wholeFish.wholeFishUsd}
                fmt={money}
                emphasis
              />
            </tbody>
          </table>
        </>
      )}

      <h3 style={S.h3}>Cost build-up</h3>
      <table style={S.table}>
        <tbody>
          <Row
            label={
              absorbed
                ? 'Fish component — by-product, raw material absorbed by the main product'
                : `Fish component — ${asPct(pctFish)} of pack, at ${asPct(chain.yieldUsed)} yield`
            }
            value={chain.fishComponent}
            fmt={money}
          />
          <Row
            label={`Marinade / other input${pctMarinade > 0 ? ` — ${asPct(pctMarinade)} of pack` : ''}`}
            value={chain.marinadeComponent}
            fmt={money}
          />
          <Row label="Raw material" value={chain.rawMaterial} fmt={money} subtotal />
          <Row label="Processing" value={chain.process} fmt={money} />
          <Row label="Packing" value={chain.packing} fmt={money} />
          <Row label="Cold hold" value={chain.coldHold} fmt={money} />
          <Row label="Ex-factory" value={chain.exFactory} fmt={money} subtotal />
          <Row label={isDomestic ? 'Transport' : 'Freight to port'} value={chain.freight} fmt={money} />
          <Row label="FINAL COST" value={chain.finalCost} fmt={money} total />
        </tbody>
      </table>

      {states.map((state) => {
        // Only worth restating when glaze pulls this state's FINAL away from the
        // build-up above; otherwise the figure is the one already printed.
        const shifted = Math.abs(state.finalCost - chain.finalCost) >= 0.005;
        return (
          <div key={state.label}>
            <h3 style={S.h3}>{state.label}</h3>
            <table style={S.table}>
              <tbody>
                {shifted && (
                  <Row
                    label={`Glaze dilution at ${asPct(glazePct)} — added ice carries no fish cost`}
                    value={state.finalCost - chain.finalCost}
                    fmt={money}
                  />
                )}
                <Row label="FINAL COST" value={state.finalCost} fmt={money} subtotal />
                {state.rows.map((r) => (
                  <Row
                    key={r.label}
                    label={r.label}
                    value={r.value}
                    fmt={r.pct ? (n) => `${(n * 100).toFixed(1)}%` : money}
                    emphasis={r.emphasis}
                  />
                ))}
              </tbody>
            </table>
          </div>
        );
      })}
    </>
  );
}
