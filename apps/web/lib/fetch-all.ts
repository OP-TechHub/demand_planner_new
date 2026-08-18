/* eslint-disable @typescript-eslint/no-explicit-any */
/**
 * Fetch every row for a plan from a computed/input table, paging past
 * PostgREST's 1000-row cap (rolling_results is up to 50×60 = 3000 rows).
 */
export async function fetchAllByPlan(supabase: any, table: string, cols: string, planId: string): Promise<any[]> {
  return fetchAllPaged((from, to) => supabase.from(table).select(cols).eq('plan_id', planId).range(from, to), table);
}

/**
 * Page any query past the 1000-row cap. `build` must apply `.range(from, to)` to
 * the query it returns — everything else (filters, ordering) is the caller's.
 *
 * Needed wherever a query can exceed 1000 rows, which for these tables means
 * roughly (programs or buckets) × months. Without it PostgREST returns the first
 * page and NO error, so the caller silently works from partial data.
 */
export async function fetchAllPaged(
  build: (from: number, to: number) => any,
  label = 'query'
): Promise<any[]> {
  const out: any[] = [];
  for (let from = 0; ; from += 1000) {
    const { data, error } = await build(from, from + 999);
    if (error) throw new Error(`${label}: ${error.message}`);
    out.push(...(data ?? []));
    if (!data || data.length < 1000) break;
  }
  return out;
}
