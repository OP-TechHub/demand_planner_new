'use client';

import { useEffect, useState } from 'react';
import { CloudOff, WifiOff } from 'lucide-react';
import { loadPageSnapshot, formatSavedAt, type OfflineSnapshot } from '@/lib/offline-snapshots';
import { offlineRoute } from '@/lib/offline-routes';
import { OFFLINE_ENTRIES } from './registry';

/**
 * Loads the saved copy of one page from this device and renders it with the
 * entry's read-only transform applied, so nothing on it can call the server.
 * Everything that runs in the browser — filters, view toggles, tooltips,
 * CSV / print exports — keeps working.
 */
export function OfflinePageViewer({ route }: { route: string }) {
  const meta = offlineRoute(route);
  const entry = OFFLINE_ENTRIES[route];
  const [state, setState] = useState<
    { status: 'loading' } | { status: 'none' } | { status: 'ready'; snap: OfflineSnapshot<Record<string, unknown>> }
  >({ status: 'loading' });
  const [online, setOnline] = useState(true);

  useEffect(() => {
    if (!meta) return;
    loadPageSnapshot<Record<string, unknown>>(route, meta.schema).then((snap) =>
      setState(snap ? { status: 'ready', snap } : { status: 'none' })
    );
    const update = () => setOnline(navigator.onLine);
    update();
    window.addEventListener('online', update);
    window.addEventListener('offline', update);
    return () => {
      window.removeEventListener('online', update);
      window.removeEventListener('offline', update);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [route]);

  const title = meta?.title ?? 'this page';

  if (!meta || !entry) {
    return <p className="py-16 text-center text-sm text-muted-foreground">This page has no offline view.</p>;
  }

  if (state.status === 'loading') {
    return <p className="py-16 text-center text-sm text-muted-foreground">Opening the saved copy of {title}…</p>;
  }

  if (state.status === 'none') {
    return (
      <div className="mx-auto max-w-sm py-16 text-center">
        <div className="mx-auto flex h-11 w-11 items-center justify-center rounded-full bg-muted text-muted-foreground">
          <CloudOff className="h-5 w-5" />
        </div>
        <h1 className="mt-4 text-base font-semibold tracking-tight">No saved copy of {title} on this device</h1>
        <p className="mt-2 text-sm text-muted-foreground">
          A copy is saved each time you open {title} while online. Open it once with a connection, and it will be
          here next time you are offline. Signing out deletes every copy.
        </p>
        <p className="mt-3 text-xs text-muted-foreground">
          <a href="/offline" className="font-medium underline underline-offset-2">See which pages are saved here</a>
        </p>
      </div>
    );
  }

  const { snap } = state;
  const { Component, readOnly } = entry;
  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center gap-2 rounded-lg border border-warning/30 bg-warning/10 px-4 py-2.5 text-sm text-warning">
        <WifiOff className="h-4 w-4 shrink-0" />
        <span>
          <b>Offline copy</b> of {title} saved {formatSavedAt(snap.savedAt)}
          {snap.userName ? ` by ${snap.userName}` : ''}. Numbers are as of then; editing and saving are off until you
          reconnect.
        </span>
        {online && (
          <a href={`/${route}`} className="ml-auto font-medium underline underline-offset-2">
            Back online — open the live page
          </a>
        )}
      </div>
      <Component {...readOnly(snap.props)} />
    </div>
  );
}
