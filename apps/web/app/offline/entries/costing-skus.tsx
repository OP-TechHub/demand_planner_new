import { SkusClient, type SkusClientProps } from '@/app/(app)/costing/skus/skus-client';
import type { OfflineEntry } from '../entry';

/**
 * The SKU master offline: New SKU, the edit dialog (save/archive) and the
 * per-grade yield cells all need the server, so `offline` hides the button and
 * answers no to every canEdit — search, the costed-by filter and both tables
 * (recipe and yield-by-size) keep working. The assumptions behind the dialog's
 * preview were masked by the server before the copy was saved, so no extra
 * masking is needed here.
 */
const entry: OfflineEntry = {
  Component: SkusClient,
  readOnly: (p: SkusClientProps): SkusClientProps => ({ ...p, offline: true }),
};

export default entry;
