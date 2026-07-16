'use client';

import { useState, useTransition } from 'react';
import { useRouter } from 'next/navigation';
import type { UserRole } from '@oceanpick/shared';
import { cn } from '@/lib/utils';
import { Select } from '@/components/ui/select';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { toast } from '@/components/ui/toast';
import { updateUserRole, setUserActive } from '../actions';

export interface AdminUser {
  id: string;
  email: string;
  full_name: string;
  role: UserRole;
  is_active: boolean;
  last_login_at: string | null;
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

  return (
    <div className="mx-auto max-w-3xl space-y-4">
      <div>
        <h1 className="text-2xl font-semibold tracking-tight">Users</h1>
        <p className="mt-1 text-sm text-muted-foreground">
          Anyone can self-register (the first user became admin; the rest default to viewer). Set roles and deactivate accounts here.
        </p>
      </div>
      {error && <p role="alert" className="rounded-md bg-destructive/10 px-3 py-2 text-sm text-destructive">{error}</p>}

      <div className="overflow-hidden rounded-lg border border-border">
        <table className="w-full text-sm">
          <thead className="border-b border-border bg-muted/50 text-left text-xs uppercase tracking-wide text-muted-foreground">
            <tr>
              <th className="px-4 py-2.5 font-medium">User</th>
              <th className="px-4 py-2.5 font-medium">Role</th>
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
                <td className="px-4 py-3 text-muted-foreground">
                  {u.last_login_at ? new Date(u.last_login_at).toLocaleDateString() : 'Never'}
                </td>
                <td className="px-4 py-3">
                  <div className="flex items-center justify-end gap-2">
                    <Badge variant={u.is_active ? 'success' : 'outline'}>{u.is_active ? 'Active' : 'Inactive'}</Badge>
                    <Button
                      variant="outline"
                      size="sm"
                      disabled={isPending || u.id === meId}
                      title={u.id === meId ? 'You can’t change your own status' : undefined}
                      onClick={() => run(() => setUserActive(u.id, !u.is_active), u.is_active ? 'User deactivated' : 'User activated')}
                    >
                      {u.is_active ? 'Deactivate' : 'Activate'}
                    </Button>
                  </div>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}
