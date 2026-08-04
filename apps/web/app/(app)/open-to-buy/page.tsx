import { createClient } from '@/lib/supabase/server';
import { getActivePlan } from '@/lib/plan';
import { OutputGrid, NotComputed } from '@/components/output-grid';
import { gridCsvRows, type GridRow } from '@/lib/grid-csv';
import { StalePlanNotice } from '../stale-banner';
import { ExportCsvButton } from '@/components/export-csv-button';
import { fetchAllByPlan } from '@/lib/fetch-all';

export default async function OpenToBuyPage() {
  const plan = await getActivePlan();
  if (!plan) return <h1 className="text-2xl font-semibold">Open to buy</h1>;
  const supabase = await createClient();

  const months = Array.from({ length: plan.horizon_months }, (_, i) => i + 1);
  const [{ data: buckets }, uw, pw, { data: pipePrograms }, allocs, rr] = await Promise.all([
    supabase.from('buckets').select('id, name, sort_order').eq('is_archived', false).order('sort_order'),
    fetchAllByPlan(supabase, 'unallocated_wr', 'bucket_id, month_index, unallocated_wr', plan.id),
    fetchAllByPlan(supabase, 'pipeline_wr', 'bucket_id, month_index, pipeline_wr', plan.id),
    // For the per-cell breakdown: which pipeline programs consumed each bucket-month.
    supabase.from('programs')
      .select('id, item_code, item_description, customer, primary_bucket_id, secondary_bucket_id, tertiary_bucket_id')
      .eq('plan_id', plan.id).eq('status', 'pipeline').is('deleted_at', null).order('sort_order'),
    fetchAllByPlan(supabase, 'allocations', 'program_id, month_index, path, allocated_wr', plan.id),
    fetchAllByPlan(supabase, 'rolling_results',
      'program_id, month_index, demand_fp, rolling_fp, borrow_m1_prim_wr, borrow_m1_alt_wr, borrow_m1_tert_wr, borrow_m2_prim_wr, borrow_m2_alt_wr, borrow_m2_tert_wr', plan.id),
  ]);

  // Reconstruct pipeline_wr's per-program breakdown per (bucket, month), exactly as
  // the engine attributes it: own-month allocations + the 6 borrow channels (each
  // sourcing from its path's bucket at month−offset).
  type Prog = { label: string; buckets: (string | null)[] }; // [primary, secondary, tertiary]
  const pipe = new Map<string, Prog>();
  for (const p of (pipePrograms ?? []) as { id: string; item_code: string; item_description: string; primary_bucket_id: string; secondary_bucket_id: string | null; tertiary_bucket_id: string | null }[]) {
    pipe.set(p.id, { label: `${p.item_code} — ${p.item_description}`, buckets: [p.primary_bucket_id, p.secondary_bucket_id, p.tertiary_bucket_id] });
  }
  const contrib = new Map<string, Map<string, number>>(); // `${bucket}:${month}` -> programId -> wr
  const add = (bucket: string | null | undefined, month: number, progId: string, wr: number) => {
    if (!bucket || month < 1 || !(wr > 0)) return;
    const k = `${bucket}:${month}`;
    let inner = contrib.get(k);
    if (!inner) { inner = new Map(); contrib.set(k, inner); }
    inner.set(progId, (inner.get(progId) ?? 0) + wr);
  };
  const PATH_IDX = { primary: 0, secondary: 1, tertiary: 2 } as const;
  for (const a of allocs as { program_id: string; month_index: number; path: keyof typeof PATH_IDX; allocated_wr: number }[]) {
    const p = pipe.get(a.program_id);
    if (p) add(p.buckets[PATH_IDX[a.path]], a.month_index, a.program_id, Number(a.allocated_wr));
  }
  for (const r of rr as Record<string, number | string>[]) {
    const p = pipe.get(r.program_id as string);
    if (!p) continue;
    const T = r.month_index as number;
    add(p.buckets[0], T - 1, r.program_id as string, Number(r.borrow_m1_prim_wr));
    add(p.buckets[1], T - 1, r.program_id as string, Number(r.borrow_m1_alt_wr));
    add(p.buckets[2], T - 1, r.program_id as string, Number(r.borrow_m1_tert_wr));
    add(p.buckets[0], T - 2, r.program_id as string, Number(r.borrow_m2_prim_wr));
    add(p.buckets[1], T - 2, r.program_id as string, Number(r.borrow_m2_alt_wr));
    add(p.buckets[2], T - 2, r.program_id as string, Number(r.borrow_m2_tert_wr));
  }
  const allocatedTitles = new Map<string, string>();
  for (const [k, inner] of contrib) {
    const items = [...inner.entries()].filter(([, wr]) => wr > 0.5).sort((a, b) => b[1] - a[1]);
    if (!items.length) continue;
    const lines = items.slice(0, 12).map(([pid, wr]) => `${pipe.get(pid)?.label ?? pid}: ${Math.round(wr).toLocaleString()} kg`);
    const extra = items.length > 12 ? `\n… +${items.length - 12} more` : '';
    allocatedTitles.set(k, `Inquiries allocated here:\n${lines.join('\n')}${extra}`);
  }

  const gridFor = (rowsByBM: Map<string, number>): GridRow[] =>
    (buckets ?? []).map((b) => ({
      key: b.id,
      label: b.name,
      values: months.map((m) => rowsByBM.get(`${b.id}:${m}`) ?? 0),
    }));

  const uwByBM = new Map<string, number>();
  for (const r of uw) uwByBM.set(`${r.bucket_id}:${r.month_index}`, r.unallocated_wr);
  const pwByBM = new Map<string, number>();
  for (const r of pw) pwByBM.set(`${r.bucket_id}:${r.month_index}`, r.pipeline_wr);

  const unallocatedRows = gridFor(uwByBM);
  const allocatedRows = gridFor(pwByBM);
  const computed = uw.length > 0 || pw.length > 0;

  // Inquiry fulfilment: each pipeline program's demand vs what the plan can fulfil,
  // per month — coloured green (fulfilled) to red (short), proportionally.
  const kg = (n: number) => `${Math.round(n).toLocaleString()} kg`;
  const pipeRows = (pipePrograms ?? []) as { id: string; item_code: string; item_description: string; customer: string }[];
  const demByPM = new Map<string, number>();
  const fulByPM = new Map<string, number>();
  for (const r of rr as Record<string, number | string>[]) {
    if (!pipe.has(r.program_id as string)) continue;
    demByPM.set(`${r.program_id}:${r.month_index}`, Number(r.demand_fp));
    fulByPM.set(`${r.program_id}:${r.month_index}`, Number(r.rolling_fp));
  }
  const fulfilRows: GridRow[] = pipeRows.map((p) => ({
    key: p.id, label: p.customer, sublabel: `${p.item_description} (${p.item_code})`,
    values: months.map((m) => demByPM.get(`${p.id}:${m}`) ?? null),
  }));
  const fulfilBg = new Map<string, string>();
  const fulfilTitle = new Map<string, string>();
  for (const p of pipeRows) {
    for (const m of months) {
      const dem = demByPM.get(`${p.id}:${m}`) ?? 0;
      if (dem <= 0) continue;
      const ful = Math.min(fulByPM.get(`${p.id}:${m}`) ?? 0, dem);
      const s = Math.round(Math.max(0, Math.min(1, ful / dem)) * 100);
      fulfilBg.set(`${p.id}:${m}`, `linear-gradient(90deg, #bbf7d0 0 ${s}%, #fecaca ${s}% 100%)`);
      fulfilTitle.set(`${p.id}:${m}`, `Fulfilled ${kg(ful)} of ${kg(dem)} (${s}%) — short ${kg(dem - ful)}`);
    }
  }
  const anyFulfil = fulfilRows.some((r) => r.values.some((v) => (v ?? 0) > 0));

  return (
    <div className="space-y-8">
      <div>
        <h1 className="text-2xl font-semibold tracking-tight">Open to buy</h1>
        <p className="mt-1 text-sm text-muted-foreground">Spare capacity and inquiry-committed whole round, per bucket × month.</p>
      </div>

      <StalePlanNotice planId={plan.id} lastComputedAt={plan.last_computed_at} />

      {!computed ? (
        <NotComputed />
      ) : (
        <>
          {/* Unallocated WR */}
          <section className="space-y-3">
            <div className="flex items-center justify-between">
              <h2 className="text-lg font-semibold">Unallocated WR</h2>
              {uw.length > 0 && <ExportCsvButton filename="unallocated-wr.csv" rows={gridCsvRows('Bucket', plan.plan_start_date, plan.horizon_months, unallocatedRows)} />}
            </div>
            <p className="text-xs text-muted-foreground">Spare whole-round capacity (kg WR) per bucket × month, after own-month consumption and all borrowings.</p>
            <OutputGrid planStartDate={plan.plan_start_date} horizon={plan.horizon_months} rows={unallocatedRows} format="num0" firstColLabel="Bucket" />
          </section>

          {/* Allocated with inquiries (formerly Pipeline WR) */}
          <section className="space-y-3">
            <div className="flex items-center justify-between">
              <h2 className="text-lg font-semibold">Allocated with inquiries</h2>
              {pw.length > 0 && <ExportCsvButton filename="allocated-with-inquiries.csv" rows={gridCsvRows('Bucket', plan.plan_start_date, plan.horizon_months, allocatedRows)} />}
            </div>
            <p className="text-xs text-muted-foreground">Whole-round (kg WR) consumed from each month&apos;s harvest by <b>pipeline / inquiry</b> programs (own-month + forward-borrowings sourcing here). Hover a value to see which inquiries make it up.</p>
            <OutputGrid planStartDate={plan.plan_start_date} horizon={plan.horizon_months} rows={allocatedRows} format="num0" firstColLabel="Bucket" cellTitle={allocatedTitles} />
          </section>

          {/* Inquiry fulfilment — which pipeline orders can be met */}
          <section className="space-y-3">
            <div className="flex items-center justify-between">
              <h2 className="text-lg font-semibold">Inquiry fulfilment</h2>
              {anyFulfil && <ExportCsvButton filename="inquiry-fulfilment.csv" rows={gridCsvRows('Program', plan.plan_start_date, plan.horizon_months, fulfilRows)} />}
            </div>
            <p className="text-xs text-muted-foreground">
              Each pipeline order&apos;s demand (kg FP) per month, shaded by how much the plan can fulfil —
              <span className="mx-1 rounded px-1" style={{ background: '#bbf7d0', color: '#1e293b' }}>fully</span>,
              <span className="mx-1 rounded px-1" style={{ background: '#fecaca', color: '#1e293b' }}>short</span>,
              or a green/red split for partial. Hover a value for the fulfilled vs short split.
            </p>
            {anyFulfil ? (
              <OutputGrid planStartDate={plan.plan_start_date} horizon={plan.horizon_months} rows={fulfilRows} format="num0" firstColLabel="Program" cellTitle={fulfilTitle} cellBg={fulfilBg} />
            ) : (
              <p className="rounded-lg border border-dashed p-4 text-sm text-muted-foreground">
                No pipeline demand is being computed. Pipeline orders are fulfilled only when the plan&apos;s Scope is <b>Active + Pipeline</b> (Settings) — set that and Recalculate to see this.
              </p>
            )}
          </section>
        </>
      )}
    </div>
  );
}
