import { RankingClient } from '@/app/(app)/ranking/ranking-client';
import type { OfflineEntry } from '../entry';

/**
 * Program Ranking offline: the page is already read-only — ranking, the
 * rank-by / status / date-range controls and the Excel export are all worked
 * out in the browser from the rows the server shipped, so nothing needs
 * stripping. The stale-plan recalculate banner lives in the server page and
 * is never part of the copy.
 */
const entry: OfflineEntry = {
  Component: RankingClient,
  readOnly: (p) => ({ ...p }),
};

export default entry;
