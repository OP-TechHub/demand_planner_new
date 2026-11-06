import { WifiOff } from 'lucide-react';
import { SavedCopies } from './saved-copies';

/*
 * Served by public/sw.js when a page navigation fails and the page has no
 * offline copy of its own (those get /offline/<route> instead).
 *
 * Deliberately static and unauthenticated — the service worker caches this at
 * install time, so it must not read Supabase or anything else request-scoped.
 * It exists because inside an installed, chromeless window there is no address
 * bar to explain the browser's own network error page.
 */
export const metadata = { title: 'Offline · Oceanpick Demand Planner' };

export default function OfflinePage() {
  return (
    <main className="flex min-h-screen items-center justify-center px-4">
      <div className="w-full max-w-sm text-center">
        <div className="mx-auto flex h-11 w-11 items-center justify-center rounded-full bg-muted text-muted-foreground">
          <WifiOff className="h-5 w-5" />
        </div>
        <h1 className="mt-4 text-base font-semibold tracking-tight">You’re offline</h1>
        <p className="mt-2 text-sm text-muted-foreground">
          The Demand Planner reads live data on every screen, so it needs a connection for anything current.
          Saved copies of pages you opened while online are available below.
        </p>
        <SavedCopies />
      </div>
    </main>
  );
}
