/* eslint-disable @typescript-eslint/no-explicit-any */

/**
 * Email a digest of input-tab changes on an official/admin plan to the users an
 * admin has chosen for that tab (users.notify_sections, set under Admin → Users).
 *
 * Each tab is reported at the moment that makes sense for it:
 *   • Programs, Demand Plan, Harvest Plan, PO Update feed the engine, so their
 *     changes go out when the plan is recalculated — the recompute job calls
 *     this with trigger 'recompute' once results are saved.
 *   • Harvest Request and Actual Harvest never make a plan stale, so waiting for
 *     a recalculation could mean waiting forever — their save actions call this
 *     with trigger 'save' as soon as the write lands.
 *
 * A change is reported at most once: change_notifications keeps, per plan and
 * tab, the latest audit entry a digest covered, and the next digest starts after
 * it. One email per recipient covers every tab they are subscribed to that has
 * changes. Best-effort throughout; personal sandboxes never notify.
 */

import { NOTIFY_SECTIONS, NOTIFY_SECTION_LABEL, type NotifySection } from '@oceanpick/shared';
import { sendEmails, type Mail } from './email';

export type NotifyTrigger = 'recompute' | 'save';

/** Which event reports each tab (see the file comment). */
const SECTION_TRIGGER: Record<NotifySection, NotifyTrigger> = {
  programs: 'recompute',
  demand_plan: 'recompute',
  harvest_plan: 'recompute',
  po_updates: 'recompute',
  harvest_request: 'save',
  harvest_actual: 'save',
};

// Which output tabs each kind of input change flows through, so the email can
// say what to re-check. A recompute regenerates everything, but this points
// people at the tabs that actually move. Harvest Request and Actual Harvest are
// not engine inputs, so no computed output moves when they change.
const AFFECTED_TABS: Record<NotifySection, string[]> = {
  demand_plan: ['Dashboard', 'Annual Summary', 'Program Fulfilment', '60-Month Summary', 'Revenue & Cost'],
  po_updates: ['Dashboard', 'Annual Summary', 'Program Fulfilment', '60-Month Summary', 'Revenue & Cost'],
  harvest_plan: ['Dashboard', 'Program Fulfilment', 'Open to buy', '60-Month Summary', 'Fulfilment Optimizer'],
  programs: ['Dashboard', 'Annual Summary', 'Program Fulfilment', 'Open to buy', '60-Month Summary', 'Revenue & Cost', 'Fulfilment Optimizer'],
  harvest_request: [],
  harvest_actual: [],
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

function plural(n: number, word: string): string {
  return `${n} ${word}${n === 1 ? '' : 's'}`;
}

/** "N month(s) set, M cleared" from a {set, cleared} payload, or null if neither is present. */
function setCleared(c: any, unit = 'month'): string | null {
  if (c.set == null && c.cleared == null) return null;
  const parts: string[] = [];
  if (c.set) parts.push(`${plural(c.set, unit)} set`);
  if (c.cleared) parts.push(`${c.cleared} cleared`);
  return parts.join(', ') || null;
}

/** A compact human description of one audit entry's `changes` payload. */
function describeChange(entityType: string, action: string, c: any): string {
  c = c ?? {};
  if (entityType === 'demand_plan') {
    if (c.imported_cells != null) return `${c.imported_cells} demand cells imported`;
    if (c.saved_from === 'inquiry') return `inquiry saved to pipeline${c.months ? ` (${plural(c.months, 'month')})` : ''}${c.trimmed ? `, ${c.trimmed} pipeline trimmed` : ''}`;
    if (c.promoted_from) return `promoted from ${c.promoted_from}${c.months ? ` (${plural(c.months, 'month')})` : ''}`;
    const sc = setCleared(c);
    return sc ? `demand ${sc}` : 'demand updated';
  }
  if (entityType === 'harvest_plan') {
    if (c.imported_cells != null) return `${c.imported_cells} harvest cells imported`;
    if (c.grid_set != null || c.grid_cleared != null) return `harvest grid: ${c.grid_set ?? 0} set, ${c.grid_cleared ?? 0} cleared`;
    const sc = setCleared(c);
    return sc ? `harvest ${sc}` : 'harvest updated';
  }
  if (entityType === 'harvest_request') {
    if (c.mode || c.harvest_days) {
      const parts: string[] = [];
      if (c.mode) parts.push(`mode ${c.mode.old ?? '—'} → ${c.mode.new ?? '—'}`);
      if (c.harvest_days) parts.push(`harvest days ${c.harvest_days.old ?? '—'} → ${c.harvest_days.new ?? '—'}`);
      return `request settings: ${parts.join('; ')}`;
    }
    if (c.daily) {
      const sc = setCleared(c, 'day');
      return sc ? `daily request ${sc}` : 'daily request updated';
    }
    const sc = setCleared(c);
    return sc ? `request ${sc}` : 'request updated';
  }
  if (entityType === 'harvest_actual') {
    const sc = setCleared(c);
    return sc ? `actual harvest ${sc}` : 'actual harvest updated';
  }
  if (entityType === 'po_updates') {
    if (c.imported_lines != null) {
      const unknown = c.unknown_item_codes ? `, ${c.unknown_item_codes} unknown item code${c.unknown_item_codes === 1 ? '' : 's'}` : '';
      return `import: ${plural(c.imported_lines ?? 0, 'line')}, ${plural(c.imported_pos ?? 0, 'PO')}${unknown}`;
    }
    const ref = c.po_ref ? `PO ${c.po_ref}` : 'PO';
    const span = c.months ? ` (${plural(c.months, 'month')})` : '';
    if (action === 'delete') return `${ref} removed${span}`;
    if (action === 'insert') return `${ref} added${span}`;
    return `${ref} updated${span}`;
  }
  if (entityType === 'programs') {
    if (action === 'insert') return `program added${c.item_code ? ` (${c.item_code})` : ''}`;
    if (action === 'delete') return 'program removed';
    if (c.imported_new != null || c.imported_updated != null) return `import: ${c.imported_new ?? 0} new, ${c.imported_updated ?? 0} updated`;
    if (c.status?.old && c.status?.new) return `status ${c.status.old} → ${c.status.new}${c.promoted || c.promoted_months ? ' (promoted)' : ''}`;
    return 'program edited';
  }
  return `${entityType} ${action}`;
}

type Row = { who: string; section: string; what: string; when: string; entity: string | null; at: string };
type SectionDigest = { section: NotifySection; rows: Row[]; through: string };

export async function notifyPlanChanges(
  svc: any,
  args: {
    planId: string;
    trigger: NotifyTrigger;
    /** The recompute job that just finished — excluded when finding the previous one. */
    jobId?: string;
    /** Restrict to these tabs; defaults to every tab reported by this trigger. */
    sections?: NotifySection[];
  }
): Promise<{ sent?: number; skipped?: string; error?: string }> {
  const { planId, trigger, jobId } = args;
  const sections = (args.sections ?? NOTIFY_SECTIONS).filter((s) => SECTION_TRIGGER[s] === trigger);
  if (!sections.length) return { skipped: 'no tabs reported by this trigger' };

  // Only official/admin plans notify — never a user's private sandbox.
  const { data: plan } = await svc
    .from('plans')
    .select('id, name, org_id, type, is_sandbox, created_at')
    .eq('id', planId)
    .maybeSingle();
  if (!plan) return { skipped: 'plan not found' };
  if (plan.is_sandbox) return { skipped: 'sandbox plan — no notification' };

  // The previous completed recompute. It is the window start for a tab that has
  // never had a digest, which keeps the first publish of a plan a silent baseline.
  let priorQ = svc
    .from('recompute_jobs')
    .select('finished_at')
    .eq('plan_id', planId)
    .eq('status', 'done')
    .not('finished_at', 'is', null)
    .order('finished_at', { ascending: false })
    .limit(1);
  if (jobId) priorQ = priorQ.neq('id', jobId);
  const { data: prior } = await priorQ.maybeSingle();
  const priorRecompute: string | null = prior?.finished_at ?? null;

  // The latest digest per tab — the window starts right after what it covered.
  const { data: ledger } = await svc
    .from('change_notifications')
    .select('section, through_at, created_at')
    .eq('plan_id', planId)
    .in('section', sections)
    .order('created_at', { ascending: false });
  const lastThrough = new Map<string, string>();
  for (const l of (ledger ?? []) as { section: string; through_at: string }[]) {
    if (!lastThrough.has(l.section)) lastThrough.set(l.section, l.through_at);
  }

  // Window start per tab. A save-triggered tab with no history falls back to the
  // plan's creation so an early save is still reported; a recompute-triggered tab
  // with no history stays silent, as the first publish always has.
  const since = new Map<NotifySection, string>();
  for (const s of sections) {
    const start = lastThrough.get(s) ?? priorRecompute ?? (trigger === 'save' ? plan.created_at : null);
    if (start) since.set(s, start);
  }
  if (!since.size) return { skipped: 'first publish — baseline, no notification' };

  const earliest = [...since.values()].sort()[0];
  const { data: audit } = await svc
    .from('audit_log')
    .select('user_id, entity_type, entity_id, action, changes, at')
    .eq('plan_id', planId)
    .in('entity_type', [...since.keys()])
    .gt('at', earliest)
    .order('at', { ascending: true });
  const entries = ((audit ?? []) as any[]).filter((e) => {
    const start = since.get(e.entity_type as NotifySection);
    return start != null && new Date(e.at).getTime() > new Date(start).getTime();
  });
  if (!entries.length) return { skipped: 'no changes since the last digest' };

  // Resolve user names and program labels for readability.
  const { data: users } = await svc
    .from('users')
    .select('id, full_name, email, is_active, notify_sections')
    .eq('org_id', plan.org_id);
  const userList = (users ?? []) as { id: string; full_name: string; email: string; is_active: boolean; notify_sections: string[] | null }[];
  const nameById = new Map(userList.map((u) => [u.id, u.full_name || u.email]));

  const { data: progs } = await svc.from('programs').select('id, item_code, customer').eq('plan_id', planId);
  const progById = new Map<string, string>((progs ?? []).map((p: any): [string, string] => [p.id, `${p.item_code}${p.customer ? ` · ${p.customer}` : ''}`]));

  const digests: SectionDigest[] = [];
  for (const s of sections) {
    const own = entries.filter((e) => e.entity_type === s);
    if (!own.length) continue;
    digests.push({
      section: s,
      through: own[own.length - 1].at,
      rows: own.map((e) => ({
        who: nameById.get(e.user_id) ?? 'Unknown user',
        section: NOTIFY_SECTION_LABEL[s],
        what: describeChange(e.entity_type, e.action, e.changes),
        entity: progById.get(e.entity_id) ?? null,
        when: fmtWhen(e.at),
        at: e.at,
      })),
    });
  }

  const base = (process.env.NEXT_PUBLIC_SITE_URL || (process.env.VERCEL_URL ? `https://${process.env.VERCEL_URL}` : '')).replace(/\/$/, '');

  // One email per recipient, covering every changed tab they are subscribed to.
  const mails: Mail[] = [];
  const recipientsBySection = new Map<NotifySection, number>();
  for (const u of userList) {
    if (!u.is_active || !u.email) continue;
    const subscribed = new Set(u.notify_sections ?? []);
    const mine = digests.filter((d) => subscribed.has(d.section));
    if (!mine.length) continue;
    for (const d of mine) recipientsBySection.set(d.section, (recipientsBySection.get(d.section) ?? 0) + 1);
    const content = buildEmail({ planName: plan.name, digests: mine, trigger, base });
    mails.push({ to: u.email, ...content });
  }

  let result: { sent?: number; skipped?: string; error?: string };
  if (!mails.length) {
    result = { sent: 0, skipped: 'no recipients subscribed to the changed tabs' };
  } else {
    const res = await sendEmails(mails);
    result = res.ok ? { sent: res.sent, skipped: res.skipped ? res.error : undefined } : { sent: res.sent, error: res.error };
  }

  // Advance the ledger whether or not anyone was subscribed or the send
  // succeeded: a change is reported once, and a mail outage must not turn
  // into a flood when it clears. The outcome is returned to the caller's log.
  const marks = digests.map((d) => ({
    plan_id: planId,
    section: d.section,
    reason: trigger,
    through_at: d.through,
    changes: d.rows.length,
    recipients: recipientsBySection.get(d.section) ?? 0,
  }));
  const { error: ledgerErr } = await svc.from('change_notifications').insert(marks);
  if (ledgerErr) console.error('change_notifications insert failed:', ledgerErr.message);

  return result;
}

function esc(s: string): string {
  return s.replace(/[&<>"]/g, (ch) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[ch] as string));
}

function joinNames(names: string[]): string {
  if (names.length <= 1) return names[0] ?? '';
  if (names.length === 2) return `${names[0]} and ${names[1]}`;
  return `${names.slice(0, -1).join(', ')} and ${names[names.length - 1]}`;
}

/** Subject, HTML and text for one recipient's digest. */
function buildEmail(d: { planName: string; digests: SectionDigest[]; trigger: NotifyTrigger; base: string }): Omit<Mail, 'to'> {
  const rows = d.digests.flatMap((x) => x.rows).sort((a, b) => a.at.localeCompare(b.at));
  const labels = d.digests.map((x) => NOTIFY_SECTION_LABEL[x.section]);
  const editors = [...new Set(rows.map((r) => r.who))];
  const since = fmtWhen(rows[0].at);

  // Affected output tabs = union across the changed tabs, canonical order.
  const tabSet = new Set<string>();
  for (const x of d.digests) for (const tab of AFFECTED_TABS[x.section]) tabSet.add(tab);
  const tabs = TAB_ORDER.filter((t) => tabSet.has(t));

  const title = d.digests.length === 1 ? `${labels[0]} updated: ${d.planName}` : `Inputs updated: ${d.planName}`;
  const verb = d.trigger === 'recompute' ? 'recalculated' : 'saved';
  const subject = `${title} — ${plural(rows.length, 'change')} ${verb}`;
  const lead = `${plural(rows.length, 'change')} to ${joinNames(labels)} by ${joinNames(editors)} ${rows.length === 1 ? 'was' : 'were'} ${d.trigger === 'recompute' ? 'recalculated and saved' : 'saved'}.`;
  const sub = `Changes from ${since} onwards (times in Sri Lanka time).`;
  const why = `You're receiving this because an admin set you to be notified of ${joinNames(labels)} changes. Ask an admin to change this under Admin → Users.`;

  return {
    subject,
    html: renderHtml({ title, lead, sub, why, rows, tabs, base: d.base }),
    text: renderText({ title, lead, sub, why, rows, tabs, base: d.base }),
  };
}

type Rendered = { title: string; lead: string; sub: string; why: string; rows: Row[]; tabs: string[]; base: string };

function renderHtml(d: Rendered): string {
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
          <div style="font-size:18px;font-weight:700;margin-top:4px;">${esc(d.title)}</div>
        </div>
        <div style="padding:20px 24px;">
          <p style="margin:0 0 4px;font-size:14px;color:#334155;">${esc(d.lead)}</p>
          <p style="margin:0 0 16px;font-size:12px;color:#64748b;">${esc(d.sub)}</p>

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
            ${tabsHtml || '<span style="color:#64748b;font-size:13px;">None — these inputs are recorded beside the plan and do not change computed results.</span>'}
          </div>
          ${cta}
        </div>
      </div>
      <p style="text-align:center;color:#94a3b8;font-size:11px;margin-top:16px;">${esc(d.why)}</p>
    </div>
  </body></html>`;
}

function renderText(d: Rendered): string {
  const lines = [
    d.title,
    '',
    d.lead,
    d.sub,
    '',
    'Changes:',
    ...d.rows.map((r) => `  • ${r.who} — ${r.section}${r.entity ? ` (${r.entity})` : ''}: ${r.what}  [${r.when}]`),
    '',
    `Output tabs affected: ${d.tabs.join(', ') || 'none (these inputs do not change computed results)'}`,
  ];
  if (d.base) lines.push('', `Open the plan: ${d.base}/home`);
  lines.push('', d.why);
  return lines.join('\n');
}
