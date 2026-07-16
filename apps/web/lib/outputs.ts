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

/** In-scope programs ordered by global rank, with customer + description labels. */
export async function programOrder(supabase: any, planId: string): Promise<OrderedProgram[]> {
  const [{ data: ranks }, { data: progs }] = await Promise.all([
    supabase.from('plan_rank').select('program_id, global_rank, in_scope').eq('plan_id', planId),
    supabase.from('programs').select('id, customer, item_description').eq('plan_id', planId).is('deleted_at', null),
  ]);
  const nameById = new Map<string, any>((progs ?? []).map((p: any) => [p.id, p]));
  return (ranks ?? [])
    .filter((r: any) => r.in_scope)
    .sort((a: any, b: any) => a.global_rank - b.global_rank)
    .map((r: any) => ({
      id: r.program_id,
      rank: r.global_rank,
      label: nameById.get(r.program_id)?.customer ?? '—',
      sublabel: nameById.get(r.program_id)?.item_description ?? '',
    }));
}
