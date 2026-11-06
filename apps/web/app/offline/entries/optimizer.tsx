import { OptimizerClient } from '@/app/(app)/optimizer/optimizer-client';
import type { OfflineEntry } from '../entry';

/**
 * The Fulfilment Optimizer offline: a pure output page with nothing to switch
 * off — the month-range filter, the harvest and fulfilment tables and the
 * headline stats all recompute in the browser. The stale-plan notice (and its
 * Recalculate button) is server chrome outside the copy, so it never shows
 * here.
 */
const entry: OfflineEntry = {
  Component: OptimizerClient,
  readOnly: (p) => ({ ...p }),
};

export default entry;
