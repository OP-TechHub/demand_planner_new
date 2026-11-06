import { RevenueCostView, type RevenueCostViewProps } from '@/app/(app)/revenue-cost/revenue-cost-view';
import type { OfflineEntry } from '../entry';

/**
 * Revenue & Cost offline: pure output, nothing to switch off. All seven metric
 * tabs, the cost-component dropdown, the Active / Pipeline filter, the row
 * picker and the Export menu run in the browser. The stale-plan banner is a
 * server render and is simply absent from the copy.
 */
const entry: OfflineEntry = {
  Component: RevenueCostView,
  readOnly: (p: RevenueCostViewProps): RevenueCostViewProps => p,
};

export default entry;
