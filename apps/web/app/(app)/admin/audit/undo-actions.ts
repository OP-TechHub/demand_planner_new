'use server';

/* eslint-disable @typescript-eslint/no-explicit-any */

import { revalidatePath } from 'next/cache';
import { createClient } from '@/lib/supabase/server';
import { createServiceClient } from '@/lib/supabase/service';
import { logAudit } from '@/lib/audit';
import { reversibility } from './reversible';

/**
 * Reverse a single audit-log entry (admin only, within the undo window). The
 * eligibility is re-checked server-side; the reversal writes go through the
 * service role (admin authorisation is enforced here, not by RLS). Locked plans
 * are refused so a read-only official plan can't be silently changed.
 */
export async function undoAuditEntry(id: string): Promise<{ error: string | null }> {
  const rls = await createClient();
  const { data: { user } } = await rls.auth.getUser();
  if (!user) return { error: 'Your session expired. Sign in again.' };
  const { data: me } = await rls.from('users').select('role').eq('id', user.id).maybeSingle();
  if (me?.role !== 'admin') return { error: 'Only an admin can undo changes.' };

  const svc = createServiceClient();
  const { data: entry } = await svc.from('audit_log').select('*').eq('id', id).maybeSingle();
  if (!entry) return { error: 'That audit entry no longer exists.' };

  const rev = reversibility(entry as any, Date.now());
  if (!rev.ok) return { error: `Can’t undo this change: ${rev.reason}.` };

  // Never mutate a locked (read-only) plan.
  if (entry.plan_id) {
    const { data: plan } = await svc.from('plans').select('name, is_locked').eq('id', entry.plan_id).maybeSingle();
    if (plan?.is_locked) return { error: `“${plan.name}” is locked (read-only). Unlock it before undoing changes.` };
  }

  try {
    await applyRevert(svc, entry, user.id);
  } catch (e) {
    return { error: e instanceof Error ? e.message : 'Undo failed.' };
  }

  // Mark the original entry reverted (so it can't be undone twice) and record the
  // undo itself in the log for transparency.
  await svc.from('audit_log').update({ reverted_at: new Date().toISOString(), reverted_by: user.id }).eq('id', id);
  await logAudit(rls, {
    planId: entry.plan_id,
    entityType: entry.entity_type,
    entityId: entry.entity_id,
    action: 'update',
    changes: { undo_of: id, undone_action: entry.action, note: 'admin undo' },
  });

  revalidatePath('/admin/audit');
  revalidatePath('/', 'layout');
  return { error: null };
}

/** Apply the concrete reversal for one entry, by entity type. */
async function applyRevert(svc: any, entry: any, adminId: string): Promise<void> {
  const c = entry.changes ?? {};
  const now = new Date().toISOString();

  if (entry.entity_type === 'demand_plan') {
    const edits = (c.edits ?? []) as { m: number; old: number }[];
    for (const e of edits) {
      const { error } = await svc.from('demand_plan').upsert(
        { plan_id: entry.plan_id, program_id: entry.entity_id, month_index: e.m, demand_fp: e.old, created_by: adminId, updated_by: adminId },
        { onConflict: 'program_id,month_index' }
      );
      if (error) throw new Error(`Reverting demand: ${error.message}`);
    }
    return;
  }

  if (entry.entity_type === 'harvest_plan') {
    const edits = (c.edits ?? []) as { m: number; old: number }[];
    for (const e of edits) {
      if (e.old === 0) {
        // 0 means "no capacity row" — restore that by removing the row.
        const { error } = await svc.from('harvest_plan').delete()
          .eq('plan_id', entry.plan_id).eq('bucket_id', entry.entity_id).eq('month_index', e.m);
        if (error) throw new Error(`Reverting harvest: ${error.message}`);
      } else {
        const { error } = await svc.from('harvest_plan').upsert(
          { plan_id: entry.plan_id, bucket_id: entry.entity_id, month_index: e.m, capacity_kg_wr: e.old, created_by: adminId, updated_by: adminId },
          { onConflict: 'plan_id,bucket_id,month_index' }
        );
        if (error) throw new Error(`Reverting harvest: ${error.message}`);
      }
    }
    return;
  }

  if (entry.entity_type === 'programs') {
    if (entry.action === 'insert') {
      // Undo a create = archive the program.
      const { error } = await svc.from('programs').update({ deleted_at: now, updated_by: adminId }).eq('id', entry.entity_id);
      if (error) throw new Error(`Removing program: ${error.message}`);
      return;
    }
    if (entry.action === 'delete') {
      // Undo an archive = restore it.
      const { error } = await svc.from('programs').update({ deleted_at: null, updated_by: adminId }).eq('id', entry.entity_id);
      if (error) throw new Error(`Restoring program: ${error.message}`);
      return;
    }
    // update = put each changed field back to its old value.
    const patch: Record<string, unknown> = { updated_by: adminId };
    for (const [k, v] of Object.entries<any>(c)) {
      if (v && typeof v === 'object' && !Array.isArray(v) && 'old' in v) patch[k] = v.old;
    }
    if (Object.keys(patch).length > 1) {
      const { error } = await svc.from('programs').update(patch).eq('id', entry.entity_id);
      if (error) throw new Error(`Reverting program: ${error.message}`);
    }
    return;
  }

  throw new Error('This kind of change can’t be undone.');
}
