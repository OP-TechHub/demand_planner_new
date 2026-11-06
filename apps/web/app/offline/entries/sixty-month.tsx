import { SixtyMonthView, type SixtyMonthViewProps } from '@/app/(app)/sixty-month/sixty-month-view';
import type { OfflineEntry } from '../entry';

/**
 * 60-Month Summary offline: pure output, nothing to switch off. The FP / WR /
 * Margin tabs, month-range filter and Export menu all run in the browser.
 * The stale-plan banner is a server render and is simply absent from the copy.
 */
const entry: OfflineEntry = {
  Component: SixtyMonthView,
  readOnly: (p: SixtyMonthViewProps): SixtyMonthViewProps => p,
};

export default entry;
