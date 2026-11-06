import { InquiryClient } from '@/app/(app)/inquiry/inquiry-client';
import type { OfflineEntry } from '../entry';

/**
 * New Inquiry offline: this is a form page, and both flows talk to the server
 * while you fill them in (spare capacity, pipeline candidates), not only on
 * save — so `offline` replaces the form with a clear disabled state and
 * `canSave` is forced off. The page header still shows what the page is for;
 * raised inquiries are readable on the Inquiries page's own copy.
 */
const entry: OfflineEntry = {
  Component: InquiryClient,
  readOnly: (p) => ({ ...p, canSave: false, offline: true }),
};

export default entry;
