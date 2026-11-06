import { DiffView, type DiffViewProps } from '@/app/(app)/diff/diff-view';
import type { OfflineEntry } from '../entry';

/**
 * Compare plans offline: the copy holds the LAST comparison viewed online
 * (the picker navigates with ?a=&b= query params, which needs the server, so
 * it is hidden — `offline: true`). Everything else — the outputs and annual
 * tables, the month-on-month grid with its views, cost-component dropdown and
 * Export menu, and the input-diff sections — renders from the saved data.
 */
const entry: OfflineEntry = {
  Component: DiffView,
  readOnly: (p: DiffViewProps): DiffViewProps => ({ ...p, offline: true }),
};

export default entry;
