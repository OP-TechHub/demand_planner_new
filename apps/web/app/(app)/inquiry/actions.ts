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

/** The program's picture for one month in the inquiry range. */
export type InquiryMonth = {
  month_index: number;
  current_demand_fp: number;
  paths: InquiryPath[];
};

export type InquiryOtherProgram = {
  item_code: string;
  item_description: string;
  /** Total demand across the inquiry range. */
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
      };
      months: InquiryMonth[];
      otherActive: InquiryOtherProgram[];
    }
  | { ok: false; error: string };

/**
 * Gather everything the inquiry screen needs for one program across a set of
 * months (a contiguous range or hand-picked months — the caller decides and
 * passes the resolved list): per month, the program's sourcing paths with each
 * bucket's spare whole-round (unallocated_wr) and the currently-planned demand
 * (so each month can be overridden). Months are independent — each draws from
 * its own month's spare capacity — so the client cascades each one on its own.
 */
export async function getInquiryContext(
  planId: string,
  programId: string,
  monthIndices: number[]
): Promise<InquiryContext> {
  if (!planId || !programId) return { ok: false, error: 'Missing selection.' };
  const monthsSel = [...new Set(monthIndices)]
    .filter((m) => Number.isInteger(m) && m >= 1)
    .sort((a, b) => a - b);
  if (monthsSel.length === 0) return { ok: false, error: 'Pick at least one month.' };

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
  const baseline = Number(prog.max_monthly_demand_fp);

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

  const [{ data: buckets }, { data: unalloc }, { data: anyResult }, { data: ownDemand }] = await Promise.all([
    supabase.from('buckets').select('id, name').in('id', bucketIds),
    supabase
      .from('unallocated_wr')
      .select('bucket_id, month_index, unallocated_wr')
      .eq('plan_id', planId)
      .in('bucket_id', bucketIds)
      .in('month_index', monthsSel),
    supabase.from('unallocated_wr').select('bucket_id').eq('plan_id', planId).limit(1),
    supabase
      .from('demand_plan')
      .select('month_index, demand_fp')
      .eq('program_id', programId)
      .in('month_index', monthsSel),
  ]);

  const nameById = new Map((buckets ?? []).map((b: { id: string; name: string }) => [b.id, b.name]));
  const unallocByKey = new Map(
    (unalloc ?? []).map((u: { bucket_id: string; month_index: number; unallocated_wr: number }) => [
      `${u.bucket_id}:${u.month_index}`,
      Number(u.unallocated_wr),
    ])
  );
  const demandByMonth = new Map(
    (ownDemand ?? []).map((d: { month_index: number; demand_fp: number }) => [d.month_index, Number(d.demand_fp)])
  );
  const computed = (anyResult ?? []).length > 0;

  const months: InquiryMonth[] = monthsSel.map((m) => ({
    month_index: m,
    current_demand_fp: demandByMonth.get(m) ?? baseline,
    paths: rawPaths.map((p) => ({
      ...p,
      bucket_name: nameById.get(p.bucket_id) ?? 'Unknown bucket',
      unallocated_wr: unallocByKey.get(`${p.bucket_id}:${m}`) ?? 0,
    })),
  }));

  // Other active programs for the same customer, with total demand across the range.
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
  const overridesByProg = new Map<string, Map<number, number>>();
  if (otherRows.length) {
    const { data: drows } = await supabase
      .from('demand_plan')
      .select('program_id, month_index, demand_fp')
      .in('program_id', otherRows.map((o) => o.id))
      .in('month_index', monthsSel);
    for (const d of (drows ?? []) as { program_id: string; month_index: number; demand_fp: number }[]) {
      const map = overridesByProg.get(d.program_id) ?? new Map<number, number>();
      map.set(d.month_index, Number(d.demand_fp));
      overridesByProg.set(d.program_id, map);
    }
  }
  const otherActive: InquiryOtherProgram[] = otherRows.map((o) => {
    const ovr = overridesByProg.get(o.id);
    const base = Number(o.max_monthly_demand_fp);
    let total = 0;
    for (const m of monthsSel) total += ovr?.get(m) ?? base;
    return { item_code: o.item_code, item_description: o.item_description, demand_fp: total };
  });

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
    },
    months,
    otherActive,
  };
}

export type NewInquiryData =
  | {
      ok: true;
      computed: boolean;
      /** Spare whole-round per chosen bucket per month, keyed `${bucketId}:${month}`. */
      unallocated: Record<string, number>;
      otherActive: InquiryOtherProgram[];
    }
  | { ok: false; error: string };

/**
 * For a NEW-program inquiry, the caller defines the sourcing (which buckets, at
 * what yields) and the customer. We supply the spare whole-round capacity of
 * those buckets across the chosen months, plus the customer's existing active
 * programs — the FP↔WR arithmetic is then the same client-side cascade.
 */
export async function getNewInquiryData(
  planId: string,
  bucketIds: string[],
  monthIndices: number[],
  customer: string
): Promise<NewInquiryData> {
  if (!planId) return { ok: false, error: 'Missing plan.' };
  const buckets = [...new Set(bucketIds)].filter(Boolean);
  const monthsSel = [...new Set(monthIndices)].filter((m) => Number.isInteger(m) && m >= 1).sort((a, b) => a - b);

  const supabase = await createClient();

  // Whether the plan has any computed results at all (drives the recalc notice).
  const { data: anyResult } = await supabase.from('unallocated_wr').select('bucket_id').eq('plan_id', planId).limit(1);
  const computed = (anyResult ?? []).length > 0;

  const unallocated: Record<string, number> = {};
  if (buckets.length && monthsSel.length) {
    const { data: rows } = await supabase
      .from('unallocated_wr')
      .select('bucket_id, month_index, unallocated_wr')
      .eq('plan_id', planId)
      .in('bucket_id', buckets)
      .in('month_index', monthsSel);
    for (const u of (rows ?? []) as { bucket_id: string; month_index: number; unallocated_wr: number }[]) {
      unallocated[`${u.bucket_id}:${u.month_index}`] = Number(u.unallocated_wr);
    }
  }

  const otherActive: InquiryOtherProgram[] = [];
  const customerName = customer.trim();
  if (customerName && monthsSel.length) {
    const { data: others } = await supabase
      .from('programs')
      .select('id, item_code, item_description, max_monthly_demand_fp')
      .eq('plan_id', planId)
      .eq('customer', customerName)
      .eq('status', 'active')
      .is('deleted_at', null)
      .order('sort_order');
    const otherRows = (others ?? []) as {
      id: string; item_code: string; item_description: string; max_monthly_demand_fp: number;
    }[];
    const overridesByProg = new Map<string, Map<number, number>>();
    if (otherRows.length) {
      const { data: drows } = await supabase
        .from('demand_plan')
        .select('program_id, month_index, demand_fp')
        .in('program_id', otherRows.map((o) => o.id))
        .in('month_index', monthsSel);
      for (const d of (drows ?? []) as { program_id: string; month_index: number; demand_fp: number }[]) {
        const map = overridesByProg.get(d.program_id) ?? new Map<number, number>();
        map.set(d.month_index, Number(d.demand_fp));
        overridesByProg.set(d.program_id, map);
      }
    }
    for (const o of otherRows) {
      const ovr = overridesByProg.get(o.id);
      const base = Number(o.max_monthly_demand_fp);
      let total = 0;
      for (const m of monthsSel) total += ovr?.get(m) ?? base;
      otherActive.push({ item_code: o.item_code, item_description: o.item_description, demand_fp: total });
    }
  }

  return { ok: true, computed, unallocated, otherActive };
}
