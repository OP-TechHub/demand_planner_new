import { SecondaryProductsView } from '@/app/(app)/secondary-products/secondary-products-view';
import type { OfflineEntry } from '../entry';

/**
 * Secondary products offline: managing by-product definitions and the Other
 * products section (add, edit, archive, quantities, CSV import) all need the
 * server, so the edit flag is forced off — the metric picker, month-range
 * filter, totals and the client-side exports all run in the browser. The
 * stale-plan notice is server chrome outside the copy, so it never shows here.
 */
const entry: OfflineEntry = {
  Component: SecondaryProductsView,
  readOnly: (p) => ({ ...p, canEdit: false }),
};

export default entry;
