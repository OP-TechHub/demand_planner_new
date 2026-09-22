import { monthLabel } from '@oceanpick/shared';
import { createClient } from '@/lib/supabase/server';
import { AuditTable, type AuditRow, type AuditChange } from './audit-table';
import { reversibility, UNDO_WINDOW_DAYS } from './reversible';

/* eslint-disable @typescript-eslint/no-explicit-any */

const SECTION: Record<string, string> = {
  programs: 'Programs',
  demand_plan: 'Demand Plan',
  harvest_plan: 'Harvest Plan',
  harvest_request: 'Harvest Request Plan',
  harvest_actual: 'Actual Harvest',
  po_updates: 'PO Update',
  buckets: 'Buckets',
  plans: 'Scenarios',
  users: 'Users & Roles',
};

/** Unit shown after month values, per section. */
const UNIT: Record<string, string> = {
  demand_plan: 'kg FP',
  harvest_plan: 'kg WR',
  harvest_request: 'kg WR',
  harvest_actual: 'kg WR',
};

function actionVerb(action: string, changes: any): string {
  if (changes?.undo_of) return 'Reverted';
  if (action === 'insert') return 'Created';
  if (action === 'delete') return changes?.archived ? 'Archived' : 'Deleted';
  return 'Updated';
}

const FIELD_LABEL: Record<string, string> = {
  is_active: 'Account status', role: 'Role', status: 'Status', edit_sections: 'Edit access',
  item_code: 'Item code', export_code: 'Export code', item_description: 'Description', customer: 'Customer',
  max_monthly_demand_fp: 'Max monthly demand (kg FP)',
  primary_yield: 'Primary yield', secondary_yield: 'Secondary yield', tertiary_yield: 'Tertiary yield',
  price_per_fp: 'Price / kg FP', barra_cost_wr: 'Barra cost / kg WR', packing_cost_fp: 'Packing cost',
  processing_cost_fp: 'Processing cost', storage_cost_fp: 'Storage cost',
  freight_cost_fp: 'Freight cost', other_costs_fp: 'Other costs', locked: 'Locked',
  plan_start_date: 'Plan start month', is_locked: 'Plan locked', is_live: 'Live plan',
};

function labelFor(k: string): string {
  return FIELD_LABEL[k] ?? k.charAt(0).toUpperCase() + k.slice(1).replace(/_/g, ' ');
}

function prettyVal(v: unknown): string {
  if (typeof v === 'boolean') return v ? 'yes' : 'no';
  if (v === null || v === undefined || v === '') return '—';
  if (typeof v === 'number') return v.toLocaleString('en-US', { maximumFractionDigits: 4 });
  return String(v);
}

/** "2026-03" → "Mar 2026". */
function prettyYM(v: unknown): string {
  if (typeof v !== 'string' || !/^\d{4}-\d{2}/.test(v)) return prettyVal(v);
  const [y, m] = v.split('-').map(Number);
  return new Date(Date.UTC(y, m - 1, 1)).toLocaleString('en-US', { month: 'short', year: 'numeric', timeZone: 'UTC' });
}

type Ctx = {
  bucketName: (id: string | null | undefined) => string | null;
  /** Month label for a month index, using the plan's start month as it was when the change was made. */
  month: (m: number) => string;
};

type Described = { changes: AuditChange[]; more: number; notes: string[] };

/** Turn a heterogeneous change payload into notes plus a list of "field: before → after" rows. */
function describeChanges(entityType: string, changes: any, ctx: Ctx): Described {
  const c = changes ?? {};
  const out: Described = { changes: [], more: 0, notes: [] };
  if (c.undo_of) {
    out.notes.push('Reverted an earlier change back to its previous values');
    return out;
  }

  // Field-level old → new pairs (roles, status, program fields, plan settings).
  for (const [k, v] of Object.entries<any>(c)) {
    if (v && typeof v === 'object' && !Array.isArray(v) && ('old' in v || 'new' in v)) {
      const fmt =
        k === 'is_active' ? (x: unknown) => (x ? 'active' : 'inactive')
        : k === 'plan_start_date' ? prettyYM
        : prettyVal;
      out.changes.push({ field: labelFor(k), before: fmt(v.old), after: fmt(v.new) });
    }
  }

  // Per-month edits (demand / harvest) — one row per month (and bucket, where recorded).
  if (Array.isArray(c.edits) && c.edits.length) {
    const unit = UNIT[entityType] ?? '';
    for (const x of c.edits) {
      const bucket = x.b ? ctx.bucketName(x.b) ?? 'Unknown bucket' : null;
      out.changes.push({
        field: `${bucket ? bucket + ' · ' : ''}${ctx.month(x.m)} (M${x.m})`,
        before: prettyVal(x.old),
        after: prettyVal(x.new),
        unit,
      });
    }
    out.more = c.more ?? 0;
  } else if (c.set || c.cleared) {
    const b: string[] = [];
    if (c.set) b.push(`${c.set} month${c.set === 1 ? '' : 's'} set`);
    if (c.cleared) b.push(`${c.cleared} month${c.cleared === 1 ? '' : 's'} cleared`);
    out.notes.push(b.join(', '));
  }

  // Context notes for multi-step flows and bulk actions.
  if (c.trim_for_inquiry) out.notes.push('Demand trimmed automatically to free capacity for an inquiry');
  else if (c.inquiry_add) out.notes.push('Inquiry volume added on top of existing demand');
  else if (c.saved_from === 'inquiry') out.notes.push('Created from an inquiry as a pipeline program');
  if (c.trimmed) out.notes.push(`${c.trimmed} other program${c.trimmed === 1 ? ' was' : 's were'} trimmed to make room`);
  if (c.promoted) out.notes.push('Promoted from pipeline to active');
  if (c.promoted_months != null) out.notes.push(`${c.promoted_months} month${c.promoted_months === 1 ? '' : 's'} promoted; the rest moved to pipeline program ${c.pipeline_twin ?? ''}`.trim());
  if (c.promoted_from) out.notes.push(`${c.months ?? ''} month${c.months === 1 ? '' : 's'} of demand promoted in from ${c.promoted_from}`.trim());
  if (c.imported_cells) out.notes.push(`Bulk CSV import: ${c.imported_cells.toLocaleString()} cells overwritten (individual values not recorded)`);
  if (c.imported_new != null || c.imported_updated != null) out.notes.push(`Bulk CSV import: ${c.imported_new ?? 0} programs added, ${c.imported_updated ?? 0} updated`);
  if (c.imported_lines != null) out.notes.push(`PO file import: ${c.imported_lines} lines across ${c.imported_pos ?? 0} POs${c.unknown_item_codes ? `, ${c.unknown_item_codes} unknown item codes skipped` : ''}`);
  if (c.po_ref) {
    const range = c.month_from && c.month_to
      ? ` for ${ctx.month(c.month_from)}${c.month_to !== c.month_from ? ` – ${ctx.month(c.month_to)}` : ''}`
      : c.months ? ` (${c.months} month${c.months === 1 ? '' : 's'})` : '';
    const qty = c.quantity_fp != null ? `, ${prettyVal(c.quantity_fp)} kg FP / month` : '';
    out.notes.push(`PO ${c.po_ref}${range}${qty}`);
  }
  if (c.rolled_forward_months != null) out.notes.push(`Plan rolled forward ${c.rolled_forward_months} month${c.rolled_forward_months === 1 ? '' : 's'}`);
  if (c.restored_from) out.notes.push(`Restored from snapshot “${c.restored_from}”`);
  if (c.access && typeof c.access === 'object') out.notes.push(`Edit access set to: ${c.access.sections}`);
  if (entityType === 'plans' && c.deleted) out.notes.push(`${c.type === 'scenario' ? 'Scenario' : 'Plan'} deleted`);
  if (entityType === 'programs' && Object.keys(c).join() === 'item_code') out.notes.push('Saved with no field values changed');
  return out;
}

/** Plain-text version of the change list, for the CSV export. */
function changesText(d: Described): string {
  const lines = d.changes.map((x) => `${x.field}: ${x.before} → ${x.after}${x.unit ? ' ' + x.unit : ''}`);
  if (d.more) lines.push(`+${d.more} more not recorded`);
  return [...d.notes, ...lines].join('; ');
}

export default async function AuditPage() {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  const { data: me } = await supabase.from('users').select('role').eq('id', user!.id).maybeSingle();
  if (me?.role !== 'admin') {
    return (
      <div className="mx-auto max-w-5xl space-y-4">
        <h1 className="text-2xl font-semibold tracking-tight">Audit Log</h1>
        <div className="rounded-lg border border-destructive/30 bg-destructive/10 p-6 text-sm text-destructive">Admins only.</div>
      </div>
    );
  }

  const { data: entries } = await supabase
    .from('audit_log').select('*').order('at', { ascending: false }).limit(200);

  // Resolve names only for the rows these 200 entries actually reference.
  // Selecting every program across every plan (master + all scenarios) would
  // blow past PostgREST's 1000-row cap and silently leave later entries
  // labelled with raw UUIDs.
  const progIds = [...new Set(
    (entries ?? [])
      .filter((e: any) => e.entity_type === 'programs' || e.entity_type === 'demand_plan' || e.entity_type === 'po_updates')
      .map((e: any) => e.entity_id as string)
      .filter(Boolean)
  )];

  const [{ data: users }, { data: programs }, { data: buckets }, { data: plans }, { data: planEvents }] = await Promise.all([
    supabase.from('users').select('id, full_name, email'),
    progIds.length
      ? supabase.from('programs').select('id, item_code, item_description, customer').in('id', progIds)
      : Promise.resolve({ data: [] as any[] }),
    supabase.from('buckets').select('id, name'),
    supabase.from('plans').select('id, name, type, plan_start_date'),
    // Plan-level events, to recover each plan's start month at the time of an
    // older edit: month indices are relative to the start, which rolls forward.
    supabase.from('audit_log').select('plan_id, at, changes').eq('entity_type', 'plans').order('at', { ascending: true }).limit(1000),
  ]);

  const userById = new Map<string, string>((users ?? []).map((u: any) => [u.id, u.full_name || u.email]));
  const progById = new Map<string, any>((programs ?? []).map((p: any) => [p.id, p]));
  const bucketById = new Map<string, string>((buckets ?? []).map((b: any) => [b.id, b.name]));
  const planById = new Map<string, any>((plans ?? []).map((p: any) => [p.id, p]));

  const startChanges = new Map<string, { at: number; old: string }[]>();
  for (const ev of planEvents ?? []) {
    const old = (ev as any).changes?.plan_start_date?.old;
    if (!ev.plan_id || typeof old !== 'string') continue;
    const list = startChanges.get(ev.plan_id) ?? [];
    list.push({ at: new Date(ev.at).getTime(), old });
    startChanges.set(ev.plan_id, list);
  }
  /** The plan's start date (YYYY-MM-01) in effect at `atMs`. */
  const startAt = (planId: string | null, atMs: number): string | null => {
    if (!planId) return null;
    const later = (startChanges.get(planId) ?? []).find((s) => s.at > atMs);
    if (later) return `${later.old.slice(0, 7)}-01`;
    return planById.get(planId)?.plan_start_date ?? null;
  };

  const progLabel = (id: string, c: any): string => {
    const p = progById.get(id);
    const code = p?.item_code ?? c.item_code;
    if (!code) return 'a program';
    const extra = p?.customer ?? c.customer;
    return extra ? `${code} (${extra})` : code;
  };

  const entityLabel = (e: any): string => {
    const c = e.changes ?? {};
    const planWide = e.entity_id === e.plan_id;
    switch (e.entity_type) {
      case 'users': return userById.get(e.entity_id) ?? 'a user';
      case 'programs': return planWide ? 'programs (bulk import)' : progLabel(e.entity_id, c);
      case 'demand_plan': return planWide ? 'demand (bulk import)' : `demand for ${progLabel(e.entity_id, c)}`;
      case 'po_updates': return planWide ? 'POs (file import)' : `PO for ${progLabel(e.entity_id, c)}`;
      case 'harvest_plan': return planWide ? 'harvest capacity (bulk import)' : `harvest capacity for ${bucketById.get(e.entity_id) ?? 'a bucket'}`;
      case 'harvest_request': return 'requested harvest';
      case 'harvest_actual': return 'actual harvest';
      case 'buckets': return bucketById.get(e.entity_id) ?? 'a bucket';
      case 'plans': return planById.get(e.entity_id)?.name ?? c.name ?? c.plan ?? 'a plan';
      default: return '';
    }
  };

  const now = Date.now();
  const rows: AuditRow[] = (entries ?? []).map((e: any) => {
    const plan = e.plan_id ? planById.get(e.plan_id) : null;
    const atMs = new Date(e.at).getTime();
    const start = startAt(e.plan_id, atMs);
    const ctx: Ctx = {
      bucketName: (id) => (id ? bucketById.get(id) ?? null : null),
      month: (m) => (start ? monthLabel(start, m) : `M${m}`),
    };
    const described = describeChanges(e.entity_type, e.changes, ctx);
    const rev = reversibility(e, now);
    return {
      id: e.id,
      whoId: e.user_id ?? '',
      who: userById.get(e.user_id) ?? 'Unknown',
      sectionKey: e.entity_type,
      section: SECTION[e.entity_type] ?? e.entity_type,
      action: actionVerb(e.action, e.changes),
      actionKey: e.action,
      entity: entityLabel(e),
      notes: described.notes,
      changes: described.changes,
      more: described.more,
      detailText: changesText(described),
      planName: plan ? (plan.type === 'scenario' ? `Scenario “${plan.name}”` : plan.name) : e.plan_id ? 'Deleted plan' : null,
      isScenario: plan?.type === 'scenario',
      at: e.at,
      canUndo: rev.ok,
      undoReason: rev.ok ? null : rev.reason ?? null,
      undone: e.reverted_at ? { by: userById.get(e.reverted_by) ?? 'an admin', at: e.reverted_at } : null,
    };
  });

  return (
    <div className="mx-auto max-w-5xl space-y-4">
      <div>
        <h1 className="text-2xl font-semibold tracking-tight">Audit Log</h1>
        <p className="mt-1 text-sm text-muted-foreground">
          Every change — <b className="text-foreground">who</b> made it, <b className="text-foreground">where</b> (section, item and plan),
          {' '}<b className="text-foreground">what</b> changed from → to, and <b className="text-foreground">when</b>. Latest {rows.length}.
          Admins can <b className="text-foreground">undo</b> eligible edits for {UNDO_WINDOW_DAYS} days; after that they’re permanent.
        </p>
      </div>

      {rows.length === 0 ? (
        <div className="rounded-lg border border-dashed border-border bg-muted/20 p-10 text-center text-sm text-muted-foreground">
          No activity recorded yet.
        </div>
      ) : (
        <AuditTable rows={rows} />
      )}
    </div>
  );
}
