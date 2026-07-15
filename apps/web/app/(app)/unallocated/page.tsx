import { createClient } from '@/lib/supabase/server';
import { getActivePlan } from '@/lib/plan';
import { OutputGrid, NotComputed, type GridRow } from '@/components/output-grid';
import { fetchAllByPlan } from '@/lib/fetch-all';
import { num0 } from '@/lib/format';

export default async function UnallocatedPage() {
  const plan = await getActivePlan();
  if (!plan) return <h1 className="text-2xl font-semibold">Unallocated WR</h1>;
  const supabase = await createClient();

  const { data: buckets } = await supabase.from('buckets').select('id, name, sort_order').eq('is_archived', false).order('sort_order');
  const uw = await fetchAllByPlan(supabase, 'unallocated_wr', 'bucket_id, month_index, unallocated_wr', plan.id);
  const byBM = new Map<string, number>();
  for (const r of uw) byBM.set(`${r.bucket_id}:${r.month_index}`, r.unallocated_wr);
  const months = Array.from({ length: plan.horizon_months }, (_, i) => i + 1);

  const rows: GridRow[] = (buckets ?? []).map((b) => ({
    key: b.id, label: b.name,
    values: months.map((m) => byBM.get(`${b.id}:${m}`) ?? 0),
  }));

  return (
    <div className="space-y-4">
      <h1 className="text-2xl font-semibold tracking-tight">Unallocated WR</h1>
      {uw.length === 0 ? (
        <NotComputed />
      ) : (
        <>
          <p className="text-xs text-muted-foreground">Spare whole-round capacity (kg WR) per bucket × month, after own-month consumption and all borrowings.</p>
          <OutputGrid planStartDate={plan.plan_start_date} horizon={plan.horizon_months} rows={rows} format={num0} firstColLabel="Bucket" />
        </>
      )}
    </div>
  );
}
