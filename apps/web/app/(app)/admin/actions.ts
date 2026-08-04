'use server';

import { revalidatePath } from 'next/cache';
import { createClient } from '@/lib/supabase/server';
import { createServiceClient } from '@/lib/supabase/service';
import { EDITABLE_SECTIONS, type UserRole } from '@oceanpick/shared';

export type AdminResult = { error: string | null };

const ROLES: UserRole[] = ['admin', 'planner', 'contributor', 'viewer'];

async function requireAdmin() {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return { supabase, me: null, error: 'Your session expired.' };
  const { data: me } = await supabase.from('users').select('id, role, org_id').eq('id', user.id).maybeSingle();
  if (!me || me.role !== 'admin') return { supabase, me, error: 'Admins only.' };
  return { supabase, me, error: null as string | null };
}

/** Append an audit-log entry (append-only; RLS requires org + user match). */
async function writeAudit(
  supabase: Awaited<ReturnType<typeof createClient>>,
  me: { id: string; org_id: string },
  entityId: string,
  changes: Record<string, { old: unknown; new: unknown }>
) {
  await supabase.from('audit_log').insert({
    org_id: me.org_id, plan_id: null, user_id: me.id,
    entity_type: 'users', entity_id: entityId, action: 'update', changes,
  });
}

/** Change a user's role. Admin-only (also enforced by RLS). */
export async function updateUserRole(userId: string, role: string): Promise<AdminResult> {
  if (!ROLES.includes(role as UserRole)) return { error: 'Invalid role.' };
  const { supabase, me, error } = await requireAdmin();
  if (error) return { error };
  if (me && userId === me.id && role !== 'admin') {
    return { error: 'You can’t remove your own admin role (avoids locking yourself out).' };
  }
  const { data: before } = await supabase.from('users').select('role').eq('id', userId).maybeSingle();
  const { error: e } = await supabase.from('users').update({ role }).eq('id', userId);
  if (e) return { error: e.message };
  if (me && before && before.role !== role) await writeAudit(supabase, me, userId, { role: { old: before.role, new: role } });
  revalidatePath('/admin/users');
  return { error: null };
}

/** Grant/revoke the input sections a user may edit. Admin-only. */
export async function setUserSections(userId: string, sections: string[]): Promise<AdminResult> {
  const { supabase, me, error } = await requireAdmin();
  if (error) return { error };
  const allowed = EDITABLE_SECTIONS as readonly string[];
  const valid = Array.from(new Set(sections.filter((s) => allowed.includes(s))));
  const { data: before } = await supabase.from('users').select('edit_sections').eq('id', userId).maybeSingle();
  const { error: e } = await supabase.from('users').update({ edit_sections: valid }).eq('id', userId);
  if (e) return { error: e.message };
  const oldList = (before?.edit_sections ?? []) as string[];
  if (me && oldList.slice().sort().join(',') !== valid.slice().sort().join(',')) {
    await writeAudit(supabase, me, userId, {
      edit_sections: { old: oldList.join(', ') || 'none', new: valid.join(', ') || 'none' },
    });
  }
  revalidatePath('/admin/users');
  return { error: null };
}

/** Activate / deactivate a user. Admin-only. */
export async function setUserActive(userId: string, isActive: boolean): Promise<AdminResult> {
  const { supabase, me, error } = await requireAdmin();
  if (error) return { error };
  if (me && userId === me.id && !isActive) return { error: 'You can’t deactivate your own account.' };
  const { data: before } = await supabase.from('users').select('is_active').eq('id', userId).maybeSingle();
  const { error: e } = await supabase.from('users').update({ is_active: isActive }).eq('id', userId);
  if (e) return { error: e.message };
  if (me && before && before.is_active !== isActive) await writeAudit(supabase, me, userId, { is_active: { old: before.is_active, new: isActive } });
  revalidatePath('/admin/users');
  return { error: null };
}

/** Audit a plan-level admin action (entity_type 'plans'). */
async function auditPlan(
  supabase: Awaited<ReturnType<typeof createClient>>,
  me: { id: string; org_id: string },
  planId: string,
  action: 'update' | 'delete',
  changes: Record<string, unknown>
) {
  await supabase.from('audit_log').insert({
    org_id: me.org_id, plan_id: planId, user_id: me.id,
    entity_type: 'plans', entity_id: planId, action, changes,
  });
}

/**
 * Lock or unlock a plan. Admin-only. A locked plan is read-only everywhere
 * (can_write_section / can_write_plan both require `not is_locked`). Works on
 * any plan including the master. Uses the service role because RLS only lets a
 * scenario's owner update it — an admin must be able to lock anyone's plan.
 */
export async function setPlanLocked(planId: string, locked: boolean): Promise<AdminResult> {
  const { me, error } = await requireAdmin();
  if (error || !me) return { error: error ?? 'Admins only.' };

  const svc = createServiceClient();
  const { data: plan } = await svc.from('plans').select('id, org_id, is_locked, name').eq('id', planId).is('deleted_at', null).maybeSingle();
  if (!plan || plan.org_id !== me.org_id) return { error: 'Plan not found.' };
  if (plan.is_locked === locked) { revalidatePath('/admin/plans'); return { error: null }; }

  const { error: e } = await svc.from('plans').update({ is_locked: locked, updated_by: me.id }).eq('id', planId);
  if (e) return { error: e.message };
  await auditPlan(await createClient(), me, planId, 'update', { is_locked: { old: plan.is_locked, new: locked }, name: plan.name });
  revalidatePath('/admin/plans');
  revalidatePath('/settings');
  return { error: null };
}

/**
 * Soft-delete a plan (scenario or snapshot). Admin-only. The master plan is
 * never deletable — it's the backbone. Recoverable in the DB (deleted_at set).
 */
export async function adminDeletePlan(planId: string): Promise<AdminResult> {
  const { me, error } = await requireAdmin();
  if (error || !me) return { error: error ?? 'Admins only.' };

  const svc = createServiceClient();
  const { data: plan } = await svc.from('plans').select('id, org_id, type, name').eq('id', planId).is('deleted_at', null).maybeSingle();
  if (!plan || plan.org_id !== me.org_id) return { error: 'Plan not found.' };
  if (plan.type === 'master') return { error: 'The master plan can’t be deleted.' };

  const { error: e } = await svc.from('plans').update({ deleted_at: new Date().toISOString(), updated_by: me.id }).eq('id', planId);
  if (e) return { error: e.message };
  await auditPlan(await createClient(), me, planId, 'delete', { deleted: true, name: plan.name, type: plan.type });
  revalidatePath('/admin/plans');
  revalidatePath('/scenarios');
  return { error: null };
}
