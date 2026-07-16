import { createClient } from '@/lib/supabase/server';
import { UsersClient, type AdminUser } from './users-client';

export default async function UsersPage() {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  const { data: me } = await supabase.from('users').select('role').eq('id', user!.id).maybeSingle();

  if (me?.role !== 'admin') {
    return (
      <div className="mx-auto max-w-3xl space-y-4">
        <h1 className="text-2xl font-semibold tracking-tight">Users</h1>
        <div className="rounded-lg border border-destructive/30 bg-destructive/10 p-6 text-sm text-destructive">Admins only.</div>
      </div>
    );
  }

  const { data: users } = await supabase
    .from('users')
    .select('id, email, full_name, role, is_active, last_login_at')
    .order('created_at', { ascending: true });

  return <UsersClient users={(users ?? []) as AdminUser[]} meId={user!.id} />;
}
