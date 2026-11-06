import { OpenToBuyView } from '@/app/(app)/open-to-buy/open-to-buy-view';
import type { OfflineEntry } from '../entry';

/**
 * Open to buy offline: the page is already read-only — nothing on it writes.
 * The shared month range, synced sideways scrolling, OTB split tooltips,
 * inquiry-fulfilment shading and every CSV / Excel / PDF export all run in
 * the browser, so nothing needs stripping. The copy only exists once the plan
 * was computed, and the stale-plan recalculate banner lives in the server
 * page — never part of the copy.
 */
const entry: OfflineEntry = {
  Component: OpenToBuyView,
  readOnly: (p) => ({ ...p }),
};

export default entry;
