import { HomeView, type HomeViewProps } from '@/app/(app)/home/home-view';
import type { OfflineEntry } from '../entry';

/**
 * Dashboard offline: `offline: true` hides the Recalculate button (POST
 * /api/recompute + server-action polling). The overview's program filter,
 * time-range filter, charts and tooltips all run in the browser. The
 * stale-plan banner and the Recent activity feed are per-request server
 * renders — absent from the copy (the activity card says so in place).
 */
const entry: OfflineEntry = {
  Component: HomeView,
  readOnly: (p: HomeViewProps): HomeViewProps => ({ ...p, offline: true }),
};

export default entry;
