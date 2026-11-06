import { ScenariosClient } from '@/app/(app)/scenarios/scenarios-client';
import type { OfflineEntry } from '../entry';

/**
 * My Plans offline: everything here acts on the server — creating a scenario
 * or plan, opening one (it switches the active plan), duplicating, renaming,
 * deleting — so `offline` hides every action and the copy is a pure read-only
 * list of the user's scenarios, with the active one still badged.
 */
const entry: OfflineEntry = {
  Component: ScenariosClient,
  readOnly: (p) => ({ ...p, canCreate: false, offline: true }),
};

export default entry;
