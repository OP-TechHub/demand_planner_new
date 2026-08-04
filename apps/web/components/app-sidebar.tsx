'use client';

import Link from 'next/link';
import { usePathname } from 'next/navigation';
import {
  Package,
  LineChart,
  Waves,
  Boxes,
  Settings,
  ClipboardCheck,
  LayoutDashboard,
  CalendarRange,
  Target,
  PackageX,
  CalendarDays,
  DollarSign,
  SlidersHorizontal,
  GitFork,
  Users,
  ScrollText,
  type LucideIcon,
} from 'lucide-react';
import { cn } from '@/lib/utils';
import type { UserRole } from '@oceanpick/shared';

type Item = { label: string; href: string; icon: LucideIcon };
type Section = { title: string; items: Item[]; adminOnly?: boolean };

const SECTIONS: Section[] = [
  {
    title: 'Inputs',
    items: [
      { label: 'Programs', href: '/programs', icon: Package },
      { label: 'New Inquiry', href: '/inquiry', icon: ClipboardCheck },
      { label: 'Demand Plan', href: '/demand-plan', icon: LineChart },
      { label: 'Harvest Plan', href: '/harvest-plan', icon: Waves },
      { label: 'Buckets', href: '/buckets', icon: Boxes },
      { label: 'Settings', href: '/settings', icon: Settings },
    ],
  },
  {
    title: 'Outputs',
    items: [
      { label: 'Dashboard', href: '/home', icon: LayoutDashboard },
      { label: 'Annual Summary', href: '/annual-summary', icon: CalendarRange },
      { label: 'Program Fulfilment', href: '/fulfilment', icon: Target },
      { label: 'Open to buy', href: '/open-to-buy', icon: PackageX },
      { label: '60-Month Summary', href: '/sixty-month', icon: CalendarDays },
      { label: 'Revenue & Cost', href: '/revenue-cost', icon: DollarSign },
      { label: 'Fulfilment Optimizer', href: '/optimizer', icon: SlidersHorizontal },
      { label: 'Inquiries', href: '/inquiries', icon: ClipboardCheck },
    ],
  },
  {
    title: 'Scenarios',
    items: [{ label: 'My scenarios', href: '/scenarios', icon: GitFork }],
  },
  {
    title: 'Admin',
    adminOnly: true,
    items: [
      { label: 'Plans', href: '/admin/plans', icon: GitFork },
      { label: 'Users', href: '/admin/users', icon: Users },
      { label: 'Audit log', href: '/admin/audit', icon: ScrollText },
    ],
  },
];

export function AppSidebar({ role }: { role: UserRole }) {
  const pathname = usePathname();

  return (
    <nav className="flex w-60 shrink-0 flex-col border-r border-border bg-card">
      <Link
        href="/home"
        className="flex h-14 shrink-0 items-center gap-2.5 border-b border-border px-4"
      >
        <span className="flex h-8 w-8 items-center justify-center rounded-md bg-primary text-primary-foreground shadow-sm">
          <Waves className="h-5 w-5" strokeWidth={2.25} />
        </span>
        <span className="leading-tight">
          <span className="block text-sm font-semibold tracking-tight">Oceanpick</span>
          <span className="block text-[11px] text-muted-foreground">Demand Planner</span>
        </span>
      </Link>

      <div className="flex-1 overflow-y-auto px-3 py-4">
        {SECTIONS.filter((s) => !s.adminOnly || role === 'admin').map((section) => (
          <div key={section.title} className="mb-5">
            <div className="px-2 pb-1.5 text-[11px] font-semibold uppercase tracking-wider text-muted-foreground/70">
              {section.title}
            </div>
            <ul className="space-y-0.5">
              {section.items.map((item) => {
                const active = pathname === item.href || pathname.startsWith(item.href + '/');
                const Icon = item.icon;
                return (
                  <li key={item.href}>
                    <Link
                      href={item.href}
                      className={cn(
                        'group flex items-center gap-2.5 rounded-md px-2.5 py-2 text-sm transition-colors',
                        active
                          ? 'bg-primary/10 font-medium text-primary'
                          : 'text-muted-foreground hover:bg-muted hover:text-foreground'
                      )}
                    >
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
    </nav>
  );
}
