'use client';

import { useState, useTransition } from 'react';
import { useRouter } from 'next/navigation';
import { Clock, ChevronDown } from 'lucide-react';
import { EDITABLE_SECTIONS, SECTION_LABEL, type UserRole } from '@oceanpick/shared';
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
              <th className="px-4 py-2.5 font-medium">Edit access</th>
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
                    <SectionAccessDropdown
                      granted={u.edit_sections ?? []}
                      disabled={isPending}
                      onChange={(secs) => run(() => setUserSections(u.id, secs), 'Access updated')}
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
        Admins can edit everything. For everyone else, click a section to grant or revoke edit access — ungranted sections stay read-only.
      </p>
    </div>
  );
}

function SectionAccessDropdown({
  granted,
  disabled,
  onChange,
}: {
  granted: string[];
  disabled: boolean;
  onChange: (sections: string[]) => void;
}) {
  const set = new Set(granted);
  const toggle = (s: string) => {
    const next = new Set(set);
    if (next.has(s)) next.delete(s);
    else next.add(s);
    onChange([...next]);
  };

  const summary =
    granted.length === 0
      ? 'No access'
      : granted.length === EDITABLE_SECTIONS.length
        ? 'All sections'
        : EDITABLE_SECTIONS.filter((s) => set.has(s)).map((s) => SECTION_LABEL[s]).join(', ');

  return (
    <details className="group relative w-56">
      <summary
        className={cn(
          'flex h-8 cursor-pointer list-none items-center justify-between rounded-md border border-input bg-card px-3 text-sm text-foreground transition-colors [&::-webkit-details-marker]:hidden',
          disabled ? 'pointer-events-none opacity-50' : 'hover:bg-muted'
        )}
      >
        <span className={cn('truncate', granted.length === 0 && 'text-muted-foreground')}>{summary}</span>
        <ChevronDown className="h-4 w-4 shrink-0 text-muted-foreground transition-transform group-open:rotate-180" />
      </summary>
      <div className="absolute left-0 z-20 mt-1 w-56 rounded-md border border-border bg-popover p-1 shadow-lg">
        {EDITABLE_SECTIONS.map((s) => (
          <label
            key={s}
            className="flex cursor-pointer items-center gap-2 rounded px-2 py-1.5 text-sm hover:bg-muted"
          >
            <input type="checkbox" checked={set.has(s)} disabled={disabled} onChange={() => toggle(s)} />
            {SECTION_LABEL[s]}
          </label>
        ))}
      </div>
    </details>
  );
}
