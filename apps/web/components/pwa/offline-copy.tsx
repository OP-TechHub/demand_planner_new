'use client';

import { createContext, useContext, useEffect, useMemo, type ReactNode } from 'react';
import { savePageSnapshot, requestOfflinePagesCache } from '@/lib/offline-snapshots';
import { offlineRoute } from '@/lib/offline-routes';

type OfflineUser = { id: string; name: string };

const Ctx = createContext<OfflineUser | null>(null);

/** Mounted once in the app layout, so pages don't each have to pass the user down. */
export function OfflineUserProvider({ user, children }: { user: OfflineUser; children: ReactNode }) {
  const value = useMemo(() => user, [user.id, user.name]); // eslint-disable-line react-hooks/exhaustive-deps
  return <Ctx.Provider value={value}>{children}</Ctx.Provider>;
}

/**
 * Refreshes this device's offline copy of one page every time it is opened
 * online (the business chose automatic over a manual button).
 *
 * A server page builds its client component's props once and hands the SAME
 * object to both this wrapper and the component, so the copy holds exactly
 * what the user saw — the server already shaped the props to their role —
 * and the flight payload dedupes the shared arrays by reference:
 *
 *   const props = { ... };
 *   return (
 *     <OfflineCopy route="demand-plan" props={props}>
 *       <DemandClient {...props} />
 *     </OfflineCopy>
 *   );
 *
 * `route` must have a row in lib/offline-routes.ts (which carries the schema
 * version) and an entry in app/offline/registry.tsx (which renders the copy
 * read-only). Saving runs after paint and never blocks or breaks the page.
 */
export function OfflineCopy({ route, props, children }: { route: string; props: unknown; children: ReactNode }) {
  const user = useContext(Ctx);
  useEffect(() => {
    if (!user?.id) return;
    const meta = offlineRoute(route);
    if (!meta) return;
    savePageSnapshot(route, meta.schema, props, user)
      .then(requestOfflinePagesCache)
      .catch(() => {});
  }, [route, props, user]);
  return <>{children}</>;
}
