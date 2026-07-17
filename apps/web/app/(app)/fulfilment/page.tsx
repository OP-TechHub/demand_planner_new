import { createClient } from '@/lib/supabase/server';
import { getActivePlan } from '@/lib/plan';
import { OutputGrid, NotComputed } from '@/components/output-grid';
import { gridCsvRows, type GridRow } from '@/lib/grid-csv';
import { StalePlanNotice } from '../stale-banner';
import { ExportCsvButton } from '@/components/export-csv-button';
import { fetchAllByPlan } from '@/lib/fetch-all';
import { programOrder } from '@/lib/outputs';

export default async function FulfilmentPage() {
  const plan = await getActivePlan();
  if (!plan) return <h1 className="text-2xl font-semibold">Program Fulfilment</h1>;
  const supabase = await createClient();

  const order = await programOrder(supabase, plan.id);
  const rr = await fetchAllByPlan(supabase, 'rolling_results', 'program_id, month_index, fulfilment_pct', plan.id);
  const byPM = new Map<string, number | null>();
  for (const r of rr) byPM.set(`${r.program_id}:${r.month_index}`, r.fulfilment_pct);
  const months = Array.from({ length: plan.horizon_months }, (_, i) => i + 1);

  const rows: GridRow[] = order.map((p) => ({
    key: p.id, label: p.label, sublabel: p.sublabel,
    values: months.map((m) => byPM.get(`${p.id}:${m}`) ?? null),
  }));

  return (
    <div className="space-y-4">
      <StalePlanNotice planId={plan.id} lastComputedAt={plan.last_computed_at} />
      <div className="flex items-center justify-between">
        <h1 className="text-2xl font-semibold tracking-tight">Program Fulfilment</h1>
        {rows.length > 0 && <ExportCsvButton filename="program-fulfilment.csv" rows={gridCsvRows('Program', plan.plan_start_date, plan.horizon_months, rows, false)} />}
      </div>
      {rows.length === 0 ? (
        <NotComputed />
      ) : (
        <>
          <p className="text-xs text-muted-foreground">Fulfilment % by program × month. Green ≥ 95%, amber 80–95%, red &lt; 80%. Blank = no demand.</p>
          <OutputGrid planStartDate={plan.plan_start_date} horizon={plan.horizon_months} rows={rows} format="pct" colorFor="fulfilment" hideTotals />
        </>
      )}
    </div>
  );
}
