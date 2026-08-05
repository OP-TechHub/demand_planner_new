/* eslint-disable @typescript-eslint/no-explicit-any */

/**
 * After an official/admin plan is recalculated, email every active user a summary
 * of what changed since the previous recalculation: who changed what, when, and
 * which output tabs those changes flow through.
 *
 * Called best-effort from the recompute background job once results are saved.
 * Personal sandboxes never notify; a recompute with no input changes is silent.
 */

import { sendEmails, type Mail } from './email';

const SECTION_LABEL: Record<string, string> = {
  programs: 'Programs',
  demand_plan: 'Demand Plan',
  harvest_plan: 'Harvest Plan',
  buckets: 'Buckets',
};

// Which output tabs each kind of input change flows through, so the email can
// say what to re-check. A recompute regenerates everything, but this points
// people at the tabs that actually move.
const AFFECTED_TABS: Record<string, string[]> = {
  demand_plan: ['Dashboard', 'Annual Summary', 'Program Fulfilment', '60-Month Summary', 'Revenue & Cost'],
  harvest_plan: ['Dashboard', 'Program Fulfilment', 'Open to buy', '60-Month Summary', 'Fulfilment Optimizer'],
  programs: ['Dashboard', 'Annual Summary', 'Program Fulfilment', 'Open to buy', '60-Month Summary', 'Revenue & Cost', 'Fulfilment Optimizer'],
  buckets: ['Open to buy', 'Program Fulfilment', 'Fulfilment Optimizer'],
};
// Canonical display order for the affected-tabs list.
const TAB_ORDER = ['Dashboard', 'Annual Summary', 'Program Fulfilment', 'Open to buy', '60-Month Summary', 'Revenue & Cost', 'Fulfilment Optimizer'];

const TZ = 'Asia/Colombo';
function fmtWhen(iso: string): string {
  try {
    return new Intl.DateTimeFormat('en-GB', {
      timeZone: TZ, day: '2-digit', month: 'short', year: 'numeric', hour: '2-digit', minute: '2-digit', hour12: false,
    }).format(new Date(iso));
  } catch {
    return iso;
  }
}

/** A compact human description of one audit entry's `changes` payload. */
function describeChange(entityType: string, action: string, c: any): string {
  c = c ?? {};
  if (entityType === 'demand_plan') {
    if (c.imported_cells != null) return `${c.imported_cells} demand cells imported`;
    if (c.saved_from === 'inquiry') return `inquiry saved to pipeline${c.months ? ` (${c.months} month${c.months === 1 ? '' : 's'})` : ''}${c.trimmed ? `, ${c.trimmed} pipeline trimmed` : ''}`;
    if (c.promoted_from) return `promoted from ${c.promoted_from}${c.months ? ` (${c.months} month${c.months === 1 ? '' : 's'})` : ''}`;
    if (c.set != null || c.cleared != null) {
      const parts: string[] = [];
      if (c.set) parts.push(`${c.set} month${c.set === 1 ? '' : 's'} set`);
      if (c.cleared) parts.push(`${c.cleared} cleared`);
      return parts.length ? `demand ${parts.join(', ')}` : 'demand updated';
    }
    return 'demand updated';
  }
  if (entityType === 'harvest_plan') {
    if (c.imported_cells != null) return `${c.imported_cells} harvest cells imported`;
    if (c.set != null || c.cleared != null) {
      const parts: string[] = [];
      if (c.set) parts.push(`${c.set} month${c.set === 1 ? '' : 's'} set`);
      if (c.cleared) parts.push(`${c.cleared} cleared`);
      return parts.length ? `harvest ${parts.join(', ')}` : 'harvest updated';
    }
    return 'harvest updated';
  }
  if (entityType === 'programs') {
    if (action === 'insert') return `program added${c.item_code ? ` (${c.item_code})` : ''}`;
    if (action === 'delete') return 'program removed';
    if (c.imported_new != null || c.imported_updated != null) return `import: ${c.imported_new ?? 0} new, ${c.imported_updated ?? 0} updated`;
    if (c.status?.old && c.status?.new) return `status ${c.status.old} → ${c.status.new}${c.promoted || c.promoted_months ? ' (promoted)' : ''}`;
    return 'program edited';
  }
  if (entityType === 'buckets') return action === 'insert' ? 'bucket added' : action === 'delete' ? 'bucket removed' : 'bucket edited';
  return `${entityType} ${action}`;
}

type Row = { who: string; section: string; what: string; when: string; entity: string | null; at: string };

export async function notifyPlanRecomputed(
  svc: any,
  args: { planId: string; jobId: string }
): Promise<{ sent?: number; skipped?: string; error?: string }> {
  const { planId, jobId } = args;

  // Only official/admin plans notify — never a user's private sandbox.
  const { data: plan } = await svc
    .from('plans')
    .select('id, name, org_id, type, is_sandbox')
    .eq('id', planId)
    .maybeSingle();
  if (!plan) return { skipped: 'plan not found' };
  if (plan.is_sandbox) return { skipped: 'sandbox plan — no notification' };

  // Window start = the previous completed recompute for this plan. Nothing before
  // that gets re-reported; the very first publish is treated as a silent baseline.
  const { data: prior } = await svc
    .from('recompute_jobs')
    .select('finished_at')
    .eq('plan_id', planId)
    .eq('status', 'done')
    .neq('id', jobId)
    .not('finished_at', 'is', null)
    .order('finished_at', { ascending: false })
    .limit(1)
    .maybeSingle();
  if (!prior?.finished_at) return { skipped: 'first publish — baseline, no notification' };
  const since: string = prior.finished_at;

  // Input changes recorded against this plan since the last publish.
  const { data: audit } = await svc
    .from('audit_log')
    .select('user_id, entity_type, entity_id, action, changes, at')
    .eq('plan_id', planId)
    .in('entity_type', ['programs', 'demand_plan', 'harvest_plan', 'buckets'])
    .gt('at', since)
    .order('at', { ascending: true });
  const entries = (audit ?? []) as any[];
  if (!entries.length) return { skipped: 'no input changes since last publish' };

  // Resolve user names and program labels for readability.
  const { data: users } = await svc.from('users').select('id, full_name, email, is_active').eq('org_id', plan.org_id);
  const userList = (users ?? []) as { id: string; full_name: string; email: string; is_active: boolean }[];
  const nameById = new Map(userList.map((u) => [u.id, u.full_name || u.email]));

  const { data: progs } = await svc.from('programs').select('id, item_code, customer').eq('plan_id', planId);
  const progById = new Map<string, string>((progs ?? []).map((p: any): [string, string] => [p.id, `${p.item_code}${p.customer ? ` · ${p.customer}` : ''}`]));

  const rows: Row[] = entries.map((e) => ({
    who: nameById.get(e.user_id) ?? 'Unknown user',
    section: SECTION_LABEL[e.entity_type] ?? e.entity_type,
    what: describeChange(e.entity_type, e.action, e.changes),
    entity: progById.get(e.entity_id) ?? null,
    when: fmtWhen(e.at),
    at: e.at,
  }));

  // Affected output tabs = union across the changed input types, canonical order.
  const changedTypes = new Set(entries.map((e) => e.entity_type));
  const tabSet = new Set<string>();
  for (const t of changedTypes) for (const tab of AFFECTED_TABS[t] ?? []) tabSet.add(tab);
  const tabs = TAB_ORDER.filter((t) => tabSet.has(t));

  const editors = [...new Set(rows.map((r) => r.who))];
  const recipients = userList.filter((u) => u.is_active && u.email);
  if (!recipients.length) return { skipped: 'no active recipients' };

  const base = (process.env.NEXT_PUBLIC_SITE_URL || (process.env.VERCEL_URL ? `https://${process.env.VERCEL_URL}` : '')).replace(/\/$/, '');
  const subject = `Plan updated: ${plan.name} — ${rows.length} change${rows.length === 1 ? '' : 's'} recalculated`;
  const html = renderHtml({ planName: plan.name, rows, tabs, editors, since: fmtWhen(since), base });
  const text = renderText({ planName: plan.name, rows, tabs, editors, since: fmtWhen(since), base });

  const mails: Mail[] = recipients.map((u) => ({ to: u.email, subject, html, text }));
  const res = await sendEmails(mails);
  if (!res.ok) return { sent: res.sent, error: res.error };
  return { sent: res.sent, skipped: res.skipped ? res.error : undefined };
}

function esc(s: string): string {
  return s.replace(/[&<>"]/g, (ch) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[ch] as string));
}

function renderHtml(d: { planName: string; rows: Row[]; tabs: string[]; editors: string[]; since: string; base: string }): string {
  const rowsHtml = d.rows
    .map(
      (r) => `<tr>
        <td style="padding:8px 12px;border-top:1px solid #e2e8f0;font-size:13px;color:#0f172a;">${esc(r.who)}</td>
        <td style="padding:8px 12px;border-top:1px solid #e2e8f0;font-size:13px;color:#0f172a;"><strong>${esc(r.section)}</strong>${r.entity ? `<br><span style="color:#64748b;font-size:12px;">${esc(r.entity)}</span>` : ''}</td>
        <td style="padding:8px 12px;border-top:1px solid #e2e8f0;font-size:13px;color:#334155;">${esc(r.what)}</td>
        <td style="padding:8px 12px;border-top:1px solid #e2e8f0;font-size:12px;color:#64748b;white-space:nowrap;">${esc(r.when)}</td>
      </tr>`
    )
    .join('');
  const tabsHtml = d.tabs
    .map((t) => `<span style="display:inline-block;margin:0 6px 6px 0;padding:3px 10px;border-radius:9999px;background:#eef2ff;color:#3730a3;font-size:12px;font-weight:600;">${esc(t)}</span>`)
    .join('');
  const cta = d.base ? `<a href="${d.base}/home" style="display:inline-block;margin-top:16px;padding:9px 16px;border-radius:8px;background:#1e6fd9;color:#ffffff;text-decoration:none;font-size:13px;font-weight:600;">Open the plan</a>` : '';

  return `<!doctype html><html><body style="margin:0;background:#f8fafc;font-family:-apple-system,Segoe UI,Roboto,Helvetica,Arial,sans-serif;">
    <div style="max-width:640px;margin:0 auto;padding:24px;">
      <div style="background:#ffffff;border:1px solid #e2e8f0;border-radius:12px;overflow:hidden;">
        <div style="padding:20px 24px;background:linear-gradient(135deg,#1e6fd9,#0ea5b7);color:#ffffff;">
          <div style="font-size:12px;letter-spacing:.06em;text-transform:uppercase;opacity:.85;">Oceanpick Demand Planner</div>
          <div style="font-size:18px;font-weight:700;margin-top:4px;">Plan recalculated: ${esc(d.planName)}</div>
        </div>
        <div style="padding:20px 24px;">
          <p style="margin:0 0 4px;font-size:14px;color:#334155;">
            <strong>${d.rows.length}</strong> change${d.rows.length === 1 ? '' : 's'} by ${esc(d.editors.join(', '))} ${d.editors.length === 1 ? 'was' : 'were'} recalculated and saved.
          </p>
          <p style="margin:0 0 16px;font-size:12px;color:#64748b;">Changes since the previous recalculation on ${esc(d.since)} (times in Sri Lanka time).</p>

          <table style="width:100%;border-collapse:collapse;">
            <thead>
              <tr>
                <th style="text-align:left;padding:0 12px 6px;font-size:11px;text-transform:uppercase;letter-spacing:.05em;color:#94a3b8;">Who</th>
                <th style="text-align:left;padding:0 12px 6px;font-size:11px;text-transform:uppercase;letter-spacing:.05em;color:#94a3b8;">Section</th>
                <th style="text-align:left;padding:0 12px 6px;font-size:11px;text-transform:uppercase;letter-spacing:.05em;color:#94a3b8;">What changed</th>
                <th style="text-align:left;padding:0 12px 6px;font-size:11px;text-transform:uppercase;letter-spacing:.05em;color:#94a3b8;">When</th>
              </tr>
            </thead>
            <tbody>${rowsHtml}</tbody>
          </table>

          <div style="margin-top:20px;">
            <div style="font-size:12px;text-transform:uppercase;letter-spacing:.05em;color:#94a3b8;margin-bottom:8px;">Output tabs affected</div>
            ${tabsHtml || '<span style="color:#64748b;font-size:13px;">—</span>'}
          </div>
          ${cta}
        </div>
      </div>
      <p style="text-align:center;color:#94a3b8;font-size:11px;margin-top:16px;">You're receiving this because you're a member of the Oceanpick Demand Planner workspace.</p>
    </div>
  </body></html>`;
}

function renderText(d: { planName: string; rows: Row[]; tabs: string[]; editors: string[]; since: string; base: string }): string {
  const lines = [
    `Plan recalculated: ${d.planName}`,
    '',
    `${d.rows.length} change(s) by ${d.editors.join(', ')} recalculated and saved.`,
    `Changes since the previous recalculation on ${d.since} (Sri Lanka time).`,
    '',
    'Changes:',
    ...d.rows.map((r) => `  • ${r.who} — ${r.section}${r.entity ? ` (${r.entity})` : ''}: ${r.what}  [${r.when}]`),
    '',
    `Output tabs affected: ${d.tabs.join(', ') || '—'}`,
  ];
  if (d.base) lines.push('', `Open the plan: ${d.base}/home`);
  return lines.join('\n');
}
