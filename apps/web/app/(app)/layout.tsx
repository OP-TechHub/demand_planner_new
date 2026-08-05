import { redirect } from 'next/navigation';
import { LogOut } from 'lucide-react';
import { AppSidebar } from '@/components/app-sidebar';
import type { UserRole } from '@oceanpick/shared';
import { getActivePlan, getSelectablePlans, getCurrentUser, getProfile, getUserName } from '@/lib/plan';
import { PlanSelector } from './plan-selector';
import { ScenarioBanner, type ScenarioAccess } from './scenario-banner';
import { ThemeToggle } from '@/components/theme-toggle';
import { Toaster } from '@/components/ui/toast';
import { ConfirmHost } from '@/components/ui/confirm';
import { RecalculateButton } from './recalculate-button';
import { logout } from '../login/actions';

export default async function AppLayout({ children }: { children: React.ReactNode }) {
  const user = await getCurrentUser();
  if (!user) redirect('/login');

  // Request-cached: shared with every page under this layout on the same render.
  const profile = await getProfile();

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
    const awaitingApproval = !profile.last_login_at;
    return (
      <main className="flex min-h-screen items-center justify-center px-4">
        <div className="max-w-md rounded-lg border border-border bg-card p-6 text-sm">
          <p className="font-semibold">{awaitingApproval ? 'Awaiting approval' : 'Access disabled'}</p>
          <p className="mt-2 text-muted-foreground">
            {awaitingApproval
              ? 'Your account has been created and is waiting for an administrator to approve access. You’ll be able to sign in once it’s approved.'
              : 'Your account has been deactivated. Contact an administrator.'}
          </p>
          <form action={logout} className="mt-4">
            <button className="rounded-md border border-border px-3 py-1.5 text-sm text-muted-foreground transition-colors hover:bg-muted hover:text-foreground">
              Sign out
            </button>
          </form>
        </div>
      </main>
    );
  }

  const [activePlan, plans] = await Promise.all([getActivePlan(), getSelectablePlans()]);
  const master = plans.find((p) => p.type === 'master') ?? null;

  // An editor may read any scenario but only its owner may write to it, so a
  // scenario someone else owns is view-only — say whose it is rather than just
  // leaving the edit controls out. Only costs a query in that case.
  const scenarioAccess: ScenarioAccess =
    activePlan?.is_locked ? 'locked'
    : activePlan?.owner_user_id === profile.id ? 'owner'
    : 'foreign';
  const scenarioOwner =
    activePlan?.type === 'scenario' && scenarioAccess === 'foreign'
      ? await getUserName(activePlan.owner_user_id)
      : undefined;

  return (
    <div className="flex min-h-screen">
      <AppSidebar role={profile.role as UserRole} />
      <div className="flex min-h-screen flex-1 flex-col">
        <header className="sticky top-0 z-20 flex h-14 items-center justify-between border-b border-border bg-card/70 px-6 backdrop-blur-md">
          <div className="flex items-center gap-2.5">
            <span className="text-[11px] font-semibold uppercase tracking-[0.08em] text-muted-foreground/70">Plan</span>
            {activePlan && <PlanSelector plans={plans} activeId={activePlan.id} />}
            {activePlan && <RecalculateButton planId={activePlan.id} label="Recalculate" size="sm" variant="outline" />}
          </div>
          <div className="flex items-center gap-2.5">
            <ThemeToggle />
            <div className="mx-0.5 h-6 w-px bg-border" />
            <div className="flex items-center gap-2.5">
              <span className="flex h-8 w-8 shrink-0 items-center justify-center rounded-full bg-gradient-to-br from-primary/15 to-accent/15 text-[11px] font-semibold uppercase text-primary ring-1 ring-inset ring-primary/15">
                {initials(profile.full_name || profile.email)}
              </span>
              <div className="text-right leading-tight">
                <div className="text-sm font-medium">{profile.full_name || profile.email}</div>
                <div className="text-[11px] capitalize text-muted-foreground">{profile.role}</div>
              </div>
            </div>
            <form action={logout}>
              <button className="inline-flex items-center gap-1.5 rounded-md border border-border bg-card px-3 py-1.5 text-sm text-muted-foreground shadow-xs transition-colors hover:bg-muted hover:text-foreground">
                <LogOut className="h-3.5 w-3.5" />
                Sign out
              </button>
            </form>
          </div>
        </header>
        {activePlan?.type === 'scenario' && master && (
          <ScenarioBanner
            name={activePlan.name}
            masterId={master.id}
            access={scenarioAccess}
            ownerName={scenarioOwner}
          />
        )}
        <main className="flex-1 p-6">{children}</main>
      </div>
      <Toaster />
      <ConfirmHost />
    </div>
  );
}

/** 1–2 letter initials from a name or email, for the header avatar. */
function initials(s: string): string {
  const name = (s.split('@')[0] ?? '').trim();
  const parts = name.split(/[\s._-]+/).filter(Boolean);
  if (parts.length >= 2) return (parts[0][0] + parts[1][0]).toUpperCase();
  return (name.slice(0, 2) || '?').toUpperCase();
}
