import { AnnualSummaryView, type AnnualSummaryViewProps } from '@/app/(app)/annual-summary/annual-summary-view';
import type { OfflineEntry } from '../entry';

/**
 * Annual Summary offline: a static table, so nothing to switch off. The CSV
 * export builds in the browser and keeps working. The stale-plan banner is a
 * server render and is simply absent from the copy.
 */
const entry: OfflineEntry = {
  Component: AnnualSummaryView,
  readOnly: (p: AnnualSummaryViewProps): AnnualSummaryViewProps => p,
};

export default entry;
