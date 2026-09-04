'use client';

import { useMemo, useState, useTransition } from 'react';
import { useRouter } from 'next/navigation';
import { Download, FileDown, FileSignature, FileText, Globe, Lock, Printer, Save, AlertTriangle } from 'lucide-react';
import { computeCost, type CostResult, type DomesticOutput, type ExportOutput } from '@oceanpick/engine';
import type {
  CostAssumptionVersion,
  CostDestinationRow,
  CostMarket,
  CostProductForm,
  CostOdcComponentRow,
  CostSizeBucket,
  CostSkuRow,
  CostVisibility,
} from '@oceanpick/shared';
import { toAssumptions, toBucket, toDestination, toSku } from '@/lib/costing-adapt';
import { toCsv, downloadCsv } from '@/lib/csv';
import { ScrollX } from '@/components/ui/scroll-x';
import { cn } from '@/lib/utils';
import { OVERRIDABLE, OVERRIDE_LABEL, PERCENT_FIELDS, type OverridableField } from '@/lib/costing-adapt';
import { isBaseCostField } from '@/lib/costing-base-cost';
import { downloadDoc, slugify } from '@/lib/doc-export';
import { BaseCostToggle, COST_SHEET_ID } from '@/components/cost-sheet-parts';
import { QuoteBuilder } from '@/components/quote-builder';
import type { QuoteItem } from '@/components/quote-sheet';
import { SkuCostSheet } from './skus/sku-cost-sheet';
import { CostedByFilter, matchesCostedBy, COSTED_BY_ALL, type CostedBy } from './costed-by-filter';
import { saveCosting } from './actions';

export type RateMap = Record<string, { sea: number; air: number }>;
export type YieldMap = Record<string, Record<string, number>>;

/** One grid row: a SKU costed for one destination (export) or none (domestic). */
interface Row {
  sku: CostSkuRow;
  destination: CostDestinationRow | null;
  result: CostResult;
}

/**
 * Who set this SKU's recipe up. The seeded 34 came from the v11 workbook and
 * have no creator — they are shared company recipes, not one person's work, so
 * they say so rather than showing a blank that reads as missing data.
 */
const COMPANY_RECIPE = 'Company recipe';

function authorOf(sku: CostSkuRow, authors: Record<string, string>): string {
  if (!sku.created_by) return COMPANY_RECIPE;
  return authors[sku.created_by] ?? 'Unknown';
}

export function CostGridClient({
  version,
  odc,
  buckets,
  destinations,
  rates,
  skus,
  yields,
  authors,
  currentUserId,
  isAdmin,
  canViewBaseCost,
}: {
  version: CostAssumptionVersion;
  odc: CostOdcComponentRow[];
  buckets: CostSizeBucket[];
  destinations: CostDestinationRow[];
  rates: RateMap;
  skus: CostSkuRow[];
  yields: YieldMap;
  authors: Record<string, string>;
  /** Null when the profile could not be read — the Created by me filter is then not offered. */
  currentUserId: string | null;
  isAdmin: boolean;
  /**
   * Whether this user may see what the fish costs to grow. False means the
   * `version` and `odc` above are a masked pair that price identically but
   * say nothing about the feed price, the tax position or the ODC line items —
   * so don't render them, and don't offer them as overrides.
   */
  canViewBaseCost: boolean;
}) {
  const router = useRouter();
  const [market, setMarket] = useState<CostMarket>('domestic');
  const [bucketId, setBucketId] = useState<string>(''); // '' = flat reference model
  const [selectedDests, setSelectedDests] = useState<string[]>(() =>
    destinations.length ? [destinations[0]!.id] : []
  );
  const [showInactive, setShowInactive] = useState(false);
  const [query, setQuery] = useState('');
  // Everyone's by default. The grid exists to compare across the range, so it
  // must not open on a subset a reader has not asked for.
  const [costedBy, setCostedBy] = useState<CostedBy>(COSTED_BY_ALL);
  const [saving, setSaving] = useState(false);
  // The row whose breakdown document is open, for preview / print / Word.
  const [sheetRow, setSheetRow] = useState<Row | null>(null);
  // The customer-facing quotation over the grid as filtered. Never open at the
  // same time as a breakdown: both mount a print copy, and print reveals every
  // one — a cost build-up must not ride along with a price list.
  const [quoteOpen, setQuoteOpen] = useState(false);
  // Whether that document carries the base cost build-up — see BaseCostToggle.
  const [includeBaseCost, setIncludeBaseCost] = useState(true);
  const sheetBaseCost = canViewBaseCost && includeBaseCost;
  const [isPending, startTransition] = useTransition();

  const domestic = market === 'domestic';
  const assumptions = useMemo(() => toAssumptions(version, odc), [version, odc]);
  const bucket = useMemo(
    () => (bucketId ? (buckets.find((b) => b.id === bucketId) ?? null) : null),
    [bucketId, buckets]
  );

  const activeDests = useMemo(
    () => destinations.filter((d) => selectedDests.includes(d.id)),
    [destinations, selectedDests]
  );

  const visibleSkus = useMemo(() => {
    const q = query.trim().toLowerCase();
    return skus.filter(
      (s) =>
        (showInactive || s.status === 'active') &&
        matchesCostedBy(s, costedBy, currentUserId) &&
        // A SKU can declare itself domestic-only or export-only; 'both' is the
        // default and the seeded behaviour.
        (s.market_scope === 'both' || s.market_scope === market) &&
        // Searching by customer is the point of showing it — "what did we quote
        // Al Rawdah?" is a question the grid should answer directly.
        (!q ||
          s.name.toLowerCase().includes(q) ||
          s.category.toLowerCase().includes(q) ||
          (s.customer ?? '').toLowerCase().includes(q) ||
          authorOf(s, authors).toLowerCase().includes(q))
    );
  }, [skus, showInactive, query, market, authors, costedBy, currentUserId]);

  /**
   * Every visible row, recomputed whenever an input changes. Domestic has no
   * ports; export repeats each SKU per selected destination so several markets
   * can be compared side by side (Decisions §9).
   */
  const rows: Row[] = useMemo(() => {
    const engineBucket = bucket ? toBucket(bucket) : null;
    const out: Row[] = [];
    for (const sku of visibleSkus) {
      const engineSku = toSku(sku, market, yields[sku.id]);
      if (domestic) {
        out.push({
          sku,
          destination: null,
          result: computeCost({ market, assumptions, sku: engineSku, bucket: engineBucket }),
        });
      } else {
        for (const d of activeDests) {
          out.push({
            sku,
            destination: d,
            result: computeCost({
              market,
              assumptions,
              sku: engineSku,
              bucket: engineBucket,
              destination: toDestination(d, rateOf(rates, d.id)),
            }),
          });
        }
      }
    }
    return out;
  }, [visibleSkus, market, domestic, assumptions, bucket, activeDests, rates, yields]);

  const brokenCount = rows.filter((r) => !r.result.ok).length;

  /**
   * SKUs that produced no usable row at all. An export SKU can fail for one
   * port and cost fine for another, so a SKU only counts as broken when every
   * one of its rows failed — those are the ones saveCosting would drop.
   */
  const brokenSkuIds = useMemo(() => {
    const anyOk = new Map<string, boolean>();
    for (const r of rows) anyOk.set(r.sku.id, (anyOk.get(r.sku.id) ?? false) || r.result.ok);
    return new Set([...anyOk].filter(([, ok]) => !ok).map(([id]) => id));
  }, [rows]);

  /**
   * The grid as a customer would see it: one row per quotable pack state, with
   * no cost, margin or contribution attached. Follows the filters, so searching
   * for a customer and then quoting them is one move.
   */
  const quoteItems = useMemo(() => rows.flatMap((r) => quoteItemsFor(r, domestic)), [rows, domestic]);

  // Prefilled only when the filtered grid is unanimous — searching a customer's
  // name is how you get here, and guessing from a mixed list would put the
  // wrong company on the document.
  const quoteCustomer = useMemo(() => {
    const names = visibleSkus.map((s) => (s.customer ?? '').trim());
    const first = names[0] ?? '';
    return first && names.every((n) => n === first) ? first : '';
  }, [visibleSkus]);

  function onExport() {
    downloadCsv(
      `costing-${market}-${new Date().toISOString().slice(0, 10)}.csv`,
      toCsv(csvMatrix(rows, domestic, activeDests.length > 1, authors))
    );
  }

  function onSheetWord() {
    if (!sheetRow) return;
    const label = sheetRow.sku.name;
    const port = sheetRow.destination ? `-${slugify(sheetRow.destination.name, 'port')}` : '';
    const ok = downloadDoc(
      `${slugify(label, 'sku')}${port}-cost-breakdown`,
      COST_SHEET_ID,
      `${label} — cost breakdown`
    );
    if (!ok) alert('Could not build the document — the breakdown sheet was not found on the page.');
  }

  function onSave(
    name: string,
    skuIds: string[],
    overrides: Partial<Record<OverridableField, number>>,
    visibility: CostVisibility
  ) {
    startTransition(async () => {
      const res = await saveCosting({
        name,
        visibility,
        market,
        versionId: version.id,
        bucketId: bucketId || null,
        destinationIds: domestic ? [] : selectedDests,
        skuIds,
        overrides,
      });
      setSaving(false);
      if (res.error) alert(res.error);
      else router.push('/costing/saved');
    });
  }

  return (
    <div className="space-y-4">
      <header className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h1 className="text-2xl font-semibold tracking-tight">Cost Grid</h1>
          <p className="mt-0.5 text-sm text-muted-foreground">
            Every SKU at the current assumptions. Nothing here is saved until you snapshot it.
          </p>
        </div>
        <div className="flex items-center gap-2">
          <button onClick={onExport} className={btnGhost}>
            <Download className="h-3.5 w-3.5" /> Export sheet
          </button>
          <button
            onClick={() => {
              setSheetRow(null);
              setQuoteOpen(true);
            }}
            className={cn(btnGhost, 'border-primary bg-primary/10 text-primary hover:bg-primary/15')}
            disabled={quoteItems.length === 0}
            title="A customer-facing price list from the rows on screen — prices only"
          >
            <FileSignature className="h-3.5 w-3.5" /> Quotation
          </button>
          <button onClick={() => setSaving(true)} className={btnPrimary} disabled={isPending}>
            <Save className="h-3.5 w-3.5" /> Save as costing
          </button>
        </div>
      </header>

      <Controls
        market={market}
        setMarket={setMarket}
        buckets={buckets}
        bucketId={bucketId}
        setBucketId={setBucketId}
        destinations={destinations}
        selectedDests={selectedDests}
        setSelectedDests={setSelectedDests}
        showInactive={showInactive}
        setShowInactive={setShowInactive}
        query={query}
        setQuery={setQuery}
        skus={skus}
        currentUserId={currentUserId}
        authors={authors}
        costedBy={costedBy}
        setCostedBy={setCostedBy}
        version={version}
      />

      {brokenCount > 0 && (
        <p className="flex items-center gap-1.5 rounded-md border border-destructive/30 bg-destructive/10 px-3 py-2 text-xs text-destructive">
          <AlertTriangle className="h-3.5 w-3.5 shrink-0" />
          {brokenCount} {brokenCount === 1 ? 'SKU is' : 'SKUs are'} not costed — their % fish and %
          marinade don&apos;t total 100%. Fix the split on the SKUs page.
        </p>
      )}

      <Grid
        rows={rows}
        domestic={domestic}
        showDestination={!domestic && activeDests.length > 1}
        authors={authors}
        onSheet={(row) => {
          setQuoteOpen(false);
          setSheetRow(row);
        }}
      />

      <Legend />

      {quoteOpen && (
        <QuoteBuilder
          sources={[{ market, items: quoteItems }]}
          defaultCustomer={quoteCustomer}
          onClose={() => setQuoteOpen(false)}
        />
      )}

      {sheetRow && sheetRow.result.ok && (
        <>
          <div
            className="fixed inset-0 z-50 flex items-start justify-center overflow-y-auto bg-black/40 p-4 print:hidden"
            onClick={() => setSheetRow(null)}
          >
            <div
              className="my-8 w-full max-w-3xl rounded-lg border bg-card p-5 shadow-lg"
              onClick={(e) => e.stopPropagation()}
            >
              <div className="flex flex-wrap items-start justify-between gap-2">
                <div>
                  <h2 className="text-lg font-semibold">Cost breakdown</h2>
                  <p className="text-xs text-muted-foreground">
                    {sheetRow.sku.name}
                    {sheetRow.destination ? ` · ${sheetRow.destination.name}` : ''}
                  </p>
                </div>
                <div className="flex gap-2">
                  <button onClick={() => setSheetRow(null)} className={btnGhost}>
                    Close
                  </button>
                  <button onClick={onSheetWord} className={btnGhost}>
                    <FileText className="h-3.5 w-3.5" /> Word
                  </button>
                  <button onClick={() => window.print()} className={btnPrimary}>
                    <Printer className="h-3.5 w-3.5" /> Print / Save as PDF
                  </button>
                </div>
              </div>

              {canViewBaseCost && (
                <div className="mt-3">
                  <BaseCostToggle include={includeBaseCost} onChange={setIncludeBaseCost} />
                </div>
              )}

              <div className="mt-3 max-h-[70vh] overflow-y-auto rounded-md border">
                <SkuCostSheet {...sheetProps(sheetRow, version, authors, bucket?.label ?? null, sheetBaseCost)} />
              </div>

              <p className="mt-3 text-xs text-muted-foreground">
                Live figures at the current assumptions — not a saved costing. Save the grid as a costing if you
                need the numbers pinned to what was quoted.
              </p>
            </div>
          </div>

          {/*
            The document itself, outside the modal's fixed positioning — a fixed
            ancestor confines a printed element to the first page. Hidden on
            screen, revealed by the #cost-sheet print rules, and serialised
            as-is by the Word export.
          */}
          <div className="hidden print:block">
            <SkuCostSheet {...sheetProps(sheetRow, version, authors, bucket?.label ?? null, sheetBaseCost)} elementId={COST_SHEET_ID} />
          </div>
        </>
      )}

      {saving && (
        <SaveDialog
          skus={visibleSkus}
          brokenSkuIds={brokenSkuIds}
          authors={authors}
          version={version}
          canViewBaseCost={canViewBaseCost}
          onCancel={() => setSaving(false)}
          onSave={onSave}
          busy={isPending}
        />
      )}
    </div>
  );
}

/**
 * A grid row as the breakdown document wants it.
 *
 * The row already holds a computed CostOutput, so nothing is recosted here —
 * the sheet shows exactly the numbers in the row you clicked, including its
 * port. Only the market that row belongs to is filled in; the other is null.
 */
function sheetProps(
  row: Row,
  version: CostAssumptionVersion,
  authors: Record<string, string>,
  bucketLabel: string | null,
  showBaseCost: boolean
) {
  const out = row.result.ok ? row.result.value : null;
  // Read the market off the row's own output, not off the page's market
  // toggle: the row is a snapshot taken when it was clicked, and deciding its
  // shape from state that has moved since would file an export result under
  // domestic. One source, so they cannot disagree.
  const isDomestic = out?.result.market === 'domestic';
  return {
    skuName: row.sku.name,
    category: row.sku.category,
    customer: row.sku.customer ?? '',
    assumptionsLabel: `v${version.version_no}${version.label ? ` · ${version.label}` : ''}`,
    authorName: authorOf(row.sku, authors),
    glazePct: row.sku.glaze_pct,
    absorbed: row.sku.raw_material_basis === 'absorbed',
    productForm: row.sku.product_form,
    gradeLabel: bucketLabel,
    pctFish: row.sku.pct_fish,
    pctMarinade: row.sku.pct_marinade,
    showBaseCost,
    domestic: out && isDomestic ? (out.result as DomesticOutput) : null,
    domesticWholeFish: out && isDomestic ? out.wholeFish : null,
    exportOut: out && !isDomestic ? (out.result as ExportOutput) : null,
    exportWholeFish: out && !isDomestic ? out.wholeFish : null,
    destinationName: row.destination?.name ?? null,
  };
}

function rateOf(rates: RateMap, id: string) {
  const r = rates[id];
  return r ? { version_id: '', destination_id: id, sea_rate_per_20ft: r.sea, air_rate_per_lot: r.air } : undefined;
}

// ---------------------------------------------------------------------------
// Controls
// ---------------------------------------------------------------------------

function Controls({
  market,
  setMarket,
  buckets,
  bucketId,
  setBucketId,
  destinations,
  selectedDests,
  setSelectedDests,
  showInactive,
  setShowInactive,
  query,
  setQuery,
  skus,
  currentUserId,
  authors,
  costedBy,
  setCostedBy,
  version,
}: {
  market: CostMarket;
  setMarket: (m: CostMarket) => void;
  buckets: CostSizeBucket[];
  bucketId: string;
  setBucketId: (id: string) => void;
  destinations: CostDestinationRow[];
  selectedDests: string[];
  setSelectedDests: (ids: string[]) => void;
  showInactive: boolean;
  setShowInactive: (v: boolean) => void;
  query: string;
  setQuery: (v: string) => void;
  skus: CostSkuRow[];
  currentUserId: string | null;
  authors: Record<string, string>;
  costedBy: CostedBy;
  setCostedBy: (v: CostedBy) => void;
  version: CostAssumptionVersion;
}) {
  const multi = selectedDests.length > 1;

  function toggleDest(id: string) {
    setSelectedDests(
      selectedDests.includes(id)
        ? selectedDests.filter((d) => d !== id) || []
        : [...selectedDests, id]
    );
  }

  return (
    <div className="space-y-2 rounded-lg border bg-card p-3">
      <div className="flex flex-wrap items-center gap-3">
        {/* Market is a mode, not a second SKU list (Decisions §3). */}
        <div className="inline-flex rounded-md border p-0.5">
          {(['domestic', 'export'] as const).map((m) => (
            <button
              key={m}
              onClick={() => setMarket(m)}
              className={cn(
                'rounded px-3 py-1 text-sm font-medium capitalize transition-colors',
                market === m ? 'bg-primary text-primary-foreground' : 'text-muted-foreground hover:text-foreground'
              )}
            >
              {m}
              <span className="ml-1.5 text-[10px] opacity-70">{m === 'domestic' ? 'LKR' : 'USD'}</span>
            </button>
          ))}
        </div>

        <label className="flex items-center gap-1.5 text-xs">
          <span className="font-medium text-muted-foreground">Size</span>
          <select value={bucketId} onChange={(e) => setBucketId(e.target.value)} className={selectCls}>
            <option value="">No size grade (reference fish)</option>
            {buckets.map((b) => (
              <option key={b.id} value={b.id}>
                {b.label} · median {b.median_g}g · FCR {b.fcr}
              </option>
            ))}
          </select>
        </label>

        <label className="flex items-center gap-1.5 text-xs">
          <input
            type="search"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder="SKU, customer or person…"
            className={cn(selectCls, 'w-48')}
          />
        </label>

        <CostedByFilter skus={skus} currentUserId={currentUserId} authors={authors} value={costedBy} onChange={setCostedBy} />

        <label className="flex items-center gap-1.5 text-xs text-muted-foreground">
          <input type="checkbox" checked={showInactive} onChange={(e) => setShowInactive(e.target.checked)} />
          Show inactive
        </label>

        <span className="ml-auto text-[11px] text-muted-foreground">
          Assumptions v{version.version_no}
          {version.label ? ` · ${version.label}` : ''} · FX {version.fx_rate}
        </span>
      </div>

      {market === 'export' && (
        <div className="flex flex-wrap items-center gap-1.5 border-t pt-2">
          <span className="text-xs font-medium text-muted-foreground">
            Destination{multi ? 's' : ''}
          </span>
          {destinations.map((d) => (
            <button
              key={d.id}
              onClick={() => toggleDest(d.id)}
              className={cn(
                'rounded-full border px-2.5 py-0.5 text-xs transition-colors',
                selectedDests.includes(d.id)
                  ? 'border-primary bg-primary/10 font-medium text-primary'
                  : 'text-muted-foreground hover:bg-muted'
              )}
            >
              {d.name}
            </button>
          ))}
          {selectedDests.length === 0 && (
            <span className="text-xs text-destructive">Pick at least one port to see CIF and below.</span>
          )}
        </div>
      )}

      {bucketId && (
        <p className="border-t pt-2 text-[11px] text-muted-foreground">
          Size grades use placeholder FCR and yield until the farm supplies real figures — costs
          shown for a grade are indicative.
        </p>
      )}
    </div>
  );
}

// ---------------------------------------------------------------------------
// Grid — the internal sheet, matching the v11 column order (Decisions §10)
// ---------------------------------------------------------------------------

function Grid({
  rows,
  domestic,
  showDestination,
  authors,
  onSheet,
}: {
  rows: Row[];
  domestic: boolean;
  showDestination: boolean;
  authors: Record<string, string>;
  onSheet: (row: Row) => void;
}) {
  if (rows.length === 0) {
    return (
      <div className="rounded-lg border bg-card p-8 text-center text-sm text-muted-foreground">
        No SKUs match.
      </div>
    );
  }

  return (
    <ScrollX className="max-h-[70vh] rounded-lg border bg-card">
      <table className="w-full border-collapse text-right text-xs tabular-nums">
        <thead>
          <tr className="text-[10px] uppercase tracking-wide text-muted-foreground">
            <th className={cn(thBase, 'left-0 z-30 text-left')}>SKU</th>
            <th className={cn(thBase, 'text-left')}>Customer</th>
            <th className={cn(thBase, 'text-left')}>Costed by</th>
            {showDestination && <th className={cn(thBase, 'text-left')}>Port</th>}
            <th className={thBase}>Yield</th>
            <th className={thBase}>Whole fish</th>
            <th className={thBase}>Fish comp</th>
            <th className={thBase}>Marinade</th>
            <th className={thBase}>Raw matl</th>
            <th className={thBase}>Process</th>
            <th className={thBase}>Packing</th>
            <th className={thBase}>Cold-hold</th>
            <th className={thBase}>Ex-factory</th>
            <th className={thBase}>Freight</th>
            <th className={cn(thBase, 'border-l')}>FINAL</th>
            {/*
              Each margin sits immediately after the price it is earned on. In
              cost-plus mode they all read the same — the margin assumption — and
              that sameness is itself the answer; they separate as soon as a
              target price is set, because one named price meets a different
              FINAL in every pack state.
            */}
            {domestic ? (
              <>
                <th className={thBase}>Rack rate</th>
                <th className={thBase}>Margin</th>
                <th className={thBase} title="What a kg of round fish earns, over what it cost to grow (feed x FCR + ODC)">WR margin</th>
                <th className={cn(thBase, 'border-l')}>FINAL glazed</th>
                <th className={thBase}>Rack glazed</th>
                <th className={thBase}>Margin glazed</th>
                <th className={thBase} title="What a kg of round fish earns, over what it cost to grow (feed x FCR + ODC)">WR glazed</th>
              </>
            ) : (
              <>
                <th className={thBase}>FOB</th>
                <th className={thBase}>Margin</th>
                <th className={thBase} title="What a kg of round fish earns, over what it cost to grow (feed x FCR + ODC)">WR margin</th>
                <th className={thBase}>CIF</th>
                <th className={thBase}>Dist→T3</th>
                <th className={cn(thBase, 'border-l')}>Glazed FOB</th>
                <th className={thBase}>Glazed margin</th>
                <th className={thBase} title="What a kg of round fish earns, over what it cost to grow (feed x FCR + ODC)">Glazed WR</th>
                <th className={thBase}>Glazed CIF</th>
                <th className={cn(thBase, 'border-l')}>Fresh FOB</th>
                <th className={thBase}>Fresh margin</th>
                <th className={thBase} title="What a kg of round fish earns, over what it cost to grow (feed x FCR + ODC)">Fresh WR</th>
                <th className={thBase}>Fresh CIF</th>
                <th className={thBase}>Fresh T3</th>
              </>
            )}
          </tr>
        </thead>
        <tbody>
          {rows.map((row) => (
            <GridRow
              key={row.sku.id + (row.destination?.id ?? '')}
              row={row}
              domestic={domestic}
              showDestination={showDestination}
              authors={authors}
              onSheet={onSheet}
            />
          ))}
        </tbody>
      </table>
    </ScrollX>
  );
}

function GridRow({
  row,
  domestic,
  showDestination,
  authors,
  onSheet,
}: {
  row: Row;
  domestic: boolean;
  showDestination: boolean;
  authors: Record<string, string>;
  onSheet: (row: Row) => void;
}) {
  const { sku, destination, result } = row;
  const absorbed = sku.raw_material_basis === 'absorbed';
  const inactive = sku.status === 'inactive';
  const span = domestic ? 19 : 26;
  const author = authorOf(sku, authors);

  const nameCell = (
    <th
      className={cn(
        tdBase,
        'sticky left-0 z-10 max-w-[220px] truncate text-left font-medium',
        inactive ? 'bg-muted/30 text-muted-foreground' : 'bg-card'
      )}
      title={sku.name}
    >
      <span className="flex items-center gap-1.5">
        <span className="min-w-0 flex-1 truncate">
          {sku.name}
          {absorbed && <ByProductBadge />}
        </span>
        {/*
          In the sticky column rather than a trailing one: this table is wide
          enough to scroll, and an action parked past Fresh T3 would be off
          screen exactly when you are looking at a row you want to send.
        */}
        {result.ok && (
          <button
            type="button"
            onClick={() => onSheet(row)}
            title="Download this SKU's cost breakdown"
            aria-label={`Download cost breakdown for ${sku.name}`}
            className="shrink-0 rounded p-0.5 text-muted-foreground opacity-60 transition-opacity hover:bg-muted hover:text-foreground hover:opacity-100"
          >
            <FileDown className="h-3.5 w-3.5" />
          </button>
        )}
      </span>
    </th>
  );

  // Who it is for and who built it. Both live on the SKU rather than the
  // costing: the recipe is what carries a customer's spec, and the grid is a
  // live view rather than a saved record (a saved costing stamps its own
  // author separately, on the Saved page).
  const identityCells = (
    <>
      <td className={cn(tdBase, 'max-w-[160px] truncate text-left')} title={sku.customer || undefined}>
        {sku.customer ? sku.customer : <span className="text-muted-foreground/50">—</span>}
      </td>
      <td
        className={cn(
          tdBase,
          'max-w-[140px] truncate text-left',
          author === COMPANY_RECIPE && 'text-muted-foreground'
        )}
        title={author === COMPANY_RECIPE ? 'Seeded from the v11 workbook — maintained by admins' : author}
      >
        {author}
      </td>
    </>
  );

  // Decisions §11: a broken split highlights and does NOT calculate.
  if (!result.ok) {
    return (
      <tr className="border-b bg-destructive/5 last:border-0">
        {nameCell}
        {identityCells}
        <td colSpan={span} className={cn(tdBase, 'text-left text-destructive')}>
          {result.issues.map((i) => i.message).join(' · ')}
        </td>
      </tr>
    );
  }

  const { chain } = result.value.result;
  const money = domestic ? lkr : usd;

  return (
    <tr className={cn('border-b last:border-0 hover:bg-muted/30', inactive && 'text-muted-foreground')}>
      {nameCell}
      {identityCells}
      {showDestination && <td className={cn(tdBase, 'text-left')}>{destination?.name}</td>}
      <td className={tdBase}>{(chain.yieldUsed * 100).toFixed(0)}%</td>
      <td className={cn(tdBase, absorbed && 'text-muted-foreground line-through')}>{money(chain.wholeFish)}</td>
      <td className={cn(tdBase, absorbed && 'text-muted-foreground')}>{money(chain.fishComponent)}</td>
      <td className={tdBase}>{money(chain.marinadeComponent)}</td>
      <td className={tdBase}>{money(chain.rawMaterial)}</td>
      <td className={tdBase}>{money(chain.process)}</td>
      <td className={tdBase}>{money(chain.packing)}</td>
      <td className={tdBase}>{money(chain.coldHold)}</td>
      <td className={tdBase}>{money(chain.exFactory)}</td>
      <td className={tdBase}>{money(chain.freight)}</td>

      {domestic ? (
        <DomesticCells out={result.value.result as DomesticOutput} absorbed={absorbed} form={sku.product_form} />
      ) : (
        <ExportCells out={result.value.result as ExportOutput} absorbed={absorbed} form={sku.product_form} />
      )}
    </tr>
  );
}

/**
 * A state this SKU isn't sold in. Blanked rather than hidden: the columns must
 * stay aligned across rows, and a dash that explains itself is clearer than a
 * number nobody should quote from.
 */
function NotSold({ why }: { why: string }) {
  return (
    <span className="text-muted-foreground/50" title={why}>
      —
    </span>
  );
}

function DomesticCells({ out, absorbed, form }: { out: DomesticOutput; absorbed: boolean; form: CostProductForm }) {
  // Glaze is added ice, so it cannot apply to a fresh product at all.
  const noGlaze = form === 'fresh';
  return (
    <>
      <td className={cn(tdBase, 'border-l font-semibold')}>{lkr(out.unglazed.finalCost)}</td>
      <td className={tdBase}>
        {/* Absorbed by-products are priced on contribution, not cost-plus: a 40%
            rack rate on a LKR 270 floor would leave money on the table. */}
        {absorbed ? <Contribution value={out.unglazed.contributionPerKg} fmt={lkr} /> : lkr(out.unglazed.sellingPrice)}
      </td>
      <td className={tdBase}>
        <Margin value={out.unglazed.marginPct} absorbed={absorbed} />
      </td>
      <td className={tdBase}>
        <Margin value={out.unglazed.wholeRoundMarginPct} absorbed={absorbed} />
      </td>
      <td className={cn(tdBase, 'border-l')}>
        {noGlaze ? <NotSold why="Fresh product carries no glaze" /> : lkr(out.glazed.finalCost)}
      </td>
      <td className={tdBase}>
        {noGlaze ? (
          <NotSold why="Fresh product carries no glaze" />
        ) : absorbed ? (
          <Contribution value={out.glazed.contributionPerKg} fmt={lkr} />
        ) : (
          lkr(out.glazed.sellingPrice)
        )}
      </td>
      <td className={tdBase}>
        {noGlaze ? (
          <NotSold why="Fresh product carries no glaze" />
        ) : (
          <Margin value={out.glazed.marginPct} absorbed={absorbed} />
        )}
      </td>
      <td className={tdBase}>
        {noGlaze ? (
          <NotSold why="Fresh product carries no glaze" />
        ) : (
          <Margin value={out.glazed.wholeRoundMarginPct} absorbed={absorbed} />
        )}
      </td>
    </>
  );
}

function ExportCells({ out, absorbed, form }: { out: ExportOutput; absorbed: boolean; form: CostProductForm }) {
  const freshOnly = form === 'fresh';
  const frozenOnly = form === 'frozen';
  const FROZEN = 'This SKU is fresh only';
  const FRESH = 'This SKU is frozen only';

  return (
    <>
      <td className={cn(tdBase, 'border-l font-semibold')}>
        {freshOnly ? <NotSold why={FROZEN} /> : usd(out.frozenPlain.finalCost)}
      </td>
      <td className={tdBase}>
        {freshOnly ? (
          <NotSold why={FROZEN} />
        ) : absorbed ? (
          <Contribution value={out.frozenPlain.contributionPerKg} fmt={usd} />
        ) : (
          usd(out.frozenPlain.sellingPrice)
        )}
      </td>
      <td className={tdBase}>
        {freshOnly ? <NotSold why={FROZEN} /> : <Margin value={out.frozenPlain.marginPct} absorbed={absorbed} />}
      </td>
      <td className={tdBase}>
        {freshOnly ? (
          <NotSold why={FROZEN} />
        ) : (
          <Margin value={out.frozenPlain.wholeRoundMarginPct} absorbed={absorbed} />
        )}
      </td>
      <td className={tdBase}>{freshOnly ? <NotSold why={FROZEN} /> : usd(out.frozenPlain.cif)}</td>
      <td className={tdBase}>{freshOnly ? <NotSold why={FROZEN} /> : usd(out.frozenPlain.distributorT3)}</td>

      <td className={cn(tdBase, 'border-l')}>
        {freshOnly ? <NotSold why="Fresh product carries no glaze" /> : usd(out.frozenGlazed.sellingPrice)}
      </td>
      <td className={tdBase}>
        {freshOnly ? (
          <NotSold why="Fresh product carries no glaze" />
        ) : (
          <Margin value={out.frozenGlazed.marginPct} absorbed={absorbed} />
        )}
      </td>
      <td className={tdBase}>
        {freshOnly ? (
          <NotSold why="Fresh product carries no glaze" />
        ) : (
          <Margin value={out.frozenGlazed.wholeRoundMarginPct} absorbed={absorbed} />
        )}
      </td>
      <td className={tdBase}>
        {freshOnly ? <NotSold why="Fresh product carries no glaze" /> : usd(out.frozenGlazed.cif)}
      </td>

      <td className={cn(tdBase, 'border-l')}>{frozenOnly ? <NotSold why={FRESH} /> : usd(out.fresh.sellingPrice)}</td>
      <td className={tdBase}>
        {frozenOnly ? <NotSold why={FRESH} /> : <Margin value={out.fresh.marginPct} absorbed={absorbed} />}
      </td>
      <td className={tdBase}>
        {frozenOnly ? (
          <NotSold why={FRESH} />
        ) : (
          <Margin value={out.fresh.wholeRoundMarginPct} absorbed={absorbed} />
        )}
      </td>
      <td className={tdBase}>{frozenOnly ? <NotSold why={FRESH} /> : usd(out.fresh.cif)}</td>
      <td className={tdBase}>{frozenOnly ? <NotSold why={FRESH} /> : usd(out.fresh.distributorT3)}</td>
    </>
  );
}

/**
 * One grid row, reduced to what a customer may be quoted.
 *
 * Mirrors the pack states the printed cost sheet shows, and for the same
 * reason: a glazed SKU ships as the glazed pack, so its unglazed twin is that
 * pack read net of its ice rather than a second product at a higher price —
 * and a Fresh line for a frozen-only SKU is a price for something nobody can
 * order. A row that failed to cost yields nothing at all.
 *
 * An absorbed by-product is quoted at what the market bears, never at the
 * cost-plus figure: the main product already took the fish cost, so cost-plus
 * on the remainder would leave money on the table (Decisions §7). No market
 * price set means no price to quote, and the builder says which products that
 * left off.
 */
function quoteItemsFor(row: Row, domestic: boolean): QuoteItem[] {
  if (!row.result.ok) return [];
  const { sku, destination } = row;
  const absorbed = sku.raw_material_basis === 'absorbed';
  const glazed = sku.glaze_pct > 0;
  const glazeLabel = `${(sku.glaze_pct * 100).toFixed(sku.glaze_pct * 100 < 10 ? 1 : 0)}% glaze`;
  const key = (state: string) => `${sku.id}-${destination?.id ?? 'none'}-${state}`;

  if (domestic) {
    const out = row.result.value.result as DomesticOutput;
    const state = glazed ? out.glazed : out.unglazed;
    return [
      {
        id: key('domestic'),
        product: sku.name,
        presentation: glazed ? `As packed — ${glazeLabel}` : 'Per kg',
        destination: null,
        price: absorbed ? sku.market_price_lkr : state.sellingPrice,
        freightPerKg: null,
      },
    ];
  }

  const out = row.result.value.result as ExportOutput;
  const port = destination?.name ?? null;
  const items: QuoteItem[] = [];

  if (sku.product_form !== 'fresh') {
    const state = glazed ? out.frozenGlazed : out.frozenPlain;
    items.push({
      id: key('frozen'),
      product: sku.name,
      presentation: glazed ? `Frozen — as packed, ${glazeLabel}` : 'Frozen',
      destination: port,
      price: absorbed ? sku.market_price_usd : state.sellingPrice,
      freightPerKg: state.freightPerKg,
    });
  }
  if (sku.product_form !== 'frozen') {
    items.push({
      id: key('fresh'),
      product: sku.name,
      presentation: 'Fresh (air)',
      destination: port,
      price: absorbed ? sku.market_price_usd : out.fresh.sellingPrice,
      freightPerKg: out.fresh.freightPerKg,
    });
  }
  return items;
}

/**
 * Gross margin at the price beside it.
 *
 * Only the answers worth acting on are coloured: below cost, and thin enough to
 * be worth a second look. A healthy margin stays in body text — this is a grid
 * of thirty-odd rows, and colouring the normal case turns the exceptions into
 * noise.
 *
 * An absorbed by-product has no margin to show: the main product already took
 * the fish cost, so its price comes off the market and the number that matters
 * is contribution, in the column to the left.
 */
function Margin({ value, absorbed }: { value: number | null; absorbed: boolean }) {
  if (absorbed) return <NotSold why="By-product — priced on contribution, not on a margin" />;
  if (value == null) return <NotSold why="No selling price to take a margin on" />;
  return (
    <span className={cn(value < 0 && 'font-medium text-destructive', value >= 0 && value < 0.15 && 'text-warning')}>
      {(value * 100).toFixed(1)}%
    </span>
  );
}

function Contribution({ value, fmt }: { value: number | null; fmt: (n: number) => string }) {
  if (value == null) {
    return <span className="text-[10px] text-muted-foreground">set price</span>;
  }
  return <span className={value >= 0 ? 'text-success' : 'text-destructive'}>{fmt(value)}</span>;
}

function ByProductBadge() {
  return (
    <span
      className="ml-1.5 rounded bg-muted px-1 py-px text-[9px] font-normal uppercase tracking-wide text-muted-foreground"
      title="By-product: the main product already absorbed the fish cost, so this carries downstream costs only and is priced on contribution."
    >
      by-product
    </span>
  );
}

function Legend() {
  return (
    <div className="flex flex-wrap gap-x-5 gap-y-1 px-1 text-[11px] text-muted-foreground">
      <span>
        <strong className="font-medium text-foreground">FINAL</strong> = ex-factory + freight, before margin
      </span>
      <span>
        <strong className="font-medium text-foreground">By-product</strong> rows carry no fish cost and show
        contribution against your market price, not a rack rate
      </span>
      <span>
        <strong className="font-medium text-foreground">Glaze</strong> dilutes fish cost only
      </span>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Save dialog
// ---------------------------------------------------------------------------

/**
 * Name the snapshot and choose what goes into it.
 *
 * The grid's own filters decide which SKUs are on offer here; the checklist
 * then narrows that to what the costing is actually for, so a quote for three
 * items is not saved as a snapshot of all thirty. Everything costable starts
 * ticked — saving the lot was the old behaviour and stays one click away.
 */
/** One half of the shared/private pair in the save dialog. */
function VisibilityChoice({
  active,
  onClick,
  icon,
  label,
  hint,
}: {
  active: boolean;
  onClick: () => void;
  icon: React.ReactNode;
  label: string;
  hint: string;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      title={hint}
      aria-pressed={active}
      className={cn(
        'inline-flex items-center gap-1.5 rounded-md border px-2.5 py-1 text-xs',
        active ? 'border-primary bg-primary/10 text-primary' : 'text-muted-foreground hover:bg-muted'
      )}
    >
      {icon}
      {label}
    </button>
  );
}

function SaveDialog({
  skus,
  brokenSkuIds,
  authors,
  version,
  canViewBaseCost,
  onCancel,
  onSave,
  busy,
}: {
  skus: CostSkuRow[];
  brokenSkuIds: Set<string>;
  authors: Record<string, string>;
  version: CostAssumptionVersion;
  canViewBaseCost: boolean;
  onCancel: () => void;
  onSave: (
    name: string,
    skuIds: string[],
    overrides: Partial<Record<OverridableField, number>>,
    visibility: CostVisibility
  ) => void;
  busy: boolean;
}) {
  const [name, setName] = useState('');
  const [query, setQuery] = useState('');
  // Public by default: the shared list is the norm, and a draft is opted out of
  // it rather than every finished costing having to be opted in.
  const [visibility, setVisibility] = useState<CostVisibility>('public');
  // Raw strings, not numbers: '' has to keep meaning "follow the company
  // value", and a half-typed '0.' is not a number yet.
  const [overrides, setOverrides] = useState<Partial<Record<OverridableField, string>>>({});
  const [showOverrides, setShowOverrides] = useState(false);

  // You can only deviate from a number you are allowed to read: the field's
  // placeholder is the company value, and the base-cost ones are restricted.
  const overridable = useMemo(
    () => (canViewBaseCost ? OVERRIDABLE : OVERRIDABLE.filter((f) => !isBaseCostField(f))),
    [canViewBaseCost]
  );

  const overrideCount = overridable.filter((f) => {
    const raw = overrides[f]?.trim();
    return raw !== undefined && raw !== '' && Number(raw) !== (version[f] as number);
  }).length;

  /** Blank and unchanged fields are dropped; the server re-checks all of this. */
  const numericOverrides = (): Partial<Record<OverridableField, number>> => {
    const out: Partial<Record<OverridableField, number>> = {};
    for (const f of overridable) {
      const raw = overrides[f]?.trim();
      if (!raw) continue;
      const n = Number(raw);
      if (Number.isFinite(n)) out[f] = n;
    }
    return out;
  };
  // A SKU with a broken split cannot be costed, so the save would drop it
  // anyway. Leaving it unticked and labelled says that up front rather than
  // reporting it afterwards.
  const costable = useMemo(() => skus.filter((s) => !brokenSkuIds.has(s.id)), [skus, brokenSkuIds]);
  const [selected, setSelected] = useState<Set<string>>(() => new Set(costable.map((s) => s.id)));

  const listed = useMemo(() => {
    const q = query.trim().toLowerCase();
    if (!q) return skus;
    return skus.filter(
      (s) =>
        s.name.toLowerCase().includes(q) ||
        s.category.toLowerCase().includes(q) ||
        (s.customer ?? '').toLowerCase().includes(q) ||
        authorOf(s, authors).toLowerCase().includes(q)
    );
  }, [skus, query, authors]);

  const toggle = (id: string) =>
    setSelected((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });

  // All/None act on what the search is showing, so they stay predictable when
  // the list is filtered: neither silently reaches past what you can see.
  const setAllListed = (on: boolean) =>
    setSelected((prev) => {
      const next = new Set(prev);
      for (const s of listed) {
        if (brokenSkuIds.has(s.id)) continue;
        if (on) next.add(s.id);
        else next.delete(s.id);
      }
      return next;
    });

  const canSave = !!name.trim() && selected.size > 0 && !busy;
  const submit = () => {
    if (canSave) onSave(name.trim(), [...selected], numericOverrides(), visibility);
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4" onClick={onCancel}>
      <div
        className="flex max-h-[85vh] w-full max-w-lg flex-col rounded-lg border bg-card p-5 shadow-lg"
        onClick={(e) => e.stopPropagation()}
      >
        <h2 className="text-lg font-semibold">Save as costing</h2>
        <p className="mt-1 text-sm text-muted-foreground">
          Snapshots these numbers and pins the assumptions they were built on, so reopening it later
          shows what you actually quoted.
        </p>
        <input
          autoFocus
          value={name}
          onChange={(e) => setName(e.target.value)}
          placeholder="e.g. Dubai frozen — October"
          className="mt-3 w-full rounded-md border px-3 py-2 text-sm"
          onKeyDown={(e) => e.key === 'Enter' && submit()}
        />

        <div className="mt-2 flex items-center gap-1">
          <VisibilityChoice
            active={visibility === 'public'}
            onClick={() => setVisibility('public')}
            icon={<Globe className="h-3.5 w-3.5" />}
            label="Shared"
            hint="Everyone who can read costings sees it"
          />
          <VisibilityChoice
            active={visibility === 'private'}
            onClick={() => setVisibility('private')}
            icon={<Lock className="h-3.5 w-3.5" />}
            label="Private"
            hint="Only you — you can share it later from Saved costings"
          />
        </div>

        <div className="mt-4 flex min-h-0 flex-col">
          <div className="mb-1.5 flex items-center justify-between gap-3">
            <span className="text-xs font-medium text-muted-foreground">
              SKUs to include ({selected.size}/{costable.length})
            </span>
            <div className="flex gap-3 text-xs">
              <button type="button" className="text-primary hover:underline" onClick={() => setAllListed(true)}>
                {query.trim() ? 'All shown' : 'All'}
              </button>
              <button
                type="button"
                className="text-muted-foreground hover:text-foreground"
                onClick={() => setAllListed(false)}
              >
                None
              </button>
            </div>
          </div>

          {skus.length > 8 && (
            <input
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              placeholder="Filter by SKU, customer or category…"
              className="mb-1.5 w-full rounded-md border px-3 py-1.5 text-xs"
            />
          )}

          <div className="min-h-0 flex-1 space-y-0.5 overflow-y-auto rounded-md border p-1">
            {listed.length === 0 ? (
              <p className="p-3 text-center text-xs text-muted-foreground">Nothing matches that filter.</p>
            ) : (
              listed.map((s) => {
                const broken = brokenSkuIds.has(s.id);
                return (
                  <label
                    key={s.id}
                    className={cn(
                      'flex items-center gap-2 rounded px-2 py-1.5 text-sm',
                      broken ? 'cursor-not-allowed opacity-60' : 'cursor-pointer hover:bg-muted'
                    )}
                  >
                    <input
                      type="checkbox"
                      checked={selected.has(s.id)}
                      disabled={broken}
                      onChange={() => toggle(s.id)}
                    />
                    <span className="min-w-0 flex-1 truncate">
                      <span className="font-medium">{s.name}</span>
                      {s.customer && <span className="text-muted-foreground"> · {s.customer}</span>}
                    </span>
                    {broken && <span className="shrink-0 text-xs text-destructive">not costed</span>}
                  </label>
                );
              })
            )}
          </div>

          <p className="mt-1.5 text-xs text-muted-foreground">
            Starts from what the grid is showing — change the market, port or search behind this dialog to offer a
            different set.
          </p>
        </div>

        <div className="mt-4 border-t pt-3">
          <button
            type="button"
            onClick={() => setShowOverrides((v) => !v)}
            className="flex w-full items-center justify-between text-left text-xs font-medium"
          >
            <span>
              Override assumptions for this costing
              {overrideCount > 0 && (
                <span className="ml-1.5 rounded-full bg-primary/10 px-1.5 py-0.5 text-[10px] text-primary">
                  {overrideCount} changed
                </span>
              )}
            </span>
            <span className="text-muted-foreground">{showOverrides ? 'Hide' : 'Show'}</span>
          </button>

          {showOverrides && (
            <>
              <p className="mt-1.5 text-[11px] text-muted-foreground">
                Blank follows the company value. Anything you type here applies to THIS costing only — the official
                assumptions are untouched, and the deviation is stamped on the saved costing so a reviewer can see
                what you changed.
              </p>
              <div className="mt-2 grid max-h-56 gap-2 overflow-y-auto rounded-md border p-2 sm:grid-cols-2">
                {overridable.map((f) => {
                  const inherited = version[f] as number;
                  const raw = overrides[f] ?? '';
                  const changed = raw.trim() !== '' && Number(raw) !== inherited;
                  return (
                    <label key={f} className="block">
                      <span className="text-[11px] font-medium">{OVERRIDE_LABEL[f]}</span>
                      <input
                        type="number"
                        step="0.0001"
                        min="0"
                        value={raw}
                        onChange={(e) => setOverrides((p) => ({ ...p, [f]: e.target.value }))}
                        placeholder={
                          PERCENT_FIELDS.has(f)
                            ? `${inherited} (${(inherited * 100).toFixed(0)}%)`
                            : String(inherited)
                        }
                        className={cn(
                          'mt-0.5 w-full rounded-md border px-2 py-1 text-xs',
                          changed && 'border-primary bg-primary/5'
                        )}
                      />
                    </label>
                  );
                })}
              </div>
            </>
          )}
        </div>

        <div className="mt-4 flex justify-end gap-2">
          <button onClick={onCancel} className={btnGhost}>
            Cancel
          </button>
          <button onClick={submit} disabled={!canSave} className={btnPrimary}>
            {busy ? 'Saving…' : `Save ${selected.size} SKU${selected.size === 1 ? '' : 's'}`}
          </button>
        </div>
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// CSV — the internal sheet, all intermediates, matching v11 (Decisions §10)
// ---------------------------------------------------------------------------

function csvMatrix(
  rows: Row[],
  domestic: boolean,
  showDestination: boolean,
  authors: Record<string, string>
): (string | number | null)[][] {
  const head = [
    'SKU',
    'Customer',
    'Costed by',
    ...(showDestination ? ['Port'] : []),
    'Category',
    'Basis',
    'Yield %',
    'Whole fish',
    'Fish comp',
    'Marinade comp',
    'Raw material',
    'Process',
    'Packing',
    'Cold-hold',
    'Ex-factory',
    'Freight',
    'FINAL',
    ...(domestic
      ? [
          'Rack rate',
          'Margin %',
          'Whole-round margin %',
          'FINAL glazed',
          'Rack glazed',
          'Glazed margin %',
          'Glazed whole-round margin %',
          'Contribution',
        ]
      : [
          'FOB',
          'Margin %',
          'Whole-round margin %',
          'CIF',
          'Importer',
          'Dist->T3',
          'Glazed FINAL',
          'Glazed FOB',
          'Glazed margin %',
          'Glazed whole-round margin %',
          'Glazed CIF',
          'Glazed Dist->T3',
          'Fresh FOB',
          'Fresh margin %',
          'Fresh whole-round margin %',
          'Fresh CIF',
          'Fresh Dist->T3',
          'Contribution',
        ]),
  ];

  const body = rows.map((r) => {
    const base: (string | number | null)[] = [
      r.sku.name,
      r.sku.customer ?? '',
      authorOf(r.sku, authors),
      ...(showDestination ? [r.destination?.name ?? ''] : []),
      r.sku.category,
      r.sku.raw_material_basis === 'absorbed' ? 'by-product (absorbed)' : 'full fish',
    ];
    if (!r.result.ok) {
      return [...base, r.result.issues.map((i) => i.message).join('; ')];
    }
    const { chain } = r.result.value.result;
    const nums: (string | number | null)[] = [
      round(chain.yieldUsed * 100),
      round(chain.wholeFish),
      round(chain.fishComponent),
      round(chain.marinadeComponent),
      round(chain.rawMaterial),
      round(chain.process),
      round(chain.packing),
      round(chain.coldHold),
      round(chain.exFactory),
      round(chain.freight),
    ];
    if (domestic) {
      const o = r.result.value.result as DomesticOutput;
      return [
        ...base,
        ...nums,
        round(o.unglazed.finalCost),
        round(o.unglazed.sellingPrice),
        pct(o.unglazed.marginPct),
        pct(o.unglazed.wholeRoundMarginPct),
        round(o.glazed.finalCost),
        round(o.glazed.sellingPrice),
        pct(o.glazed.marginPct),
        pct(o.glazed.wholeRoundMarginPct),
        round(o.unglazed.contributionPerKg),
      ];
    }
    const o = r.result.value.result as ExportOutput;
    return [
      ...base,
      ...nums,
      round(o.frozenPlain.finalCost),
      round(o.frozenPlain.sellingPrice),
      pct(o.frozenPlain.marginPct),
      pct(o.frozenPlain.wholeRoundMarginPct),
      round(o.frozenPlain.cif),
      round(o.frozenPlain.importerPrice),
      round(o.frozenPlain.distributorT3),
      round(o.frozenGlazed.finalCost),
      round(o.frozenGlazed.sellingPrice),
      pct(o.frozenGlazed.marginPct),
      pct(o.frozenGlazed.wholeRoundMarginPct),
      round(o.frozenGlazed.cif),
      round(o.frozenGlazed.distributorT3),
      round(o.fresh.sellingPrice),
      pct(o.fresh.marginPct),
      pct(o.fresh.wholeRoundMarginPct),
      round(o.fresh.cif),
      round(o.fresh.distributorT3),
      round(o.frozenPlain.contributionPerKg),
    ];
  });

  return [head, ...body];
}

const round = (n: number | null): number | null => (n == null ? null : Math.round(n * 10000) / 10000);
/** A fraction as whole percent, to one place — the header says "%", so the cell doesn't. */
const pct = (n: number | null): number | null => (n == null ? null : Math.round(n * 1000) / 10);

// ---------------------------------------------------------------------------

/** LKR reads better without decimals at these magnitudes; USD needs cents. */
const lkr = (n: number): string => Math.round(n).toLocaleString();
const usd = (n: number): string => n.toFixed(2);

// Header cells carry the sticky position and an OPAQUE background themselves:
// sticking <thead> doesn't work, and a tint on the <tr> lets rows show through as
// they scroll under it. The frozen SKU column's header overrides to z-30 so it wins
// over both the sticky row and the sticky column. See components/output-grid.tsx.
const thBase =
  'sticky top-0 z-20 whitespace-nowrap border-b border-border bg-muted px-2 py-2 font-medium';
const tdBase = 'whitespace-nowrap px-2 py-1.5';
const selectCls = 'rounded-md border bg-background px-2 py-1 text-xs';
const btnGhost =
  'inline-flex items-center gap-1.5 rounded-md border px-2.5 py-1.5 text-xs font-medium hover:bg-muted';
const btnPrimary =
  'inline-flex items-center gap-1.5 rounded-md bg-primary px-2.5 py-1.5 text-xs font-medium text-primary-foreground disabled:opacity-50';
