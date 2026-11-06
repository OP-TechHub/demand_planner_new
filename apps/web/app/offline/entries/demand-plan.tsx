import { DemandClient } from '@/app/(app)/demand-plan/demand-client';
import type { OfflineEntry } from '../entry';

/**
 * The Demand Plan offline: editing, paste-import and the approval actions all
 * need the server, so the edit/approve flags are forced off — the grid, its
 * three status views, fulfilment shading, whole-round tooltips and the CSV
 * export all run in the browser. The pending-requests panel still shows (the
 * business chose to keep it: the copy holds exactly what the user saw), but
 * with canApprove off it is read-only.
 */
const entry: OfflineEntry = {
  Component: DemandClient,
  readOnly: (p) => ({ ...p, canEdit: false, canApprove: false, needsApproval: false }),
};

export default entry;
