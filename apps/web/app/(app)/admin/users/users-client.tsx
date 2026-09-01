'use client';

import { useState, useTransition } from 'react';
import { useRouter } from 'next/navigation';
import { Clock } from 'lucide-react';
import { BASE_COST_EDIT, BASE_COST_VIEW, type UserRole } from '@oceanpick/shared';
import { cn } from '@/lib/utils';
import { Select } from '@/components/ui/select';
import { Badge } from '@/components/ui/badge';
import { toast } from '@/components/ui/toast';
import { updateUserRole, setUserActive, setUserSections } from '../actions';

export interface AdminUser {
  id: string;
  email: string;
  full_name: string;
  role: UserRole;
  is_active: boolean;
  last_login_at: string | null;
  edit_sections: string[];
}

const ROLES: UserRole[] = ['admin', 'planner', 'contributor', 'viewer'];

function initials(u: AdminUser) {
  const src = (u.full_name || u.email).trim();
  const parts = src.split(/\s+/);
  return ((parts[0]?.[0] ?? '') + (parts[1]?.[0] ?? '')).toUpperCase() || src.slice(0, 2).toUpperCase();
}

/** The grants one non-admin user holds, each one a checkbox. */
function AccessCell({
  held,
  busy,
  onToggle,
}: {
  held: string[];
  busy: boolean;
  onToggle: (section: string, on: boolean) => void;
}) {
  const canEditBase = held.includes(BASE_COST_EDIT);
  return (
    <div className="space-y-1.5">
      <Grant
        label="Can edit buckets"
        checked={held.includes('buckets')}
        disabled={busy}
        onChange={(on) => onToggle('buckets', on)}
      />
      <Grant
        label="Can view base cost"
        // Editing implies viewing, so the box is ticked and held there rather
        // than offering a state the permission check would ignore anyway.
        checked={held.includes(BASE_COST_VIEW) || canEditBase}
        disabled={busy || canEditBase}
        title={canEditBase ? 'Included in "Can edit base cost"' : undefined}
        onChange={(on) => onToggle(BASE_COST_VIEW, on)}
      />
      <Grant
        label="Can edit base cost"
        checked={canEditBase}
        disabled={busy}
        onChange={(on) => onToggle(BASE_COST_EDIT, on)}
      />
    </div>
  );
}

/** One grant checkbox, in the compact form the access column needs. */
function Grant({
  label,
  checked,
  disabled,
  title,
  onChange,
}: {
  label: string;
  checked: boolean;
  disabled: boolean;
  title?: string;
  onChange: (on: boolean) => void;
}) {
  return (
    <label className="flex items-center gap-2 text-sm" title={title}>
      <input
        type="checkbox"
        checked={checked}
        disabled={disabled}
        onChange={(e) => onChange(e.target.checked)}
        className="h-4 w-4 cursor-pointer accent-primary"
      />
      {label}
    </label>
  );
}

export function UsersClient({ users, meId }: { users: AdminUser[]; meId: string }) {
  const router = useRouter();
  const [isPending, start] = useTransition();
  const [error, setError] = useState<string | null>(null);

  const run = (fn: () => Promise<{ error: string | null }>, ok: string) => {
    setError(null);
    start(async () => {
      const res = await fn();
      if (res.error) { setError(res.error); toast.error(res.error); }
      else { toast.success(ok); router.refresh(); }
    });
  };

  /**
   * Flip one grant, leaving the others alone.
   *
   * setUserSections takes the whole list, so sending just the section being
   * toggled would silently revoke every other grant the user holds — which is
   * what this used to do when 'buckets' was the only one.
   */
  const toggle = (u: AdminUser, section: string, on: boolean) => {
    const next = new Set(u.edit_sections ?? []);
    if (on) next.add(section);
    else next.delete(section);
    return setUserSections(u.id, [...next]);
  };

  const pendingCount = users.filter((u) => !u.is_active && !u.last_login_at).length;

  return (
    <div className="mx-auto max-w-3xl space-y-4">
      <div>
        <h1 className="text-2xl font-semibold tracking-tight">Users</h1>
        <p className="mt-1 text-sm text-muted-foreground">
          Anyone can self-register (the first user became admin; the rest default to viewer). Set roles and deactivate accounts here.
        </p>
      </div>
      {error && <p role="alert" className="rounded-md bg-destructive/10 px-3 py-2 text-sm text-destructive">{error}</p>}

      {pendingCount > 0 && (
        <div className="flex items-center gap-2 rounded-lg border border-warning/30 bg-warning/10 px-4 py-2.5 text-sm text-warning">
          <Clock className="h-4 w-4 shrink-0" />
          {pendingCount} account{pendingCount > 1 ? 's are' : ' is'} awaiting approval — click <b>Approve</b> to grant access.
        </div>
      )}

      <div className="overflow-x-auto rounded-lg border border-border">
        <table className="w-full min-w-[52rem] text-sm">
          <thead className="border-b border-border bg-muted/50 text-left text-xs uppercase tracking-wide text-muted-foreground">
            <tr>
              <th className="px-4 py-2.5 font-medium">User</th>
              <th className="px-4 py-2.5 font-medium">Role</th>
              <th className="px-4 py-2.5 font-medium">Access</th>
              <th className="px-4 py-2.5 font-medium">Last login</th>
              <th className="px-4 py-2.5 text-right font-medium">Status</th>
            </tr>
          </thead>
          <tbody>
            {users.map((u) => (
              <tr key={u.id} className="border-b border-border transition-colors last:border-0 hover:bg-muted/30">
                <td className="px-4 py-3">
                  <div className="flex items-center gap-3">
                    <span className={cn(
                      'flex h-9 w-9 shrink-0 items-center justify-center rounded-full text-xs font-semibold',
                      u.is_active ? 'bg-primary/10 text-primary' : 'bg-muted text-muted-foreground'
                    )}>
                      {initials(u)}
                    </span>
                    <div className="min-w-0">
                      <div className="flex items-center gap-1.5 font-medium">
                        <span className="truncate">{u.full_name || u.email}</span>
                        {u.id === meId && <span className="text-xs font-normal text-muted-foreground">(you)</span>}
                      </div>
                      <div className="truncate text-xs text-muted-foreground">{u.email}</div>
                    </div>
                  </div>
                </td>
                <td className="px-4 py-3">
                  <div className="w-36">
                    <Select
                      value={u.role}
                      disabled={isPending}
                      onChange={(e) => run(() => updateUserRole(u.id, e.target.value), 'Role updated')}
                      className="h-8 capitalize"
                    >
                      {ROLES.map((r) => <option key={r} value={r}>{r}</option>)}
                    </Select>
                  </div>
                </td>
                <td className="px-4 py-3">
                  {u.role === 'admin' ? (
                    <span className="text-xs text-muted-foreground">Full access</span>
                  ) : (
                    <AccessCell
                      held={u.edit_sections ?? []}
                      busy={isPending}
                      onToggle={(section, on) => run(() => toggle(u, section, on), 'Access updated')}
                    />
                  )}
                </td>
                <td className="px-4 py-3 text-muted-foreground">
                  {u.last_login_at ? new Date(u.last_login_at).toLocaleDateString() : 'Never'}
                </td>
                <td className="px-4 py-3">
                  <div className="flex items-center justify-end gap-2">
                    {!u.is_active && !u.last_login_at && <Badge variant="warning">Pending</Badge>}
                    <div className="w-32">
                      <Select
                        value={u.is_active ? 'active' : 'inactive'}
                        disabled={isPending || u.id === meId}
                        title={u.id === meId ? 'You can’t change your own status' : undefined}
                        onChange={(e) => {
                          const active = e.target.value === 'active';
                          run(() => setUserActive(u.id, active), active ? 'User activated' : 'User deactivated');
                        }}
                        className="h-8"
                      >
                        <option value="active">Active</option>
                        <option value="inactive">Inactive</option>
                      </Select>
                    </div>
                  </div>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      <p className="text-xs text-muted-foreground">
        Admins can edit everything. For everyone else, click a section to grant or revoke edit access — ungranted
        sections stay read-only.
      </p>
      <p className="text-xs text-muted-foreground">
        <b>Base cost</b> is the Assumptions screen&apos;s &ldquo;Base fish cost&rdquo; and &ldquo;Other direct
        costs&rdquo; — the feed price, clearing, import tax, FCR, FX and the ODC components, plus the whole-fish
        build-up printed on a cost sheet. It is hidden from everyone by default; grant view to show it, and edit to
        let someone publish a new assumptions version that changes it. The costs and prices built on it stay visible
        either way.
      </p>
    </div>
  );
}

