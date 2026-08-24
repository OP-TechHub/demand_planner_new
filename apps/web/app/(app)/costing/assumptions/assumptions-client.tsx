'use client';

import { useActionState, useMemo, useState, useTransition } from 'react';
import { useRouter } from 'next/navigation';
import { History, Lock } from 'lucide-react';
import { effectiveFeedCostUsd, odcTotalUsd, wholeFishCost } from '@oceanpick/engine';
import type {
  CostAssumptionVersion,
  CostDestinationRow,
  CostOdcComponentRow,
  CostSizeBucket,
} from '@oceanpick/shared';
import { toAssumptions } from '@/lib/costing-adapt';
import { cn } from '@/lib/utils';
import { makeVersionCurrent, publishAssumptionVersion, saveSizeBucket, type SaveState } from './actions';

type RateMap = Record<string, { sea: number; air: number }>;

export function AssumptionsClient({
  version,
  versions,
  odc,
  buckets,
  destinations,
  rates,
  isAdmin,
}: {
  version: CostAssumptionVersion;
  versions: CostAssumptionVersion[];
  odc: CostOdcComponentRow[];
  buckets: CostSizeBucket[];
  destinations: CostDestinationRow[];
  rates: RateMap;
  isAdmin: boolean;
}) {
  const router = useRouter();
  const [state, action, pending] = useActionState<SaveState, FormData>(publishAssumptionVersion, {
    error: null,
    ok: false,
  });

  // Live preview: what the fish costs under the numbers currently on screen.
  const [draft, setDraft] = useState<Record<string, number>>({});
  const preview = useMemo(() => {
    const merged = { ...version, ...draft } as CostAssumptionVersion;
    const a = toAssumptions(merged, odc);
    return {
      domestic: wholeFishCost(a, 'domestic'),
      export: wholeFishCost(a, 'export'),
      odcUsd: odcTotalUsd(a),
      effectiveFeed: effectiveFeedCostUsd(a, 'domestic'),
    };
  }, [version, draft, odc]);

  const onNum = (field: string) => (e: React.ChangeEvent<HTMLInputElement>) => {
    const v = Number(e.target.value);
    setDraft((d) => ({ ...d, [field]: Number.isFinite(v) ? v : 0 }));
  };

  const isHistoric = !version.is_current;

  return (
    <div className="mx-auto max-w-5xl space-y-4">
      <header className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h1 className="text-2xl font-semibold tracking-tight">Assumptions</h1>
          <p className="mt-0.5 text-sm text-muted-foreground">
            The company&apos;s farm economics. Entered once and shared by both markets — export
            differs on the feed tax alone.
          </p>
        </div>
        <VersionPicker versions={versions} current={version} />
      </header>

      {isHistoric && (
        <Banner tone="warning">
          You&apos;re viewing version {version.version_no}, which isn&apos;t the current one. Costings
          built today use the current version.
          {isAdmin && (
            <MakeCurrentButton id={version.id} onDone={() => router.refresh()} />
          )}
        </Banner>
      )}

      {!isAdmin && (
        <Banner tone="muted">
          <Lock className="mr-1.5 inline h-3.5 w-3.5" />
          Only an admin can change these. You can still override any of them inside your own costing
          — the deviation gets stamped on it so reviewers can see it.
        </Banner>
      )}

      {state.error && <Banner tone="destructive">{state.error}</Banner>}
      {state.ok && <Banner tone="success">Published as a new version. Existing costings keep the version they were built on.</Banner>}

      <form action={action} className="space-y-4">
        <input type="hidden" name="from_version_id" value={version.id} />

        <Section
          title="Base fish cost"
          hint="Feed, clearing and FCR are shared by both markets. Import tax is the only line that differs."
        >
          <Field label="Feed cost" unit="USD / kg feed" name="feed_cost_per_kg" value={version.feed_cost_per_kg} step="0.01" disabled={!isAdmin} onChange={onNum('feed_cost_per_kg')} />
          <Field label="Clearing cost" unit="USD / kg — added after tax, not taxed" name="clearing_cost_per_kg" value={version.clearing_cost_per_kg} step="0.01" disabled={!isAdmin} onChange={onNum('clearing_cost_per_kg')} />
          <Field label="Import tax — domestic" unit="fraction, e.g. 0.35 for 35%" name="import_tax_pct_domestic" value={version.import_tax_pct_domestic} step="0.0001" disabled={!isAdmin} onChange={onNum('import_tax_pct_domestic')} />
          <Field label="Import tax — export" unit="0 on duty drawback" name="import_tax_pct_export" value={version.import_tax_pct_export} step="0.0001" disabled={!isAdmin} onChange={onNum('import_tax_pct_export')} />
          <Field label="FCR" unit="kg feed per kg live fish" name="fcr_reference" value={version.fcr_reference} step="0.01" disabled={!isAdmin} onChange={onNum('fcr_reference')} />
          <Field label="FX rate" unit="LKR per 1 USD" name="fx_rate" value={version.fx_rate} step="0.01" disabled={!isAdmin} onChange={onNum('fx_rate')} />

          <div className="col-span-full mt-1 grid grid-cols-2 gap-3 rounded-md bg-muted/40 p-3 text-xs sm:grid-cols-4">
            <Readout label="Effective feed" value={`$${preview.effectiveFeed.toFixed(4)}`} hint="feed × (1+tax) + clearing" />
            <Readout label="ODC" value={`$${preview.odcUsd.toFixed(4)}`} hint="sum of components below" />
            <Readout label="Whole fish — domestic" value={`LKR ${preview.domestic.wholeFishLkr.toFixed(2)}`} />
            <Readout label="Whole fish — export" value={`$${preview.export.wholeFishUsd.toFixed(4)}`} />
          </div>
        </Section>

        <Section title="Other direct costs" hint="Each entered in its own currency. Per-fish components divide by the fish's median weight when a size grade is selected; per-kg ones stay flat.">
          <div className="col-span-full overflow-x-auto">
            <table className="w-full text-xs">
              <thead className="text-left text-[10px] uppercase tracking-wide text-muted-foreground">
                <tr>
                  <th className="py-1 pr-3 font-medium">Component</th>
                  <th className="py-1 pr-3 text-right font-medium">Value</th>
                  <th className="py-1 pr-3 font-medium">Currency</th>
                  <th className="py-1 font-medium">Basis</th>
                </tr>
              </thead>
              <tbody>
                {odc.map((c) => (
                  <tr key={c.id} className="border-t">
                    <td className="py-1.5 pr-3">{c.name}</td>
                    <td className="py-1.5 pr-3 text-right">
                      <input name={`odc_${c.id}`} defaultValue={c.value} type="number" step="0.0001" min="0" disabled={!isAdmin} className={cn(inputCls, 'w-28 text-right')} />
                    </td>
                    <td className="py-1.5 pr-3 text-muted-foreground">{c.currency}</td>
                    <td className="py-1.5">
                      <select name={`odc_basis_${c.id}`} defaultValue={c.basis} disabled={!isAdmin} className={inputCls}>
                        <option value="per_kg">per kg</option>
                        <option value="per_fish">per fish</option>
                      </select>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </Section>

        <Section title="Per-kg adders" hint="Entered per market. Cold holding sits inside ex-factory; freight comes after it, on the way to FINAL.">
          <Field label="Transport — domestic" unit="LKR / kg, factory → customer" name="domestic_transport_lkr" value={version.domestic_transport_lkr} step="0.01" disabled={!isAdmin} onChange={onNum('domestic_transport_lkr')} />
          <Field label="Cold holding — domestic" unit="LKR / kg" name="domestic_cold_hold_lkr" value={version.domestic_cold_hold_lkr} step="0.01" disabled={!isAdmin} onChange={onNum('domestic_cold_hold_lkr')} />
          <Field label="Freight to port — export" unit="USD / kg, factory → port" name="export_freight_to_port_usd" value={version.export_freight_to_port_usd} step="0.01" disabled={!isAdmin} onChange={onNum('export_freight_to_port_usd')} />
          <Field label="Cold chain — export" unit="USD / kg" name="export_cold_chain_usd" value={version.export_cold_chain_usd} step="0.01" disabled={!isAdmin} onChange={onNum('export_cold_chain_usd')} />

          <HaulageCheck draft={draft} version={version} />
        </Section>

        <Section title="Margins and the value chain" hint="Rack and FOB are gross margins: price = cost ÷ (1 − margin). The importer and distributor figures are markups on top, and model their economics — they never appear on a customer quote.">
          <Field label="Domestic rack margin" unit="gross margin" name="rack_margin_pct" value={version.rack_margin_pct} step="0.0001" disabled={!isAdmin} onChange={onNum('rack_margin_pct')} />
          <Field label="FOB margin" unit="our gross margin on FINAL" name="fob_margin_pct" value={version.fob_margin_pct} step="0.0001" disabled={!isAdmin} onChange={onNum('fob_margin_pct')} />
          <Field label="Importer clearing" unit="markup on CIF" name="importer_clearing_pct" value={version.importer_clearing_pct} step="0.0001" disabled={!isAdmin} onChange={onNum('importer_clearing_pct')} />
          <Field label="Importer markup" unit="to distributor" name="importer_markup_pct" value={version.importer_markup_pct} step="0.0001" disabled={!isAdmin} onChange={onNum('importer_markup_pct')} />
          <Field label="Distributor markup" unit="to T3 / foodservice" name="distributor_markup_pct" value={version.distributor_markup_pct} step="0.0001" disabled={!isAdmin} onChange={onNum('distributor_markup_pct')} />
        </Section>

        <Section title="Destination freight" hint="Rates are per shipment. Changing a fill weight reprices every port at once.">
          <Field label="Container fill weight" unit="kg per 20ft reefer" name="container_fill_kg" value={version.container_fill_kg} step="1" disabled={!isAdmin} onChange={onNum('container_fill_kg')} />
          <Field label="Air lot weight" unit="kg per air consignment" name="air_lot_kg" value={version.air_lot_kg} step="1" disabled={!isAdmin} onChange={onNum('air_lot_kg')} />

          <div className="col-span-full overflow-x-auto">
            <table className="w-full text-xs">
              <thead className="text-left text-[10px] uppercase tracking-wide text-muted-foreground">
                <tr>
                  <th className="py-1 pr-3 font-medium">Destination</th>
                  <th className="py-1 pr-3 text-right font-medium">Sea $ / 20ft</th>
                  <th className="py-1 pr-3 text-right font-medium">Air $ / lot</th>
                  <th className="py-1 pr-3 text-right font-medium">→ Sea $/kg</th>
                  <th className="py-1 text-right font-medium">→ Air $/kg</th>
                </tr>
              </thead>
              <tbody>
                {destinations.map((d) => {
                  const r = rates[d.id] ?? { sea: 0, air: 0 };
                  const fill = draft.container_fill_kg ?? version.container_fill_kg;
                  const lot = draft.air_lot_kg ?? version.air_lot_kg;
                  const sea = draft[`sea_${d.id}`] ?? r.sea;
                  const air = draft[`air_${d.id}`] ?? r.air;
                  return (
                    <tr key={d.id} className="border-t">
                      <td className="py-1.5 pr-3">{d.name}</td>
                      <td className="py-1.5 pr-3 text-right">
                        <input name={`sea_${d.id}`} defaultValue={r.sea} type="number" step="1" min="0" disabled={!isAdmin} onChange={onNum(`sea_${d.id}`)} className={cn(inputCls, 'w-24 text-right')} />
                      </td>
                      <td className="py-1.5 pr-3 text-right">
                        <input name={`air_${d.id}`} defaultValue={r.air} type="number" step="1" min="0" disabled={!isAdmin} onChange={onNum(`air_${d.id}`)} className={cn(inputCls, 'w-24 text-right')} />
                      </td>
                      <td className="py-1.5 pr-3 text-right tabular-nums text-muted-foreground">
                        {fill > 0 ? (sea / fill).toFixed(3) : '—'}
                      </td>
                      <td className="py-1.5 text-right tabular-nums text-muted-foreground">
                        {lot > 0 ? (air / lot).toFixed(3) : '—'}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        </Section>

        {isAdmin && (
          <div className="sticky bottom-4 flex flex-wrap items-center gap-2 rounded-lg border bg-card p-3 shadow-sm">
            <input name="label" placeholder="Name this version, e.g. 'Nov FX + feed'" className={cn(inputCls, 'flex-1 min-w-[200px]')} />
            <input name="notes" placeholder="Why it changed (optional)" className={cn(inputCls, 'flex-1 min-w-[200px]')} />
            <button type="submit" disabled={pending} className="rounded-md bg-primary px-3 py-1.5 text-sm font-medium text-primary-foreground disabled:opacity-50">
              {pending ? 'Publishing…' : 'Publish new version'}
            </button>
            <p className="w-full text-[11px] text-muted-foreground">
              Saving mints a new version rather than editing this one, so costings already sent keep
              the numbers they were built on.
            </p>
          </div>
        )}
      </form>

      <SizeGrades buckets={buckets} isAdmin={isAdmin} />
    </div>
  );
}

// ---------------------------------------------------------------------------

function SizeGrades({ buckets, isAdmin }: { buckets: CostSizeBucket[]; isAdmin: boolean }) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();

  function save(id: string, patch: { median_g?: number; fcr?: number }) {
    startTransition(async () => {
      const res = await saveSizeBucket(id, patch);
      if (res.error) alert(res.error);
      router.refresh();
    });
  }

  return (
    <section className="rounded-lg border bg-card p-4">
      <h2 className="text-sm font-semibold">Size grades</h2>
      <p className="mt-0.5 text-xs text-muted-foreground">
        Only FCR and ODC vary with fish size. These FCR figures are the workbook&apos;s placeholders —
        replace them with real farm data, then the grid&apos;s size selector becomes meaningful.
      </p>
      <div className="mt-3 overflow-x-auto">
        <table className="w-full text-xs">
          <thead className="text-left text-[10px] uppercase tracking-wide text-muted-foreground">
            <tr>
              <th className="py-1 pr-3 font-medium">Grade</th>
              <th className="py-1 pr-3 text-right font-medium">Median weight (g)</th>
              <th className="py-1 text-right font-medium">FCR</th>
            </tr>
          </thead>
          <tbody>
            {buckets.map((b) => (
              <tr key={b.id} className="border-t">
                <td className="py-1.5 pr-3">{b.label}</td>
                <td className="py-1.5 pr-3 text-right">
                  <input
                    type="number" step="1" min={b.min_g} max={b.max_g} defaultValue={b.median_g} disabled={!isAdmin || pending}
                    onBlur={(e) => { const v = Number(e.target.value); if (v !== b.median_g) save(b.id, { median_g: v }); }}
                    className={cn(inputCls, 'w-24 text-right')}
                  />
                </td>
                <td className="py-1.5 text-right">
                  <input
                    type="number" step="0.01" min="0.01" defaultValue={b.fcr} disabled={!isAdmin || pending}
                    onBlur={(e) => { const v = Number(e.target.value); if (v !== b.fcr) save(b.id, { fcr: v }); }}
                    className={cn(inputCls, 'w-20 text-right')}
                  />
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </section>
  );
}

/**
 * Domestic transport and export freight-to-port both price the same movement —
 * the lorry out of the factory. v11 held them as two unrelated numbers and they
 * drifted (60 LKR against $0.10, a 76% gap), which is what this catches.
 *
 * They are not forced equal: a port run genuinely can cost more or less than a
 * delivery run. But a gap this size should be a decision, not an oversight.
 */
function HaulageCheck({ draft, version }: { draft: Record<string, number>; version: CostAssumptionVersion }) {
  const fx = draft.fx_rate ?? version.fx_rate;
  const domesticLkr = draft.domestic_transport_lkr ?? version.domestic_transport_lkr;
  const exportUsd = draft.export_freight_to_port_usd ?? version.export_freight_to_port_usd;
  if (!(fx > 0)) return null;

  const domesticUsd = domesticLkr / fx;
  const gap = exportUsd - domesticUsd;
  const material = Math.abs(gap) > 0.01 && domesticUsd > 0 && Math.abs(gap) / domesticUsd > 0.1;

  return (
    <div className="col-span-full rounded-md bg-muted/40 px-3 py-2 text-[11px]">
      Domestic haulage is{' '}
      <strong className="font-medium">
        {domesticLkr.toFixed(2)} LKR = ${domesticUsd.toFixed(4)}/kg
      </strong>{' '}
      at FX {fx}. Export freight to port is <strong className="font-medium">${exportUsd.toFixed(4)}/kg</strong>.
      {material ? (
        <span className="text-warning">
          {' '}
          That&apos;s {gap > 0 ? 'higher' : 'lower'} by ${Math.abs(gap).toFixed(4)} (
          {Math.abs((gap / domesticUsd) * 100).toFixed(0)}%). These price the same lorry out of the
          factory — if the port run really does differ, fine, but check it&apos;s deliberate.
        </span>
      ) : (
        <span className="text-muted-foreground"> In line with each other.</span>
      )}
    </div>
  );
}

function VersionPicker({ versions, current }: { versions: CostAssumptionVersion[]; current: CostAssumptionVersion }) {
  return (
    <label className="flex items-center gap-1.5 text-xs">
      <History className="h-3.5 w-3.5 text-muted-foreground" />
      <select
        value={current.id}
        onChange={(e) => {
          window.location.href = `/costing/assumptions?v=${e.target.value}`;
        }}
        className={inputCls}
      >
        {versions.map((v) => (
          <option key={v.id} value={v.id}>
            v{v.version_no}
            {v.label ? ` · ${v.label}` : ''}
            {v.is_current ? ' (current)' : ''}
          </option>
        ))}
      </select>
    </label>
  );
}

function MakeCurrentButton({ id, onDone }: { id: string; onDone: () => void }) {
  const [pending, startTransition] = useTransition();
  return (
    <button
      onClick={() =>
        startTransition(async () => {
          const res = await makeVersionCurrent(id);
          if (res.error) alert(res.error);
          onDone();
        })
      }
      disabled={pending}
      className="ml-2 rounded border px-2 py-0.5 text-xs font-medium hover:bg-background/50"
    >
      {pending ? 'Switching…' : 'Make this the current version'}
    </button>
  );
}

function Section({ title, hint, children }: { title: string; hint?: string; children: React.ReactNode }) {
  return (
    <section className="rounded-lg border bg-card p-4">
      <h2 className="text-sm font-semibold">{title}</h2>
      {hint && <p className="mt-0.5 text-xs text-muted-foreground">{hint}</p>}
      <div className="mt-3 grid gap-3 sm:grid-cols-2 lg:grid-cols-3">{children}</div>
    </section>
  );
}

function Field({
  label, unit, name, value, step, disabled, onChange,
}: {
  label: string; unit?: string; name: string; value: number; step?: string; disabled?: boolean;
  onChange?: (e: React.ChangeEvent<HTMLInputElement>) => void;
}) {
  return (
    <label className="block">
      <span className="text-xs font-medium">{label}</span>
      <input name={name} defaultValue={value} type="number" step={step ?? 'any'} min="0" disabled={disabled} onChange={onChange} className={cn(inputCls, 'mt-1 w-full')} />
      {unit && <span className="mt-0.5 block text-[10px] text-muted-foreground">{unit}</span>}
    </label>
  );
}

function Readout({ label, value, hint }: { label: string; value: string; hint?: string }) {
  return (
    <div>
      <div className="text-[10px] uppercase tracking-wide text-muted-foreground">{label}</div>
      <div className="font-medium tabular-nums">{value}</div>
      {hint && <div className="text-[10px] text-muted-foreground">{hint}</div>}
    </div>
  );
}

function Banner({ tone, children }: { tone: 'warning' | 'destructive' | 'success' | 'muted'; children: React.ReactNode }) {
  const tones = {
    warning: 'border-warning/30 bg-warning/10 text-warning',
    destructive: 'border-destructive/30 bg-destructive/10 text-destructive',
    success: 'border-success/30 bg-success/10 text-success',
    muted: 'bg-muted/50 text-muted-foreground',
  };
  return <div className={cn('rounded-md border px-3 py-2 text-xs', tones[tone])}>{children}</div>;
}

const inputCls = 'rounded-md border bg-background px-2 py-1 text-xs disabled:opacity-60';
