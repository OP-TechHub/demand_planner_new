'use client';

import { useEffect, useRef, useState } from 'react';
import { DownloadCloud } from 'lucide-react';
import { cn } from '@/lib/utils';
import { OFFLINE_ROUTES } from '@/lib/offline-routes';
import { listSavedPages } from '@/lib/offline-snapshots';
import type { UserRole } from '@oceanpick/shared';

/*
 * "Prepare for offline" for the sidebar footer.
 *
 * Offline copies are otherwise saved one page at a time, on visit. This
 * button sweeps every route the signed-in role can see through a hidden
 * same-origin iframe so that each page's own <OfflineCopy> performs its
 * normal save — the device ends up with the whole planner without the user
 * clicking through ~26 pages before losing connectivity.
 *
 * Why iframes: the snapshot content is the exact props object each server
 * page builds (role-shaped on the server). fetch/prefetch never mount the
 * client tree, so OfflineCopy would never run; a server endpoint would mean
 * re-extracting the props-building of every page. Loading the real page is
 * the only path that needs no per-page changes.
 *
 * A route that never saves is a normal outcome, not an error: pages without
 * content (optimizer before results are computed) and role-gated pages
 * render without <OfflineCopy>, so their iframes simply time out and are
 * reported as "not available".
 */

const CONCURRENCY = 2; // each iframe renders the full (app) layout — keep the server load bounded
const ROUTE_TIMEOUT_MS = 20_000;
const POLL_MS = 2_000;

type Pending = { frame: HTMLIFrameElement; timer: number };

type Run = {
  startedAt: string; // ISO; a saved copy counts only if its savedAt is >= this
  total: number;
  queue: string[];
  pending: Map<string, Pending>;
  saved: number;
  unavailable: number;
  channel: BroadcastChannel | null;
  poll: number | null;
};

export function PrepareOfflineButton({ role }: { role: UserRole }) {
  const [online, setOnline] = useState(true);
  const [phase, setPhase] = useState<'idle' | 'running' | 'done'>('idle');
  const [label, setLabel] = useState('Prepare for offline');
  const runRef = useRef<Run | null>(null);

  useEffect(() => {
    setOnline(navigator.onLine);
    const on = () => setOnline(true);
    const off = () => setOnline(false);
    window.addEventListener('online', on);
    window.addEventListener('offline', off);
    return () => {
      window.removeEventListener('online', on);
      window.removeEventListener('offline', off);
      abort();
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  /** Tear a run down completely (unmount, i.e. navigation or sign-out mid-run). */
  function abort() {
    const run = runRef.current;
    if (!run) return;
    runRef.current = null;
    for (const { frame, timer } of run.pending.values()) {
      window.clearTimeout(timer);
      frame.remove();
    }
    run.pending.clear();
    if (run.poll !== null) window.clearInterval(run.poll);
    run.channel?.close();
  }

  function launch(route: string) {
    const run = runRef.current;
    if (!run) return;
    const frame = document.createElement('iframe');
    frame.src = '/' + route;
    frame.style.display = 'none';
    frame.setAttribute('aria-hidden', 'true');
    frame.tabIndex = -1;
    document.body.appendChild(frame);
    const timer = window.setTimeout(() => settle(route, 'unavailable'), ROUTE_TIMEOUT_MS);
    run.pending.set(route, { frame, timer });
  }

  /** Idempotent: duplicate signals (channel + poll) and foreign routes are ignored. */
  function settle(route: string, outcome: 'saved' | 'unavailable') {
    const run = runRef.current;
    const entry = run?.pending.get(route);
    if (!run || !entry) return;
    window.clearTimeout(entry.timer);
    entry.frame.remove();
    run.pending.delete(route);
    if (outcome === 'saved') run.saved += 1;
    else run.unavailable += 1;

    const next = run.queue.shift();
    if (next) launch(next);

    if (run.pending.size === 0 && run.queue.length === 0) {
      if (run.poll !== null) window.clearInterval(run.poll);
      run.channel?.close();
      runRef.current = null;
      setPhase('done');
      setLabel(
        `${run.saved} page${run.saved === 1 ? '' : 's'} saved` +
          (run.unavailable ? ` · ${run.unavailable} not available` : '')
      );
    } else {
      const done = run.saved + run.unavailable;
      setLabel(`Saving ${Math.min(done + 1, run.total)} of ${run.total}…`);
    }
  }

  function start() {
    if (runRef.current) return; // double-click guard (the button is also disabled)
    const routes = OFFLINE_ROUTES
      // The one admin-only offline route; every other row is open to all roles.
      .filter((r) => r.route !== 'costing/archived' || role === 'admin')
      .map((r) => r.route);
    if (routes.length === 0) return;

    const run: Run = {
      startedAt: new Date().toISOString(),
      total: routes.length,
      queue: routes.slice(CONCURRENCY),
      pending: new Map(),
      saved: 0,
      unavailable: 0,
      channel: null,
      poll: null,
    };
    runRef.current = run;
    setPhase('running');
    setLabel(`Saving 1 of ${run.total}…`);

    try {
      const ch = new BroadcastChannel('op-offline');
      ch.onmessage = (e) => {
        if (e.data?.type === 'saved' && typeof e.data.route === 'string') {
          settle(e.data.route, 'saved');
        }
      };
      run.channel = ch;
    } catch {
      // No BroadcastChannel (older Safari): the poll below is the only signal.
    }

    // Fallback for browsers without BroadcastChannel and for lost messages:
    // a pending route whose meta savedAt is newer than the run start was
    // saved, whoever wrote it. ISO-8601 strings compare correctly as text.
    run.poll = window.setInterval(() => {
      const current = runRef.current;
      if (!current) return;
      listSavedPages()
        .then((saved) => {
          for (const p of saved) {
            if (current.pending.has(p.route) && p.savedAt >= current.startedAt) {
              settle(p.route, 'saved');
            }
          }
        })
        .catch(() => {});
    }, POLL_MS);

    for (const route of routes.slice(0, CONCURRENCY)) launch(route);
  }

  // Offline there is nothing to fetch; the footer's empty:hidden collapses.
  if (!online) return null;

  return (
    <button
      type="button"
      onClick={start}
      disabled={phase === 'running'}
      title="Save a copy of every page to this device so the planner can be viewed offline"
      className={cn(
        'group flex w-full items-center gap-2.5 rounded-md border border-border px-2.5 py-2 text-[13px] text-muted-foreground transition-colors',
        phase === 'running'
          ? 'cursor-default'
          : 'hover:bg-muted/70 hover:text-foreground'
      )}
    >
      <DownloadCloud
        className={cn(
          'h-4 w-4 shrink-0 transition-colors',
          phase === 'running' ? 'animate-pulse text-primary' : 'group-hover:text-foreground'
        )}
      />
      <span className="truncate">{label}</span>
    </button>
  );
}
