'use client';

import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { Waves } from 'lucide-react';
import { cn } from '@/lib/utils';
import { NAV_SECTIONS } from '@/components/nav-sections';
import { InstallAppButton } from '@/components/pwa/install-app-button';
import { PrepareOfflineButton } from '@/components/pwa/prepare-offline-button';
import type { UserRole } from '@oceanpick/shared';

export function AppSidebar({ role }: { role: UserRole }) {
  const pathname = usePathname();

  return (
    <nav className="flex w-60 shrink-0 flex-col border-r border-border bg-card">
      <Link
        href="/home"
        className="flex h-14 shrink-0 items-center gap-2.5 border-b border-border px-4"
      >
        <span className="flex h-8 w-8 items-center justify-center rounded-lg bg-gradient-to-br from-primary to-accent text-primary-foreground shadow-sm ring-1 ring-inset ring-white/10">
          <Waves className="h-5 w-5" strokeWidth={2.25} />
        </span>
        <span className="leading-tight">
          <span className="block text-[13px] font-semibold tracking-tight">Oceanpick</span>
          <span className="block text-[11px] text-muted-foreground">Demand Planner</span>
        </span>
      </Link>

      <div className="min-h-0 flex-1 overflow-y-auto px-3 py-4">
        {NAV_SECTIONS.filter((s) => !s.adminOnly || role === 'admin').map((section) => (
          <div key={section.title} className="mb-5">
            <div className="px-2 pb-2 text-[10px] font-semibold uppercase tracking-[0.09em] text-muted-foreground/60">
              {section.title}
            </div>
            <ul className="space-y-0.5">
              {section.items.map((item) => {
                const active = pathname === item.href || pathname.startsWith(item.href + '/');
                const Icon = item.icon;
                return (
                  <li key={item.href}>
                    {/* No viewport prefetch: each prefetch re-renders the (app)
                        layout down to loading.tsx — an Auth check plus the
                        profile and plan queries — so ~30 visible links meant
                        ~30 such renders competing with the real page load.
                        Clicking still streams loading.tsx immediately. */}
                    <Link
                      href={item.href}
                      prefetch={false}
                      aria-current={active ? 'page' : undefined}
                      className={cn(
                        'group relative flex items-center gap-2.5 rounded-md px-2.5 py-2 text-[13px] transition-colors',
                        active
                          ? 'bg-primary/10 font-medium text-primary'
                          : 'text-muted-foreground hover:bg-muted/70 hover:text-foreground'
                      )}
                    >
                      {active && <span className="absolute left-0 top-1/2 h-5 w-[3px] -translate-y-1/2 rounded-r-full bg-primary" />}
                      <Icon
                        className={cn(
                          'h-4 w-4 shrink-0 transition-colors',
                          active ? 'text-primary' : 'text-muted-foreground group-hover:text-foreground'
                        )}
                      />
                      <span className="truncate">{item.label}</span>
                    </Link>
                  </li>
                );
              })}
            </ul>
          </div>
        ))}
      </div>

      {/* Each button renders nothing when it has nothing to offer (offline /
          no install prompt), so the footer collapses away when both do. */}
      <div className="shrink-0 space-y-1.5 px-3 pb-3 empty:hidden">
        <PrepareOfflineButton role={role} />
        <InstallAppButton />
      </div>
    </nav>
  );
}
