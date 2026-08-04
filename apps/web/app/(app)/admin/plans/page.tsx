import { createClient } from '@/lib/supabase/server';
import { PlansAdminClient, type AdminPlan, type AccessUser } from './plans-client';

export default async function AdminPlansPage() {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  const { data: me } = await supabase.from('users').select('role').eq('id', user!.id).maybeSingle();

  if (me?.role !== 'admin') {
    return (
      <div className="mx-auto max-w-4xl space-y-4">
        <h1 className="text-2xl font-semibold tracking-tight">Plans</h1>
        <div className="rounded-lg border border-destructive/30 bg-destructive/10 p-6 text-sm text-destructive">Admins only.</div>
      </div>
    );
  }

  // Admins can read every plan in the org (RLS: is_editor sees all).
  const [{ data: plans }, { data: users }] = await Promise.all([
    supabase
      .from('plans')
      .select('id, name, type, is_locked, is_sandbox, owner_user_id, plan_start_date, horizon_months, forked_at, created_at')
      .is('deleted_at', null)
      .order('type', { ascending: true })
      .order('created_at', { ascending: true }),
    supabase.from('users').select('id, full_name, email, role, is_active').order('full_name'),
  ]);

  const nameById = new Map((users ?? []).map((u) => [u.id, u.full_name || u.email]));
  // Non-admin active users are the ones you grant per-plan edit access to
  // (admins always edit; viewers/planners/contributors need a grant).
  const accessUsers: AccessUser[] = (users ?? [])
    .filter((u) => u.is_active && u.role !== 'admin')
    .map((u) => ({ id: u.id, name: u.full_name || u.email }));
  const rows: AdminPlan[] = (plans ?? []).map((p) => ({
    id: p.id,
    name: p.name,
    type: p.type,
    is_locked: p.is_locked,
    is_sandbox: p.is_sandbox,
    owner: p.owner_user_id ? (nameById.get(p.owner_user_id) ?? '—') : '—',
    plan_start_date: p.plan_start_date,
    horizon_months: p.horizon_months,
    created_at: p.created_at,
  }));

  return <PlansAdminClient plans={rows} users={accessUsers} />;
}
