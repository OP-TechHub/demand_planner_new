import { HarvestClient } from '@/app/(app)/harvest-plan/harvest-client';
import type { OfflineEntry } from '../entry';

/**
 * The Harvest Plan offline: editing capacity (click-to-edit, paste, CSV
 * import), the plant's request plan, the daily request and its settings, and
 * recording actuals all need the server, so each section's edit grant is
 * forced off — the capacity grid, the required-harvest bar with its hover
 * split, the request and actual tables, the month-range filter and the CSV
 * export all run in the browser.
 */
const entry: OfflineEntry = {
  Component: HarvestClient,
  readOnly: (p) => ({
    ...p,
    canEdit: false,
    canEditRequest: false,
    canEditActual: false,
    canEditActualBuckets: false,
  }),
};

export default entry;
