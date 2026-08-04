'use client';

import { useTransition } from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { Lock, LockOpen, Trash2, Users } from 'lucide-react';
import { monthLabel } from '@oceanpick/shared';
import { cn } from '@/lib/utils';
import { Button } from '@/components/ui/button';
import { toast } from '@/components/ui/toast';
import { confirmDialog } from '@/components/ui/confirm';
import { setPlanLocked, adminDeletePlan } from '../actions';

export type AdminPlan = {
  id: string;
  name: string;
  type: string;
  is_locked: boolean;
  owner: string;
  plan_start_date: string;
  horizon_months: number;
  created_at: string;
};

const TYPE_LABEL: Record<string, string> = { master: 'Master', scenario: 'Scenario', snapshot: 'Snapshot' };

export function PlansAdminClient({ plans }: { plans: AdminPlan[] }) {
  const router = useRouter();
  const [pending, start] = useTransition();

  function toggleLock(p: AdminPlan) {
    start(async () => {
      const res = await setPlanLocked(p.id, !p.is_locked);
      if (res.error) toast.error(res.error);
      else { toast.success(p.is_locked ? 'Plan unlocked.' : 'Plan locked.'); router.refresh(); }
    });
  }

  async function remove(p: AdminPlan) {
    const ok = await confirmDialog({
      title: `Delete “${p.name}”?`,
      description: 'The plan is hidden everywhere and can be recovered from the database if needed. Its programs, demand, and results are kept.',
      confirmLabel: 'Delete',
      destructive: true,
    });
    if (!ok) return;
    start(async () => {
      const res = await adminDeletePlan(p.id);
      if (res.error) toast.error(res.error);
      else { toast.success('Plan deleted.'); router.refresh(); }
    });
  }

  return (
    <div className="mx-auto max-w-4xl space-y-4">
      <div>
        <h1 className="text-2xl font-semibold tracking-tight">Plans</h1>
        <p className="mt-1 text-sm text-muted-foreground">
          Lock a plan to make it read-only for everyone, or delete plans you no longer need. The master plan can’t be deleted.
        </p>
      </div>

      <div className="flex items-start gap-2 rounded-lg border bg-muted/30 p-3 text-sm text-muted-foreground">
        <Users className="mt-0.5 h-4 w-4 shrink-0" />
        <span>
          Who may edit which inputs (programs, demand, harvest, buckets) is set per user in{' '}
          <Link href="/admin/users" className="font-medium text-primary hover:underline">Admin → Users</Link>.
        </span>
      </div>

      <div className="overflow-x-auto rounded-lg border">
        <table className="w-full text-sm">
          <thead className="bg-muted/50 text-muted-foreground">
            <tr>
              <th className="px-3 py-2 text-left font-medium">Plan</th>
              <th className="px-3 py-2 text-left font-medium">Type</th>
              <th className="px-3 py-2 text-left font-medium">Owner</th>
              <th className="px-3 py-2 text-left font-medium">Window</th>
              <th className="px-3 py-2 text-left font-medium">Status</th>
              <th className="px-3 py-2 text-right font-medium">Actions</th>
            </tr>
          </thead>
          <tbody>
            {plans.map((p) => (
              <tr key={p.id} className="border-t">
                <td className="px-3 py-2 font-medium">{p.name}</td>
                <td className="px-3 py-2 text-muted-foreground">{TYPE_LABEL[p.type] ?? p.type}</td>
                <td className="px-3 py-2 text-muted-foreground">{p.owner}</td>
                <td className="px-3 py-2 tabular-nums text-muted-foreground">
                  {monthLabel(p.plan_start_date, 1)} – {monthLabel(p.plan_start_date, p.horizon_months)}
                </td>
                <td className="px-3 py-2">
                  {p.is_locked ? (
                    <span className="inline-flex items-center gap-1 rounded px-1.5 py-0.5 text-xs font-medium bg-warning/10 text-warning">
                      <Lock className="h-3 w-3" /> Locked
                    </span>
                  ) : (
                    <span className="inline-flex items-center gap-1 rounded px-1.5 py-0.5 text-xs font-medium bg-success/10 text-success">
                      <LockOpen className="h-3 w-3" /> Editable
                    </span>
                  )}
                </td>
                <td className="px-3 py-2">
                  <div className="flex items-center justify-end gap-2">
                    <Button variant="outline" size="sm" disabled={pending} onClick={() => toggleLock(p)}>
                      {p.is_locked ? <><LockOpen className="h-3.5 w-3.5" /> Unlock</> : <><Lock className="h-3.5 w-3.5" /> Lock</>}
                    </Button>
                    <Button
                      variant="outline"
                      size="sm"
                      disabled={pending || p.type === 'master'}
                      onClick={() => remove(p)}
                      title={p.type === 'master' ? 'The master plan can’t be deleted' : 'Delete plan'}
                      className={cn(p.type !== 'master' && 'text-destructive hover:bg-destructive/10')}
                    >
                      <Trash2 className="h-3.5 w-3.5" /> Delete
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
