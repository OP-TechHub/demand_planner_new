import { createClient } from '@/lib/supabase/server';
import { AuditTable, type AuditRow } from './audit-table';

/* eslint-disable @typescript-eslint/no-explicit-any */

const SECTION: Record<string, string> = {
  programs: 'Programs',
  demand_plan: 'Demand Plan',
  harvest_plan: 'Harvest Plan',
  buckets: 'Buckets',
  plans: 'Scenarios',
  users: 'Users & Roles',
};

function actionVerb(action: string, changes: any): string {
  if (action === 'insert') return 'Created';
  if (action === 'delete') return changes?.archived ? 'Archived' : 'Deleted';
  return 'Updated';
}

function relativeTime(iso: string): string {
  const diff = Date.now() - new Date(iso).getTime();
  const m = Math.round(diff / 60000);
  if (m < 1) return 'just now';
  if (m < 60) return `${m}m ago`;
  const h = Math.round(m / 60);
  if (h < 24) return `${h}h ago`;
  const d = Math.round(h / 24);
  if (d < 30) return `${d}d ago`;
  return new Date(iso).toLocaleDateString();
}

const FIELD_LABEL: Record<string, string> = {
  is_active: 'Status', role: 'Role', status: 'Status',
  item_code: 'Item code', item_description: 'Description', customer: 'Customer',
  max_monthly_demand_fp: 'Max monthly demand',
  primary_yield: 'Primary yield', secondary_yield: 'Secondary yield', tertiary_yield: 'Tertiary yield',
  price_per_fp: 'Price', barra_cost_wr: 'Barra cost', packing_cost_fp: 'Packing cost',
  processing_cost_fp: 'Processing cost', storage_cost_fp: 'Storage cost',
  freight_cost_fp: 'Freight cost', other_costs_fp: 'Other costs', locked: 'Locked',
};

function labelFor(k: string): string {
  return FIELD_LABEL[k] ?? k.charAt(0).toUpperCase() + k.slice(1).replace(/_/g, ' ');
}

function prettyVal(v: unknown): string {
  if (typeof v === 'boolean') return v ? 'yes' : 'no';
  if (v === null || v === undefined || v === '') return '—';
  if (typeof v === 'number') return v.toLocaleString();
  return String(v);
}

/** Turn a heterogeneous change payload into a human-readable "old → new" summary. */
function describeChanges(changes: any): string {
  const c = changes ?? {};
  const parts: string[] = [];

  // Field-level old → new pairs (roles, status, program fields).
  for (const [k, v] of Object.entries<any>(c)) {
    if (v && typeof v === 'object' && !Array.isArray(v) && ('old' in v || 'new' in v)) {
      const fmt = k === 'is_active' ? (x: unknown) => (x ? 'active' : 'inactive') : prettyVal;
      parts.push(`${labelFor(k)}: ${fmt(v.old)} → ${fmt(v.new)}`);
    }
  }

  // Per-month edits (demand / harvest) — show a handful, then "+N more".
  if (Array.isArray(c.edits) && c.edits.length) {
    const shown = c.edits.slice(0, 8).map((x: any) => `M${x.m}: ${prettyVal(x.old)} → ${prettyVal(x.new)}`);
    const remaining = c.edits.length - Math.min(8, c.edits.length) + (c.more ?? 0);
    parts.push(shown.join(' · ') + (remaining > 0 ? ` · +${remaining} more` : ''));
  } else if (c.set || c.cleared) {
    const b: string[] = [];
    if (c.set) b.push(`${c.set} month${c.set === 1 ? '' : 's'} set`);
    if (c.cleared) b.push(`${c.cleared} cleared`);
    parts.push(b.join(', '));
  }

  if (c.imported_cells) parts.push(`${c.imported_cells} cells imported`);
  if (c.imported_new || c.imported_updated) parts.push(`${c.imported_new ?? 0} added, ${c.imported_updated ?? 0} updated`);
  return parts.join(' · ');
}

export default async function AuditPage() {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  const { data: me } = await supabase.from('users').select('role').eq('id', user!.id).maybeSingle();
  if (me?.role !== 'admin') {
    return (
      <div className="mx-auto max-w-4xl space-y-4">
        <h1 className="text-2xl font-semibold tracking-tight">Audit Log</h1>
        <div className="rounded-lg border border-destructive/30 bg-destructive/10 p-6 text-sm text-destructive">Admins only.</div>
      </div>
    );
  }

  const [{ data: entries }, { data: users }, { data: programs }, { data: buckets }, { data: plans }] = await Promise.all([
    supabase.from('audit_log').select('*').order('at', { ascending: false }).limit(200),
    supabase.from('users').select('id, full_name, email'),
    supabase.from('programs').select('id, item_code, item_description'),
    supabase.from('buckets').select('id, name'),
    supabase.from('plans').select('id, name, type'),
  ]);

  const userById = new Map<string, string>((users ?? []).map((u: any) => [u.id, u.full_name || u.email]));
  const progById = new Map<string, string>((programs ?? []).map((p: any) => [p.id, p.item_code || p.item_description]));
  const bucketById = new Map<string, string>((buckets ?? []).map((b: any) => [b.id, b.name]));
  const planById = new Map<string, any>((plans ?? []).map((p: any) => [p.id, p]));

  const entityLabel = (e: any): string => {
    const c = e.changes ?? {};
    switch (e.entity_type) {
      case 'users': return userById.get(e.entity_id) ?? 'a user';
      case 'programs': return progById.get(e.entity_id) ?? c.item_code ?? 'a program';
      case 'demand_plan': return progById.get(e.entity_id) ?? planById.get(e.entity_id)?.name ?? 'demand';
      case 'harvest_plan': return bucketById.get(e.entity_id) ?? planById.get(e.entity_id)?.name ?? 'harvest';
      case 'buckets': return bucketById.get(e.entity_id) ?? 'a bucket';
      case 'plans': return planById.get(e.entity_id)?.name ?? 'a scenario';
      default: return '';
    }
  };

  const rows: AuditRow[] = (entries ?? []).map((e: any) => {
    const plan = e.plan_id ? planById.get(e.plan_id) : null;
    return {
      id: e.id,
      whoId: e.user_id ?? '',
      who: userById.get(e.user_id) ?? 'Unknown',
      sectionKey: e.entity_type,
      section: SECTION[e.entity_type] ?? e.entity_type,
      action: actionVerb(e.action, e.changes),
      actionKey: e.action,
      entity: entityLabel(e),
      detail: describeChanges(e.changes),
      scenario: plan && plan.type === 'scenario' ? plan.name : null,
      rel: relativeTime(e.at),
      abs: new Date(e.at).toLocaleString(),
      dateStr: new Date(e.at).toLocaleDateString(),
    };
  });

  return (
    <div className="mx-auto max-w-4xl space-y-4">
      <div>
        <h1 className="text-2xl font-semibold tracking-tight">Audit Log</h1>
        <p className="mt-1 text-sm text-muted-foreground">
          Append-only record of every change — who did it, in which section, and when. Latest {rows.length}.
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
