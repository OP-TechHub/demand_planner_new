import { PoUpdateClient } from '@/app/(app)/po-update/po-update-client';
import type { OfflineEntry } from '../entry';

/**
 * PO Update offline: recording, editing, deleting and importing POs all write
 * through server actions, and every one of those affordances hangs off
 * `canEdit` — forced off here, so the record / edit / delete buttons, the
 * import dialog and the PO modal never render. The month window, program
 * search, "only programs with POs" filter, the fold-out PO lists and the CSV
 * export (kept at the viewer's own `canExport`) all run in the browser.
 */
const entry: OfflineEntry = {
  Component: PoUpdateClient,
  readOnly: (p) => ({ ...p, canEdit: false }),
};

export default entry;
