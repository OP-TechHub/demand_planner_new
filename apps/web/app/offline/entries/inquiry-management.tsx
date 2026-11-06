import { InquiryManagementClient } from '@/app/(app)/inquiry-management/inquiry-management-client';
import type { OfflineEntry } from '../entry';

/**
 * Inquiry management offline: the page is already read-only — nothing on it
 * writes. The customer / product pickers, the offer basis, the month-filtered
 * MetricGrid with its exports, and Print / Save as PDF of the offer sheet all
 * run in the browser, so nothing needs stripping. The copy only exists once
 * the plan was computed, exactly like the online page.
 */
const entry: OfflineEntry = {
  Component: InquiryManagementClient,
  readOnly: (p) => ({ ...p }),
};

export default entry;
