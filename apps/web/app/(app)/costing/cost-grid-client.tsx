'use client';

import { useMemo, useState, useTransition } from 'react';
import { useRouter } from 'next/navigation';
import { Download, Save, AlertTriangle } from 'lucide-react';
import { computeCost, type CostResult, type DomesticOutput, type ExportOutput } from '@oceanpick/engine';
import type {
  CostAssumptionVersion,
  CostDestinationRow,
  CostMarket,
  CostProductForm,
  CostOdcComponentRow,
  CostSizeBucket,
  CostSkuRow,
} from '@oceanpick/shared';
import { toAssumptions, toBucket, toDestination, toSku } from '@/lib/costing-adapt';
import { toCsv, downloadCsv } from '@/lib/csv';
import { ScrollX } from '@/components/ui/scroll-x';
import { cn } from '@/lib/utils';
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
  isAdmin,
}: {
  version: CostAssumptionVersion;
  odc: CostOdcComponentRow[];
  buckets: CostSizeBucket[];
  destinations: CostDestinationRow[];
  rates: RateMap;
  skus: CostSkuRow[];
  yields: YieldMap;
  authors: Record<string, string>;
  isAdmin: boolean;
}) {
  const router = useRouter();
  const [market, setMarket] = useState<CostMarket>('domestic');
  const [bucketId, setBucketId] = useState<string>(''); // '' = flat reference model
  const [selectedDests, setSelectedDests] = useState<string[]>(() =>
    destinations.length ? [destinations[0]!.id] : []
  );
  const [showInactive, setShowInactive] = useState(false);
  const [query, setQuery] = useState('');
  const [saving, setSaving] = useState(false);
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
  }, [skus, showInactive, query, market, authors]);

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

  function onExport() {
    downloadCsv(
      `costing-${market}-${new Date().toISOString().slice(0, 10)}.csv`,
      toCsv(csvMatrix(rows, domestic, activeDests.length > 1, authors))
    );
  }

  function onSave(name: string) {
    startTransition(async () => {
      const res = await saveCosting({
        name,
        market,
        versionId: version.id,
        bucketId: bucketId || null,
        destinationIds: domestic ? [] : selectedDests,
        skuIds: visibleSkus.map((s) => s.id),
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
      />

      <Legend />

      {saving && <SaveDialog onCancel={() => setSaving(false)} onSave={onSave} busy={isPending} />}
    </div>
  );
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
}: {
  rows: Row[];
  domestic: boolean;
  showDestination: boolean;
  authors: Record<string, string>;
}) {
  if (rows.length === 0) {
    return (
      <div className="rounded-lg border bg-card p-8 text-center text-sm text-muted-foreground">
        No SKUs match.
      </div>
    );
  }

  return (
    <ScrollX className="rounded-lg border bg-card">
      <table className="w-full border-collapse text-right text-xs tabular-nums">
        <thead>
          <tr className="border-b bg-muted/40 text-[10px] uppercase tracking-wide text-muted-foreground">
            <th className={cn(thBase, 'sticky left-0 z-10 bg-muted/40 text-left')}>SKU</th>
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
            {domestic ? (
              <>
                <th className={thBase}>Rack rate</th>
                <th className={cn(thBase, 'border-l')}>FINAL glazed</th>
                <th className={thBase}>Rack glazed</th>
              </>
            ) : (
              <>
                <th className={thBase}>FOB</th>
                <th className={thBase}>CIF</th>
                <th className={thBase}>Dist→T3</th>
                <th className={cn(thBase, 'border-l')}>Glazed FOB</th>
                <th className={thBase}>Glazed CIF</th>
                <th className={cn(thBase, 'border-l')}>Fresh FOB</th>
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
}: {
  row: Row;
  domestic: boolean;
  showDestination: boolean;
  authors: Record<string, string>;
}) {
  const { sku, destination, result } = row;
  const absorbed = sku.raw_material_basis === 'absorbed';
  const inactive = sku.status === 'inactive';
  const span = domestic ? 15 : 20;
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
      {sku.name}
      {absorbed && <ByProductBadge />}
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
      <td className={tdBase}>{freshOnly ? <NotSold why={FROZEN} /> : usd(out.frozenPlain.cif)}</td>
      <td className={tdBase}>{freshOnly ? <NotSold why={FROZEN} /> : usd(out.frozenPlain.distributorT3)}</td>

      <td className={cn(tdBase, 'border-l')}>
        {freshOnly ? <NotSold why="Fresh product carries no glaze" /> : usd(out.frozenGlazed.sellingPrice)}
      </td>
      <td className={tdBase}>
        {freshOnly ? <NotSold why="Fresh product carries no glaze" /> : usd(out.frozenGlazed.cif)}
      </td>

      <td className={cn(tdBase, 'border-l')}>{frozenOnly ? <NotSold why={FRESH} /> : usd(out.fresh.sellingPrice)}</td>
      <td className={tdBase}>{frozenOnly ? <NotSold why={FRESH} /> : usd(out.fresh.cif)}</td>
      <td className={tdBase}>{frozenOnly ? <NotSold why={FRESH} /> : usd(out.fresh.distributorT3)}</td>
    </>
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

function SaveDialog({ onCancel, onSave, busy }: { onCancel: () => void; onSave: (name: string) => void; busy: boolean }) {
  const [name, setName] = useState('');
  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4" onClick={onCancel}>
      <div className="w-full max-w-md rounded-lg border bg-card p-5 shadow-lg" onClick={(e) => e.stopPropagation()}>
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
          onKeyDown={(e) => e.key === 'Enter' && name.trim() && onSave(name.trim())}
        />
        <div className="mt-4 flex justify-end gap-2">
          <button onClick={onCancel} className={btnGhost}>
            Cancel
          </button>
          <button onClick={() => onSave(name.trim())} disabled={!name.trim() || busy} className={btnPrimary}>
            {busy ? 'Saving…' : 'Save'}
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
      ? ['Rack rate', 'FINAL glazed', 'Rack glazed', 'Contribution']
      : [
          'FOB',
          'CIF',
          'Importer',
          'Dist->T3',
          'Glazed FINAL',
          'Glazed FOB',
          'Glazed CIF',
          'Glazed Dist->T3',
          'Fresh FOB',
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
        round(o.glazed.finalCost),
        round(o.glazed.sellingPrice),
        round(o.unglazed.contributionPerKg),
      ];
    }
    const o = r.result.value.result as ExportOutput;
    return [
      ...base,
      ...nums,
      round(o.frozenPlain.finalCost),
      round(o.frozenPlain.sellingPrice),
      round(o.frozenPlain.cif),
      round(o.frozenPlain.importerPrice),
      round(o.frozenPlain.distributorT3),
      round(o.frozenGlazed.finalCost),
      round(o.frozenGlazed.sellingPrice),
      round(o.frozenGlazed.cif),
      round(o.frozenGlazed.distributorT3),
      round(o.fresh.sellingPrice),
      round(o.fresh.cif),
      round(o.fresh.distributorT3),
      round(o.frozenPlain.contributionPerKg),
    ];
  });

  return [head, ...body];
}

const round = (n: number | null): number | null => (n == null ? null : Math.round(n * 10000) / 10000);

// ---------------------------------------------------------------------------

/** LKR reads better without decimals at these magnitudes; USD needs cents. */
const lkr = (n: number): string => Math.round(n).toLocaleString();
const usd = (n: number): string => n.toFixed(2);

const thBase = 'whitespace-nowrap px-2 py-2 font-medium';
const tdBase = 'whitespace-nowrap px-2 py-1.5';
const selectCls = 'rounded-md border bg-background px-2 py-1 text-xs';
const btnGhost =
  'inline-flex items-center gap-1.5 rounded-md border px-2.5 py-1.5 text-xs font-medium hover:bg-muted';
const btnPrimary =
  'inline-flex items-center gap-1.5 rounded-md bg-primary px-2.5 py-1.5 text-xs font-medium text-primary-foreground disabled:opacity-50';
