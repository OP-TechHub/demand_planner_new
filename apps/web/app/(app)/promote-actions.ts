'use server';

import { revalidatePath } from 'next/cache';
import { createClient } from '@/lib/supabase/server';
import { createServiceClient } from '@/lib/supabase/service';
import { logAudit } from '@/lib/audit';

export type PromoteResult = { ok: boolean; error?: string };
export type PromoteMonth = { month_index: number; demand_fp: number };
export type PromoteTarget = { id: string; item_code: string; item_description: string };

export type PromoteContext =
  | {
      ok: true;
      program: { id: string; plan_id: string; item_code: string; item_description: string; customer: string };
      months: PromoteMonth[];
      targets: PromoteTarget[];
      defaultTargetId: string | null;
    }
  | { ok: false; error: string };

/**
 * What the promote dialog needs for a pipeline program: the months carrying
 * pipeline demand, the customer's active programs (targets to move into), and a
 * best-guess default target (the base of a `‹code›-P` twin).
 */
export async function getPromoteContext(pipelineProgramId: string): Promise<PromoteContext> {
  if (!pipelineProgramId) return { ok: false, error: 'Missing program.' };
  const supabase = await createClient();
  const { data: prog } = await supabase
    .from('programs')
    .select('id, plan_id, item_code, item_description, customer, status')
    .eq('id', pipelineProgramId)
    .is('deleted_at', null)
    .maybeSingle();
  if (!prog) return { ok: false, error: 'Program not found.' };
  if (prog.status !== 'pipeline') return { ok: false, error: 'Only pipeline programs can be promoted.' };

  const { data: dem } = await supabase
    .from('demand_plan').select('month_index, demand_fp').eq('program_id', pipelineProgramId).order('month_index');
  const months: PromoteMonth[] = (dem ?? [])
    .map((d: { month_index: number; demand_fp: number }) => ({ month_index: d.month_index, demand_fp: Number(d.demand_fp) }))
    .filter((d) => d.demand_fp > 0);

  const { data: acts } = await supabase
    .from('programs').select('id, item_code, item_description')
    .eq('plan_id', prog.plan_id).eq('customer', prog.customer).eq('status', 'active').is('deleted_at', null).order('sort_order');
  const targets = (acts ?? []) as PromoteTarget[];
  const base = prog.item_code.replace(/-P\d*$/i, '');
  const defaultTargetId = targets.find((t) => t.item_code === base)?.id ?? targets[0]?.id ?? null;

  return {
    ok: true,
    program: { id: prog.id, plan_id: prog.plan_id, item_code: prog.item_code, item_description: prog.item_description, customer: prog.customer },
    months,
    targets,
    defaultTargetId,
  };
}

/** Edit-access gate for promotion: admin, own sandbox, or all the named grants. */
async function assertAccess(planId: string, sections: string[]) {
  const rls = await createClient();
  const { data: { user } } = await rls.auth.getUser();
  if (!user) return { ok: false as const, error: 'Your session expired. Sign in again.' };
  const { data: me } = await rls.from('users').select('role, org_id').eq('id', user.id).maybeSingle();
  if (!me) return { ok: false as const, error: 'Account not found.' };
  const svc = createServiceClient();
  const { data: plan } = await svc
    .from('plans').select('org_id, is_locked, is_sandbox, owner_user_id').eq('id', planId).is('deleted_at', null).maybeSingle();
  if (!plan || plan.org_id !== me.org_id) return { ok: false as const, error: 'Plan not found.' };
  if (plan.is_locked) return { ok: false as const, error: 'This plan is locked (read-only).' };
  let allowed = me.role === 'admin' || (plan.is_sandbox && plan.owner_user_id === user.id);
  if (!allowed) {
    const { data: grants } = await svc
      .from('plan_editor_grants').select('section').eq('plan_id', planId).eq('user_id', user.id).in('section', sections);
    const have = new Set((grants ?? []).map((g: { section: string }) => g.section));
    allowed = sections.every((s) => have.has(s));
  }
  if (!allowed) return { ok: false as const, error: 'You don’t have edit access for this on this plan.' };
  return { ok: true as const, rls, svc, userId: user.id };
}

export type PromoteTargetChoice = { kind: 'move'; activeProgramId: string } | { kind: 'make_active' };

/**
 * Promote a pipeline program to active. Either:
 *  - move: for the chosen months, add the pipeline demand onto a target ACTIVE
 *    program and clear it from pipeline (so a month shifts from Pipeline to
 *    Active); or
 *  - make_active: flip the whole pipeline program to active (all its months).
 */
export async function promoteInquiry(
  pipelineProgramId: string,
  monthIndices: number[],
  target: PromoteTargetChoice
): Promise<PromoteResult> {
  if (!pipelineProgramId) return { ok: false, error: 'Missing program.' };

  const pre = await createClient();
  const { data: prog0 } = await pre
    .from('programs').select('id, plan_id, status, customer, item_code').eq('id', pipelineProgramId).is('deleted_at', null).maybeSingle();
  if (!prog0) return { ok: false, error: 'Program not found.' };
  if (prog0.status !== 'pipeline') return { ok: false, error: 'Only pipeline programs can be promoted.' };

  const sections = target.kind === 'make_active' ? ['demand_plan', 'programs'] : ['demand_plan'];
  const access = await assertAccess(prog0.plan_id, sections);
  if (!access.ok) return { ok: false, error: access.error };
  const { svc, rls, userId } = access;

  if (target.kind === 'make_active') {
    // Which of the program's demand-months to activate. Empty selection = all.
    const { data: allDem } = await svc.from('demand_plan').select('month_index, demand_fp').eq('program_id', pipelineProgramId);
    const demByM = new Map<number, number>(
      (allDem ?? [])
        .map((d: { month_index: number; demand_fp: number }): [number, number] => [d.month_index, Number(d.demand_fp)])
        .filter(([, v]) => v > 0)
    );
    const allMonths = [...demByM.keys()];
    const sel = [...new Set(monthIndices)].filter((m) => demByM.has(m));
    const selected = sel.length ? sel : allMonths;
    const rest = allMonths.filter((m) => !selected.includes(m));

    // All months selected (or none carry demand) → just flip the program.
    if (rest.length === 0) {
      const { error } = await svc.from('programs').update({ status: 'active', updated_by: userId }).eq('id', pipelineProgramId);
      if (error) return { ok: false, error: error.message };
      await logAudit(rls, { planId: prog0.plan_id, entityType: 'programs', entityId: pipelineProgramId, action: 'update', changes: { status: { old: 'pipeline', new: 'active' }, promoted: true } });
      revalidatePath('/demand-plan'); revalidatePath('/inquiries'); revalidatePath('/programs'); revalidatePath('/open-to-buy');
      return { ok: true };
    }

    // Partial: keep the selected months on this program (now active) and move the
    // rest into a new pipeline twin.
    const { data: p } = await svc
      .from('programs')
      .select('item_description, customer, primary_bucket_id, primary_yield, secondary_bucket_id, secondary_yield, tertiary_bucket_id, tertiary_yield, price_per_fp, barra_cost_wr, packing_cost_fp, processing_cost_fp, storage_cost_fp, freight_cost_fp, other_costs_fp')
      .eq('id', pipelineProgramId).maybeSingle();
    if (!p) return { ok: false, error: 'Program not found.' };

    const base = prog0.item_code.replace(/-P\d*$/i, '');
    let twinCode = `${base}-P`;
    for (let i = 1; i <= 50; i++) {
      const code = i === 1 ? `${base}-P` : `${base}-P${i}`;
      const { data: taken } = await svc.from('programs').select('id').eq('plan_id', prog0.plan_id).eq('item_code', code).is('deleted_at', null).maybeSingle();
      if (!taken) { twinCode = code; break; }
    }
    const { data: lastP } = await svc.from('programs').select('sort_order').eq('plan_id', prog0.plan_id).order('sort_order', { ascending: false }).limit(1).maybeSingle();
    const sortOrder = ((lastP?.sort_order as number | undefined) ?? 0) + 10;

    const { data: twin, error: ce } = await svc.from('programs').insert({
      plan_id: prog0.plan_id, status: 'pipeline', item_code: twinCode, item_description: p.item_description, customer: p.customer,
      max_monthly_demand_fp: 0,
      primary_bucket_id: p.primary_bucket_id, primary_yield: p.primary_yield,
      secondary_bucket_id: p.secondary_bucket_id, secondary_yield: p.secondary_yield,
      tertiary_bucket_id: p.tertiary_bucket_id, tertiary_yield: p.tertiary_yield,
      price_per_fp: p.price_per_fp, barra_cost_wr: p.barra_cost_wr, packing_cost_fp: p.packing_cost_fp,
      processing_cost_fp: p.processing_cost_fp, storage_cost_fp: p.storage_cost_fp, freight_cost_fp: p.freight_cost_fp, other_costs_fp: p.other_costs_fp,
      sort_order: sortOrder, created_by: userId, updated_by: userId,
    }).select('id').maybeSingle();
    if (ce || !twin) return { ok: false, error: ce?.message ?? 'Could not create the pipeline twin.' };

    const twinRows = rest.map((m) => ({ plan_id: prog0.plan_id, program_id: twin.id, month_index: m, demand_fp: demByM.get(m)!, created_by: userId, updated_by: userId }));
    const { error: ie } = await svc.from('demand_plan').insert(twinRows);
    if (ie) return { ok: false, error: ie.message };
    const { error: de } = await svc.from('demand_plan').delete().eq('program_id', pipelineProgramId).in('month_index', rest);
    if (de) return { ok: false, error: de.message };
    const { error: ue } = await svc.from('programs').update({ status: 'active', updated_by: userId }).eq('id', pipelineProgramId);
    if (ue) return { ok: false, error: ue.message };

    await logAudit(rls, { planId: prog0.plan_id, entityType: 'programs', entityId: pipelineProgramId, action: 'update', changes: { status: { old: 'pipeline', new: 'active' }, promoted_months: selected.length, pipeline_twin: twinCode } });
    revalidatePath('/demand-plan'); revalidatePath('/inquiries'); revalidatePath('/programs'); revalidatePath('/open-to-buy');
    return { ok: true };
  }

  const months = [...new Set(monthIndices)].filter((m) => Number.isInteger(m) && m >= 1);
  if (!months.length) return { ok: false, error: 'Pick at least one month to promote.' };

  const { data: activeProg } = await svc
    .from('programs').select('id, status, plan_id, max_monthly_demand_fp').eq('id', target.activeProgramId).is('deleted_at', null).maybeSingle();
  if (!activeProg || activeProg.plan_id !== prog0.plan_id) return { ok: false, error: 'Target program not found.' };
  if (activeProg.status !== 'active') return { ok: false, error: 'Target must be an active program.' };
  const activeBaseline = Number(activeProg.max_monthly_demand_fp);

  const [{ data: pipeDem }, { data: actDem }] = await Promise.all([
    svc.from('demand_plan').select('month_index, demand_fp').eq('program_id', pipelineProgramId).in('month_index', months),
    svc.from('demand_plan').select('month_index, demand_fp').eq('program_id', target.activeProgramId).in('month_index', months),
  ]);
  const pipeBy = new Map<number, number>((pipeDem ?? []).map((d: { month_index: number; demand_fp: number }) => [d.month_index, Number(d.demand_fp)]));
  const actBy = new Map<number, number>((actDem ?? []).map((d: { month_index: number; demand_fp: number }) => [d.month_index, Number(d.demand_fp)]));

  const activeUpserts: Record<string, unknown>[] = [];
  const promoted: number[] = [];
  for (const m of months) {
    const pv = pipeBy.get(m) ?? 0;
    if (pv <= 0) continue;
    const actEff = actBy.has(m) ? actBy.get(m)! : activeBaseline;
    activeUpserts.push({ plan_id: prog0.plan_id, program_id: target.activeProgramId, month_index: m, demand_fp: actEff + pv, created_by: userId, updated_by: userId });
    promoted.push(m);
  }
  if (!activeUpserts.length) return { ok: false, error: 'No pipeline demand in the selected months to promote.' };

  const { error: ue } = await svc.from('demand_plan').upsert(activeUpserts, { onConflict: 'program_id,month_index' });
  if (ue) return { ok: false, error: ue.message };
  const { error: de } = await svc.from('demand_plan').delete().eq('program_id', pipelineProgramId).in('month_index', promoted);
  if (de) return { ok: false, error: de.message };

  await logAudit(rls, { planId: prog0.plan_id, entityType: 'demand_plan', entityId: target.activeProgramId, action: 'update', changes: { promoted_from: prog0.item_code, months: promoted.length } });
  revalidatePath('/demand-plan'); revalidatePath('/inquiries'); revalidatePath('/programs'); revalidatePath('/open-to-buy');
  return { ok: true };
}
