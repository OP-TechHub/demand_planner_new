/* eslint-disable @typescript-eslint/no-explicit-any */

/**
 * Append an audit-log entry. Best-effort — never blocks or fails the mutation
 * that called it. RLS requires org_id = current_org_id() and user_id = auth.uid(),
 * which this satisfies from the caller's own session.
 */
export async function logAudit(
  supabase: any,
  entry: {
    planId: string | null;
    entityType: 'programs' | 'demand_plan' | 'harvest_plan' | 'harvest_request' | 'buckets' | 'plans';
    entityId: string;
    action: 'insert' | 'update' | 'delete';
    changes?: Record<string, unknown>;
  }
): Promise<void> {
  try {
    const { data: { user } } = await supabase.auth.getUser();
    if (!user) return;
    const { data: me } = await supabase.from('users').select('org_id').eq('id', user.id).maybeSingle();
    if (!me) return;
    await supabase.from('audit_log').insert({
      org_id: me.org_id,
      plan_id: entry.planId,
      user_id: user.id,
      entity_type: entry.entityType,
      entity_id: entry.entityId,
      action: entry.action,
      changes: entry.changes ?? null,
    });
  } catch {
    // audit is best-effort; swallow errors so they never break the write
  }
}
