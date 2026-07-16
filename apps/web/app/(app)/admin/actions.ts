'use server';

import { revalidatePath } from 'next/cache';
import { createClient } from '@/lib/supabase/server';
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
