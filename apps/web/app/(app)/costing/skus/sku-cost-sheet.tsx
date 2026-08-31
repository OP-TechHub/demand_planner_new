'use client';

import type { CostProductForm } from '@oceanpick/shared';
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
  productForm,
  gradeLabel,
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
  /**
   * Which states this SKU is actually sold in. The engine costs all three
   * export states whatever the SKU is, because fresh and frozen-no-glaze share
   * a FINAL and fall out of the same chain — but printing a Fresh section for a
   * frozen-only product is not a harmless extra, it is a price for something
   * nobody can order, in a document that leaves the building.
   */
  productForm: CostProductForm;
  /**
   * The size grade these figures were costed at, or null for the flat
   * reference model. Named on the sheet because the same SKU costs differently
   * per grade — FCR and yield both move — and a reader cannot tell which they
   * are holding otherwise.
   */
  gradeLabel?: string | null;
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
          <Meta
            label="Sold as"
            value={
              productForm === 'frozen' ? 'Frozen only' : productForm === 'fresh' ? 'Fresh only (air)' : 'Frozen and fresh'
            }
          />
          <Meta label="Size grade" value={gradeLabel ?? 'Reference size (no grade)'} />
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
          /*
            A glazed SKU ships as one thing: the glazed pack. Its unglazed twin
            is the same pack read net of its ice, not a product anyone can
            order — useful on screen for cross-checking, misleading in a
            document that leaves the building, where "No glaze" reads as a
            second product at a higher price. The net figure is still here, as
            the build-up's "before glaze" total.
          */
          states={(glazePct > 0
            ? [{ label: `As packed — ${asPct(glazePct)} glaze`, s: domestic.glazed }]
            : [{ label: 'Per kg', s: domestic.unglazed }]
          ).map(({ label, s }) => ({
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
          /*
            One frozen row, not two: the glazed pack when the SKU is glazed,
            the plain one when it is not. Fresh is kept separately — it is a
            different pack rather than the same one net of ice, and it carries
            no glaze at all.
          */
          states={[
            ...(productForm === 'fresh'
              ? []
              : glazePct > 0
                ? [{ label: `Frozen — as packed, ${asPct(glazePct)} glaze`, s: exportOut.frozenGlazed }]
                : [{ label: 'Frozen', s: exportOut.frozenPlain }]),
            ...(productForm === 'frozen' ? [] : [{ label: 'Fresh (air)', s: exportOut.fresh }]),
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
        {glazePct > 0
          ? `Costs are per kilogram of the pack as shipped, including its ${asPct(glazePct)} glaze weight; the build-up's "before glaze" total is the same pack net of that ice. `
          : 'Costs are per kilogram of finished product. '}
        These figures are calculated live from{' '}
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
  // When glaze moves a shown state's FINAL away from the chain's, the chain
  // total is no longer any state's FINAL — calling it "FINAL COST" would put
  // two different figures under the same name on one page.
  const glazeShifts = states.some((st) => Math.abs(st.finalCost - chain.finalCost) >= 0.005);

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
          <Row
            label={glazeShifts ? 'FINAL COST — before glaze' : 'FINAL COST'}
            value={chain.finalCost}
            fmt={money}
            total
          />
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
                {/*
                  Restated rather than left to the table above: a page break can
                  land between them, and "Glaze dilution −0.43" with no starting
                  figure above it is not a number anyone can check.
                */}
                {shifted && (
                  <>
                    <Row label="Cost before glaze" value={chain.finalCost} fmt={money} />
                    <Row
                      label={`Glaze dilution at ${asPct(glazePct)} — added ice carries no fish cost`}
                      value={state.finalCost - chain.finalCost}
                      fmt={money}
                    />
                  </>
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
