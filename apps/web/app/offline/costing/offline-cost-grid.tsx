'use client';

import { useEffect, useState } from 'react';
import { CloudOff, WifiOff } from 'lucide-react';
import { CostGridClient, type CostGridProps } from '@/app/(app)/costing/cost-grid-client';
import { formatSavedAt, loadCostGridSnapshot, type OfflineSnapshot } from '@/lib/offline-costing';

/**
 * Loads the saved copy from this device and renders the grid from it, with the
 * server-only actions (save as costing, re-cost) switched off. Breakdowns,
 * the CSV sheet, Print / Save as PDF and Word all run in the browser.
 */
export function OfflineCostGrid() {
  const [state, setState] = useState<{ status: 'loading' } | { status: 'none' } | { status: 'ready'; snap: OfflineSnapshot<CostGridProps> }>({ status: 'loading' });
  const [online, setOnline] = useState(true);

  useEffect(() => {
    loadCostGridSnapshot<CostGridProps>().then((snap) => setState(snap ? { status: 'ready', snap } : { status: 'none' }));
    const update = () => setOnline(navigator.onLine);
    update();
    window.addEventListener('online', update);
    window.addEventListener('offline', update);
    return () => {
      window.removeEventListener('online', update);
      window.removeEventListener('offline', update);
    };
  }, []);

  if (state.status === 'loading') {
    return <p className="py-16 text-center text-sm text-muted-foreground">Opening the saved Cost Grid…</p>;
  }

  if (state.status === 'none') {
    return (
      <div className="mx-auto max-w-sm py-16 text-center">
        <div className="mx-auto flex h-11 w-11 items-center justify-center rounded-full bg-muted text-muted-foreground">
          <CloudOff className="h-5 w-5" />
        </div>
        <h1 className="mt-4 text-base font-semibold tracking-tight">No saved Cost Grid on this device</h1>
        <p className="mt-2 text-sm text-muted-foreground">
          A copy is saved each time you open Costing while online. Open it once with a connection, and it will be here
          next time you are offline. Signing out deletes the copy.
        </p>
      </div>
    );
  }

  const { snap } = state;
  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center gap-2 rounded-lg border border-warning/30 bg-warning/10 px-4 py-2.5 text-sm text-warning">
        <WifiOff className="h-4 w-4 shrink-0" />
        <span>
          <b>Offline copy</b> saved {formatSavedAt(snap.savedAt)}{snap.userName ? ` by ${snap.userName}` : ''}. Prices are as of
          then. Saving a costing and re-costing are off until you reconnect.
        </span>
        {online && (
          <a href="/costing" className="ml-auto font-medium underline underline-offset-2">
            Back online — open the live Cost Grid
          </a>
        )}
      </div>
      <CostGridClient {...snap.props} canRecost={false} offline />
    </div>
  );
}
