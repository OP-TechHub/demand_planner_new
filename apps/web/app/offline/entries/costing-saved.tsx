import { SavedList, type SavedListProps } from '@/app/(app)/costing/saved/saved-list';
import type { OfflineEntry } from '../entry';

/**
 * The saved-costings list offline: duplicate, share/private and delete are
 * server actions, so `offline` hides the row buttons — the Mine/Everyone tabs
 * and the version/override badges keep working. Rows still link to their
 * costing, which deliberately has no offline copy: the service worker shows
 * the generic offline screen for it.
 */
const entry: OfflineEntry = {
  Component: SavedList,
  readOnly: (p: SavedListProps): SavedListProps => ({ ...p, offline: true }),
};

export default entry;
