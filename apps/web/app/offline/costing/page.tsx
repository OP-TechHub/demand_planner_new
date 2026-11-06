import { OfflineCostGrid } from './offline-cost-grid';

/*
 * The saved Cost Grid, for use with no connection.
 *
 * Static and unauthenticated on purpose, like /offline: the service worker
 * caches this page and its code (never any data), and the grid's data comes
 * from the copy kept in this browser's IndexedDB (lib/offline-costing.ts).
 * The worker serves it when /costing cannot be reached.
 */
export const dynamic = 'force-static';
export const metadata = { title: 'Cost Grid (offline) · Oceanpick Demand Planner' };

export default function OfflineCostingPage() {
  return (
    <main className="mx-auto max-w-[1600px] px-4 py-6">
      <OfflineCostGrid />
    </main>
  );
}
