import { BucketsClient } from '@/app/(app)/buckets/buckets-client';
import type { OfflineEntry } from '../entry';

/**
 * Buckets offline: creating, editing, archiving and restoring need the server,
 * so the edit flag is forced off — the month-range filter and the capacity
 * totals it recomputes all run in the browser.
 */
const entry: OfflineEntry = {
  Component: BucketsClient,
  readOnly: (p) => ({ ...p, canEdit: false }),
};

export default entry;
