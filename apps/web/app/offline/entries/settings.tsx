import { SettingsView, type SettingsViewProps } from '@/app/(app)/settings/settings-view';
import type { OfflineEntry } from '../entry';

/**
 * Settings offline: a read-only statement of the plan's settings in plain
 * text. Every form (settings, roll-forward, snapshot restore) is a server
 * action, so none of them render; the API keys card is hidden for everyone —
 * and the snapshot itself never contained key material (the page saves
 * `apiKeys: []`), which the transform forces again here for good measure.
 */
const entry: OfflineEntry = {
  Component: SettingsView,
  readOnly: (p: SettingsViewProps): SettingsViewProps => ({ ...p, offline: true, apiKeys: [] }),
};

export default entry;
