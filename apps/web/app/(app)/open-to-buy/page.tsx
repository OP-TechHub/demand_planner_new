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
  const [{ data: buckets }, uw, pw] = await Promise.all([
    supabase.from('buckets').select('id, name, sort_order').eq('is_archived', false).order('sort_order'),
    fetchAllByPlan(supabase, 'unallocated_wr', 'bucket_id, month_index, unallocated_wr', plan.id),
    fetchAllByPlan(supabase, 'pipeline_wr', 'bucket_id, month_index, pipeline_wr', plan.id),
  ]);

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
            <p className="text-xs text-muted-foreground">Whole-round (kg WR) consumed from each month&apos;s harvest by <b>pipeline / inquiry</b> programs (own-month + forward-borrowings sourcing here).</p>
            <OutputGrid planStartDate={plan.plan_start_date} horizon={plan.horizon_months} rows={allocatedRows} format="num0" firstColLabel="Bucket" />
          </section>
        </>
      )}
    </div>
  );
}
