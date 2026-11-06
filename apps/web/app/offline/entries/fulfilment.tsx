import { FulfilmentView, type FulfilmentViewProps } from '@/app/(app)/fulfilment/fulfilment-view';
import type { OfflineEntry } from '../entry';

/**
 * Program Fulfilment offline: the page is pure output, so nothing needs to be
 * switched off. The heatmap grid, its month-range filter and the Export menu
 * (CSV / Excel / PDF) all run in the browser. The stale-plan banner is a
 * server render and is simply absent from the copy.
 */
const entry: OfflineEntry = {
  Component: FulfilmentView,
  readOnly: (p: FulfilmentViewProps): FulfilmentViewProps => p,
};

export default entry;
