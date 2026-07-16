import { createClient } from '@/lib/supabase/server';
import { Badge } from '@/components/ui/badge';

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

function actionTone(action: string): string {
  if (action === 'insert') return 'text-success';
  if (action === 'delete') return 'text-destructive';
  return 'text-primary';
}

function initials(name: string) {
  const p = name.trim().split(/\s+/);
  return ((p[0]?.[0] ?? '') + (p[1]?.[0] ?? '')).toUpperCase() || name.slice(0, 2).toUpperCase();
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

function prettyVal(v: unknown): string {
  if (typeof v === 'boolean') return v ? 'active' : 'inactive';
  if (v === null || v === undefined) return '—';
  return String(v);
}

/** Turn a heterogeneous change payload into a human-readable summary. */
function describeChanges(changes: any): string {
  const c = changes ?? {};
  const parts: string[] = [];
  for (const [k, v] of Object.entries<any>(c)) {
    if (v && typeof v === 'object' && ('old' in v || 'new' in v)) {
      const key = k === 'is_active' ? 'Status' : k.charAt(0).toUpperCase() + k.slice(1);
      parts.push(`${key}: ${prettyVal(v.old)} → ${prettyVal(v.new)}`);
    }
  }
  if (c.set || c.cleared) {
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

  // Resolve the human label for whatever entity an entry points at.
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

  return (
    <div className="mx-auto max-w-4xl space-y-4">
      <div>
        <h1 className="text-2xl font-semibold tracking-tight">Audit Log</h1>
        <p className="mt-1 text-sm text-muted-foreground">
          Append-only record of every change — who did it, in which section, and when. Showing the latest {Math.min(entries?.length ?? 0, 200)}.
        </p>
      </div>

      {!entries || entries.length === 0 ? (
        <div className="rounded-lg border border-dashed border-border bg-muted/20 p-10 text-center text-sm text-muted-foreground">
          No activity recorded yet.
        </div>
      ) : (
        <div className="overflow-x-auto rounded-lg border border-border">
          <table className="w-full min-w-[42rem] text-sm">
            <thead className="border-b border-border bg-muted/50 text-left text-xs uppercase tracking-wide text-muted-foreground">
              <tr>
                <th className="px-4 py-2.5 font-medium">Who</th>
                <th className="px-4 py-2.5 font-medium">Section</th>
                <th className="px-4 py-2.5 font-medium">What changed</th>
                <th className="px-4 py-2.5 text-right font-medium">When</th>
              </tr>
            </thead>
            <tbody>
              {(entries as any[]).map((e) => {
                const who = userById.get(e.user_id) ?? 'Unknown';
                const detail = describeChanges(e.changes);
                const plan = e.plan_id ? planById.get(e.plan_id) : null;
                return (
                  <tr key={e.id} className="border-b border-border align-top last:border-0 hover:bg-muted/30">
                    <td className="px-4 py-3">
                      <div className="flex items-center gap-2.5">
                        <span className="flex h-8 w-8 shrink-0 items-center justify-center rounded-full bg-primary/10 text-[11px] font-semibold text-primary">
                          {initials(who)}
                        </span>
                        <span className="truncate font-medium">{who}</span>
                      </div>
                    </td>
                    <td className="px-4 py-3">
                      <Badge variant="secondary">{SECTION[e.entity_type] ?? e.entity_type}</Badge>
                    </td>
                    <td className="px-4 py-3">
                      <div>
                        <span className={`font-medium ${actionTone(e.action)}`}>{actionVerb(e.action, e.changes)}</span>{' '}
                        <span className="text-foreground">{entityLabel(e)}</span>
                        {plan && plan.type === 'scenario' && (
                          <span className="ml-2 rounded bg-muted px-1.5 py-0.5 text-xs text-muted-foreground">in “{plan.name}”</span>
                        )}
                      </div>
                      {detail && <div className="mt-0.5 text-xs text-muted-foreground">{detail}</div>}
                    </td>
                    <td className="whitespace-nowrap px-4 py-3 text-right text-muted-foreground">
                      <div title={new Date(e.at).toLocaleString()}>{relativeTime(e.at)}</div>
                      <div className="text-xs text-muted-foreground/70">{new Date(e.at).toLocaleDateString()}</div>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}
