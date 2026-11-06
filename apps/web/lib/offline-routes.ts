/**
 * Every page that keeps an offline copy on the device (see offline-snapshots.ts
 * for how, and docs/user-guide.md for the business decisions).
 *
 * One row per page:
 *   - `route`  — the app path without the leading slash ('demand-plan',
 *                'costing/skus'). Doubles as the snapshot key and the offline
 *                URL (/offline/<route>).
 *   - `title`  — what the sidebar calls the page, reused on the offline screens.
 *   - `schema` — bump when the page's client props change shape, so a copy
 *                saved by an older build is ignored rather than handed to a
 *                component that cannot read it. It re-saves on the next online
 *                visit.
 *
 * Adding a page: add its row here, create app/offline/entries/<slug>.tsx
 * (slug = route with '/' → '-'), import it in app/offline/registry.tsx, wrap
 * the page's client component in <OfflineCopy>, and add the route to the
 * OFFLINE_ROUTES literal in public/sw.js (kept in sync by hand — the worker
 * cannot import this file).
 *
 * Admin pages and auth pages are deliberately absent: the business excluded
 * admin from offline, and auth cannot work without a connection anyway.
 */
export type OfflineRouteMeta = { route: string; title: string; schema: number };

export const OFFLINE_ROUTES: OfflineRouteMeta[] = [
  // Inputs
  { route: 'programs', title: 'Programs', schema: 1 },
  { route: 'inquiry', title: 'New Inquiry', schema: 1 },
  { route: 'demand-plan', title: 'Demand Plan', schema: 1 },
  { route: 'po-update', title: 'PO Update', schema: 1 },
  { route: 'harvest-plan', title: 'Harvest Plan', schema: 1 },
  { route: 'buckets', title: 'Buckets', schema: 1 },
  { route: 'settings', title: 'Settings', schema: 1 },
  // Outputs
  { route: 'home', title: 'Dashboard', schema: 1 },
  { route: 'annual-summary', title: 'Annual Summary', schema: 1 },
  { route: 'order-book', title: 'Order Book', schema: 1 },
  { route: 'fulfilment', title: 'Program Fulfilment', schema: 1 },
  { route: 'open-to-buy', title: 'Open to buy', schema: 1 },
  { route: 'sixty-month', title: '60-Month Summary', schema: 1 },
  { route: 'revenue-cost', title: 'Revenue & Cost', schema: 1 },
  { route: 'secondary-products', title: 'Secondary products', schema: 1 },
  { route: 'optimizer', title: 'Fulfilment Optimizer', schema: 1 },
  { route: 'ranking', title: 'Program Ranking', schema: 1 },
  { route: 'inquiry-management', title: 'Inquiry management', schema: 1 },
  { route: 'inquiries', title: 'Inquiries', schema: 1 },
  // Scenarios
  { route: 'scenarios', title: 'My scenarios', schema: 1 },
  { route: 'diff', title: 'Compare plans', schema: 1 },
  // Costing (costing/saved/[id] has no copy — only the pages above the fold;
  // the saved-costings LIST is copied, individual saved costings are not)
  { route: 'costing', title: 'Cost Grid', schema: 1 },
  { route: 'costing/saved', title: 'Saved costings', schema: 1 },
  { route: 'costing/skus', title: 'Costing SKUs', schema: 1 },
  { route: 'costing/assumptions', title: 'Assumptions', schema: 1 },
  { route: 'costing/archived', title: 'Deleted costings', schema: 1 },
];

export function offlineRoute(route: string): OfflineRouteMeta | undefined {
  return OFFLINE_ROUTES.find((r) => r.route === route);
}

/** 'costing/skus' → 'costing-skus': the entry filename under app/offline/entries. */
export function offlineSlug(route: string): string {
  return route.replace(/\//g, '-');
}
