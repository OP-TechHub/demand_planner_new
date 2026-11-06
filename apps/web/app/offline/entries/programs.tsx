import { ProgramsClient } from '@/app/(app)/programs/programs-client';
import type { OfflineEntry } from '../entry';

/**
 * Programs offline: creating, editing, archiving and the CSV import all need
 * the server, so the edit flag is forced off — the status/customer filters,
 * the search box, the resizable column and the CSV export all run in the
 * browser.
 */
const entry: OfflineEntry = {
  Component: ProgramsClient,
  readOnly: (p) => ({ ...p, canEdit: false }),
};

export default entry;
