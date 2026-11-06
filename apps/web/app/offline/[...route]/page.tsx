import { OFFLINE_ROUTES, offlineRoute } from '@/lib/offline-routes';
import { OfflinePageViewer } from '../offline-page-viewer';

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
    <main className="mx-auto max-w-[1600px] px-4 py-6">
      <OfflinePageViewer route={route} />
    </main>
  );
}
