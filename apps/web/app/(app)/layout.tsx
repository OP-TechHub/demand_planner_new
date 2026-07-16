import { redirect } from 'next/navigation';
import { LogOut } from 'lucide-react';
import { createClient } from '@/lib/supabase/server';
import { AppSidebar } from '@/components/app-sidebar';
import type { UserRole } from '@oceanpick/shared';
import { getActivePlan, getSelectablePlans } from '@/lib/plan';
import { PlanSelector } from './plan-selector';
import { ScenarioBanner } from './scenario-banner';
import { ThemeToggle } from '@/components/theme-toggle';
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
        <div className="max-w-md rounded-lg border border-destructive/30 bg-destructive/10 p-6 text-sm">
          <p className="font-semibold text-destructive">Account not fully provisioned</p>
          <p className="mt-2 text-destructive">
            Your login exists but your profile row is missing. This usually means the seed
            never ran, so no organisation matches your email domain. Ask an admin to run
            <code className="mx-1 rounded bg-destructive/15 px-1">supabase/seed.sql</code>.
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

  const [activePlan, plans] = await Promise.all([getActivePlan(), getSelectablePlans()]);
  const master = plans.find((p) => p.type === 'master') ?? null;

  return (
    <div className="flex min-h-screen">
      <AppSidebar role={profile.role as UserRole} />
      <div className="flex min-h-screen flex-1 flex-col">
        <header className="sticky top-0 z-20 flex h-14 items-center justify-between border-b border-border bg-card/80 px-6 backdrop-blur">
          <div className="flex items-center gap-3">
            <span className="text-xs font-medium uppercase tracking-wider text-muted-foreground">Plan</span>
            {activePlan && <PlanSelector plans={plans} activeId={activePlan.id} />}
          </div>
          <div className="flex items-center gap-3">
            <ThemeToggle />
            <div className="h-6 w-px bg-border" />
            <div className="text-right leading-tight">
              <div className="text-sm font-medium">{profile.full_name || profile.email}</div>
              <div className="text-xs capitalize text-muted-foreground">{profile.role}</div>
            </div>
            <form action={logout}>
              <button className="inline-flex items-center gap-1.5 rounded-md border border-border px-3 py-1.5 text-sm text-muted-foreground transition-colors hover:bg-muted hover:text-foreground">
                <LogOut className="h-3.5 w-3.5" />
                Sign out
              </button>
            </form>
          </div>
        </header>
        {activePlan?.type === 'scenario' && master && (
          <ScenarioBanner name={activePlan.name} masterId={master.id} />
        )}
        <main className="flex-1 p-6">{children}</main>
      </div>
    </div>
  );
}
