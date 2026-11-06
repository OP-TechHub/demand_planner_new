'use server';

import { revalidatePath } from 'next/cache';
import { canApproveDemand, type UserRole } from '@oceanpick/shared';
import { createClient } from '@/lib/supabase/server';
import { createServiceClient } from '@/lib/supabase/service';
import { applyDemandCells, emailRequester, type DemandCellChange } from '@/lib/demand-approval';
import { runInBackground } from '@/lib/background';

export type ApprovalResult = { error: string | null };

async function me() {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return null;
  const { data } = await supabase
    .from('users').select('id, org_id, role, is_active, edit_sections, full_name, email').eq('id', user.id).maybeSingle();
  return data && data.is_active ? data : null;
}

/**
 * Accept or reject a pending Demand Plan change. Only admins and holders of
 * 'demand_approve' may decide, and never on their own request.
 *
 * The status flips first, guarded on 'pending', so two approvers clicking at
 * once cannot both apply it. If writing the cells then fails, the request goes
 * back to pending so it can be retried.
 */
export async function decideDemandRequest(requestId: string, approve: boolean, note?: string): Promise<ApprovalResult> {
  const user = await me();
  if (!user) return { error: 'Your session expired. Sign in again.' };
  if (!canApproveDemand(user.role as UserRole, user.edit_sections)) return { error: 'You don’t have permission to approve demand changes.' };

  const svc = createServiceClient();
  const { data: req } = await svc
    .from('demand_change_requests')
    .select('id, org_id, plan_id, requested_by, cells, cell_count, status, source')
    .eq('id', requestId)
    .maybeSingle();
  if (!req || req.org_id !== user.org_id) return { error: 'Request not found.' };
  if (req.status !== 'pending') return { error: `This request was already ${req.status}.` };
  if (req.requested_by === user.id) return { error: 'You can’t approve or reject your own change. Another approver has to decide it.' };

  const { data: plan } = await svc.from('plans').select('id, name, is_locked, deleted_at').eq('id', req.plan_id).maybeSingle();
  if (!plan || plan.deleted_at) return { error: 'The plan no longer exists.' };
  if (approve && plan.is_locked) return { error: 'The plan is locked. Unlock it before approving changes.' };

  const trimmed = note?.trim() || null;
  const decidedAt = new Date().toISOString();
  const { data: claimed } = await svc
    .from('demand_change_requests')
    .update({ status: approve ? 'approved' : 'rejected', decided_by: user.id, decided_at: decidedAt, decision_note: trimmed })
    .eq('id', requestId)
    .eq('status', 'pending')
    .select('id')
    .maybeSingle();
  if (!claimed) return { error: 'Someone else decided this request first.' };

  if (approve) {
    const cells = req.cells as DemandCellChange[];

    // Programs removed since the request was made are skipped, not resurrected.
    const { data: live } = await svc
      .from('programs').select('id, max_monthly_demand_fp').eq('plan_id', req.plan_id).is('deleted_at', null)
      .in('id', [...new Set(cells.map((c) => c.program_id))]);
    const baseline = new Map((live ?? []).map((p: { id: string; max_monthly_demand_fp: number }) => [p.id, Number(p.max_monthly_demand_fp ?? 0)]));
    const toApply = cells.filter((c) => baseline.has(c.program_id));

    // Old values for the audit trail, read just before writing.
    const { data: before } = await svc
      .from('demand_plan').select('program_id, month_index, demand_fp').eq('plan_id', req.plan_id)
      .in('program_id', [...baseline.keys()]);
    const current = new Map((before ?? []).map((r: { program_id: string; month_index: number; demand_fp: number }) => [`${r.program_id}:${r.month_index}`, Number(r.demand_fp)]));

    const err = await applyDemandCells(svc, req.plan_id, toApply, req.requested_by);
    if (err) {
      await svc.from('demand_change_requests')
        .update({ status: 'pending', decided_by: null, decided_at: null, decision_note: null }).eq('id', requestId);
      return { error: `Could not apply the change: ${err}` };
    }

    // One audit entry per program, credited to the requester, naming the approver.
    const byProgram = new Map<string, { m: number; old: number; new: number }[]>();
    for (const c of toApply) {
      const base = baseline.get(c.program_id) ?? 0;
      const old = current.get(`${c.program_id}:${c.month_index}`) ?? base;
      const next = c.demand_fp ?? base;
      if (old === next) continue;
      byProgram.set(c.program_id, [...(byProgram.get(c.program_id) ?? []), { m: c.month_index, old, new: next }]);
    }
    const CAP = 40;
    const approver = user.full_name || user.email;
    const audits = [...byProgram].map(([programId, edits]) => {
      edits.sort((a, b) => a.m - b.m);
      return {
        org_id: req.org_id, plan_id: req.plan_id, user_id: req.requested_by,
        entity_type: 'demand_plan', entity_id: programId, action: 'update',
        changes: {
          set: edits.filter((e) => e.new !== baseline.get(programId)).length,
          cleared: edits.filter((e) => e.new === baseline.get(programId)).length,
          edits: edits.slice(0, CAP), more: Math.max(0, edits.length - CAP),
          approved_by: approver, approval_request_id: requestId, source: req.source,
        },
      };
    });
    if (audits.length) await svc.from('audit_log').insert(audits);
  }

  await runInBackground(
    emailRequester(svc, {
      requesterId: req.requested_by,
      deciderName: user.full_name || user.email,
      planName: plan.name,
      approved: approve,
      count: req.cell_count,
      note: trimmed,
    }),
    'demand decision email'
  );

  revalidatePath('/demand-plan');
  return { error: null };
}

/** The requester takes back their own pending change. */
export async function withdrawDemandRequest(requestId: string): Promise<ApprovalResult> {
  const user = await me();
  if (!user) return { error: 'Your session expired. Sign in again.' };
  const svc = createServiceClient();
  const { data } = await svc
    .from('demand_change_requests')
    .update({ status: 'withdrawn', decided_by: user.id, decided_at: new Date().toISOString() })
    .eq('id', requestId)
    .eq('requested_by', user.id)
    .eq('status', 'pending')
    .select('id')
    .maybeSingle();
  if (!data) return { error: 'This request is no longer pending.' };
  revalidatePath('/demand-plan');
  return { error: null };
}
