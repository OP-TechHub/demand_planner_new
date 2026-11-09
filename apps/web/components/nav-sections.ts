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
  ClipboardList,
  BookOpen,
  Receipt,
  Recycle,
  GitFork,
  GitCompare,
  Users,
  ScrollText,
  Calculator,
  FileSpreadsheet,
  Tags,
  ArchiveRestore,
  ListOrdered,
  MessageSquare,
  type LucideIcon,
} from 'lucide-react';

export type NavItem = { label: string; href: string; icon: LucideIcon };
export type NavSection = { title: string; items: NavItem[]; adminOnly?: boolean };

/** The planner's navigation, shared by the live sidebar and the offline one. */
export const NAV_SECTIONS: NavSection[] = [
  {
    title: 'Inputs',
    items: [
      { label: 'Programs', href: '/programs', icon: Package },
      { label: 'New Inquiry', href: '/inquiry', icon: ClipboardCheck },
      { label: 'Demand Plan', href: '/demand-plan', icon: LineChart },
      { label: 'PO Update', href: '/po-update', icon: Receipt },
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
      { label: 'Order Book', href: '/order-book', icon: BookOpen },
      { label: 'Program Fulfilment', href: '/fulfilment', icon: Target },
      { label: 'Open to buy', href: '/open-to-buy', icon: PackageX },
      { label: '60-Month Summary', href: '/sixty-month', icon: CalendarDays },
      { label: 'Revenue & Cost', href: '/revenue-cost', icon: DollarSign },
      { label: 'Secondary products', href: '/secondary-products', icon: Recycle },
      { label: 'Fulfilment Optimizer', href: '/optimizer', icon: SlidersHorizontal },
      { label: 'Program Ranking', href: '/ranking', icon: ListOrdered },
      { label: 'Inquiry management', href: '/inquiry-management', icon: ClipboardList },
      { label: 'Inquiries', href: '/inquiries', icon: ClipboardCheck },
    ],
  },
  {
    title: 'Scenarios',
    items: [
      { label: 'My scenarios', href: '/scenarios', icon: GitFork },
      { label: 'Compare plans', href: '/diff', icon: GitCompare },
    ],
  },
  // Its own section, not an Input or an Output: costing is a standalone module
  // with its own tables and no link to plans or programs
  // (costing_module/Costing_Module_Decisions.md §1).
  {
    title: 'Costing',
    items: [
      { label: 'Cost Grid', href: '/costing', icon: Calculator },
      { label: 'Saved costings', href: '/costing/saved', icon: FileSpreadsheet },
      { label: 'Costing SKUs', href: '/costing/skus', icon: Tags },
      { label: 'Assumptions', href: '/costing/assumptions', icon: SlidersHorizontal },
    ],
  },
  {
    title: 'Admin',
    adminOnly: true,
    items: [
      { label: 'Plans', href: '/admin/plans', icon: GitFork },
      { label: 'Users', href: '/admin/users', icon: Users },
      { label: 'Audit log', href: '/admin/audit', icon: ScrollText },
      { label: 'Assistant usage', href: '/admin/assistant', icon: MessageSquare },
      { label: 'Deleted costings', href: '/costing/archived', icon: ArchiveRestore },
    ],
  },
];
