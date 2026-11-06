import { ArchivedList, type ArchivedListProps } from '@/app/(app)/costing/archived/archived-client';
import type { OfflineEntry } from '../entry';

/**
 * The costing bin offline: restoring a costing or a SKU is a server action,
 * so `offline` hides the Restore buttons — both lists stay readable, so an
 * admin can still see what was deleted and when. The page is admin-only
 * online, so only an admin's device ever holds this copy.
 */
const entry: OfflineEntry = {
  Component: ArchivedList,
  readOnly: (p: ArchivedListProps): ArchivedListProps => ({ ...p, offline: true }),
};

export default entry;
