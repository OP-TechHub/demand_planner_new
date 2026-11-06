import { InquiriesClient, type InquiryRow } from '@/app/(app)/inquiries/inquiries-client';
import type { OfflineEntry } from '../entry';

/**
 * Inquiries offline: promoting an inquiry to the active plan loads and writes
 * through server actions, so every row's `promotable` flag is forced off and
 * the Promote button (and its dialog) never renders. The date and created-by
 * filters and the CSV export all run in the browser.
 */
const entry: OfflineEntry = {
  Component: InquiriesClient,
  readOnly: (p) => ({
    ...p,
    inquiries: (p.inquiries as InquiryRow[]).map((i) => ({ ...i, promotable: false })),
  }),
};

export default entry;
