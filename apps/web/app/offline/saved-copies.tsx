'use client';

import { useEffect, useState } from 'react';
import { listSavedPages, formatSavedAt, type SavedPage } from '@/lib/offline-snapshots';
import { OFFLINE_ROUTES } from '@/lib/offline-routes';

/** On the offline screen: every page this device holds a saved copy of. */
export function SavedCopies() {
  const [saved, setSaved] = useState<SavedPage[]>([]);
  useEffect(() => {
    listSavedPages().then(setSaved).catch(() => {});
  }, []);
  if (saved.length === 0) return null;

  // Sidebar order, not save order — people look for pages where the nav has them.
  const byRoute = new Map(saved.map((s) => [s.route, s]));
  const rows = OFFLINE_ROUTES.filter((r) => byRoute.has(r.route));

  return (
    <div className="mt-6 text-left">
      <p className="text-center text-sm font-medium">Saved copies on this device</p>
      <ul className="mt-3 max-h-[50vh] divide-y divide-border overflow-y-auto rounded-lg border border-border">
        {rows.map((r) => {
          const s = byRoute.get(r.route)!;
          return (
            <li key={r.route}>
              {/* Plain links, not next/link: a full navigation is what the service worker answers offline. */}
              <a href={`/offline/${r.route}`} className="flex items-baseline justify-between gap-3 px-3 py-2 text-sm transition-colors hover:bg-muted">
                <span className="font-medium text-primary">{r.title}</span>
                <span className="shrink-0 text-xs text-muted-foreground">{formatSavedAt(s.savedAt)}</span>
              </a>
            </li>
          );
        })}
      </ul>
    </div>
  );
}
