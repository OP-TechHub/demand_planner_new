/* eslint-disable @typescript-eslint/no-explicit-any */
/**
 * Fetch every row for a plan from a computed/input table, paging past
 * PostgREST's 1000-row cap (rolling_results is up to 50×60 = 3000 rows).
 */
export async function fetchAllByPlan(supabase: any, table: string, cols: string, planId: string): Promise<any[]> {
  const out: any[] = [];
  for (let from = 0; ; from += 1000) {
    const { data, error } = await supabase.from(table).select(cols).eq('plan_id', planId).range(from, from + 999);
    if (error) throw new Error(`${table}: ${error.message}`);
    out.push(...(data ?? []));
    if (!data || data.length < 1000) break;
  }
  return out;
}
