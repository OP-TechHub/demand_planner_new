import { createClient } from '@/lib/supabase/server';
import { getActivePlan } from '@/lib/plan';
import { OutputGrid, NotComputed, gridCsvRows, type GridRow } from '@/components/output-grid';
import { ExportCsvButton } from '@/components/export-csv-button';
import { fetchAllByPlan } from '@/lib/fetch-all';
import { programOrder } from '@/lib/outputs';
import { pct } from '@/lib/format';

function fulfilmentColor(v: number | null): string {
  if (v == null) return 'text-muted-foreground/40';
  if (v >= 0.95) return 'bg-green-100 text-green-800';
  if (v >= 0.8) return 'bg-amber-100 text-amber-800';
  return 'bg-red-100 text-red-800';
}

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
      <div className="flex items-center justify-between">
        <h1 className="text-2xl font-semibold tracking-tight">Program Fulfilment</h1>
        {rows.length > 0 && <ExportCsvButton filename="program-fulfilment.csv" rows={gridCsvRows('Program', plan.plan_start_date, plan.horizon_months, rows, false)} />}
      </div>
      {rows.length === 0 ? (
        <NotComputed />
      ) : (
        <>
          <p className="text-xs text-muted-foreground">Fulfilment % by program × month. Green ≥ 95%, amber 80–95%, red &lt; 80%. Blank = no demand.</p>
          <OutputGrid planStartDate={plan.plan_start_date} horizon={plan.horizon_months} rows={rows} format={pct} colorFor={fulfilmentColor} hideTotals />
        </>
      )}
    </div>
  );
}
