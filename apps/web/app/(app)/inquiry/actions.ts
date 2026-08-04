'use server';

import { createClient } from '@/lib/supabase/server';

/** One of a program's sourcing paths, with the spare WR in its bucket that month. */
export type InquiryPath = {
  path: 'primary' | 'secondary' | 'tertiary';
  bucket_id: string;
  bucket_name: string;
  yield: number;
  unallocated_wr: number;
};

export type InquiryOtherProgram = {
  item_code: string;
  item_description: string;
  demand_fp: number;
};

export type InquiryContext =
  | {
      ok: true;
      /** false when the plan has no computed results yet (needs a recompute). */
      computed: boolean;
      program: {
        id: string;
        item_code: string;
        item_description: string;
        customer: string;
        price_per_fp: number;
        status: string;
        current_demand_fp: number;
      };
      paths: InquiryPath[];
      otherActive: InquiryOtherProgram[];
    }
  | { ok: false; error: string };

/**
 * Gather everything the inquiry screen needs for one (program, month): the
 * program's sourcing paths with the spare whole-round (unallocated_wr) in each
 * bucket that month, the currently-planned demand (so the user can override
 * it), and the customer's other active programs. The FP↔WR arithmetic is done
 * client-side from these numbers so it updates live as the quantity changes.
 */
export async function getInquiryContext(
  planId: string,
  programId: string,
  monthIndex: number
): Promise<InquiryContext> {
  if (!planId || !programId || !monthIndex) return { ok: false, error: 'Missing selection.' };

  const supabase = await createClient();
  const { data: progData } = await supabase
    .from('programs')
    .select(
      'id, item_code, item_description, customer, status, price_per_fp, max_monthly_demand_fp, ' +
        'primary_bucket_id, secondary_bucket_id, tertiary_bucket_id, ' +
        'primary_yield, secondary_yield, tertiary_yield'
    )
    .eq('id', programId)
    .is('deleted_at', null)
    .maybeSingle();
  if (!progData) return { ok: false, error: 'Program not found.' };
  // The concatenated select defeats Supabase's row-type inference, so name the shape.
  const prog = progData as unknown as {
    id: string; item_code: string; item_description: string; customer: string; status: string;
    price_per_fp: number; max_monthly_demand_fp: number;
    primary_bucket_id: string; secondary_bucket_id: string | null; tertiary_bucket_id: string | null;
    primary_yield: number; secondary_yield: number | null; tertiary_yield: number | null;
  };

  // Currently-planned demand this month: the override if set, else the baseline.
  const { data: dcell } = await supabase
    .from('demand_plan')
    .select('demand_fp')
    .eq('program_id', programId)
    .eq('month_index', monthIndex)
    .maybeSingle();
  const currentDemand = Number(dcell?.demand_fp ?? prog.max_monthly_demand_fp);

  const rawPaths = [
    { path: 'primary' as const, bucket_id: prog.primary_bucket_id, yield: Number(prog.primary_yield) },
    prog.secondary_bucket_id
      ? { path: 'secondary' as const, bucket_id: prog.secondary_bucket_id, yield: Number(prog.secondary_yield) }
      : null,
    prog.tertiary_bucket_id
      ? { path: 'tertiary' as const, bucket_id: prog.tertiary_bucket_id, yield: Number(prog.tertiary_yield) }
      : null,
  ].filter((p): p is { path: 'primary' | 'secondary' | 'tertiary'; bucket_id: string; yield: number } => p !== null);

  const bucketIds = [...new Set(rawPaths.map((p) => p.bucket_id))];

  const [{ data: buckets }, { data: unalloc }, { data: anyResult }] = await Promise.all([
    supabase.from('buckets').select('id, name').in('id', bucketIds),
    supabase
      .from('unallocated_wr')
      .select('bucket_id, unallocated_wr')
      .eq('plan_id', planId)
      .eq('month_index', monthIndex)
      .in('bucket_id', bucketIds),
    supabase.from('unallocated_wr').select('bucket_id').eq('plan_id', planId).limit(1),
  ]);

  const nameById = new Map((buckets ?? []).map((b: { id: string; name: string }) => [b.id, b.name]));
  const unallocById = new Map(
    (unalloc ?? []).map((u: { bucket_id: string; unallocated_wr: number }) => [u.bucket_id, Number(u.unallocated_wr)])
  );
  const computed = (anyResult ?? []).length > 0;

  const paths: InquiryPath[] = rawPaths.map((p) => ({
    ...p,
    bucket_name: nameById.get(p.bucket_id) ?? 'Unknown bucket',
    unallocated_wr: unallocById.get(p.bucket_id) ?? 0,
  }));

  // Other active programs for the same customer, with their demand this month.
  const { data: others } = await supabase
    .from('programs')
    .select('id, item_code, item_description, max_monthly_demand_fp')
    .eq('plan_id', planId)
    .eq('customer', prog.customer)
    .eq('status', 'active')
    .neq('id', programId)
    .is('deleted_at', null)
    .order('sort_order');
  const otherRows = (others ?? []) as {
    id: string; item_code: string; item_description: string; max_monthly_demand_fp: number;
  }[];
  const demByProg = new Map<string, number>();
  if (otherRows.length) {
    const { data: drows } = await supabase
      .from('demand_plan')
      .select('program_id, demand_fp')
      .eq('month_index', monthIndex)
      .in('program_id', otherRows.map((o) => o.id));
    for (const d of (drows ?? []) as { program_id: string; demand_fp: number }[]) {
      demByProg.set(d.program_id, Number(d.demand_fp));
    }
  }
  const otherActive: InquiryOtherProgram[] = otherRows.map((o) => ({
    item_code: o.item_code,
    item_description: o.item_description,
    demand_fp: demByProg.get(o.id) ?? Number(o.max_monthly_demand_fp),
  }));

  return {
    ok: true,
    computed,
    program: {
      id: prog.id,
      item_code: prog.item_code,
      item_description: prog.item_description,
      customer: prog.customer,
      price_per_fp: Number(prog.price_per_fp),
      status: prog.status,
      current_demand_fp: currentDemand,
    },
    paths,
    otherActive,
  };
}
