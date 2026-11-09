'use client';

import { useEffect, useState } from 'react';
import { Waves, WifiOff } from 'lucide-react';
import { cn } from '@/lib/utils';
import { NAV_SECTIONS } from '@/components/nav-sections';
import { offlineRoute } from '@/lib/offline-routes';
import { listSavedPages } from '@/lib/offline-snapshots';

/**
 * The planner's sidebar for the offline screens, so people can move between
 * saved copies the way they move between pages online. Without it an
 * installed (chromeless) window has no way off the first copy it opens.
 *
 * Same sections, labels and order as the live sidebar. Pages with a copy on
 * this device are links to /offline/<route>; pages without one are greyed
 * out. Admin-only pages appear only when this device holds a copy of them,
 * which only an admin's sweep can have produced.
 *
 * Plain <a>, not next/link: next/link fetches the RSC payload, which fails
 * offline, whereas a full navigation is answered by the service worker.
 */
export function OfflineSidebar({ current }: { current: string }) {
  const [saved, setSaved] = useState<Set<string> | null>(null);

  useEffect(() => {
    listSavedPages()
      .then((pages) => setSaved(new Set(pages.map((p) => p.route))))
      .catch(() => setSaved(new Set()));
  }, []);

  const sections = NAV_SECTIONS.map((section) => ({
    ...section,
    items: section.items.filter((item) => {
      const route = item.href.slice(1);
      if (!offlineRoute(route)) return false; // admin pages are online-only
      return !section.adminOnly || saved?.has(route);
    }),
  })).filter((s) => s.items.length > 0);

  return (
    <nav className="flex w-60 shrink-0 flex-col border-r border-border bg-card">
      <a href="/offline" className="flex h-14 shrink-0 items-center gap-2.5 border-b border-border px-4">
        <span className="flex h-8 w-8 items-center justify-center rounded-lg bg-gradient-to-br from-primary to-accent text-primary-foreground shadow-sm ring-1 ring-inset ring-white/10">
          <Waves className="h-5 w-5" strokeWidth={2.25} />
        </span>
        <span className="leading-tight">
          <span className="block text-[13px] font-semibold tracking-tight">Oceanpick</span>
          <span className="flex items-center gap-1 text-[11px] text-muted-foreground">
            <WifiOff className="h-3 w-3" /> Offline copies
          </span>
        </span>
      </a>

      <div className="min-h-0 flex-1 overflow-y-auto px-3 py-4">
        {sections.map((section) => (
          <div key={section.title} className="mb-5">
            <div className="px-2 pb-2 text-[10px] font-semibold uppercase tracking-[0.09em] text-muted-foreground/60">
              {section.title}
            </div>
            <ul className="space-y-0.5">
              {section.items.map((item) => {
                const route = item.href.slice(1);
                const active = route === current;
                const available = saved?.has(route) ?? false;
                const Icon = item.icon;
                const base = 'group relative flex items-center gap-2.5 rounded-md px-2.5 py-2 text-[13px] transition-colors';
                if (!available && !active) {
                  return (
                    <li key={item.href}>
                      <span
                        title={saved ? 'No saved copy on this device' : undefined}
                        className={cn(base, 'cursor-default text-muted-foreground/40')}
                      >
                        <Icon className="h-4 w-4 shrink-0" />
                        <span className="truncate">{item.label}</span>
                      </span>
                    </li>
                  );
                }
                return (
                  <li key={item.href}>
                    <a
                      href={`/offline/${route}`}
                      aria-current={active ? 'page' : undefined}
                      className={cn(
                        base,
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
                    </a>
                  </li>
                );
              })}
            </ul>
          </div>
        ))}
      </div>
    </nav>
  );
}
