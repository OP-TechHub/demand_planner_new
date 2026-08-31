'use client';

import { useActionState, useEffect, useMemo, useRef, useState, useTransition } from 'react';
import { useRouter } from 'next/navigation';
import { Download, FileText, Lock, Pencil, Plus, Printer } from 'lucide-react';
import { computeCost, type DomesticOutput, type ExportOutput, type WholeFishCost } from '@oceanpick/engine';
import {
  COST_CATEGORIES,
  type CostAssumptionVersion,
  type CostDestinationRow,
  type CostMarketScope,
  type CostOdcComponentRow,
  type CostPricingMode,
  type CostProductForm,
  type CostSizeBucket,
  type CostSkuRow,
} from '@oceanpick/shared';
import { toAssumptions, toBucket } from '@/lib/costing-adapt';
import { cn } from '@/lib/utils';
import { downloadDoc, slugify } from '@/lib/doc-export';
import { COST_SHEET_ID } from '@/components/cost-sheet-parts';
import { ScrollX } from '@/components/ui/scroll-x';
import { SkuCostSheet } from './sku-cost-sheet';
import { archiveCostSku, saveCostSku, saveSkuBucketYield, type SkuFormState } from './actions';

type YieldMap = Record<string, Record<string, number>>;

export function SkusClient({
  skus,
  buckets,
  yields,
  orgId,
  version,
  odc,
  destinations,
  rates,
  currentUserId,
  authors,
  isAdmin,
}: {
  skus: CostSkuRow[];
  buckets: CostSizeBucket[];
  yields: YieldMap;
  orgId: string;
  version: CostAssumptionVersion;
  odc: CostOdcComponentRow[];
  destinations: CostDestinationRow[];
  rates: Record<string, { sea: number; air: number }>;
  currentUserId: string | null;
  authors: Record<string, string>;
  isAdmin: boolean;
}) {
  const [editing, setEditing] = useState<CostSkuRow | null | undefined>(undefined);
  const [query, setQuery] = useState('');
  const [tab, setTab] = useState<'recipe' | 'yields'>('recipe');

  const visible = useMemo(() => {
    const q = query.trim().toLowerCase();
    return q ? skus.filter((s) => s.name.toLowerCase().includes(q) || s.category.toLowerCase().includes(q)) : skus;
  }, [skus, query]);

  /**
   * You own what you make. Admins may edit any recipe; everyone else may edit
   * the ones they created. Mirrors the DB policy exactly, so the UI never
   * offers an edit the database will reject.
   */
  const canEdit = (s: CostSkuRow) => isAdmin || (currentUserId != null && s.created_by === currentUserId);

  // The offered category vocabulary: the known set, plus anything already in
  // use, so a value already on a row is never silently dropped by the dropdown.
  const categories = useMemo(
    () => [...new Set([...COST_CATEGORIES, ...skus.map((s) => s.category).filter(Boolean)])],
    [skus]
  );

  /**
   * Where a recipe came from. A null creator means it arrived with the seed —
   * a shared company recipe from the workbook, not one person's addition.
   */
  const sourceOf = (s: CostSkuRow): string =>
    s.created_by == null
      ? 'Company'
      : s.created_by === currentUserId
        ? 'You'
        : (authors[s.created_by] ?? 'Someone else');

  return (
    <div className="space-y-4">
      <header className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h1 className="text-2xl font-semibold tracking-tight">Costing SKUs</h1>
          <p className="mt-0.5 text-sm text-muted-foreground">
            One list serving both markets. Processing, packing and marinade are entered in USD
            everywhere — domestic converts them at the FX rate.
          </p>
        </div>
        <button onClick={() => setEditing(null)} className="inline-flex items-center gap-1.5 rounded-md bg-primary px-3 py-1.5 text-sm font-medium text-primary-foreground">
          <Plus className="h-3.5 w-3.5" /> New SKU
        </button>
      </header>

      {!isAdmin && (
        <p className="rounded-md bg-muted/50 px-3 py-2 text-xs text-muted-foreground">
          <Lock className="mr-1.5 inline h-3.5 w-3.5" />
          Add any SKU you need and edit the ones you added. The shared recipes below are maintained
          by an admin, so nobody&apos;s costings shift underneath them.
        </p>
      )}

      <div className="flex flex-wrap items-center gap-3">
        <div className="inline-flex rounded-md border p-0.5">
          {(['recipe', 'yields'] as const).map((t) => (
            <button
              key={t}
              onClick={() => setTab(t)}
              className={cn(
                'rounded px-3 py-1 text-sm font-medium capitalize',
                tab === t ? 'bg-primary text-primary-foreground' : 'text-muted-foreground hover:text-foreground'
              )}
            >
              {t === 'recipe' ? 'Recipe' : 'Yield by size'}
            </button>
          ))}
        </div>
        <input type="search" value={query} onChange={(e) => setQuery(e.target.value)} placeholder="Find a SKU…" className={cn(inputCls, 'w-48')} />
        <span className="text-xs text-muted-foreground">{visible.length} of {skus.length}</span>
      </div>

      {tab === 'recipe' ? (
        <RecipeTable skus={visible} canEdit={canEdit} sourceOf={sourceOf} onEdit={setEditing} />
      ) : (
        <YieldTable skus={visible} buckets={buckets} yields={yields} canEdit={canEdit} />
      )}

      {editing !== undefined && (
        <SkuDialog
          sku={editing}
          orgId={orgId}
          buckets={buckets}
          yields={yields}
          version={version}
          odc={odc}
          destinations={destinations}
          rates={rates}
          allSkus={skus}
          categories={categories}
          onClose={() => setEditing(undefined)}
        />
      )}
    </div>
  );
}

// ---------------------------------------------------------------------------

function RecipeTable({
  skus,
  canEdit,
  sourceOf,
  onEdit,
}: {
  skus: CostSkuRow[];
  canEdit: (s: CostSkuRow) => boolean;
  sourceOf: (s: CostSkuRow) => string;
  onEdit: (s: CostSkuRow) => void;
}) {
  return (
    <ScrollX className="rounded-lg border bg-card">
      <table className="w-full border-collapse text-right text-xs tabular-nums">
        <thead>
          <tr className="border-b bg-muted/40 text-[10px] uppercase tracking-wide text-muted-foreground">
            <th className={cn(th, 'sticky left-0 z-10 bg-muted/40 text-left')}>SKU</th>
            <th className={cn(th, 'text-left')}>Added by</th>
            <th className={cn(th, 'text-left')}>Category</th>
            <th className={cn(th, 'text-left')}>Raw material</th>
            <th className={th}>Yield</th>
            <th className={th}>Glaze</th>
            <th className={th}>% fish</th>
            <th className={th}>% marinade</th>
            <th className={th}>Marinade $</th>
            <th className={th}>Process $</th>
            <th className={th}>Packing $</th>
            <th className={cn(th, 'text-left')}>Pack</th>
            <th className={th}>Market LKR</th>
            <th className={th}>Market USD</th>
            <th className={th} />
          </tr>
        </thead>
        <tbody>
          {skus.map((s) => {
            const absorbed = s.raw_material_basis === 'absorbed';
            const overridden = hasOverride(s);
            return (
              <tr key={s.id} className={cn('border-b last:border-0 hover:bg-muted/30', s.status === 'inactive' && 'text-muted-foreground')}>
                <th className={cn(td, 'sticky left-0 z-10 max-w-[240px] truncate bg-card text-left font-medium')} title={s.name}>
                  {s.name}
                  {s.status === 'inactive' && <span className="ml-1.5 text-[10px] font-normal">(inactive)</span>}
                  {overridden && (
                    <span className="ml-1.5 rounded bg-primary/10 px-1 py-px text-[9px] font-normal uppercase text-primary" title="This SKU overrides a global margin or adder">
                      override
                    </span>
                  )}
                </th>
                <td className={cn(td, 'text-left')}>
                  {s.created_by == null ? (
                    <span className="text-muted-foreground">Company</span>
                  ) : (
                    <span className={cn(s.created_by && 'rounded bg-muted px-1.5 py-px')}>{sourceOf(s)}</span>
                  )}
                </td>
                <td className={cn(td, 'text-left')}>{s.category}</td>
                <td className={cn(td, 'text-left')}>
                  {absorbed ? (
                    <span className="text-muted-foreground" title="The main product already absorbed the fish cost. Costed on downstream costs only, priced on contribution.">
                      absorbed (by-product)
                    </span>
                  ) : (
                    'full fish'
                  )}
                </td>
                <td className={td}>{pct(s.base_yield)}</td>
                <td className={td}>{s.glaze_pct ? pct(s.glaze_pct) : '—'}</td>
                <td className={td}>{pct(s.pct_fish)}</td>
                <td className={td}>{s.pct_marinade ? pct(s.pct_marinade) : '—'}</td>
                <td className={td}>{s.marinade_usd_per_kg ? s.marinade_usd_per_kg.toFixed(2) : '—'}</td>
                <td className={td}>{s.process_usd_per_kg.toFixed(2)}</td>
                <td className={td}>{s.packing_usd_per_kg.toFixed(2)}</td>
                <td className={cn(td, 'text-left')}>{s.pack_size ?? '—'}</td>
                <td className={cn(td, absorbed && !s.market_price_lkr && 'text-destructive')}>
                  {s.market_price_lkr != null ? Math.round(s.market_price_lkr).toLocaleString() : absorbed ? 'set' : '—'}
                </td>
                <td className={cn(td, absorbed && !s.market_price_usd && 'text-destructive')}>
                  {s.market_price_usd != null ? s.market_price_usd.toFixed(2) : absorbed ? 'set' : '—'}
                </td>
                <td className={td}>
                  {canEdit(s) && (
                    <button onClick={() => onEdit(s)} className="rounded p-1 hover:bg-muted" aria-label={`Edit ${s.name}`}>
                      <Pencil className="h-3.5 w-3.5" />
                    </button>
                  )}
                </td>
              </tr>
            );
          })}
        </tbody>
      </table>
    </ScrollX>
  );
}

/**
 * Yield per SKU per size grade. Every cell starts at the SKU's flat yield, so a
 * row of identical numbers means "the farm hasn't supplied this one yet" rather
 * than "size doesn't matter here".
 */
function YieldTable({
  skus,
  buckets,
  yields,
  canEdit,
}: {
  skus: CostSkuRow[];
  buckets: CostSizeBucket[];
  yields: YieldMap;
  canEdit: (s: CostSkuRow) => boolean;
}) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();

  function save(skuId: string, bucketId: string, value: number) {
    startTransition(async () => {
      const res = await saveSkuBucketYield(skuId, bucketId, value);
      if (res.error) alert(res.error);
      router.refresh();
    });
  }

  return (
    <>
      <p className="rounded-md bg-muted/50 px-3 py-2 text-xs text-muted-foreground">
        Enter the yield at each grade&apos;s median weight. Until these differ from the flat yield,
        selecting a size grade in the grid changes FCR and ODC but not yield.
      </p>
      <ScrollX className="rounded-lg border bg-card">
        <table className="w-full border-collapse text-right text-xs tabular-nums">
          <thead>
            <tr className="border-b bg-muted/40 text-[10px] uppercase tracking-wide text-muted-foreground">
              <th className={cn(th, 'sticky left-0 z-10 bg-muted/40 text-left')}>SKU</th>
              <th className={th}>Flat</th>
              {buckets.map((b) => (
                <th key={b.id} className={th}>
                  {b.label}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {skus.map((s) => (
              <tr key={s.id} className="border-b last:border-0 hover:bg-muted/30">
                <th className={cn(td, 'sticky left-0 z-10 max-w-[240px] truncate bg-card text-left font-medium')} title={s.name}>
                  {s.name}
                </th>
                <td className={cn(td, 'text-muted-foreground')}>{pct(s.base_yield)}</td>
                {buckets.map((b) => {
                  const v = yields[s.id]?.[b.id] ?? s.base_yield;
                  const isPlaceholder = Math.abs(v - s.base_yield) < 1e-9;
                  return (
                    <td key={b.id} className={td}>
                      <input
                        type="number" step="0.01" min="0.01" max="1" defaultValue={v}
                        disabled={!canEdit(s) || pending}
                        onBlur={(e) => {
                          const next = Number(e.target.value);
                          if (Number.isFinite(next) && Math.abs(next - v) > 1e-9) save(s.id, b.id, next);
                        }}
                        className={cn(inputCls, 'w-16 text-right', isPlaceholder && 'text-muted-foreground')}
                      />
                    </td>
                  );
                })}
              </tr>
            ))}
          </tbody>
        </table>
      </ScrollX>
    </>
  );
}

// ---------------------------------------------------------------------------
// Live preview: cost and price the SKU on screen, before it is saved
// ---------------------------------------------------------------------------

interface PreviewResult {
  issues: string[];
  domestic: DomesticOutput | null;
  export: ExportOutput | null;
  pricingMode: CostPricingMode;
  /** 0 means the glazed rows would duplicate the plain ones, so they're dropped. */
  glazePct: number;
  /** In target mode, whether a target was actually entered for that market. */
  hasTargetDomestic: boolean;
  hasTargetExport: boolean;
  /** The size grade costed at, or null for the flat reference model. */
  gradeLabel: string | null;
  /**
   * The rest is not used by the on-screen preview at all — it is what the
   * downloadable sheet needs to show the ex-farm build-up and identify the SKU.
   * Kept on the preview so the document and the panel can never be costed from
   * two different snapshots of the form.
   */
  domesticWholeFish: WholeFishCost | null;
  exportWholeFish: WholeFishCost | null;
  skuName: string;
  category: string;
  customer: string;
  absorbed: boolean;
  productForm: CostProductForm;
  pctFish: number;
  pctMarinade: number;
}

/**
 * Build an engine SKU from the form and cost it, for whichever markets this SKU
 * is scoped to.
 *
 * Reuses the same `computeCost` the grid and the saved costings use, so a
 * number previewed here is the number that gets stored — there is no second
 * implementation of the maths to drift.
 */
function previewFromForm(
  fd: FormData,
  version: CostAssumptionVersion,
  odc: CostOdcComponentRow[],
  destinations: CostDestinationRow[],
  rates: Record<string, { sea: number; air: number }>,
  /** Null costs on the flat reference model, as this dialog always used to. */
  bucketRow?: CostSizeBucket | null,
  bucketYields?: Record<string, number>
): PreviewResult {
  const num = (k: string) => {
    const n = Number(String(fd.get(k) ?? '').trim());
    return Number.isFinite(n) ? n : 0;
  };
  const optional = (k: string) => {
    const s = String(fd.get(k) ?? '').trim();
    if (s === '') return undefined;
    const n = Number(s);
    return Number.isFinite(n) ? n : undefined;
  };

  const marketScope = String(fd.get('market_scope') ?? 'both') as CostMarketScope;
  const pricingMode = String(fd.get('pricing_mode') ?? 'margin') as CostPricingMode;
  const assumptions = toAssumptions(version, odc);

  const base = {
    id: 'preview',
    name: String(fd.get('name') ?? 'This SKU'),
    status: 'active' as const,
    category: String(fd.get('category') ?? ''),
    glazePct: num('glaze_pct'),
    baseYield: num('base_yield'),
    pctFish: num('pct_fish'),
    pctMarinade: num('pct_marinade'),
    marinadeUsdPerKg: num('marinade_usd_per_kg'),
    processUsdPerKg: num('process_usd_per_kg'),
    packingUsdPerKg: num('packing_usd_per_kg'),
    packSize: null,
    rawMaterialBasis: String(fd.get('raw_material_basis') ?? 'full_fish') as 'full_fish' | 'absorbed',
    bucketYields,
    pricingMode,
    overrides: {
      rackMarginPct: optional('override_rack_margin_pct'),
      fobMarginPct: optional('override_fob_margin_pct'),
      transportLkr: optional('override_transport_lkr'),
      coldHoldLkr: optional('override_cold_hold_lkr'),
      freightToPortUsd: optional('override_freight_to_port_usd'),
      coldChainUsd: optional('override_cold_chain_usd'),
      importerClearingPct: optional('override_importer_clearing_pct'),
      importerMarkupPct: optional('override_importer_markup_pct'),
      distributorMarkupPct: optional('override_distributor_markup_pct'),
    },
  };

  const bucket = bucketRow ? toBucket(bucketRow) : null;

  const issues: string[] = [];
  let domesticOut: DomesticOutput | null = null;
  let exportOut: ExportOutput | null = null;
  let domesticWholeFish: WholeFishCost | null = null;
  let exportWholeFish: WholeFishCost | null = null;
  let hasTargetDomestic = false;
  let hasTargetExport = false;

  if (marketScope === 'domestic' || marketScope === 'both') {
    const price = optional('market_price_lkr') ?? null;
    hasTargetDomestic = price != null && price > 0;
    const res = computeCost({
      market: 'domestic',
      assumptions,
      sku: { ...base, marketPrice: price, targetPrice: price },
      bucket,
    });
    if (res.ok) {
      domesticOut = res.value.result as DomesticOutput;
      domesticWholeFish = res.value.wholeFish;
    } else issues.push(...res.issues.map((i) => i.message));
  }

  if (marketScope === 'export' || marketScope === 'both') {
    // Any port will do. The preview stops at FOB, and everything up to FOB is
    // generic — the port only starts to matter at CIF, which isn't shown here.
    // So the first destination is a stand-in, not a choice, and naming it in the
    // UI would imply these figures are specific to it.
    const dest = destinations[0];
    if (!dest) {
      issues.push('No destination is set up, so export freight can’t be priced.');
    } else {
      const price = optional('market_price_usd') ?? null;
      hasTargetExport = price != null && price > 0;
      const rate = rates[dest.id] ?? { sea: 0, air: 0 };
      const res = computeCost({
        market: 'export',
        assumptions,
        sku: { ...base, marketPrice: price, targetPrice: price },
        bucket,
        destination: { id: dest.id, name: dest.name, seaRatePer20ft: rate.sea, airRatePerLot: rate.air },
      });
      if (res.ok) {
        exportOut = res.value.result as ExportOutput;
        exportWholeFish = res.value.wholeFish;
      } else issues.push(...res.issues.map((i) => i.message));
    }
  }

  return {
    issues: [...new Set(issues)],
    domestic: domesticOut,
    export: exportOut,
    pricingMode,
    glazePct: base.glazePct,
    hasTargetDomestic,
    hasTargetExport,
    domesticWholeFish,
    exportWholeFish,
    skuName: base.name,
    category: base.category,
    customer: String(fd.get('customer') ?? ''),
    absorbed: base.rawMaterialBasis === 'absorbed',
    productForm: String(fd.get('product_form') ?? 'both') as CostProductForm,
    gradeLabel: bucketRow?.label ?? null,
    pctFish: base.pctFish,
    pctMarinade: base.pctMarinade,
  };
}

function MarginBadge({ pct }: { pct: number | null }) {
  if (pct == null) return <span className="text-muted-foreground">—</span>;
  // Below cost is the answer worth seeing, so it is coloured, not hidden.
  const tone = pct < 0 ? 'text-destructive' : pct < 0.15 ? 'text-warning' : 'text-success';
  return <span className={cn('font-medium', tone)}>{(pct * 100).toFixed(1)}%</span>;
}

function PreviewPanel({
  preview,
  form,
  onPriceChange,
  onPrint,
  onWord,
}: {
  preview: PreviewResult;
  form: CostProductForm;
  /** Try a price: writes it into the form and recosts through the engine. */
  onPriceChange: (market: 'domestic' | 'export', value: string) => void;
  onPrint: () => void;
  onWord: () => void;
}) {
  const target = preview.pricingMode === 'target';
  // Glaze only earns a row of its own once it actually changes the cost.
  const glazed = preview.glazePct > 0;
  return (
    <div className="space-y-3 rounded-md border border-primary/30 bg-primary/5 p-3">
      <div className="flex flex-wrap items-start justify-between gap-2">
        <h3 className="text-xs font-semibold">
          Costing preview
          <span className="ml-1.5 font-normal text-muted-foreground">
            priced on {target ? 'your target' : 'the standard margin'} · not saved yet
          </span>
        </h3>
        {/*
          The document is only offered once there is something costed to put in
          it — downloading a breakdown of a recipe that has not been calculated
          would produce an empty or stale sheet.
        */}
        <div className="flex shrink-0 gap-1.5">
          <button
            type="button"
            onClick={onPrint}
            className="inline-flex items-center gap-1 rounded-md border bg-card px-2 py-1 text-[11px] font-medium hover:bg-muted"
          >
            <Printer className="h-3 w-3" /> Print / PDF
          </button>
          <button
            type="button"
            onClick={onWord}
            className="inline-flex items-center gap-1 rounded-md border bg-card px-2 py-1 text-[11px] font-medium hover:bg-muted"
          >
            <FileText className="h-3 w-3" /> Word
          </button>
        </div>
      </div>

      <p className="text-[11px] text-muted-foreground">
        Type over <strong className="font-medium text-foreground">Your price</strong> to see what any
        price earns. There is one price per market, so every state moves together — but each shows
        its own margin, because their costs differ.
      </p>

      {preview.issues.length > 0 && (
        <p className="rounded border border-destructive/30 bg-destructive/10 px-2 py-1.5 text-[11px] text-destructive">
          {preview.issues.join(' · ')}
        </p>
      )}

      {/* Glaze at 0% produces a glazed row identical to the plain one — two
          lines saying the same thing. Only show it once glaze does something. */}
      {preview.domestic && (
        <PreviewBlock
          title="Domestic (LKR/kg)"
          note={target && !preview.hasTargetDomestic ? 'no domestic target set — showing the standard price' : undefined}
          fmt={(n) => Math.round(n).toLocaleString()}
          rows={[
            [glazed ? 'No glaze' : 'Per kg', preview.domestic.unglazed.finalCost, preview.domestic.unglazed.rackRate, preview.domestic.unglazed.sellingPrice, preview.domestic.unglazed.marginPct],
            ...(glazed
              ? ([[`With ${(preview.glazePct * 100).toFixed(0)}% glaze`, preview.domestic.glazed.finalCost, preview.domestic.glazed.rackRate, preview.domestic.glazed.sellingPrice, preview.domestic.glazed.marginPct]] as PreviewRow[])
              : []),
          ]}
          target={target}
          onPriceChange={(v) => onPriceChange('domestic', v)}
        />
      )}

      {preview.export && (
        <PreviewBlock
          // Deliberately no port name: every figure here is at FOB, which is the
          // same for all of them. Naming one would imply otherwise.
          title="Export (USD/kg, FOB)"
          note={
            target && !preview.hasTargetExport
              ? 'no export target set — showing the standard price'
              : 'same for every port — freight only starts to matter at CIF'
          }
          fmt={(n) => n.toFixed(2)}
          rows={[
            ...(form === 'fresh'
              ? []
              : ([
                  [glazed ? 'Frozen, no glaze' : 'Frozen', preview.export.frozenPlain.finalCost, preview.export.frozenPlain.fob, preview.export.frozenPlain.sellingPrice, preview.export.frozenPlain.marginPct],
                  ...(glazed
                    ? ([[`Frozen, ${(preview.glazePct * 100).toFixed(0)}% glaze`, preview.export.frozenGlazed.finalCost, preview.export.frozenGlazed.fob, preview.export.frozenGlazed.sellingPrice, preview.export.frozenGlazed.marginPct]] as PreviewRow[])
                    : []),
                ] as PreviewRow[])),
            ...(form === 'frozen'
              ? []
              : ([['Fresh (air)', preview.export.fresh.finalCost, preview.export.fresh.fob, preview.export.fresh.sellingPrice, preview.export.fresh.marginPct]] as PreviewRow[])),
          ]}
          target={target}
          onPriceChange={(v) => onPriceChange('export', v)}
        />
      )}

      <p className="text-[10px] text-muted-foreground">
        One SKU, costed in each state it can be sold in — not separate products.
      </p>
    </div>
  );
}

type PreviewRow = [string, number, number, number, number | null];

function PreviewBlock({
  title,
  note,
  fmt,
  rows,
  target,
  onPriceChange,
}: {
  title: string;
  note?: string;
  fmt: (n: number) => string;
  rows: PreviewRow[];
  target: boolean;
  onPriceChange: (value: string) => void;
}) {
  // Every row in a market shares one price — that is how the SKU stores it —
  // so the cells are bound to a single value and move together.
  const shared = rows[0]?.[3] ?? 0;

  return (
    <div>
      <div className="text-[10px] font-semibold uppercase tracking-wide text-muted-foreground">
        {title}
        {note && <span className="ml-1.5 normal-case tracking-normal opacity-80">· {note}</span>}
      </div>
      <table className="mt-1 w-full text-right text-[11px] tabular-nums">
        <thead className="text-[10px] uppercase text-muted-foreground">
          <tr>
            <th className="py-0.5 text-left font-medium">State</th>
            <th className="py-0.5 font-medium">Cost</th>
            <th className="py-0.5 font-medium">Standard price</th>
            <th className="py-0.5 font-medium">Your price</th>
            <th className="py-0.5 font-medium">Margin</th>
          </tr>
        </thead>
        <tbody>
          {rows.map(([label, cost, standard, , margin], i) => (
            <tr key={label} className="border-t border-primary/10">
              <td className="py-0.5 text-left">{label}</td>
              <td className="py-0.5">{fmt(cost)}</td>
              <td className={cn('py-0.5', target && 'text-muted-foreground')}>{fmt(standard)}</td>
              <td className="py-0.5">
                {i === 0 ? (
                  <input
                    type="number"
                    step="any"
                    min="0"
                    // Rounded to what the column displays, so typing starts from
                    // the number on screen rather than a long float.
                    value={Number(fmt(shared).replace(/,/g, ''))}
                    onChange={(e) => onPriceChange(e.target.value)}
                    // The form clears the preview on any input; this input lives
                    // inside it but must survive its own edit.
                    onInput={(e) => e.stopPropagation()}
                    className="w-24 rounded border bg-background px-1.5 py-0.5 text-right font-medium"
                    aria-label="Your price"
                  />
                ) : (
                  <span className="font-medium" title="One price per market — edit it on the first row">
                    {fmt(shared)}
                  </span>
                )}
              </td>
              <td className="py-0.5">
                <MarginBadge pct={margin} />
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

// ---------------------------------------------------------------------------

function SkuDialog({
  sku,
  orgId,
  buckets,
  yields,
  version,
  odc,
  destinations,
  rates,
  allSkus,
  categories,
  onClose,
}: {
  sku: CostSkuRow | null;
  orgId: string;
  buckets: CostSizeBucket[];
  yields: YieldMap;
  version: CostAssumptionVersion;
  odc: CostOdcComponentRow[];
  destinations: CostDestinationRow[];
  rates: Record<string, { sea: number; air: number }>;
  allSkus: CostSkuRow[];
  categories: string[];
  onClose: () => void;
}) {
  const router = useRouter();
  const formRef = useRef<HTMLFormElement>(null);
  const [state, action, pending] = useActionState<SkuFormState, FormData>(saveCostSku, { error: null, ok: false });
  const [preview, setPreview] = useState<PreviewResult | null>(null);
  const [downloadOpen, setDownloadOpen] = useState(false);
  // Which size grade to cost at. '' is the flat reference model, which is what
  // this dialog used to do unconditionally — so the default preserves every
  // number it produced before, and picking a grade is an explicit act.
  const [previewBucketId, setPreviewBucketId] = useState('');

  /**
   * Which record the field defaults come from.
   *
   * Normally the SKU being edited, but "copy its settings" repoints it at
   * another SKU so a new one can start from an existing recipe instead of being
   * retyped. It is NOT the same as `sku`: the hidden id, the title and the
   * archive button stay bound to `sku`, so copying settings into a new SKU can
   * never turn into an edit of the one it was copied from.
   */
  const [src, setSrc] = useState<CostSkuRow | null>(sku);

  const [name, setName] = useState(sku?.name ?? '');
  const [basis, setBasis] = useState(src?.raw_material_basis ?? 'full_fish');
  const [form, setForm] = useState(src?.product_form ?? 'both');
  // Glazed is not stored as its own flag — a SKU is glazed exactly when it
  // carries glaze. The toggle is derived from that on open and collapses back
  // to a glaze of 0 when switched off, so there is one fact, not two that can
  // disagree.
  const [glazed, setGlazed] = useState((src?.glaze_pct ?? 0) > 0);
  const [glazePctValue, setGlazePctValue] = useState(
    src?.glaze_pct ? String(src.glaze_pct) : ''
  );
  const [categoryChoice, setCategoryChoice] = useState(
    src?.category && categories.includes(src.category) ? src.category : (categories[0] ?? 'Whole')
  );
  const [pricingMode, setPricingMode] = useState(src?.pricing_mode ?? 'margin');
  // Open by default for a new SKU: the inherited values are the point of the
  // section, so they should be on screen without a click. For an existing SKU,
  // open only if it actually overrides something.
  const [showOverrides, setShowOverrides] = useState(sku ? hasOverride(sku) : true);

  /**
   * Cost and price this SKU from what is on screen right now, without saving.
   *
   * Reads the live form rather than mirroring every field into state: the
   * numeric inputs are uncontrolled, and a FormData snapshot is both simpler
   * and impossible to get out of sync with what the user can see. Recalculated
   * on demand, so the answer always belongs to the values currently entered.
   */
  /** The grade to cost at, and this SKU's per-grade yields if it has any. */
  function gradeContext() {
    const bucket = previewBucketId ? (buckets.find((b) => b.id === previewBucketId) ?? null) : null;
    // A brand-new SKU has no stored per-grade yields, so resolveYield falls
    // back to its flat yield — correct, and the sheet says which grade it used.
    return { bucket, bucketYields: src?.id ? yields[src.id] : undefined };
  }

  function calculate() {
    const el = formRef.current;
    if (!el) return;
    const fd = new FormData(el);
    const { bucket, bucketYields } = gradeContext();
    setPreview(previewFromForm(fd, version, odc, destinations, rates, bucket, bucketYields));
  }

  // A stale preview is worse than none: it shows numbers for a recipe that is
  // no longer on screen. Any edit clears it until Calculate is pressed again.
  const invalidatePreview = () => {
    setPreview(null);
    setDownloadOpen(false);
  };

  /**
   * Open the download menu, costing the SKU from the form first — every time,
   * not only when there is no preview yet.
   *
   * The document is rendered from the preview, so a preview that has drifted
   * from the form is a document that quietly disagrees with the SKU you are
   * about to save. Recosting on open makes that impossible by construction
   * rather than by remembering to invalidate at every mutation site, which is
   * exactly the kind of bookkeeping that goes wrong. previewFromForm is a pure
   * read of the form, so doing it again costs nothing.
   */
  function openDownload() {
    calculate();
    setDownloadOpen(true);
  }

  function downloadWord() {
    if (!preview) return;
    const label = preview.skuName || 'SKU';
    if (!downloadDoc(`${slugify(label, 'sku')}-cost-breakdown`, COST_SHEET_ID, `${label} — cost breakdown`)) {
      alert('Could not build the document — the breakdown sheet was not found on the page.');
    }
    setDownloadOpen(false);
  }

  function printSheet() {
    setDownloadOpen(false);
    window.print();
  }

  /**
   * Try a price straight from the preview table.
   *
   * Writes it into the real target-price field and recosts, rather than working
   * the margin out locally — so the number on screen comes from the same engine
   * that will store it, and the two can't disagree. Typing a price also means
   * pricing on a target, so the mode follows rather than making you set it
   * first and then discover the field.
   */
  function tryPrice(market: 'domestic' | 'export', value: string) {
    const el = formRef.current;
    if (!el) return;
    const field = el.elements.namedItem(
      market === 'domestic' ? 'market_price_lkr' : 'market_price_usd'
    ) as HTMLInputElement | null;
    if (!field) return;

    field.value = value;
    if (pricingMode !== 'target') setPricingMode('target');

    // The mode lives in React state, so it isn't in the form yet on this pass.
    const fd = new FormData(el);
    fd.set('pricing_mode', 'target');
    const { bucket, bucketYields } = gradeContext();
    setPreview(previewFromForm(fd, version, odc, destinations, rates, bucket, bucketYields));
  }

  useEffect(() => {
    if (state.ok) {
      onClose();
      router.refresh();
    }
  }, [state.ok, onClose, router]);

  const absorbed = basis === 'absorbed';

  /** A different SKU already holding this name — the duplicate the list drifts on. */
  const duplicate =
    allSkus.find(
      (s) => s.id !== sku?.id && s.name.trim().toLowerCase() === name.trim().toLowerCase()
    ) ?? null;

  function copyFrom(source: CostSkuRow) {
    // Every field on screen is about to be replaced with another SKU's recipe,
    // so a preview costed from the old one is not merely stale — it belongs to
    // a different product.
    invalidatePreview();
    setSrc(source);
    setBasis(source.raw_material_basis);
    setForm(source.product_form);
    setGlazed((source.glaze_pct ?? 0) > 0);
    setGlazePctValue(source.glaze_pct ? String(source.glaze_pct) : '');
    setCategoryChoice(categories.includes(source.category) ? source.category : (categories[0] ?? 'Whole'));
    setName(`${source.name} (copy)`);
  }

  return (
    <>
      <div className="fixed inset-0 z-50 flex items-start justify-center overflow-y-auto bg-black/40 p-4" onClick={onClose}>
      <form
        ref={formRef}
        action={action}
        onClick={(e) => e.stopPropagation()}
        onInput={invalidatePreview}
        // Remount when the copy source changes, so the uncontrolled numeric
        // fields pick up the new defaults instead of keeping the old ones.
        key={src?.id ?? 'new'}
        className="my-8 w-full max-w-2xl space-y-4 rounded-lg border bg-card p-5 shadow-lg"
      >
        <h2 className="text-lg font-semibold">{sku ? sku.name : 'New SKU'}</h2>
        {!sku && src && (
          <p className="rounded-md bg-primary/5 px-3 py-2 text-xs text-primary">
            Starting from <strong className="font-medium">{src.name}</strong> — every field below is
            its recipe. Adjust what differs.
          </p>
        )}
        {sku && <input type="hidden" name="id" value={sku.id} />}
        <input type="hidden" name="org_id" value={orgId} />

        {state.error && (
          <p className="rounded-md border border-destructive/30 bg-destructive/10 px-3 py-2 text-xs text-destructive">
            {state.error}
          </p>
        )}

        {/* Market first: it frames everything below it, and it decides which
            grid this SKU turns up in. */}
        <div className="grid gap-3 sm:grid-cols-2">
          <Select
            label="Costing for"
            name="market_scope"
            defaultValue={src?.market_scope ?? 'both'}
            options={[
              ['both', 'Domestic and export'],
              ['domestic', 'Domestic only (LKR)'],
              ['export', 'Export only (USD)'],
            ]}
          />
          <Select
            label="Product form"
            name="product_form"
            defaultValue={form}
            onChange={(e) => setForm(e.target.value as typeof form)}
            options={[
              ['both', 'Frozen and fresh'],
              ['frozen', 'Frozen only'],
              ['fresh', 'Fresh only (air freight)'],
            ]}
          />
        </div>

        <div className="grid gap-3 sm:grid-cols-2">
          <div className="sm:col-span-2">
            <label className="block">
              <span className="text-xs font-medium">Name</span>
              {/* A datalist rather than a plain box: the existing SKUs drop down
                  as you type, so a near-duplicate is visible before it is
                  created. The list is one shared vocabulary. */}
              <input
                name="name"
                list="cost-sku-names"
                value={name}
                onChange={(e) => setName(e.target.value)}
                type="text"
                autoComplete="off"
                placeholder="Pick an existing SKU or type a new name"
                className={cn(inputCls, 'mt-1 w-full', duplicate && 'border-destructive')}
              />
              <datalist id="cost-sku-names">
                {allSkus.map((s) => (
                  <option key={s.id} value={s.name}>
                    {s.category}
                  </option>
                ))}
              </datalist>
            </label>
            {duplicate ? (
              <p className="mt-1 text-[11px] text-destructive">
                That name is already in use.{' '}
                <button type="button" onClick={() => copyFrom(duplicate)} className="underline">
                  Copy its settings
                </button>{' '}
                and rename, or pick a different name.
              </p>
            ) : (
              <p className="mt-1 text-[11px] text-muted-foreground">
                Existing SKUs appear as you type — reuse one rather than adding a near-duplicate.
              </p>
            )}
          </div>

          <label className="block">
            <span className="text-xs font-medium">Category</span>
            <select
              name="category"
              value={categoryChoice}
              onChange={(e) => setCategoryChoice(e.target.value)}
              className={cn(inputCls, 'mt-1 w-full')}
            >
              {categories.map((c) => (
                <option key={c} value={c}>
                  {c}
                </option>
              ))}
              <option value="__other">Other…</option>
            </select>
            {categoryChoice === '__other' && (
              <input
                name="category_other"
                defaultValue=""
                type="text"
                placeholder="New category name"
                className={cn(inputCls, 'mt-1 w-full')}
              />
            )}
          </label>

          <Select label="Status" name="status" defaultValue={src?.status ?? 'active'} options={[['active', 'Active'], ['inactive', 'Inactive']]} />

          {/* Free text for now. When the customer master lands, a costing will
              pick from it and this becomes the thing to migrate from. */}
          <Field
            label="Customer"
            name="customer"
            defaultValue={src?.customer ?? ''}
            type="text"
            hint="optional — who this is costed for"
            className="sm:col-span-2"
          />
        </div>

        <fieldset className="rounded-md border p-3">
          <legend className="px-1 text-xs font-semibold">Raw material</legend>
          <Select
            label="Basis"
            name="raw_material_basis"
            defaultValue={basis}
            onChange={(e) => setBasis(e.target.value as typeof basis)}
            options={[
              ['full_fish', 'Full fish — carries whole-fish cost ÷ yield'],
              ['absorbed', 'Absorbed — by-product, main product already paid for the fish'],
            ]}
          />
          <p className="mt-1.5 text-[11px] text-muted-foreground">
            {absorbed
              ? 'This SKU carries no fish cost. Its cost is a floor — processing, packing, cold-hold and freight — and it is priced on contribution against the market price below, not on margin.'
              : 'Co-products stay on full fish: each is costed at its own standalone yield, as though it were the target of its own run.'}
          </p>
        </fieldset>

        <div className="grid gap-3 sm:grid-cols-3">
          {/* Fractions, not percentages: 0.45 is 45%. Entered this way because
              the engine and the workbook both work in fractions, and converting
              at the edge is where off-by-100 errors come from. */}
          <Field
            label="Yield"
            name="base_yield"
            defaultValue={src?.base_yield ?? 0.45}
            step="0.01"
            hint="fraction — 0.45 = 45% of whole fish"
          />
          <GlazeField
            glazed={glazed}
            // The toggle is a button, so it never fires the form's onInput and
            // would leave a preview standing for a recipe that just changed.
            setGlazed={(v) => {
              setGlazed(v);
              invalidatePreview();
            }}
            value={glazePctValue}
            setValue={setGlazePctValue}
            // Glaze is added ice, so a fresh-only product cannot carry any.
            // Locked rather than merely validated on save: offering a choice
            // that will be rejected is worse than not offering it.
            fresh={form === 'fresh'}
          />
          <Field
            label="Pack size"
            name="pack_size"
            defaultValue={src?.pack_size ?? ''}
            type="text"
            // Deliberately not used in any calculation — all costs are per kg.
            hint="label only, e.g. 500g or 3kg carton — not used in costing"
          />
          <Field
            label="% fish"
            name="pct_fish"
            defaultValue={src?.pct_fish ?? 1}
            step="0.01"
            hint="fraction — 1 = 100%. Must total 1 with marinade"
          />
          <Field
            label="% marinade"
            name="pct_marinade"
            defaultValue={src?.pct_marinade ?? 0}
            step="0.01"
            hint="fraction — 0.18 = 18% of finished weight"
          />
          {/* Always USD, in BOTH markets — domestic converts at the FX rate.
              Surprising enough to say on every field rather than once. */}
          <Field
            label="Marinade cost"
            name="marinade_usd_per_kg"
            defaultValue={src?.marinade_usd_per_kg ?? 0}
            step="0.01"
            hint="USD per kg of marinade"
          />
          <Field
            label="Processing cost"
            name="process_usd_per_kg"
            defaultValue={src?.process_usd_per_kg ?? 0}
            step="0.01"
            hint={`USD per kg finished — LKR at FX ${version.fx_rate}`}
          />
          <Field
            label="Packing cost"
            name="packing_usd_per_kg"
            defaultValue={src?.packing_usd_per_kg ?? 0}
            step="0.01"
            hint={`USD per kg finished — LKR at FX ${version.fx_rate}`}
          />
        </div>

        <fieldset className={cn('rounded-md border p-3', (absorbed || pricingMode === 'target') && 'border-primary/40 bg-primary/5')}>
          <legend className="px-1 text-xs font-semibold">Pricing</legend>

          <div className="inline-flex rounded-md border bg-background p-0.5 text-xs">
            {(
              [
                ['margin', 'Standard margin'],
                ['target', 'Target price'],
              ] as const
            ).map(([mode, label]) => (
              <button
                key={mode}
                type="button"
                onClick={() => {
                  setPricingMode(mode);
                  invalidatePreview();
                }}
                className={cn(
                  'rounded px-2.5 py-1 font-medium',
                  pricingMode === mode ? 'bg-primary text-primary-foreground' : 'text-muted-foreground hover:text-foreground'
                )}
              >
                {label}
              </button>
            ))}
          </div>
          <input type="hidden" name="pricing_mode" value={pricingMode} />

          <p className="mt-1.5 text-[11px] text-muted-foreground">
            {pricingMode === 'margin'
              ? `Price is cost ÷ (1 − margin) — ${(version.rack_margin_pct * 100).toFixed(0)}% domestic, ${(version.fob_margin_pct * 100).toFixed(0)}% FOB unless overridden below.`
              : 'You name the price and the margin is worked out from it. Use this when the buyer sets the price and the question is whether it clears cost.'}
          </p>

          <div className="mt-3 grid gap-3 sm:grid-cols-2">
            <Field
              label={pricingMode === 'target' ? 'Target price — domestic (LKR/kg)' : 'Market price — domestic (LKR/kg)'}
              name="market_price_lkr"
              defaultValue={src?.market_price_lkr ?? ''}
              step="1"
              hint={pricingMode === 'target' ? 'what you intend to charge' : 'what the market bears'}
            />
            <Field
              label={pricingMode === 'target' ? 'Target price — export (USD/kg FOB)' : 'Market price — export (USD/kg)'}
              name="market_price_usd"
              defaultValue={src?.market_price_usd ?? ''}
              step="0.01"
              hint={pricingMode === 'target' ? 'CIF and below build on this' : 'blank = no contribution shown'}
            />
          </div>

          {absorbed && (
            <p className="mt-2 text-[11px] text-primary">
              This is a by-product, so its cost is a floor rather than a base for margin. The price
              above is what drives its contribution per kg.
            </p>
          )}
        </fieldset>

        {/* Shown expanded for a new SKU so the inherited figures are visible
            immediately rather than hidden behind a disclosure. */}
        <div className="rounded-md border p-3">
          <button type="button" onClick={() => setShowOverrides((v) => !v)} className="text-xs font-semibold">
            {showOverrides ? '▾' : '▸'} Margins and adders
            <span className="ml-1.5 font-normal text-muted-foreground">
              inherited from assumptions v{version.version_no} — override any of them here
            </span>
          </button>

          {showOverrides && (
            <div className="mt-3 space-y-3">
              <p className="text-[11px] text-muted-foreground">
                Each box shows the company value in grey. Leave it empty and this SKU follows that
                value — including when an admin changes it later. Type a number and this SKU stops
                following it.
              </p>

              <div>
                <div className="text-[10px] font-semibold uppercase tracking-wide text-muted-foreground">Domestic</div>
                <div className="mt-1.5 grid gap-3 sm:grid-cols-3">
                  <OverrideField
                    label="Rack margin" name="override_rack_margin_pct"
                    current={src?.override_rack_margin_pct ?? null}
                    onDirty={invalidatePreview}
                    inherited={version.rack_margin_pct} step="0.01" kind="pct"
                  />
                  <OverrideField
                    label="Transport" name="override_transport_lkr"
                    current={src?.override_transport_lkr ?? null}
                    onDirty={invalidatePreview}
                    inherited={version.domestic_transport_lkr} step="0.01" kind="lkr"
                  />
                  <OverrideField
                    label="Cold holding" name="override_cold_hold_lkr"
                    current={src?.override_cold_hold_lkr ?? null}
                    onDirty={invalidatePreview}
                    inherited={version.domestic_cold_hold_lkr} step="0.01" kind="lkr"
                  />
                </div>
              </div>

              <div>
                <div className="text-[10px] font-semibold uppercase tracking-wide text-muted-foreground">Export</div>
                <div className="mt-1.5 grid gap-3 sm:grid-cols-3">
                  <OverrideField
                    label="FOB margin" name="override_fob_margin_pct"
                    current={src?.override_fob_margin_pct ?? null}
                    onDirty={invalidatePreview}
                    inherited={version.fob_margin_pct} step="0.01" kind="pct"
                  />
                  <OverrideField
                    label="Freight to port" name="override_freight_to_port_usd"
                    current={src?.override_freight_to_port_usd ?? null}
                    onDirty={invalidatePreview}
                    inherited={version.export_freight_to_port_usd} step="0.01" kind="usd"
                  />
                  <OverrideField
                    label="Cold chain" name="override_cold_chain_usd"
                    current={src?.override_cold_chain_usd ?? null}
                    onDirty={invalidatePreview}
                    inherited={version.export_cold_chain_usd} step="0.01" kind="usd"
                  />
                </div>

                {/*
                  Past FOB. These do not touch this SKU's cost or its FOB — they
                  shape the CIF → importer → distributor ladder underneath it,
                  which is why they sit in their own row rather than beside the
                  adders that do move the cost.
                */}
                <p className="mt-3 text-[10px] font-medium uppercase tracking-wide text-muted-foreground">
                  Downstream — past FOB
                </p>
                <div className="mt-1 grid gap-3 sm:grid-cols-3">
                  <OverrideField
                    label="Importer clearing" name="override_importer_clearing_pct"
                    current={src?.override_importer_clearing_pct ?? null}
                    onDirty={invalidatePreview}
                    inherited={version.importer_clearing_pct} step="0.01" kind="pct"
                  />
                  <OverrideField
                    label="Importer markup" name="override_importer_markup_pct"
                    current={src?.override_importer_markup_pct ?? null}
                    onDirty={invalidatePreview}
                    inherited={version.importer_markup_pct} step="0.01" kind="pct"
                  />
                  <OverrideField
                    label="Distributor markup" name="override_distributor_markup_pct"
                    current={src?.override_distributor_markup_pct ?? null}
                    onDirty={invalidatePreview}
                    inherited={version.distributor_markup_pct} step="0.01" kind="pct"
                  />
                </div>
              </div>
            </div>
          )}
        </div>

        {buckets.length > 0 && (
          <label className="flex flex-wrap items-center gap-2 text-xs">
            <span className="font-medium">Cost at</span>
            <select
              // No `name`: this drives the preview only and must not land in
              // the SKU's own FormData.
              value={previewBucketId}
              onChange={(e) => {
                setPreviewBucketId(e.target.value);
                invalidatePreview();
              }}
              className={cn(inputCls, 'w-auto')}
            >
              <option value="">Reference size (no grade)</option>
              {buckets.map((b) => (
                <option key={b.id} value={b.id}>
                  {b.label}
                </option>
              ))}
            </select>
            <span className="text-[10px] text-muted-foreground">
              {previewBucketId
                ? 'Uses this grade\u2019s FCR and yield \u2014 the Cost Grid at the same grade will agree.'
                : 'The flat model. Pick a grade to match what the Cost Grid shows at that grade.'}
            </span>
          </label>
        )}

        {preview ? (
          <PreviewPanel
            preview={preview}
            form={form}
            onPriceChange={tryPrice}
            onPrint={() => window.print()}
            onWord={downloadWord}
          />
        ) : (
          <p className="rounded-md bg-muted/50 px-3 py-2 text-[11px] text-muted-foreground">
            Press Calculate to cost this SKU and see the price and margin before saving.
          </p>
        )}

        <div className="flex items-center justify-between gap-2">
          {sku ? <ArchiveButton id={sku.id} onDone={onClose} /> : <span />}
          <div className="flex gap-2">
            <button type="button" onClick={onClose} className="rounded-md border px-3 py-1.5 text-sm font-medium hover:bg-muted">
              Cancel
            </button>
            {/* type="button" matters: inside a form, a bare button submits. */}
            <button
              type="button"
              onClick={calculate}
              className="rounded-md border border-primary px-3 py-1.5 text-sm font-medium text-primary hover:bg-primary/10"
            >
              Calculate
            </button>

            <div className="relative">
              <button
                type="button"
                onClick={openDownload}
                className="inline-flex items-center gap-1.5 rounded-md border px-3 py-1.5 text-sm font-medium hover:bg-muted"
              >
                <Download className="h-3.5 w-3.5" /> Download
              </button>
              {downloadOpen && (
                <>
                  {/* Click-away, behind the menu but above the form. */}
                  <div className="fixed inset-0 z-10" onClick={() => setDownloadOpen(false)} />
                  <div className="absolute bottom-full right-0 z-20 mb-1 w-56 overflow-hidden rounded-md border bg-popover shadow-lg">
                    <button
                      type="button"
                      onClick={printSheet}
                      className="flex w-full items-center gap-2 px-3 py-2 text-left text-sm hover:bg-muted"
                    >
                      <Printer className="h-3.5 w-3.5" /> Print / Save as PDF
                    </button>
                    <button
                      type="button"
                      onClick={downloadWord}
                      className="flex w-full items-center gap-2 border-t px-3 py-2 text-left text-sm hover:bg-muted"
                    >
                      <FileText className="h-3.5 w-3.5" /> Download as Word
                    </button>
                    <p className="border-t bg-muted/40 px-3 py-1.5 text-[11px] text-muted-foreground">
                      The full cost build-up for this SKU, at current assumptions.
                    </p>
                  </div>
                </>
              )}
            </div>
            <button type="submit" disabled={pending} className="rounded-md bg-primary px-3 py-1.5 text-sm font-medium text-primary-foreground disabled:opacity-50">
              {pending ? 'Saving…' : pricingMode === 'target' ? 'Save with target price' : 'Save'}
            </button>
          </div>
        </div>
      </form>
      </div>

      {/*
        The document itself, a SIBLING of the overlay above rather than a child.
        That is the whole point: the overlay is `fixed` and scrolls its own
        content, and an element printed from inside a fixed, overflowing
        ancestor is clipped to a single page at whatever scroll offset the
        container happened to be at — which prints the tail of the sheet and
        silently drops its header and build-up. Out here it is in normal flow,
        so the print rules in globals.css can lift it to the top of the page and
        let it paginate.

        Hidden on screen, revealed by the #cost-sheet print rules, and read
        as-is by the Word export.
      */}
      {preview && (
        <div className="hidden print:block">
          <SkuCostSheet
            elementId={COST_SHEET_ID}
            skuName={preview.skuName || (sku?.name ?? 'SKU')}
            category={preview.category}
            customer={preview.customer}
            assumptionsLabel={`v${version.version_no}${version.label ? ` · ${version.label}` : ''}`}
            glazePct={preview.glazePct}
            absorbed={preview.absorbed}
            productForm={preview.productForm}
            gradeLabel={preview.gradeLabel}
            pctFish={preview.pctFish}
            pctMarinade={preview.pctMarinade}
            domestic={preview.domestic}
            domesticWholeFish={preview.domesticWholeFish}
            exportOut={preview.export}
            exportWholeFish={preview.exportWholeFish}
          />
        </div>
      )}
    </>
  );
}

function ArchiveButton({ id, onDone }: { id: string; onDone: () => void }) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  return (
    <button
      type="button"
      disabled={pending}
      onClick={() => {
        if (!confirm('Archive this SKU? Saved costings keep their own snapshot of it.')) return;
        startTransition(async () => {
          const res = await archiveCostSku(id);
          if (res.error) alert(res.error);
          onDone();
          router.refresh();
        });
      }}
      className="text-xs font-medium text-destructive hover:underline"
    >
      Archive
    </button>
  );
}

// ---------------------------------------------------------------------------

/**
 * An assumption this SKU may override.
 *
 * The inherited figure is shown as a placeholder, NOT prefilled. Prefilling
 * would post a value for every field, turning each new SKU into one that
 * overrides everything — so a later change to the company assumptions would
 * silently stop reaching it. Blank has to keep meaning "follow the company
 * value", which is the whole point of an inherited default (Decisions §8).
 */
function OverrideField({
  label,
  name,
  current,
  inherited,
  step,
  kind,
  onDirty,
}: {
  label: string;
  name: string;
  current: number | null;
  inherited: number;
  step: string;
  kind: 'pct' | 'lkr' | 'usd';
  /**
   * Called whenever this field's value changes, including from the two
   * shortcut buttons below. Typing fires a real DOM input event that the form
   * hears on its own; setting a controlled input's value from React does not,
   * so the buttons have to say so themselves.
   */
  onDirty?: () => void;
}) {
  const [value, setValue] = useState(current == null ? '' : String(current));
  const overriding = value.trim() !== '';

  const change = (v: string) => {
    setValue(v);
    onDirty?.();
  };

  const show = (n: number) =>
    kind === 'pct' ? `${n} (${(n * 100).toFixed(0)}%)` : kind === 'lkr' ? `LKR ${n}` : `$${n}`;

  return (
    <label className="block">
      <span className="text-xs font-medium">{label}</span>
      <input
        name={name}
        value={value}
        onChange={(e) => change(e.target.value)}
        type="number"
        step={step}
        min="0"
        placeholder={show(inherited)}
        className={cn(inputCls, 'mt-1 w-full', overriding && 'border-primary bg-primary/5')}
      />
      <span className="mt-0.5 block text-[10px] text-muted-foreground">
        {overriding ? (
          <>
            <span className="text-primary">overriding</span> ·{' '}
            <button type="button" onClick={() => change('')} className="underline hover:text-foreground">
              use {show(inherited)}
            </button>
          </>
        ) : (
          <>
            follows {show(inherited)} ·{' '}
            <button type="button" onClick={() => change(String(inherited))} className="underline hover:text-foreground">
              override
            </button>
          </>
        )}
      </span>
    </label>
  );
}

function Field({
  label, name, defaultValue, step, hint, type = 'number', className,
}: {
  label: string; name: string; defaultValue: string | number; step?: string; hint?: string;
  type?: string; className?: string;
}) {
  return (
    <label className={cn('block', className)}>
      <span className="text-xs font-medium">{label}</span>
      <input name={name} defaultValue={defaultValue} type={type} step={step} min={type === 'number' ? '0' : undefined} className={cn(inputCls, 'mt-1 w-full')} />
      {hint && <span className="mt-0.5 block text-[10px] text-muted-foreground">{hint}</span>}
    </label>
  );
}

/**
 * Glazed or not, and the percentage only when it is.
 *
 * `glaze_pct` is always submitted — 0 when unglazed — so the server and the
 * engine keep seeing the single numeric field they already understand. The
 * toggle is pure UI over that one number.
 */
function GlazeField({
  glazed,
  setGlazed,
  value,
  setValue,
  fresh,
}: {
  glazed: boolean;
  setGlazed: (v: boolean) => void;
  value: string;
  setValue: (v: string) => void;
  fresh: boolean;
}) {
  const on = glazed && !fresh;
  return (
    <div className="block">
      <span className="text-xs font-medium">Glaze</span>
      <div className="mt-1 inline-flex w-full rounded-md border p-0.5">
        {([
          [false, 'Not glazed'],
          [true, 'Glazed'],
        ] as [boolean, string][]).map(([v, label]) => (
          <button
            key={label}
            type="button"
            disabled={fresh && v}
            onClick={() => setGlazed(v)}
            className={cn(
              'flex-1 rounded px-2 py-1 text-xs font-medium transition-colors',
              on === v ? 'bg-primary text-primary-foreground' : 'text-muted-foreground hover:text-foreground',
              fresh && v && 'cursor-not-allowed opacity-50 hover:text-muted-foreground'
            )}
          >
            {label}
          </button>
        ))}
      </div>

      {on ? (
        <>
          <input
            name="glaze_pct"
            value={value}
            onChange={(e) => setValue(e.target.value)}
            type="number"
            step="0.01"
            min="0"
            autoFocus
            placeholder="0.2"
            className={cn(inputCls, 'mt-1.5 w-full')}
          />
          <span className="mt-0.5 block text-[10px] text-muted-foreground">
            fraction — 0.2 = 20% added ice
          </span>
        </>
      ) : (
        <>
          {/* Still submitted, so the server sees the field it expects. */}
          <input type="hidden" name="glaze_pct" value="0" />
          <span className="mt-1.5 block text-[10px] text-muted-foreground">
            {fresh ? 'Fresh product carries no glaze — it is added ice.' : 'No added ice.'}
          </span>
        </>
      )}
    </div>
  );
}

function Select({
  label, name, defaultValue, options, onChange,
}: {
  label: string; name: string; defaultValue: string; options: [string, string][];
  onChange?: (e: React.ChangeEvent<HTMLSelectElement>) => void;
}) {
  return (
    <label className="block">
      <span className="text-xs font-medium">{label}</span>
      <select name={name} defaultValue={defaultValue} onChange={onChange} className={cn(inputCls, 'mt-1 w-full')}>
        {options.map(([v, l]) => (
          <option key={v} value={v}>{l}</option>
        ))}
      </select>
    </label>
  );
}

const hasOverride = (s: CostSkuRow): boolean =>
  s.override_rack_margin_pct != null ||
  s.override_fob_margin_pct != null ||
  s.override_transport_lkr != null ||
  s.override_cold_hold_lkr != null ||
  s.override_freight_to_port_usd != null ||
  s.override_cold_chain_usd != null ||
  s.override_importer_clearing_pct != null ||
  s.override_importer_markup_pct != null ||
  s.override_distributor_markup_pct != null;

const pct = (n: number) => (n * 100).toFixed(0) + '%';
const th = 'whitespace-nowrap px-2 py-2 font-medium';
const td = 'whitespace-nowrap px-2 py-1.5';
const inputCls = 'rounded-md border bg-background px-2 py-1 text-xs disabled:opacity-60';
