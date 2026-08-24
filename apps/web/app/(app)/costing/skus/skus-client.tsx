'use client';

import { useActionState, useEffect, useMemo, useState, useTransition } from 'react';
import { useRouter } from 'next/navigation';
import { Lock, Pencil, Plus } from 'lucide-react';
import type { CostSizeBucket, CostSkuRow } from '@oceanpick/shared';
import { cn } from '@/lib/utils';
import { ScrollX } from '@/components/ui/scroll-x';
import { archiveCostSku, saveCostSku, saveSkuBucketYield, type SkuFormState } from './actions';

type YieldMap = Record<string, Record<string, number>>;

export function SkusClient({
  skus,
  buckets,
  yields,
  orgId,
  isAdmin,
}: {
  skus: CostSkuRow[];
  buckets: CostSizeBucket[];
  yields: YieldMap;
  orgId: string;
  isAdmin: boolean;
}) {
  const [editing, setEditing] = useState<CostSkuRow | null | undefined>(undefined);
  const [query, setQuery] = useState('');
  const [tab, setTab] = useState<'recipe' | 'yields'>('recipe');

  const visible = useMemo(() => {
    const q = query.trim().toLowerCase();
    return q ? skus.filter((s) => s.name.toLowerCase().includes(q) || s.category.toLowerCase().includes(q)) : skus;
  }, [skus, query]);

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
        {isAdmin && (
          <button onClick={() => setEditing(null)} className="inline-flex items-center gap-1.5 rounded-md bg-primary px-3 py-1.5 text-sm font-medium text-primary-foreground">
            <Plus className="h-3.5 w-3.5" /> New SKU
          </button>
        )}
      </header>

      {!isAdmin && (
        <p className="rounded-md bg-muted/50 px-3 py-2 text-xs text-muted-foreground">
          <Lock className="mr-1.5 inline h-3.5 w-3.5" />
          The SKU list is admin-maintained, so everyone costs off the same recipes.
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
        <RecipeTable skus={visible} isAdmin={isAdmin} onEdit={setEditing} />
      ) : (
        <YieldTable skus={visible} buckets={buckets} yields={yields} isAdmin={isAdmin} />
      )}

      {editing !== undefined && (
        <SkuDialog sku={editing} orgId={orgId} onClose={() => setEditing(undefined)} />
      )}
    </div>
  );
}

// ---------------------------------------------------------------------------

function RecipeTable({
  skus,
  isAdmin,
  onEdit,
}: {
  skus: CostSkuRow[];
  isAdmin: boolean;
  onEdit: (s: CostSkuRow) => void;
}) {
  return (
    <ScrollX className="rounded-lg border bg-card">
      <table className="w-full border-collapse text-right text-xs tabular-nums">
        <thead>
          <tr className="border-b bg-muted/40 text-[10px] uppercase tracking-wide text-muted-foreground">
            <th className={cn(th, 'sticky left-0 z-10 bg-muted/40 text-left')}>SKU</th>
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
                  {isAdmin && (
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
  isAdmin,
}: {
  skus: CostSkuRow[];
  buckets: CostSizeBucket[];
  yields: YieldMap;
  isAdmin: boolean;
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
                        disabled={!isAdmin || pending}
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

function SkuDialog({ sku, orgId, onClose }: { sku: CostSkuRow | null; orgId: string; onClose: () => void }) {
  const router = useRouter();
  const [state, action, pending] = useActionState<SkuFormState, FormData>(saveCostSku, { error: null, ok: false });
  const [basis, setBasis] = useState(sku?.raw_material_basis ?? 'full_fish');
  const [showOverrides, setShowOverrides] = useState(sku ? hasOverride(sku) : false);

  useEffect(() => {
    if (state.ok) {
      onClose();
      router.refresh();
    }
  }, [state.ok, onClose, router]);

  const absorbed = basis === 'absorbed';

  return (
    <div className="fixed inset-0 z-50 flex items-start justify-center overflow-y-auto bg-black/40 p-4" onClick={onClose}>
      <form
        action={action}
        onClick={(e) => e.stopPropagation()}
        className="my-8 w-full max-w-2xl space-y-4 rounded-lg border bg-card p-5 shadow-lg"
      >
        <h2 className="text-lg font-semibold">{sku ? sku.name : 'New SKU'}</h2>
        {sku && <input type="hidden" name="id" value={sku.id} />}
        <input type="hidden" name="org_id" value={orgId} />

        {state.error && (
          <p className="rounded-md border border-destructive/30 bg-destructive/10 px-3 py-2 text-xs text-destructive">
            {state.error}
          </p>
        )}

        <div className="grid gap-3 sm:grid-cols-2">
          <Field label="Name" name="name" defaultValue={sku?.name ?? ''} type="text" className="sm:col-span-2" />
          <Field label="Category" name="category" defaultValue={sku?.category ?? ''} type="text" />
          <Select label="Status" name="status" defaultValue={sku?.status ?? 'active'} options={[['active', 'Active'], ['inactive', 'Inactive']]} />
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
          <Field label="Yield" name="base_yield" defaultValue={sku?.base_yield ?? 0.45} step="0.01" hint="0.45 = 45%" />
          <Field label="Glaze %" name="glaze_pct" defaultValue={sku?.glaze_pct ?? 0} step="0.01" hint="0.2 = 20% added ice" />
          <Field label="Pack size" name="pack_size" defaultValue={sku?.pack_size ?? ''} type="text" hint="optional" />
          <Field label="% fish" name="pct_fish" defaultValue={sku?.pct_fish ?? 1} step="0.01" hint="must total 100% with marinade" />
          <Field label="% marinade" name="pct_marinade" defaultValue={sku?.pct_marinade ?? 0} step="0.01" />
          <Field label="Marinade $/kg" name="marinade_usd_per_kg" defaultValue={sku?.marinade_usd_per_kg ?? 0} step="0.01" />
          <Field label="Process $/kg" name="process_usd_per_kg" defaultValue={sku?.process_usd_per_kg ?? 0} step="0.01" />
          <Field label="Packing $/kg" name="packing_usd_per_kg" defaultValue={sku?.packing_usd_per_kg ?? 0} step="0.01" />
        </div>

        <fieldset className={cn('rounded-md border p-3', absorbed && 'border-primary/40 bg-primary/5')}>
          <legend className="px-1 text-xs font-semibold">
            Market price {absorbed && <span className="font-normal text-primary">— drives contribution</span>}
          </legend>
          <div className="grid gap-3 sm:grid-cols-2">
            <Field label="Domestic (LKR/kg)" name="market_price_lkr" defaultValue={sku?.market_price_lkr ?? ''} step="1" hint="what the market bears" />
            <Field label="Export (USD/kg)" name="market_price_usd" defaultValue={sku?.market_price_usd ?? ''} step="0.01" hint="blank = no contribution shown" />
          </div>
        </fieldset>

        <div className="rounded-md border p-3">
          <button type="button" onClick={() => setShowOverrides((v) => !v)} className="text-xs font-semibold">
            {showOverrides ? '▾' : '▸'} Per-SKU overrides
            <span className="ml-1.5 font-normal text-muted-foreground">blank inherits the global value</span>
          </button>
          {showOverrides && (
            <div className="mt-3 grid gap-3 sm:grid-cols-3">
              <Field label="Rack margin" name="override_rack_margin_pct" defaultValue={sku?.override_rack_margin_pct ?? ''} step="0.01" />
              <Field label="FOB margin" name="override_fob_margin_pct" defaultValue={sku?.override_fob_margin_pct ?? ''} step="0.01" />
              <Field label="Transport LKR/kg" name="override_transport_lkr" defaultValue={sku?.override_transport_lkr ?? ''} step="0.01" />
              <Field label="Cold-hold LKR/kg" name="override_cold_hold_lkr" defaultValue={sku?.override_cold_hold_lkr ?? ''} step="0.01" />
              <Field label="Freight to port $/kg" name="override_freight_to_port_usd" defaultValue={sku?.override_freight_to_port_usd ?? ''} step="0.01" />
              <Field label="Cold chain $/kg" name="override_cold_chain_usd" defaultValue={sku?.override_cold_chain_usd ?? ''} step="0.01" />
            </div>
          )}
        </div>

        <div className="flex items-center justify-between gap-2">
          {sku ? <ArchiveButton id={sku.id} onDone={onClose} /> : <span />}
          <div className="flex gap-2">
            <button type="button" onClick={onClose} className="rounded-md border px-3 py-1.5 text-sm font-medium hover:bg-muted">
              Cancel
            </button>
            <button type="submit" disabled={pending} className="rounded-md bg-primary px-3 py-1.5 text-sm font-medium text-primary-foreground disabled:opacity-50">
              {pending ? 'Saving…' : 'Save'}
            </button>
          </div>
        </div>
      </form>
    </div>
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
  s.override_cold_chain_usd != null;

const pct = (n: number) => (n * 100).toFixed(0) + '%';
const th = 'whitespace-nowrap px-2 py-2 font-medium';
const td = 'whitespace-nowrap px-2 py-1.5';
const inputCls = 'rounded-md border bg-background px-2 py-1 text-xs disabled:opacity-60';
