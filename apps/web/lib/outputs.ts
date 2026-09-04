/* eslint-disable @typescript-eslint/no-explicit-any */
// Shared loaders for the output pages.
import type { GridRow } from '@/components/output-grid';

export interface OrderedProgram { id: string; rank: number; label: string; sublabel: string }

/** Build per-program month arrays from rolling_results rows, in rank order. */
export function gridRowsFor(order: OrderedProgram[], rr: any[], months: number, valueKey: string): GridRow[] {
  const byPM = new Map<string, number>();
  for (const r of rr) byPM.set(`${r.program_id}:${r.month_index}`, r[valueKey]);
  return order.map((p) => ({
    key: p.id, label: p.label, sublabel: p.sublabel,
    values: Array.from({ length: months }, (_, i) => byPM.get(`${p.id}:${i + 1}`) ?? 0),
  }));
}

/**
 * The same figures per kilo of finished product.
 *
 * The engine builds revenue and cost as `rolling_fp × rate` (aggregate.ts), so
 * dividing gives back the rate that was actually charged — the realised price
 * per kg for revenue, the loaded cost per kg for cost, and the difference for
 * margin. A month that shipped nothing has no rate to report, so it reads 0
 * and, carrying a zero weight, is excluded from the averages rather than
 * dragging them down.
 */
export function unitGridRowsFor(
  order: OrderedProgram[],
  rr: any[],
  months: number,
  valueKey: string,
  volumeKey = 'rolling_fp'
): GridRow[] {
  const byPM = new Map<string, { v: number; w: number }>();
  for (const r of rr) {
    byPM.set(`${r.program_id}:${r.month_index}`, { v: Number(r[valueKey]) || 0, w: Number(r[volumeKey]) || 0 });
  }
  return order.map((p) => {
    const cells = Array.from({ length: months }, (_, i) => byPM.get(`${p.id}:${i + 1}`) ?? { v: 0, w: 0 });
    return {
      key: p.id,
      label: p.label,
      sublabel: p.sublabel,
      values: cells.map((c) => (c.w > 0 ? c.v / c.w : 0)),
      weights: cells.map((c) => c.w),
    };
  });
}

/**
 * In-scope programs with customer + description labels, ordered alphabetically
 * by customer and then by item description, so a row is found by name rather
 * than by remembering where it landed in the allocation ranking. Each entry
 * still carries its rank for the pages that display it.
 */
export async function programOrder(supabase: any, planId: string): Promise<OrderedProgram[]> {
  const [{ data: ranks }, { data: progs }] = await Promise.all([
    supabase.from('plan_rank').select('program_id, global_rank, in_scope').eq('plan_id', planId),
    supabase.from('programs').select('id, customer, item_description').eq('plan_id', planId).is('deleted_at', null),
  ]);
  const nameById = new Map<string, any>((progs ?? []).map((p: any) => [p.id, p]));
  const collator = new Intl.Collator(undefined, { sensitivity: 'base', numeric: true });
  return (ranks ?? [])
    .filter((r: any) => r.in_scope)
    .map((r: any) => ({
      id: r.program_id,
      rank: r.global_rank,
      label: nameById.get(r.program_id)?.customer ?? '—',
      sublabel: nameById.get(r.program_id)?.item_description ?? '',
    }))
    .sort(
      (a: OrderedProgram, b: OrderedProgram) =>
        collator.compare(a.label, b.label) ||
        collator.compare(a.sublabel, b.sublabel) ||
        a.rank - b.rank
    );
}
