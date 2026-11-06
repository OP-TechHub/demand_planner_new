import { OrderBookView } from '@/app/(app)/order-book/order-book-view';
import type { OfflineEntry } from '../entry';

/**
 * Order Book offline: the page is already read-only — nothing on it writes.
 * The firmness tabs, program picker, month window, cell colours with their
 * hover breakdowns and the CSV / Excel / PDF exports all run in the browser,
 * so nothing needs stripping. The stale-plan recalculate banner lives in the
 * server page and is never part of the copy.
 */
const entry: OfflineEntry = {
  Component: OrderBookView,
  readOnly: (p) => ({ ...p }),
};

export default entry;
