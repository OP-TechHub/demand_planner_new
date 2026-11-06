/* eslint-disable @typescript-eslint/no-explicit-any */

/**
 * Approval for Demand Plan changes.
 *
 * On an official plan, a non-admin's Demand Plan edit is held as a pending
 * request (demand_change_requests) instead of being written. An admin, or a
 * user granted 'demand_approve', accepts it — which writes the cells and
 * audits the change against the requester — or rejects it. Admin edits, and
 * any edit to a private sandbox, apply directly as before.
 *
 * Server-only: uses the service role for request writes and for applying an
 * approved change, after the caller has been checked with their own session.
 */

import { canEditPlanSection, demandNeedsApproval, type UserRole } from '@oceanpick/shared';
import { createClient } from '@/lib/supabase/server';
import { createServiceClient } from '@/lib/supabase/service';
import { sendEmails, type Mail } from '@/lib/email';
import { runInBackground } from '@/lib/background';

/** One proposed cell. A null demand_fp clears the override (back to baseline). */
export type DemandCellChange = { program_id: string; month_index: number; demand_fp: number | null };
export type DemandRequestSource = 'editor' | 'grid' | 'import' | 'reset';

export type EditContext = {
  userId: string;
  orgId: string;
  role: UserRole;
  planName: string;
  canEdit: boolean;
  needsApproval: boolean;
};

/**
 * Who is editing, and whether this edit may go straight in. Uses the caller's
 * session, so a plan they cannot read comes back as not editable.
 */
export async function getDemandEditContext(planId: string): Promise<EditContext | { error: string }> {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return { error: 'Your session expired. Sign in again.' };
  const [{ data: me }, { data: plan }, { data: grant }] = await Promise.all([
    supabase.from('users').select('id, org_id, role, is_active').eq('id', user.id).maybeSingle(),
    supabase.from('plans').select('id, name, org_id, is_sandbox, is_locked, owner_user_id').eq('id', planId).maybeSingle(),
    supabase.from('plan_editor_grants').select('section').eq('plan_id', planId).eq('user_id', user.id).eq('section', 'demand_plan').maybeSingle(),
  ]);
  if (!me || !me.is_active) return { error: 'Your account is not active.' };
  if (!plan) return { error: 'Plan not found or not accessible.' };
  const role = me.role as UserRole;
  return {
    userId: user.id,
    orgId: me.org_id,
    role,
    planName: plan.name,
    canEdit: canEditPlanSection(plan, { id: user.id, role }, !!grant),
    needsApproval: demandNeedsApproval(plan, role),
  };
}

/** Drop duplicate cells (last one wins), so a request never holds two values for one month. */
function dedupe(cells: DemandCellChange[]): DemandCellChange[] {
  const byKey = new Map<string, DemandCellChange>();
  for (const c of cells) byKey.set(`${c.program_id}:${c.month_index}`, c);
  return [...byKey.values()];
}

/**
 * Hold an edit for approval. The cells must belong to the plan's live
 * programs; anything else is refused rather than stored for later.
 */
export async function submitDemandRequest(
  ctx: EditContext,
  planId: string,
  source: DemandRequestSource,
  cellsIn: DemandCellChange[]
): Promise<{ error: string | null; count: number }> {
  const cells = dedupe(cellsIn);
  if (!cells.length) return { error: null, count: 0 };

  const svc = createServiceClient();
  const programIds = [...new Set(cells.map((c) => c.program_id))];
  const { data: progs } = await svc
    .from('programs').select('id').eq('plan_id', planId).is('deleted_at', null).in('id', programIds);
  const known = new Set((progs ?? []).map((p: { id: string }) => p.id));
  if (programIds.some((id) => !known.has(id))) return { error: 'Some of these programs are not on this plan.', count: 0 };

  const { data: req, error } = await svc
    .from('demand_change_requests')
    .insert({ org_id: ctx.orgId, plan_id: planId, requested_by: ctx.userId, source, cells, cell_count: cells.length })
    .select('id')
    .maybeSingle();
  if (error || !req) return { error: error?.message ?? 'Could not submit the change for approval.', count: 0 };

  await runInBackground(emailApprovers(svc, { planId, planName: ctx.planName, orgId: ctx.orgId, requesterId: ctx.userId, count: cells.length }), 'demand approval email');
  return { error: null, count: cells.length };
}

/**
 * Write cells to demand_plan: numbers upsert, nulls delete. One delete per
 * program, since a single `in` over months would clear other programs too.
 */
export async function applyDemandCells(
  db: any,
  planId: string,
  cells: DemandCellChange[],
  actorId: string
): Promise<string | null> {
  const upserts = cells.filter((c) => c.demand_fp !== null).map((c) => ({
    plan_id: planId, program_id: c.program_id, month_index: c.month_index,
    demand_fp: c.demand_fp as number, created_by: actorId, updated_by: actorId,
  }));
  if (upserts.length) {
    const { error } = await db.from('demand_plan').upsert(upserts, { onConflict: 'program_id,month_index' });
    if (error) return error.message;
  }
  const clears = new Map<string, number[]>();
  for (const c of cells) if (c.demand_fp === null) clears.set(c.program_id, [...(clears.get(c.program_id) ?? []), c.month_index]);
  for (const [programId, months] of clears) {
    const { error } = await db.from('demand_plan').delete().eq('plan_id', planId).eq('program_id', programId).in('month_index', months);
    if (error) return error.message;
  }
  return null;
}

function siteBase(): string {
  return (process.env.NEXT_PUBLIC_SITE_URL || (process.env.VERCEL_URL ? `https://${process.env.VERCEL_URL}` : '')).replace(/\/$/, '');
}

function esc(s: string): string {
  return s.replace(/[&<>"]/g, (ch) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[ch] as string));
}

/** A plain one-card email, matching the look of the change digest. */
function simpleMail(title: string, lines: string[], cta?: { href: string; label: string }): { html: string; text: string } {
  const body = lines.map((l) => `<p style="margin:0 0 10px;font-size:14px;color:#334155;">${esc(l)}</p>`).join('');
  const button = cta
    ? `<a href="${cta.href}" style="display:inline-block;margin-top:8px;padding:9px 16px;border-radius:8px;background:#1e6fd9;color:#ffffff;text-decoration:none;font-size:13px;font-weight:600;">${esc(cta.label)}</a>`
    : '';
  const html = `<!doctype html><html><body style="margin:0;background:#f8fafc;font-family:-apple-system,Segoe UI,Roboto,Helvetica,Arial,sans-serif;">
    <div style="max-width:560px;margin:0 auto;padding:24px;">
      <div style="background:#ffffff;border:1px solid #e2e8f0;border-radius:12px;overflow:hidden;">
        <div style="padding:20px 24px;background:linear-gradient(135deg,#1e6fd9,#0ea5b7);color:#ffffff;">
          <div style="font-size:12px;letter-spacing:.06em;text-transform:uppercase;opacity:.85;">Oceanpick Demand Planner</div>
          <div style="font-size:18px;font-weight:700;margin-top:4px;">${esc(title)}</div>
        </div>
        <div style="padding:20px 24px;">${body}${button}</div>
      </div>
    </div>
  </body></html>`;
  const text = [title, '', ...lines, ...(cta ? ['', `${cta.label}: ${cta.href}`] : [])].join('\n');
  return { html, text };
}

/** Tell every approver (admins and 'demand_approve' holders, not the requester) a change is waiting. */
async function emailApprovers(
  svc: any,
  d: { planId: string; planName: string; orgId: string; requesterId: string; count: number }
): Promise<void> {
  const { data: users } = await svc.from('users').select('id, full_name, email, role, is_active, edit_sections').eq('org_id', d.orgId);
  const list = (users ?? []) as { id: string; full_name: string; email: string; role: string; is_active: boolean; edit_sections: string[] | null }[];
  const requester = list.find((u) => u.id === d.requesterId);
  const who = requester?.full_name || requester?.email || 'A user';
  const approvers = list.filter(
    (u) => u.id !== d.requesterId && u.is_active && u.email && (u.role === 'admin' || (u.edit_sections ?? []).includes('demand_approve'))
  );
  if (!approvers.length) return;
  const base = siteBase();
  const title = `Demand change waiting for approval: ${d.planName}`;
  const { html, text } = simpleMail(
    title,
    [
      `${who} proposed a change to ${d.count} demand cell${d.count === 1 ? '' : 's'} on ${d.planName}.`,
      'Nothing has been written to the plan yet. Review it on the Demand Plan page and accept or reject it.',
    ],
    base ? { href: `${base}/demand-plan`, label: 'Review the change' } : undefined
  );
  const mails: Mail[] = approvers.map((u) => ({ to: u.email, subject: title, html, text }));
  await sendEmails(mails);
}

/** Tell the requester what happened to their change. */
export async function emailRequester(
  svc: any,
  d: { requesterId: string; deciderName: string; planName: string; approved: boolean; count: number; note: string | null }
): Promise<void> {
  const { data: u } = await svc.from('users').select('email, is_active').eq('id', d.requesterId).maybeSingle();
  if (!u?.email || !u.is_active) return;
  const verb = d.approved ? 'approved' : 'rejected';
  const title = `Your demand change was ${verb}: ${d.planName}`;
  const lines = [
    `${d.deciderName} ${verb} your change to ${d.count} demand cell${d.count === 1 ? '' : 's'} on ${d.planName}.`,
    d.approved ? 'It is now in the plan and will show in the outputs after the next recalculation.' : 'Nothing was written to the plan.',
  ];
  if (d.note) lines.push(`Note: ${d.note}`);
  const base = siteBase();
  const { html, text } = simpleMail(title, lines, base ? { href: `${base}/demand-plan`, label: 'Open the Demand Plan' } : undefined);
  await sendEmails([{ to: u.email, subject: title, html, text }]);
}
