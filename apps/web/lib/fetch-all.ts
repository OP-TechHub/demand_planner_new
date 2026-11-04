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
 *
 * The first page goes alone (most queries fit in it). If it comes back full,
 * the next pages are requested in parallel batches, so a 3000-row read costs
 * two round trips instead of four — each page is one database round trip.
 */
const PAGE = 1000;
const BATCH = 4;

export async function fetchAllPaged(
  build: (from: number, to: number) => any,
  label = 'query'
): Promise<any[]> {
  const page = async (from: number): Promise<any[]> => {
    const { data, error } = await build(from, from + PAGE - 1);
    if (error) throw new Error(`${label}: ${error.message}`);
    return data ?? [];
  };

  const out = await page(0);
  if (out.length < PAGE) return out;
  for (let start = PAGE; ; start += PAGE * BATCH) {
    const pages = await Promise.all(Array.from({ length: BATCH }, (_, k) => page(start + k * PAGE)));
    for (const rows of pages) {
      out.push(...rows);
      if (rows.length < PAGE) return out;
    }
  }
}
