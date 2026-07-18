-- ============================================================================
-- API keys — machine-to-machine access to the read API (/api/v1).
--
-- These authenticate another *system* (e.g. the PO matching app), not a person,
-- so they don't go through Supabase Auth. A caller presents the raw key as a
-- Bearer token; the API hashes it and looks the row up here. We store only the
-- SHA-256 hash, never the raw key — it's shown once at creation and can't be
-- recovered, only revoked and replaced.
--
-- Scope is deliberately narrow: keys are org-scoped and read-only. Management
-- (mint/revoke) is admin-only via RLS; verification runs under the service role.
-- ============================================================================

create table if not exists demand_planner.api_keys (
  id            uuid primary key default gen_random_uuid(),
  org_id        uuid not null references demand_planner.organizations (id) on delete cascade,
  label         text not null check (char_length(label) between 1 and 80),
  key_hash      text not null unique,               -- sha256(raw key), hex
  key_prefix    text not null,                      -- e.g. "op_live_a1b2c3" — safe to display
  scopes        text[] not null default array['read'],
  created_by    uuid references demand_planner.users (id),
  created_at    timestamptz not null default now(),
  last_used_at  timestamptz,
  revoked_at    timestamptz
);

create index if not exists api_keys_org_idx
  on demand_planner.api_keys (org_id) where revoked_at is null;

alter table demand_planner.api_keys enable row level security;

-- Only an org admin manages the org's keys. Note the raw key/hash is never sent
-- to the client anyway — the settings UI selects the display columns only.
drop policy if exists api_keys_admin_all on demand_planner.api_keys;
create policy api_keys_admin_all on demand_planner.api_keys for all
  using (org_id = demand_planner.current_org_id() and demand_planner.current_role_name() = 'admin')
  with check (org_id = demand_planner.current_org_id() and demand_planner.current_role_name() = 'admin');

-- Default privileges should cover this, but grant explicitly so a drifted env
-- doesn't 404 the settings page.
grant select, insert, update, delete on demand_planner.api_keys to authenticated;
grant all on demand_planner.api_keys to service_role;
