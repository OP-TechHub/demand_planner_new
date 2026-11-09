import { OFFLINE_ROUTES, offlineRoute } from '@/lib/offline-routes';
import { OfflinePageViewer } from '../offline-page-viewer';
import { OfflineSidebar } from '../offline-sidebar';

/*
 * The saved copy of any data page, for use with no connection.
 *
 * Static and unauthenticated on purpose, like /offline: the service worker
 * caches every one of these pages and their code (never any data), and the
 * data comes from the copy kept in this browser's IndexedDB
 * (lib/offline-snapshots.ts). The worker serves /offline/<route> when
 * /<route> cannot be reached.
 */
export const dynamic = 'force-static';
export const dynamicParams = false;

export function generateStaticParams() {
  return OFFLINE_ROUTES.map((r) => ({ route: r.route.split('/') }));
}

export async function generateMetadata({ params }: { params: Promise<{ route: string[] }> }) {
  const route = (await params).route.join('/');
  return { title: `${offlineRoute(route)?.title ?? 'Offline'} (offline) · Oceanpick Demand Planner` };
}

export default async function OfflineRoutePage({ params }: { params: Promise<{ route: string[] }> }) {
  const route = (await params).route.join('/');
  return (
    <div className="flex h-screen overflow-hidden">
      <OfflineSidebar current={route} />
      <main className="min-h-0 min-w-0 flex-1 overflow-y-auto p-6">
        <OfflinePageViewer route={route} />
      </main>
    </div>
  );
}
