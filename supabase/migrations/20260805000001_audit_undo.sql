-- ============================================================================
-- Oceanpick Demand Planner — Admin undo for audit-log entries
--
-- An admin can reverse an eligible change from the audit log within 30 days.
-- We record when/who reverted an entry so it can't be undone twice and so the
-- history shows it was rolled back. The actual reversal writes are done by the
-- service role (admin authorisation is enforced in app code).
--
-- No history is deleted: after 30 days the change is simply permanent (the UI
-- stops offering undo). These columns only annotate existing rows.
-- ============================================================================

alter table demand_planner.audit_log
  add column if not exists reverted_at timestamptz,
  add column if not exists reverted_by uuid references demand_planner.users (id);
