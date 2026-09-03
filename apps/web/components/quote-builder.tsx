'use client';

import { useMemo, useState } from 'react';
import { FileText, Printer } from 'lucide-react';
import { Dialog } from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import { Input, Textarea } from '@/components/ui/input';
import { downloadDoc, slugify } from '@/lib/doc-export';
import { cn } from '@/lib/utils';
import {
  QUOTE_SHEET_ID,
  QuoteSheet,
  quoteMoney,
  quotePrice,
  type Incoterm,
  type QuoteSource,
  type QuoteTerms,
} from '@/components/quote-sheet';

/**
 * Turn a set of costed products into a price list for the customer.
 *
 * The costing is the working; this is the answer. The sender picks which
 * products go on it and whether the price is quoted FOB or CIF, and gets a
 * document carrying nothing but those prices — see quote-sheet.tsx.
 *
 * Used from both places a price is arrived at: a saved costing, and the SKU
 * editor's live preview. Neither passes a costing through — they pass
 * QuoteItems, which is all a customer may see.
 *
 * Nothing is persisted. A quotation is a rendering of figures that already
 * exist; where they came from stays the record of what was priced and when.
 */
export function QuoteBuilder({
  sources,
  authorName,
  defaultCustomer = '',
  onClose,
}: {
  /** One entry per market these products are sold in. Empty renders nothing. */
  sources: QuoteSource[];
  authorName?: string | null;
  /** Prefills the customer field when the product already names one. */
  defaultCustomer?: string;
  onClose: () => void;
}) {
  const [marketIdx, setMarketIdx] = useState(0);
  const source = sources[Math.min(marketIdx, sources.length - 1)];
  const market = source?.market ?? 'export';
  const domestic = market === 'domestic';
  const money = quoteMoney(market);

  const [terms, setTerms] = useState<QuoteTerms>(() => ({
    customer: defaultCustomer,
    reference: `QT-${isoInDays(0).replace(/-/g, '')}`,
    incoterm: 'FOB',
    loadPort: 'Colombo',
    insurancePct: 0,
    validUntil: isoInDays(30),
    paymentTerms: '',
    notes: '',
  }));
  const set = <K extends keyof QuoteTerms>(k: K, v: QuoteTerms[K]) => setTerms((t) => ({ ...t, [k]: v }));

  // Everything on offer starts on the quote; unticking a few is quicker than
  // building a list of thirty products up from nothing. Keyed by market so
  // switching between them does not carry one market's choices into the other.
  const [dropped, setDropped] = useState<Set<string>>(new Set());
  const items = useMemo(() => source?.items ?? [], [source]);
  const chosen = useMemo(() => items.filter((i) => !dropped.has(i.id)), [items, dropped]);
  const toggle = (id: string) =>
    setDropped((s) => {
      const next = new Set(s);
      if (!next.delete(id)) next.add(id);
      return next;
    });

  // A product with no price cannot be quoted on this basis — CIF needs the
  // freight it was costed with. Say so rather than dropping it silently.
  const unpriceable = chosen.filter((i) => quotePrice(i, terms, market) == null);

  function onWord() {
    const name = `quotation-${slugify(terms.customer || terms.reference, 'customer')}`;
    if (!downloadDoc(name, QUOTE_SHEET_ID, `Price Quotation - ${terms.reference}`)) {
      window.alert('Could not build the document — the quotation was not found on the page.');
    }
  }

  if (!source) return null;

  return (
    <>
      <Dialog
        open
        onClose={onClose}
        title="Price quotation"
        description="Prices only — no costs, margins or assumptions leave with this document."
        className="max-w-3xl print:hidden"
        footer={
          <>
            <Button variant="outline" onClick={onClose}>
              Close
            </Button>
            <Button variant="outline" onClick={onWord} disabled={chosen.length === 0}>
              <FileText className="h-4 w-4" /> Download Word
            </Button>
            <Button onClick={() => window.print()} disabled={chosen.length === 0}>
              <Printer className="h-4 w-4" /> Print / Save as PDF
            </Button>
          </>
        }
      >
        <div className="max-h-[68vh] space-y-4 overflow-y-auto pr-1">
          {/* Only when the product is actually sold both ways — a quotation is
              one currency, so the market has to be settled before anything else. */}
          {sources.length > 1 && (
            <Choice
              label="Market"
              options={sources.map((s, i) => ({
                key: String(i),
                label: s.market === 'domestic' ? 'Domestic (LKR)' : 'Export (USD)',
              }))}
              value={String(marketIdx)}
              onChange={(v) => {
                setMarketIdx(Number(v));
                setDropped(new Set());
              }}
            />
          )}

          {!domestic && (
            <Choice
              label="Quote on"
              options={(['FOB', 'CIF'] as Incoterm[]).map((t) => ({
                key: t,
                label: t,
                hint: t === 'FOB' ? 'at our port' : 'delivered to their port',
              }))}
              value={terms.incoterm}
              onChange={(v) => set('incoterm', v as Incoterm)}
            />
          )}

          <div className="grid gap-3 sm:grid-cols-2">
            <Field label="Customer">
              <Input
                value={terms.customer}
                onChange={(e) => set('customer', e.target.value)}
                placeholder="Company the quotation is addressed to"
              />
            </Field>
            <Field label="Quotation reference">
              <Input value={terms.reference} onChange={(e) => set('reference', e.target.value)} />
            </Field>
            {!domestic && terms.incoterm === 'FOB' && (
              <Field label="Port of loading">
                <Input value={terms.loadPort} onChange={(e) => set('loadPort', e.target.value)} />
              </Field>
            )}
            {!domestic && terms.incoterm === 'CIF' && (
              <Field label="Marine insurance (% of goods + freight)">
                <Input
                  type="number"
                  min={0}
                  step={0.05}
                  value={terms.insurancePct * 100}
                  onChange={(e) => set('insurancePct', (Number(e.target.value) || 0) / 100)}
                />
              </Field>
            )}
            <Field label="Valid until">
              <Input type="date" value={terms.validUntil} onChange={(e) => set('validUntil', e.target.value)} />
            </Field>
            <Field label="Payment terms (optional)">
              <Input
                value={terms.paymentTerms}
                onChange={(e) => set('paymentTerms', e.target.value)}
                placeholder="Left off the quotation when blank"
              />
            </Field>
          </div>

          {/*
            The costing's freight takes the goods to the port and no further, so
            a CIF price with no insurance loaded is really cost-and-freight. The
            document says exactly that when this is zero — but the sender should
            know before it goes out.
          */}
          {!domestic && terms.incoterm === 'CIF' && terms.insurancePct === 0 && (
            <p className="rounded-md border border-warning/40 bg-warning/5 px-3 py-2 text-xs text-warning">
              No insurance is loaded, so this price covers the goods and the freight only. The quotation will say
              freight is included and will not claim insurance. Enter a rate if your CIF terms include cover.
            </p>
          )}

          <Field label="Notes to the customer (optional)">
            <Textarea
              rows={2}
              value={terms.notes}
              onChange={(e) => set('notes', e.target.value)}
              placeholder="Minimum order quantity, lead time, packing — anything the price depends on"
            />
          </Field>

          {items.length > 1 && (
            <div>
              <div className="flex items-center justify-between">
                <Label>
                  Products on the quotation ({chosen.length} of {items.length})
                </Label>
                <button
                  type="button"
                  onClick={() => setDropped(new Set(dropped.size === 0 ? items.map((i) => i.id) : []))}
                  className="text-xs font-medium text-primary hover:underline"
                >
                  {dropped.size === 0 ? 'Clear all' : 'Select all'}
                </button>
              </div>
              <div className="mt-1.5 max-h-56 overflow-y-auto rounded-md border">
                {items.map((i) => {
                  const price = quotePrice(i, terms, market);
                  return (
                    <label
                      key={i.id}
                      className="flex cursor-pointer items-center gap-2 border-b px-2.5 py-1.5 text-xs last:border-0 hover:bg-muted/40"
                    >
                      <input
                        type="checkbox"
                        checked={!dropped.has(i.id)}
                        onChange={() => toggle(i.id)}
                        className="h-3.5 w-3.5 cursor-pointer accent-primary"
                      />
                      <span className="min-w-0 flex-1 truncate">{i.product}</span>
                      <span className="shrink-0 text-muted-foreground">{i.presentation}</span>
                      {!domestic && terms.incoterm === 'CIF' && i.destination && (
                        <span className="shrink-0 text-muted-foreground">{i.destination}</span>
                      )}
                      <span className="w-20 shrink-0 text-right tabular-nums">
                        {price == null ? '—' : money(price)}
                      </span>
                    </label>
                  );
                })}
              </div>
              {unpriceable.length > 0 && (
                <p className="mt-1.5 text-xs text-warning">
                  {unpriceable.length} selected product(s) have no {terms.incoterm} price and will be left off the
                  document.
                </p>
              )}
            </div>
          )}

          <div>
            <Label>Preview</Label>
            <div className="mt-1.5 max-h-[50vh] overflow-y-auto rounded-md border">
              <QuoteSheet market={market} items={chosen} terms={terms} authorName={authorName} />
            </div>
          </div>
        </div>
      </Dialog>

      {/*
        The copy that print reveals and the Word export serialises, at page level
        rather than inside the dialog: a fixed-position ancestor confines a
        printed element to the first page and would truncate a long price list.
      */}
      <div className="hidden print:block">
        <QuoteSheet
          market={market}
          items={chosen}
          terms={terms}
          authorName={authorName}
          elementId={QUOTE_SHEET_ID}
        />
      </div>
    </>
  );
}

function Label({ children }: { children: React.ReactNode }) {
  return <span className="text-xs font-medium text-muted-foreground">{children}</span>;
}

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <label className="block">
      <Label>{label}</Label>
      <div className="mt-1">{children}</div>
    </label>
  );
}

/** A row of exclusive chips — market, and the FOB/CIF basis. */
function Choice({
  label,
  options,
  value,
  onChange,
}: {
  label: string;
  options: { key: string; label: string; hint?: string }[];
  value: string;
  onChange: (key: string) => void;
}) {
  return (
    <div>
      <Label>{label}</Label>
      <div className="mt-1 flex flex-wrap gap-1.5">
        {options.map((o) => (
          <button
            key={o.key}
            type="button"
            onClick={() => onChange(o.key)}
            className={cn(
              'rounded-md border px-3 py-1.5 text-xs font-medium',
              value === o.key
                ? 'border-primary bg-primary/10 text-primary'
                : 'text-muted-foreground hover:bg-muted'
            )}
          >
            {o.label}
            {o.hint && <span className="ml-1.5 font-normal">{o.hint}</span>}
          </button>
        ))}
      </div>
    </div>
  );
}

/** A local calendar date `days` from now, as ISO — never UTC, which can be yesterday. */
function isoInDays(days: number): string {
  const d = new Date();
  d.setDate(d.getDate() + days);
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}
