/* eslint-disable @typescript-eslint/no-explicit-any */

/**
 * Decides whether a single audit-log entry can be undone by an admin, using only
 * what the entry already recorded. Shared by the audit page (to show/hide the
 * Undo button) and the server action (to re-check before applying).
 *
 * Reversible today: single-cell demand/harvest edits that stored their before
 * values (≤40 cells, nothing truncated), and program add / edit / remove.
 * Not reversible: bulk CSV imports (no before values kept), oversized edits,
 * and multi-step flows like inquiry-to-pipeline or promotions.
 */

export const UNDO_WINDOW_DAYS = 30;
const WINDOW_MS = UNDO_WINDOW_DAYS * 24 * 60 * 60 * 1000;

export type AuditEntryLike = {
  entity_type: string;
  action: string;
  changes: any;
  at: string;
  reverted_at?: string | null;
};

export type Reversibility = { ok: boolean; reason?: string };

/** True when `changes` holds at least one field-level {old,new} diff. */
function hasFieldDiff(c: any): boolean {
  return Object.values(c ?? {}).some(
    (v: any) => v && typeof v === 'object' && !Array.isArray(v) && ('old' in v || 'new' in v)
  );
}

export function reversibility(entry: AuditEntryLike, nowMs: number): Reversibility {
  if (entry.reverted_at) return { ok: false, reason: 'Already undone' };
  if (nowMs - new Date(entry.at).getTime() > WINDOW_MS) return { ok: false, reason: `Older than ${UNDO_WINDOW_DAYS} days — now permanent` };

  const c = entry.changes ?? {};

  if (entry.entity_type === 'demand_plan' || entry.entity_type === 'harvest_plan') {
    if (c.imported_cells != null) return { ok: false, reason: 'Bulk import — can’t undo' };
    if ((c.more ?? 0) > 0) return { ok: false, reason: 'Too many cells changed to undo' };
    if (Array.isArray(c.edits) && c.edits.length) return { ok: true };
    return { ok: false, reason: 'No reversible detail recorded' };
  }

  if (entry.entity_type === 'programs') {
    // Multi-step flows (promotion) leave more than a field flip — don't touch them.
    if (c.promoted || c.promoted_months != null || c.saved_from) return { ok: false, reason: 'Part of a promotion/inquiry — undo manually' };
    if (entry.action === 'insert') {
      if (c.imported_new != null || c.imported_updated != null) return { ok: false, reason: 'Bulk import — can’t undo' };
      return { ok: true }; // undo = archive the created program
    }
    if (entry.action === 'delete') return c.archived ? { ok: true } : { ok: false, reason: 'Can’t undo' };
    if (entry.action === 'update') {
      if (c.imported_new != null || c.imported_updated != null) return { ok: false, reason: 'Bulk import — can’t undo' };
      return hasFieldDiff(c) ? { ok: true } : { ok: false, reason: 'No reversible detail recorded' };
    }
  }

  return { ok: false, reason: 'This kind of change can’t be undone' };
}
