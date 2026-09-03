'use client';

import { Meta, S, SheetHeader } from '@/components/cost-sheet-parts';

/** The id the print rules in globals.css reveal, and the Word export reads. */
export const QUOTE_SHEET_ID = 'quote-sheet';

/** The delivery basis a price is quoted on. Export only; domestic has neither. */
export type Incoterm = 'FOB' | 'CIF';

export type QuoteMarket = 'domestic' | 'export';

/**
 * One quotable product, reduced to what a customer may see.
 *
 * Deliberately not a costing line or an engine output: this is the boundary
 * between the two, and it carries no cost, margin, yield or assumption. Both
 * the saved-costing page and the SKU editor build these, so the quotation
 * cannot leak a field neither of them meant to send.
 */
export interface QuoteItem {
  /** Stable key for selection. Unique within one source. */
  id: string;
  product: string;
  /** Pack state as the customer would read it: "Frozen — 10% glaze", "Fresh (air)". */
  presentation: string;
  /** Port of discharge, named on a CIF quote. Null when none applies. */
  destination: string | null;
  /** The price we sell at — rack for domestic, FOB for export. Null: not quotable. */
  price: number | null;
  /** Freight per kg to that port. Null means CIF cannot be quoted for this item. */
  freightPerKg: number | null;
}

/** The quotable products for one market. A SKU sold both ways has two. */
export interface QuoteSource {
  market: QuoteMarket;
  items: QuoteItem[];
}

export interface QuoteTerms {
  customer: string;
  reference: string;
  incoterm: Incoterm;
  /** Port of loading, named on an FOB quote. */
  loadPort: string;
  /** Marine insurance as a fraction of the goods-and-freight value. 0 loads none. */
  insurancePct: number;
  /** ISO date the offer lapses. Empty means no expiry is stated. */
  validUntil: string;
  /** Free text, printed only when filled. */
  paymentTerms: string;
  notes: string;
}

export const quoteCurrency = (market: QuoteMarket) => (market === 'domestic' ? 'LKR' : 'USD');

/** LKR reads as whole rupees; USD needs its cents. */
export const quoteMoney = (market: QuoteMarket) =>
  market === 'domestic' ? (n: number) => Math.round(n).toLocaleString() : (n: number) => n.toFixed(2);

/**
 * The price to quote for one product, on the chosen basis.
 *
 * FOB is the selling price as it stands. CIF is built up from that same price
 * plus the freight to the port — never read off a stored `cif`, because a
 * by-product is priced at what the market bears while the chain's CIF was built
 * on a cost-plus FOB the product is never actually sold at. Deriving it keeps
 * the quoted CIF consistent with the quoted FOB in every case.
 *
 * Returns null when there is nothing honest to quote, so the sheet can leave
 * the row out rather than print a zero.
 */
export function quotePrice(
  item: QuoteItem,
  terms: Pick<QuoteTerms, 'incoterm' | 'insurancePct'>,
  market: QuoteMarket
): number | null {
  if (item.price == null) return null;
  if (market === 'domestic' || terms.incoterm === 'FOB') return item.price;
  if (item.freightPerKg == null) return null;
  // Insurance is a gross-up on the cost-and-freight value, which is how a
  // marine policy is rated. At 0% this is exactly C&F, and the sheet's terms
  // say only that freight is included.
  return (item.price + item.freightPerKg) * (1 + terms.insurancePct);
}

/**
 * A customer-facing price quotation.
 *
 * Prices only. No cost, no margin, no contribution, no yield, no assumptions
 * version, no internal costing name — everything the breakdown sheets exist to
 * show is deliberately absent here, and the sheet is fed the items to quote
 * rather than reading a costing, so nothing unselected can leak.
 *
 * Laid out for paper and for Word, in inline styles, for the same reason as the
 * cost sheets: the Word export is this element's own outerHTML and class names
 * mean nothing once the document leaves the app.
 */
export function QuoteSheet({
  market,
  items,
  terms,
  authorName,
  elementId,
}: {
  market: QuoteMarket;
  /** Only the products the sender chose. Ordering is the sender's. */
  items: QuoteItem[];
  terms: QuoteTerms;
  authorName?: string | null;
  /**
   * Set to QUOTE_SHEET_ID on the copy that print and the Word export read; the
   * on-screen preview renders the same sheet without an id.
   */
  elementId?: string;
}) {
  const domestic = market === 'domestic';
  const currency = quoteCurrency(market);
  const money = quoteMoney(market);

  const priced = items
    .map((item) => ({ item, price: quotePrice(item, terms, market) }))
    .filter((r): r is { item: QuoteItem; price: number } => r.price != null);

  // Named on the document, and the thing an importer checks first.
  const basis = domestic
    ? 'Delivered, domestic market'
    : terms.incoterm === 'FOB'
      ? `FOB ${terms.loadPort || 'port of loading'}`
      : 'CIF, named port of discharge';

  // A CIF quote is per port, so the port has to be on the row. An FOB quote is
  // one price wherever it ships, and a destination column would only confuse.
  const showDestination = !domestic && terms.incoterm === 'CIF' && priced.some((p) => p.item.destination);

  return (
    <div id={elementId} style={S.sheet}>
      <SheetHeader
        title="Price Quotation"
        subtitle={`Prices in ${currency} per kilogram`}
        reference={terms.reference}
        authorName={authorName}
      />

      <table style={S.metaTable}>
        <tbody>
          <Meta label="Customer" value={terms.customer || '—'} />
          <Meta label="Terms of sale" value={basis} />
          <Meta label="Currency" value={`${currency} per kg of finished product`} />
          {terms.validUntil && <Meta label="Valid until" value={longDate(terms.validUntil)} />}
          {terms.paymentTerms && <Meta label="Payment terms" value={terms.paymentTerms} />}
        </tbody>
      </table>

      {priced.length === 0 ? (
        <p style={{ ...S.note, marginTop: '18px' }}>
          No prices are available for the selected products on this basis. Please contact us for a quotation.
        </p>
      ) : (
        <table style={{ ...S.table, marginTop: '18px' }}>
          <thead>
            <tr>
              <th style={S.th}>Product</th>
              <th style={S.th}>Presentation</th>
              {showDestination && <th style={S.th}>Port of discharge</th>}
              <th style={S.thNum}>Price ({currency}/kg)</th>
            </tr>
          </thead>
          <tbody>
            {priced.map(({ item, price }) => (
              <tr key={item.id}>
                <td style={{ ...S.td, ...S.strong }}>{item.product}</td>
                <td style={S.td}>{item.presentation}</td>
                {showDestination && <td style={S.td}>{item.destination ?? '—'}</td>}
                <td style={{ ...S.td, ...S.tdNum, ...S.strong }}>{money(price)}</td>
              </tr>
            ))}
          </tbody>
        </table>
      )}

      {terms.notes && <p style={{ ...S.note, whiteSpace: 'pre-wrap' }}>{terms.notes}</p>}

      <div style={S.footer}>
        <p style={S.footerStrong}>Terms</p>
        <p style={S.footerText}>
          {domestic
            ? 'Prices are quoted per kilogram of finished product, delivered. '
            : terms.incoterm === 'FOB'
              ? `Prices are quoted per kilogram of finished product, FOB ${terms.loadPort || 'port of loading'} (Incoterms 2020). Ocean freight, insurance, duties, clearing and onward delivery are for the buyer’s account. `
              : terms.insurancePct > 0
                ? 'Prices are quoted per kilogram of finished product, CIF the named port of discharge (Incoterms 2020), and include ocean freight and marine insurance. Import duties, clearing and onward delivery are for the buyer’s account. '
                : 'Prices are quoted per kilogram of finished product and include ocean freight to the named port of discharge. Import duties, clearing and onward delivery are for the buyer’s account. '}
          {terms.validUntil
            ? `This quotation is valid until ${longDate(terms.validUntil)} and is `
            : 'This quotation is '}
          offered subject to availability at the time of order, to prior sale, and to written confirmation of order.
        </p>
      </div>
    </div>
  );
}

/** An ISO date as prose. Parsed as local noon so a timezone cannot shift the day. */
function longDate(iso: string): string {
  const [y, m, d] = iso.split('-').map(Number);
  if (!y || !m || !d) return iso;
  return new Date(y, m - 1, d, 12).toLocaleDateString(undefined, {
    year: 'numeric',
    month: 'long',
    day: 'numeric',
  });
}
