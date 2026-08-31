'use client';

import { useEffect, useState } from 'react';
import {
  COST_STATE_LABEL,
  type CostCosting,
  type CostCostingLine,
} from '@oceanpick/shared';

/**
 * One SKU's full cost build-up, laid out for paper and for Word.
 *
 * Everything here is read back from the line as it was SAVED — the stored chain
 * and whole-fish snapshot — so the sheet always says what was quoted, never
 * what today's assumptions would produce. Nothing is recomputed.
 *
 * Styling is INLINE rather than Tailwind on purpose: the Word export is this
 * element's own outerHTML, and a class name means nothing once the document
 * leaves the app. Inline styles travel.
 */

/** The id the print rules in globals.css reveal, and the Word export reads. */
export const COST_SHEET_ID = 'cost-sheet';

const num = (v: unknown): number | null => (typeof v === 'number' && Number.isFinite(v) ? v : null);
const rec = (v: unknown): Record<string, unknown> =>
  v && typeof v === 'object' ? (v as Record<string, unknown>) : {};

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
  // Set after mount: rendering a date during SSR and again on the client would
  // hydrate mismatched.
  const [prepared, setPrepared] = useState('');
  useEffect(() => {
    setPrepared(new Date().toLocaleDateString(undefined, { year: 'numeric', month: 'long', day: 'numeric' }));
  }, []);

  const domestic = costing.market === 'domestic';
  const money = domestic
    ? (n: number) => Math.round(n).toLocaleString()
    : (n: number) => n.toFixed(2);
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

  const pct = (v: number | null) => (v == null ? '—' : `${(v * 100).toFixed(v * 100 < 10 ? 1 : 0)}%`);

  return (
    <div id={elementId} style={S.sheet}>
      <div style={S.head}>
        <div>
          <h1 style={S.h1}>Cost Breakdown</h1>
          <p style={S.sub}>Per kilogram of finished product</p>
        </div>
        <div style={S.headRight}>
          <div>
            Reference: <strong>{costing.name}</strong>
          </div>
          {prepared && <div>Prepared: {prepared}</div>}
          <div>By: {authorName}</div>
        </div>
      </div>

      {/* --- What this sheet is about ------------------------------------ */}
      <table style={S.metaTable}>
        <tbody>
          <Meta label="Product" value={line.sku_name} />
          <Meta label="Pack state" value={COST_STATE_LABEL[line.state]} />
          <Meta label="Market" value={domestic ? 'Domestic' : 'Export'} />
          {line.destination_name && <Meta label="Destination" value={line.destination_name} />}
          <Meta label="Currency" value={`${line.currency} per kg finished product`} />
          {yieldUsed != null && <Meta label="Yield used" value={pct(yieldUsed)} />}
          {glazePct > 0 && <Meta label="Glaze" value={pct(glazePct)} />}
          <Meta label="Assumptions" value={`Built on ${pinnedLabel}`} />
        </tbody>
      </table>

      {/* --- Raw material, ex-farm --------------------------------------- */}
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

      {/* --- The build-up ------------------------------------------------- */}
      <h2 style={S.h2}>Cost build-up ({unit})</h2>
      <table style={S.table}>
        <tbody>
          <Row
            label={
              absorbed
                ? 'Fish component — by-product, raw material absorbed by the main product'
                : `Fish component${pctFish != null ? ` — ${pct(pctFish)} of pack, at ${pct(yieldUsed)} yield` : ''}`
            }
            value={num(chain.fishComponent)}
            fmt={money}
          />
          <Row
            label={`Marinade / other input${pctMarinade != null && pctMarinade > 0 ? ` — ${pct(pctMarinade)} of pack` : ''}`}
            value={num(chain.marinadeComponent)}
            fmt={money}
          />
          <Row label="Raw material" value={num(chain.rawMaterial)} fmt={money} subtotal />
          <Row label="Processing" value={num(chain.process)} fmt={money} />
          <Row label="Packing" value={num(chain.packing)} fmt={money} />
          <Row label="Cold hold" value={num(chain.coldHold)} fmt={money} />
          <Row label="Ex-factory" value={num(chain.exFactory)} fmt={money} subtotal />
          <Row
            label={domestic ? 'Transport' : 'Freight to port'}
            value={num(chain.freight)}
            fmt={money}
          />
          {glazeCredit != null && Math.abs(glazeCredit) >= 0.005 && (
            <Row
              label={`Glaze dilution at ${pct(glazePct)} — added ice carries no fish cost`}
              value={glazeCredit}
              fmt={money}
            />
          )}
          <Row label="FINAL COST" value={stateFinal} fmt={money} total />
        </tbody>
      </table>

      {/* --- What it sells for -------------------------------------------- */}
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

      <div style={S.footer}>
        <p style={S.footerStrong}>Internal — commercially confidential</p>
        <p style={S.footerText}>
          Costs are per kilogram of finished product and exclude glaze weight. Figures are those calculated when
          this costing was saved, on {pinnedLabel}; later changes to assumptions are not reflected here. Prices are
          indicative and subject to written confirmation.
        </p>
      </div>
    </div>
  );
}

function Meta({ label, value }: { label: string; value: string }) {
  return (
    <tr>
      <td style={S.metaLabel}>{label}</td>
      <td style={S.metaValue}>{value}</td>
    </tr>
  );
}

/** One line of a money table. A null value prints an em dash, never a zero. */
function Row({
  label,
  value,
  fmt,
  subtotal,
  total,
  emphasis,
}: {
  label: string;
  value: number | null;
  fmt: (n: number) => string;
  subtotal?: boolean;
  total?: boolean;
  emphasis?: boolean;
}) {
  const cell = total ? S.tdTotal : subtotal ? S.tdSubtotal : S.td;
  const strong = total || subtotal || emphasis;
  return (
    <tr>
      <td style={{ ...cell, ...(strong ? S.strong : null) }}>{label}</td>
      <td style={{ ...cell, ...S.tdNum, ...(strong ? S.strong : null) }}>{value == null ? '—' : fmt(value)}</td>
    </tr>
  );
}

const S: Record<string, React.CSSProperties> = {
  sheet: {
    background: '#ffffff',
    color: '#000000',
    padding: '28px 32px',
    fontFamily: 'Calibri, Arial, Helvetica, sans-serif',
    fontSize: '11pt',
    lineHeight: 1.35,
  },
  head: {
    display: 'flex',
    alignItems: 'flex-start',
    justifyContent: 'space-between',
    borderBottom: '2px solid #000000',
    paddingBottom: '10px',
  },
  h1: { fontSize: '18pt', fontWeight: 700, margin: 0, lineHeight: 1.1 },
  sub: { fontSize: '10pt', margin: '2px 0 0' },
  headRight: { fontSize: '9pt', textAlign: 'right', lineHeight: 1.5 },
  h2: {
    fontSize: '11pt',
    fontWeight: 700,
    textTransform: 'uppercase',
    letterSpacing: '0.04em',
    margin: '20px 0 6px',
  },
  metaTable: { width: '100%', borderCollapse: 'collapse', marginTop: '14px', fontSize: '10pt' },
  metaLabel: { width: '150px', padding: '2px 0', verticalAlign: 'top', fontWeight: 600 },
  metaValue: { padding: '2px 0', verticalAlign: 'top' },
  table: { width: '100%', borderCollapse: 'collapse', fontSize: '10pt' },
  td: { padding: '4px 0', borderBottom: '1px solid #d4d4d4' },
  tdSubtotal: { padding: '4px 0', borderTop: '1px solid #000000', borderBottom: '1px solid #d4d4d4' },
  tdTotal: { padding: '6px 0', borderTop: '2px solid #000000', borderBottom: '2px solid #000000' },
  tdNum: { textAlign: 'right', whiteSpace: 'nowrap', width: '120px' },
  strong: { fontWeight: 700 },
  note: {
    fontSize: '9pt',
    marginTop: '14px',
    padding: '8px 10px',
    border: '1px solid #a3a3a3',
    background: '#f5f5f5',
  },
  footer: { marginTop: '22px', borderTop: '1px solid #a3a3a3', paddingTop: '8px' },
  footerStrong: { fontSize: '8.5pt', fontWeight: 700, margin: 0 },
  footerText: { fontSize: '8.5pt', margin: '3px 0 0', lineHeight: 1.5 },
};
