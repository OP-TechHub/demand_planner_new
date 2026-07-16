'use client';

import { useState, useTransition } from 'react';
import { useRouter } from 'next/navigation';
import type { UserRole } from '@oceanpick/shared';
import { cn } from '@/lib/utils';
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

export function UsersClient({ users, meId }: { users: AdminUser[]; meId: string }) {
  const router = useRouter();
  const [isPending, start] = useTransition();
  const [error, setError] = useState<string | null>(null);

  const run = (fn: () => Promise<{ error: string | null }>) => {
    setError(null);
    start(async () => {
      const res = await fn();
      if (res.error) setError(res.error);
      else router.refresh();
    });
  };

  return (
    <div className="mx-auto max-w-3xl space-y-4">
      <h1 className="text-2xl font-semibold tracking-tight">Users</h1>
      <p className="text-xs text-muted-foreground">
        Anyone can self-register (first user in became admin; the rest default to viewer). Set roles and deactivate accounts here.
      </p>
      {error && <p role="alert" className="rounded-md bg-destructive/10 px-3 py-2 text-sm text-destructive">{error}</p>}

      <div className="overflow-x-auto rounded-lg border">
        <table className="w-full text-sm">
          <thead className="border-b bg-muted/50 text-left text-xs uppercase tracking-wide text-muted-foreground">
            <tr>
              <th className="px-3 py-2">User</th>
              <th className="px-3 py-2">Role</th>
              <th className="px-3 py-2">Last login</th>
              <th className="px-3 py-2 text-right">Status</th>
            </tr>
          </thead>
          <tbody>
            {users.map((u) => (
              <tr key={u.id} className={cn('border-b last:border-0', !u.is_active && 'opacity-50')}>
                <td className="px-3 py-2">
                  <div className="font-medium">{u.full_name || u.email}{u.id === meId && <span className="ml-2 text-xs text-muted-foreground">(you)</span>}</div>
                  <div className="text-xs text-muted-foreground">{u.email}</div>
                </td>
                <td className="px-3 py-2">
                  <select
                    value={u.role}
                    disabled={isPending}
                    onChange={(e) => run(() => updateUserRole(u.id, e.target.value))}
                    className="rounded-md border px-2 py-1 text-sm capitalize outline-none focus:ring-2 focus:ring-primary"
                  >
                    {ROLES.map((r) => <option key={r} value={r}>{r}</option>)}
                  </select>
                </td>
                <td className="px-3 py-2 text-muted-foreground">{u.last_login_at ? new Date(u.last_login_at).toLocaleDateString() : 'Never'}</td>
                <td className="px-3 py-2 text-right">
                  <button
                    onClick={() => run(() => setUserActive(u.id, !u.is_active))}
                    disabled={isPending}
                    className="rounded-md border px-2 py-1 text-xs hover:bg-muted"
                  >
                    {u.is_active ? 'Deactivate' : 'Activate'}
                  </button>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}
