'use client';

import Link from 'next/link';
import { useMemo, useState, useTransition } from 'react';
import { useRouter } from 'next/navigation';
import {
  ArrowLeft,
  Download,
  FileSignature,
  FileText,
  Globe,
  ListPlus,
  Lock,
  Printer,
  Search,
  TrendingDown,
  TrendingUp,
  Trash2,
} from 'lucide-react';
import {
  COST_STATE_LABEL,
  type CostCosting,
  type CostMarket,
  type CostMarketScope,
  type CostCostingDestination,
  type CostCostingLine,
  type CostProductState,
} from '@oceanpick/shared';
import { toCsv, downloadCsv } from '@/lib/csv';
import { downloadDoc, slugify } from '@/lib/doc-export';
import { Dialog } from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import { ScrollX } from '@/components/ui/scroll-x';
import { cn } from '@/lib/utils';
import { BaseCostToggle, num, rec } from '@/components/cost-sheet-parts';
import { QuoteBuilder } from '@/components/quote-builder';
import type { QuoteItem } from '@/components/quote-sheet';
import { addSkusToCosting, removeProductFromCosting, setCostingVisibility } from '../../actions';
import { CostSheet, COST_SHEET_ID } from './cost-sheet';

/** A SKU the owner may still put on this costing. */
export interface AddableSku {
  id: string;
  name: string;
  category: string;
  customer: string;
  /** Which grid its recipe was written for. Advisory — any product may go on any costing. */
  scope: CostMarketScope;
}

export interface RepricedLine {
  finalCost: number;
  sellingPrice: number | null;
}

export function CostingDetail({
  costing,
  lines,
  destinations,
  pinnedLabel,
  pinnedIsCurrent,
  currentLabel,
  authorName,
  canEdit,
  addable,
  repriced,
  showBaseCost,
}: {
  costing: CostCosting;
  lines: CostCostingLine[];
  destinations: CostCostingDestination[];
  pinnedLabel: string;
  pinnedIsCurrent: boolean;
  currentLabel: string | null;
  authorName: string;
  /** Its owner, or an admin — who may publish it, change what is on it, or pull it back. */
  canEdit: boolean;
  /** Active SKUs for this market that are not on the costing yet. Empty unless canEdit. */
  addable: AddableSku[];
  repriced: Record<string, RepricedLine>;
  /**
   * Whether the reader may see what the fish costs to grow. False also means
   * the page stripped those figures out of `lines` and `costing` before they
   * were sent — this flag only decides what the sheet draws.
   */
  showBaseCost: boolean;
}) {
  const router = useRouter();
  const [visibilityPending, startVisibility] = useTransition();
  const [productsOpen, setProductsOpen] = useState(false);
  const [showReprice, setShowReprice] = useState(false);
  const [state, setState] = useState<CostProductState | 'all'>('all');
  // The line whose breakdown sheet is open, for print / Word / preview.
  const [sheetLine, setSheetLine] = useState<CostCostingLine | null>(null);
  // The customer-facing quotation built off these lines. Never open at the same
  // time as a breakdown: both mount a print copy, and print reveals every one.
  const [quoteOpen, setQuoteOpen] = useState(false);
  // Whether this sheet carries the base cost build-up. Starts on, so a reader
  // who is allowed the detail keeps getting it, and comes off in one click for
  // a copy that is going outside. Only reachable when showBaseCost is true.
  const [includeBaseCost, setIncludeBaseCost] = useState(true);
  const sheetBaseCost = showBaseCost && includeBaseCost;

  const isPrivate = costing.visibility === 'private';
  const overrides = Object.entries(costing.assumption_overrides ?? {});
  // One entry per product on the sheet, however many states and ports it spans.
  // Keyed by the snapshot name: that is what the lines are unique on and what
  // removal addresses, and it survives the underlying SKU being deleted.
  const products = useMemo(() => {
    const counts = new Map<string, number>();
    for (const l of lines) counts.set(l.sku_name, (counts.get(l.sku_name) ?? 0) + 1);
    return [...counts].map(([name, lineCount]) => ({ name, lineCount }));
  }, [lines]);

  const states = useMemo(
    () => [...new Set(lines.map((l) => l.state))] as CostProductState[],
    [lines]
  );
  const visible = useMemo(
    () => (state === 'all' ? lines : lines.filter((l) => l.state === state)),
    [lines, state]
  );

  // Per line, not per costing: one costing can hold rupee domestic lines beside
  // dollar export ones, and rupees are whole numbers where dollars carry cents.
  const money = (n: number, currency: string) =>
    currency === 'LKR' ? Math.round(n).toLocaleString() : n.toFixed(2);

  // Which markets are actually on this sheet, read off the lines rather than
  // the costing's own market — that one only decides which market a product
  // scoped to BOTH was costed in.
  const currencies = useMemo(() => new Set(lines.map((l) => l.currency)), [lines]);
  const marketSummary =
    currencies.size > 1 ? 'Domestic + export' : currencies.has('LKR') ? 'Domestic' : 'Export';
  // A port belongs to an export line, and those can sit on a costing whose own
  // market is domestic — so the column follows the lines, not the port list.
  const showPort = useMemo(() => lines.some((l) => l.destination_name), [lines]);

  /**
   * The quotation, split by market.
   *
   * One source per currency: a quote sheet prices in a single currency, so a
   * costing spanning both would otherwise put rupees and dollars in one column.
   * The builder already takes several sources — the SKU page sends two.
   */
  const quoteSources = useMemo(() => {
    const domesticItems = visible.filter((l) => l.currency === 'LKR').map(toQuoteItem);
    const exportItems = visible.filter((l) => l.currency === 'USD').map(toQuoteItem);
    return [
      ...(domesticItems.length ? [{ market: 'domestic' as CostMarket, items: domesticItems }] : []),
      ...(exportItems.length ? [{ market: 'export' as CostMarket, items: exportItems }] : []),
    ];
  }, [visible]);

  // Only meaningful once the pinned version is no longer the current one.
  const repriceAvailable = !pinnedIsCurrent && Object.keys(repriced).length > 0;

  function onWord() {
    if (!sheetLine) return;
    const title = `${costing.name} — ${sheetLine.sku_name}`;
    const name = `${slugify(costing.name, 'costing')}-${slugify(sheetLine.sku_name, 'sku')}-${sheetLine.state}`;
    // The sheet is always mounted while a line is selected, so a miss here means
    // the id moved rather than a timing problem — say so instead of failing mute.
    if (!downloadDoc(name, COST_SHEET_ID, title)) {
      window.alert('Could not build the document — the breakdown sheet was not found on the page.');
    }
  }

  function onExport() {
    const head = ['SKU', 'Port', 'Market', 'State', 'Currency', 'FINAL cost', 'Selling price', 'Contribution/kg'];
    const body = visible.map((l) => [
      l.sku_name,
      l.destination_name ?? '',
      l.currency === 'LKR' ? 'Domestic' : 'Export',
      COST_STATE_LABEL[l.state],
      l.currency,
      round(l.final_cost),
      round(l.selling_price),
      round(l.contribution_per_kg),
    ]);
    downloadCsv(`${slug(costing.name)}.csv`, toCsv([head, ...body]));
  }

  return (
    <div className="mx-auto max-w-6xl space-y-4">
      <Link href="/costing/saved" className="inline-flex items-center gap-1 text-xs text-muted-foreground hover:text-foreground">
        <ArrowLeft className="h-3.5 w-3.5" /> All costings
      </Link>

      <header className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <div className="flex flex-wrap items-center gap-2">
            <h1 className="text-2xl font-semibold tracking-tight">{costing.name}</h1>
            {/* Shown to every reader, not just the owner: an admin opening
                someone else's unpublished draft should know that is what it is
                before quoting from it. */}
            {isPrivate && (
              <span
                className="inline-flex items-center gap-1 rounded-full border px-2 py-0.5 text-[11px] text-muted-foreground"
                title={canEdit ? 'Not shared — only you and admins can open this' : `Private to ${authorName}`}
              >
                <Lock className="h-3 w-3" />
                private
              </span>
            )}
          </div>
          <p className="mt-0.5 text-sm text-muted-foreground">
            {marketSummary} · {authorName} ·{' '}
            {new Date(costing.created_at).toLocaleDateString()}
            {destinations.length > 0 && ` · ${destinations.map((d) => d.destination_name).join(', ')}`}
          </p>
        </div>
        <div className="flex items-center gap-2">
          <button
            onClick={() => {
              setSheetLine(null);
              setProductsOpen(false);
              setQuoteOpen(true);
            }}
            className="inline-flex items-center gap-1.5 rounded-md border border-primary bg-primary/10 px-2.5 py-1.5 text-xs font-medium text-primary hover:bg-primary/15"
          >
            <FileSignature className="h-3.5 w-3.5" /> Quotation
          </button>
          <button onClick={onExport} className="inline-flex items-center gap-1.5 rounded-md border px-2.5 py-1.5 text-xs font-medium hover:bg-muted">
            <Download className="h-3.5 w-3.5" /> Export
          </button>
          {canEdit && (
            <button
              onClick={() => {
                setSheetLine(null);
                setQuoteOpen(false);
                setProductsOpen(true);
              }}
              className="inline-flex items-center gap-1.5 rounded-md border px-2.5 py-1.5 text-xs font-medium hover:bg-muted"
              title="Add products to this costing, or take one off"
            >
              <ListPlus className="h-3.5 w-3.5" /> Products
            </button>
          )}
          {canEdit && (
            <button
              disabled={visibilityPending}
              onClick={() =>
                startVisibility(async () => {
                  const res = await setCostingVisibility(costing.id, isPrivate ? 'public' : 'private');
                  if (res.error) alert(res.error);
                  router.refresh();
                })
              }
              className="inline-flex items-center gap-1.5 rounded-md border px-2.5 py-1.5 text-xs font-medium hover:bg-muted disabled:opacity-50"
              title={isPrivate ? 'Everyone who can read costings will see it' : 'Only you will see it'}
            >
              {isPrivate ? <Globe className="h-3.5 w-3.5" /> : <Lock className="h-3.5 w-3.5" />}
              {isPrivate ? 'Share' : 'Make private'}
            </button>
          )}
        </div>
      </header>

      {costing.notes && <p className="rounded-md bg-muted/50 px-3 py-2 text-sm">{costing.notes}</p>}

      <div className="flex flex-wrap items-center gap-2 rounded-lg border bg-card p-3 text-xs">
        <span className="font-medium">Built on {pinnedLabel}</span>
        {pinnedIsCurrent ? (
          <span className="text-muted-foreground">— still the current assumptions</span>
        ) : (
          <span className="text-warning">— assumptions have moved on since ({currentLabel} is current)</span>
        )}

        {repriceAvailable && (
          <button
            onClick={() => setShowReprice((v) => !v)}
            className={cn(
              'ml-auto rounded-md border px-2.5 py-1 font-medium',
              showReprice ? 'border-primary bg-primary/10 text-primary' : 'hover:bg-muted'
            )}
          >
            {showReprice ? 'Hide reprice' : 'Reprice at current assumptions'}
          </button>
        )}
      </div>

      {overrides.length > 0 && (
        <div className="rounded-md border border-primary/40 bg-primary/5 px-3 py-2 text-xs">
          <strong className="font-medium text-primary">Custom assumptions.</strong>{' '}
          This costing deviates from the company&apos;s official numbers on:{' '}
          {overrides.map(([k, v]) => `${k.replace(/_/g, ' ')} = ${v}`).join(', ')}.
        </div>
      )}

      {showReprice && (
        <p className="rounded-md bg-muted/50 px-3 py-2 text-xs text-muted-foreground">
          The stored figures are what was quoted and never change. The reprice column shows what the
          same SKU would cost today — a SKU archived since is left blank rather than guessed at.
        </p>
      )}

      {states.length > 1 && (
        <div className="flex flex-wrap items-center gap-1.5">
          <button onClick={() => setState('all')} className={chip(state === 'all')}>
            All states
          </button>
          {states.map((s) => (
            <button key={s} onClick={() => setState(s)} className={chip(state === s)}>
              {COST_STATE_LABEL[s]}
            </button>
          ))}
        </div>
      )}

      <ScrollX className="max-h-[70vh] rounded-lg border bg-card">
        <table className="w-full border-collapse text-right text-xs tabular-nums">
          <thead>
            <tr className="text-[10px] uppercase tracking-wide text-muted-foreground">
              <th className={cn(th, 'left-0 z-30 text-left')}>SKU</th>
              {showPort && <th className={cn(th, 'text-left')}>Port</th>}
              <th
                className={cn(th, 'text-left')}
                title="Each product is costed in its own market, so one costing can hold both"
              >
                Market
              </th>
              <th className={cn(th, 'text-left')}>State</th>
              <th className={th}>FINAL cost</th>
              <th className={th}>Selling price</th>
              <th className={th}>Contribution</th>
              {showReprice && (
                <>
                  <th className={cn(th, 'border-l')}>Today&apos;s cost</th>
                  <th className={th}>Change</th>
                </>
              )}
              <th className={cn(th, 'text-right')} />
            </tr>
          </thead>
          <tbody>
            {visible.map((l) => {
              const now = repriced[l.id];
              const delta = now ? now.finalCost - l.final_cost : null;
              return (
                <tr key={l.id} className="border-b last:border-0 hover:bg-muted/30">
                  <th className={cn(td, 'sticky left-0 z-10 max-w-[240px] truncate bg-card text-left font-medium')} title={l.sku_name}>
                    {l.sku_name}
                  </th>
                  {showPort && <td className={cn(td, 'text-left')}>{l.destination_name ?? '—'}</td>}
                  {/* The currency is the market: both are set when the line is
                      costed, so they cannot drift apart. */}
                  <td className={cn(td, 'text-left text-muted-foreground')}>
                    {l.currency === 'LKR' ? 'Domestic' : 'Export'}{' '}
                    <span className="text-muted-foreground/60">{l.currency}</span>
                  </td>
                  <td className={cn(td, 'text-left text-muted-foreground')}>{COST_STATE_LABEL[l.state]}</td>
                  <td className={cn(td, 'font-semibold')}>{money(l.final_cost, l.currency)}</td>
                  <td className={td}>{l.selling_price != null ? money(l.selling_price, l.currency) : '—'}</td>
                  <td className={td}>
                    {l.contribution_per_kg != null ? (
                      <span className={l.contribution_per_kg >= 0 ? 'text-success' : 'text-destructive'}>
                        {money(l.contribution_per_kg, l.currency)}
                      </span>
                    ) : (
                      '—'
                    )}
                  </td>
                  {showReprice && (
                    <>
                      <td className={cn(td, 'border-l')}>{now ? money(now.finalCost, l.currency) : '—'}</td>
                      <td className={td}>
                        {delta == null ? (
                          '—'
                        ) : Math.abs(delta) < 0.005 ? (
                          <span className="text-muted-foreground">no change</span>
                        ) : (
                          <span className={cn('inline-flex items-center gap-1', delta > 0 ? 'text-destructive' : 'text-success')}>
                            {delta > 0 ? <TrendingUp className="h-3 w-3" /> : <TrendingDown className="h-3 w-3" />}
                            {delta > 0 ? '+' : ''}
                            {money(delta, l.currency)}
                          </span>
                        )}
                      </td>
                    </>
                  )}
                  <td className={cn(td, 'text-right')}>
                    <button
                      onClick={() => {
                        setQuoteOpen(false);
                        setProductsOpen(false);
                        setSheetLine(l);
                      }}
                      className="whitespace-nowrap font-medium text-primary hover:underline"
                    >
                      Breakdown
                    </button>
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </ScrollX>

      {productsOpen && (
        <ProductManager
          costingId={costing.id}
          products={products}
          addable={addable}
          market={costing.market}
          onClose={() => setProductsOpen(false)}
        />
      )}

      {quoteOpen && (
        <QuoteBuilder
          sources={quoteSources}
          authorName={authorName}
          onClose={() => setQuoteOpen(false)}
        />
      )}

      {/*
        Two copies of the same sheet, deliberately. The one in the dialog is the
        on-screen preview; the one below carries COST_SHEET_ID and is what print
        reveals and the Word export serialises — it sits at page level, outside
        the dialog's fixed positioning, so a sheet longer than a page still
        prints in full.
      */}
      {sheetLine && (
        <>
          <Dialog
            open
            onClose={() => setSheetLine(null)}
            title="Cost breakdown"
            description={`${sheetLine.sku_name} · ${COST_STATE_LABEL[sheetLine.state]}${sheetLine.destination_name ? ` · ${sheetLine.destination_name}` : ''}`}
            className="max-w-3xl print:hidden"
            footer={
              <>
                <Button variant="outline" onClick={() => setSheetLine(null)}>Close</Button>
                <Button variant="outline" onClick={onWord}>
                  <FileText className="h-4 w-4" /> Download Word
                </Button>
                <Button onClick={() => window.print()}>
                  <Printer className="h-4 w-4" /> Print / Save as PDF
                </Button>
              </>
            }
          >
            {showBaseCost && (
              <div className="mb-3">
                <BaseCostToggle include={includeBaseCost} onChange={setIncludeBaseCost} />
              </div>
            )}
            <div className="max-h-[65vh] overflow-y-auto rounded-md border">
              <CostSheet costing={costing} line={sheetLine} pinnedLabel={pinnedLabel} authorName={authorName} showBaseCost={sheetBaseCost} />
            </div>
            <p className="mt-3 text-xs text-muted-foreground">
              Both formats hold the figures as saved, not as they would price today. The Word file is editable, so
              anything else not meant for the recipient can be taken out before it is sent.
            </p>
          </Dialog>

          <div className="hidden print:block">
            <CostSheet
              costing={costing}
              line={sheetLine}
              pinnedLabel={pinnedLabel}
              authorName={authorName}
              showBaseCost={sheetBaseCost}
              elementId={COST_SHEET_ID}
            />
          </div>
        </>
      )}
    </div>
  );
}

/**
 * Add products to a saved costing, or take one off.
 *
 * Both halves in one dialog because they are one question — "what is on this
 * sheet" — and because doing them apart invites the mistake of adding a
 * replacement without removing what it replaces.
 *
 * Nothing is costed here. The new lines are built on the server against the
 * costing's own pinned assumptions, so a product added today is priced on the
 * same basis as the ones saved with it rather than on today's numbers.
 */
function ProductManager({
  costingId,
  products,
  addable,
  market,
  onClose,
}: {
  costingId: string;
  products: { name: string; lineCount: number }[];
  addable: AddableSku[];
  market: CostMarket;
  onClose: () => void;
}) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const [query, setQuery] = useState('');
  const [picked, setPicked] = useState<string[]>([]);
  const [message, setMessage] = useState<string | null>(null);

  const matches = useMemo(() => {
    const q = query.trim().toLowerCase();
    if (!q) return addable;
    return addable.filter(
      (s) =>
        s.name.toLowerCase().includes(q) ||
        s.category.toLowerCase().includes(q) ||
        (s.customer ?? '').toLowerCase().includes(q)
    );
  }, [addable, query]);

  // The last product cannot go: the server refuses it, and an enabled button
  // that always fails is worse than a disabled one that explains itself.
  const isLast = products.length <= 1;

  function onAdd() {
    if (picked.length === 0) return;
    startTransition(async () => {
      const res = await addSkusToCosting(costingId, picked);
      setMessage(res.error);
      if (!res.error) setPicked([]);
      router.refresh();
    });
  }

  function onRemove(name: string) {
    if (!confirm(`Take “${name}” off this costing? Every state and port of it goes with it.`)) return;
    startTransition(async () => {
      const res = await removeProductFromCosting(costingId, name);
      setMessage(res.error);
      router.refresh();
    });
  }

  return (
    <Dialog
      open
      onClose={onClose}
      title="Products on this costing"
      description={`Added products are costed on this costing's pinned ${market} assumptions, not today's.`}
      className="max-w-2xl"
      footer={
        <>
          <Button variant="outline" onClick={onClose}>
            Done
          </Button>
          <Button onClick={onAdd} disabled={pending || picked.length === 0}>
            {picked.length === 0 ? 'Add products' : `Add ${picked.length} product${picked.length === 1 ? '' : 's'}`}
          </Button>
        </>
      }
    >
      {message && (
        <p className="mb-3 rounded-md border border-warning/40 bg-warning/10 px-3 py-2 text-xs text-warning">
          {message}
        </p>
      )}

      <section className="mb-4">
        <h3 className="mb-1.5 text-xs font-medium uppercase tracking-wide text-muted-foreground">
          On the costing ({products.length})
        </h3>
        <div className="flex flex-wrap gap-1.5">
          {products.map((p) => (
            <span
              key={p.name}
              className="inline-flex items-center gap-1.5 rounded-full border bg-muted/40 py-0.5 pl-2.5 pr-1 text-xs"
            >
              {p.name}
              <span className="text-[10px] text-muted-foreground">{p.lineCount}</span>
              <button
                disabled={pending || isLast}
                onClick={() => onRemove(p.name)}
                className="rounded-full p-0.5 text-muted-foreground hover:bg-destructive/10 hover:text-destructive disabled:opacity-40 disabled:hover:bg-transparent disabled:hover:text-muted-foreground"
                aria-label={`Remove ${p.name}`}
                title={isLast ? 'The last product cannot be removed — delete the costing instead' : `Remove ${p.name}`}
              >
                <Trash2 className="h-3 w-3" />
              </button>
            </span>
          ))}
        </div>
      </section>

      <section>
        <h3 className="mb-1.5 text-xs font-medium uppercase tracking-wide text-muted-foreground">Add a product</h3>
        {addable.length === 0 ? (
          <p className="rounded-md border bg-muted/30 px-3 py-4 text-center text-xs text-muted-foreground">
            Every active {market} product is already on this costing.
          </p>
        ) : (
          <>
            <div className="relative mb-2">
              <Search className="pointer-events-none absolute left-2.5 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-muted-foreground" />
              <input
                value={query}
                onChange={(e) => setQuery(e.target.value)}
                placeholder="Search by product, category or customer"
                className="w-full rounded-md border bg-background py-1.5 pl-8 pr-2 text-xs outline-none focus:border-primary"
              />
            </div>
            <div className="max-h-64 divide-y overflow-y-auto rounded-md border">
              {matches.length === 0 ? (
                <p className="px-3 py-4 text-center text-xs text-muted-foreground">Nothing matches “{query}”.</p>
              ) : (
                matches.map((s) => (
                  <label key={s.id} className="flex cursor-pointer items-center gap-2 px-3 py-1.5 text-xs hover:bg-muted/40">
                    <input
                      type="checkbox"
                      checked={picked.includes(s.id)}
                      onChange={(e) =>
                        setPicked((prev) => (e.target.checked ? [...prev, s.id] : prev.filter((id) => id !== s.id)))
                      }
                    />
                    <span className="min-w-0 flex-1 truncate font-medium">{s.name}</span>
                    {s.scope !== 'both' && s.scope !== market && (
                      <span
                        className="shrink-0 text-[10px] uppercase tracking-wide text-warning"
                        title={`Set up for the ${s.scope} market. It will be costed on this costing's ${market} basis — check its selling price.`}
                      >
                        {s.scope} only
                      </span>
                    )}
                    <span className="shrink-0 text-[11px] text-muted-foreground">
                      {[s.category, s.customer].filter(Boolean).join(' · ')}
                    </span>
                  </label>
                ))
              )}
            </div>
          </>
        )}
      </section>
    </Dialog>
  );
}

/**
 * One saved line, reduced to what a customer may see.
 *
 * Only the four customer-facing fields cross over — the freight is carried so
 * the quotation can build CIF off the same selling price it quotes as FOB.
 * Everything else on the line stays on this page.
 */
const toQuoteItem = (l: CostCostingLine): QuoteItem => ({
  id: l.id,
  product: l.sku_name,
  presentation: COST_STATE_LABEL[l.state],
  destination: l.destination_name,
  price: l.selling_price,
  freightPerKg: num(rec(l.outputs).freightPerKg),
});

const round = (n: number | null): number | null => (n == null ? null : Math.round(n * 10000) / 10000);
const slug = (s: string) => s.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '') || 'costing';
const chip = (active: boolean) =>
  cn(
    'rounded-full border px-2.5 py-0.5 text-xs',
    active ? 'border-primary bg-primary/10 font-medium text-primary' : 'text-muted-foreground hover:bg-muted'
  );
// Header cells carry the sticky position and an OPAQUE background themselves:
// sticking <thead> doesn't work, and a tint on the <tr> lets rows show through as
// they scroll under it. The frozen SKU column's header overrides to z-30 so it wins
// over both the sticky row and the sticky column. See components/output-grid.tsx.
const th =
  'sticky top-0 z-20 whitespace-nowrap border-b border-border bg-muted px-2 py-2 font-medium';
const td = 'whitespace-nowrap px-2 py-1.5';
