import { CostGridClient, type CostGridProps } from '@/app/(app)/costing/cost-grid-client';
import type { OfflineEntry } from '../entry';

/**
 * The Cost Grid offline: saving a costing and re-costing need the server, so
 * they are switched off; breakdowns, the CSV sheet, Print / Save as PDF and
 * Word all run in the browser. The base cost was masked by the server before
 * the copy was saved, so it stays masked here.
 */
const entry: OfflineEntry = {
  Component: CostGridClient,
  readOnly: (p: CostGridProps): CostGridProps => ({ ...p, canRecost: false, offline: true }),
};

export default entry;
