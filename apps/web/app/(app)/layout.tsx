import { redirect } from 'next/navigation';
import { createClient } from '@/lib/supabase/server';
import { logout } from '../login/actions';

export default async function AppLayout({ children }: { children: React.ReactNode }) {
  const supabase = await createClient();

  const { data: { user } } = await supabase.auth.getUser();
  if (!user) redirect('/login');

  // RLS restricts this to the caller's own org.
  const { data: profile } = await supabase
    .from('users')
    .select('full_name, email, role, is_active')
    .eq('id', user.id)
    .single();

  // A profile row is created by the handle_new_user() trigger. If it's missing,
  // something went wrong at signup rather than the user being unauthorised —
  // fail loudly instead of showing a broken shell.
  if (!profile) {
    return (
      <main className="flex min-h-screen items-center justify-center px-4">
        <div className="max-w-md rounded-lg border border-red-200 bg-red-50 p-6 text-sm">
          <p className="font-semibold text-red-800">Account not fully provisioned</p>
          <p className="mt-2 text-red-700">
            Your login exists but your profile row is missing. This usually means the seed
            never ran, so no organisation matches your email domain. Ask an admin to run
            <code className="mx-1 rounded bg-red-100 px-1">supabase/seed.sql</code>.
          </p>
        </div>
      </main>
    );
  }

  if (!profile.is_active) {
    return (
      <main className="flex min-h-screen items-center justify-center px-4">
        <div className="max-w-md rounded-lg border bg-card p-6 text-sm">
          <p className="font-semibold">Access disabled</p>
          <p className="mt-2 text-muted-foreground">
            Your account has been deactivated. Contact an administrator.
          </p>
        </div>
      </main>
    );
  }

  return (
    <div className="min-h-screen">
      <header className="flex h-14 items-center justify-between border-b bg-card px-6">
        <span className="text-sm font-semibold tracking-tight">Oceanpick Demand Planner</span>
        <div className="flex items-center gap-4">
          <div className="text-right leading-tight">
            <div className="text-sm font-medium">{profile.full_name || profile.email}</div>
            <div className="text-xs capitalize text-muted-foreground">{profile.role}</div>
          </div>
          <form action={logout}>
            <button className="rounded-md border px-3 py-1.5 text-sm hover:bg-muted">
              Sign out
            </button>
          </form>
        </div>
      </header>
      <main className="p-6">{children}</main>
    </div>
  );
}
