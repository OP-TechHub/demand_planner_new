import { AssumptionsClient, type AssumptionsClientProps } from '@/app/(app)/costing/assumptions/assumptions-client';
import type { OfflineEntry } from '../entry';

/**
 * The assumptions screen offline: publishing, making a version current, the
 * port list and the size-grade cells all need the server, so every edit grant
 * is forced off and `offline` freezes the version picker (switching versions
 * is a `?v=` round trip) and drops the grant notices, which would otherwise
 * mislabel the user's real rights. The whole-fish readouts still compute in
 * the browser. The copy shows whichever version was last opened online, and
 * the base-cost sections appear only if the server sent them unmasked.
 */
const entry: OfflineEntry = {
  Component: AssumptionsClient,
  readOnly: (p: AssumptionsClientProps): AssumptionsClientProps => ({
    ...p,
    isAdmin: false,
    canEditBaseCost: false,
    canEditAssumptions: false,
    offline: true,
  }),
};

export default entry;
