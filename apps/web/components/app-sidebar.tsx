'use client';

import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { cn } from '@/lib/utils';
import type { UserRole } from '@oceanpick/shared';

type Item = { label: string; href: string; soon?: boolean };
type Section = { title: string; items: Item[]; adminOnly?: boolean };

// Only the Inputs pages (plus the Dashboard) are built in Session 2. Everything
// downstream of the calc engine is shown but disabled ("soon") so the shell
// reflects the whole app without linking to routes that don't exist yet.
const SECTIONS: Section[] = [
  {
    title: 'Inputs',
    items: [
      { label: 'Programs', href: '/programs' },
      { label: 'Demand Plan', href: '/demand-plan' },
      { label: 'Harvest Plan', href: '/harvest-plan' },
      { label: 'Buckets', href: '/buckets' },
      { label: 'Settings', href: '/settings' },
    ],
  },
  {
    title: 'Outputs',
    items: [
      { label: 'Dashboard', href: '/home' },
      { label: 'Annual Summary', href: '/annual-summary', soon: true },
      { label: 'Program Fulfilment', href: '/fulfilment', soon: true },
      { label: 'Unallocated WR', href: '/unallocated', soon: true },
      { label: '60-Month Summary', href: '/sixty-month', soon: true },
      { label: 'Revenue & Cost', href: '/revenue-cost', soon: true },
    ],
  },
  {
    title: 'Admin',
    adminOnly: true,
    items: [
      { label: 'Users', href: '/admin/users', soon: true },
      { label: 'Audit log', href: '/admin/audit', soon: true },
    ],
  },
];

export function AppSidebar({ role }: { role: UserRole }) {
  const pathname = usePathname();

  return (
    <nav className="w-56 shrink-0 border-r bg-card px-3 py-4 text-sm">
      {SECTIONS.filter((s) => !s.adminOnly || role === 'admin').map((section) => (
        <div key={section.title} className="mb-5">
          <div className="px-2 pb-1 text-xs font-semibold uppercase tracking-wide text-muted-foreground">
            {section.title}
          </div>
          <ul className="space-y-0.5">
            {section.items.map((item) => {
              const active = pathname === item.href || pathname.startsWith(item.href + '/');
              if (item.soon) {
                return (
                  <li
                    key={item.href}
                    className="flex items-center justify-between rounded-md px-2 py-1.5 text-muted-foreground/60"
                    title="Arrives in a later session"
                  >
                    <span>{item.label}</span>
                    <span className="text-[10px] uppercase tracking-wide">soon</span>
                  </li>
                );
              }
              return (
                <li key={item.href}>
                  <Link
                    href={item.href}
                    className={cn(
                      'block rounded-md px-2 py-1.5 hover:bg-muted',
                      active && 'bg-muted font-medium text-foreground'
                    )}
                  >
                    {item.label}
                  </Link>
                </li>
              );
            })}
          </ul>
        </div>
      ))}
    </nav>
  );
}
