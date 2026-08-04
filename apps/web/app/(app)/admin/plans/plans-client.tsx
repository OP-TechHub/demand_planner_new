'use client';

import { useEffect, useState, useTransition } from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { Lock, LockOpen, Trash2, Users, KeyRound, Plus } from 'lucide-react';
import { monthLabel, PLAN_EDITABLE_SECTIONS, SECTION_LABEL } from '@oceanpick/shared';
import { cn } from '@/lib/utils';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Dialog } from '@/components/ui/dialog';
import { toast } from '@/components/ui/toast';
import { confirmDialog } from '@/components/ui/confirm';
import { setPlanLocked, adminDeletePlan, getPlanGrants, setPlanUserSections } from '../actions';
import { createScenario } from '../../plan-actions';

export type AdminPlan = {
  id: string;
  name: string;
  type: string;
  is_locked: boolean;
  is_sandbox: boolean;
  owner: string;
  plan_start_date: string;
  horizon_months: number;
  created_at: string;
};
export type AccessUser = { id: string; name: string };

/** What kind of plan a row is, for the Kind column. */
function kindOf(p: AdminPlan): string {
  if (p.type === 'master') return 'Master';
  if (p.is_sandbox) return 'Sandbox';
  return 'Official';
}

export function PlansAdminClient({ plans, users }: { plans: AdminPlan[]; users: AccessUser[] }) {
  const router = useRouter();
  const [pending, start] = useTransition();
  const [accessPlan, setAccessPlan] = useState<AdminPlan | null>(null);
  const [newOpen, setNewOpen] = useState(false);
  const [newName, setNewName] = useState('');
  const [newErr, setNewErr] = useState<string | null>(null);
  const [creating, startCreate] = useTransition();

  function createOfficial() {
    setNewErr(null);
    if (!newName.trim()) { setNewErr('Name is required.'); return; }
    startCreate(async () => {
      const res = await createScenario(newName.trim(), '', { official: true });
      if (res.error) { setNewErr(res.error); return; }
      toast.success('Official plan created.');
      setNewOpen(false); setNewName(''); router.refresh();
    });
  }

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
      <div className="flex items-start justify-between gap-4">
        <div>
          <h1 className="text-2xl font-semibold tracking-tight">Plans</h1>
          <p className="mt-1 text-sm text-muted-foreground">
            Official plans (master + approved copies) are managed here — lock them read-only, set per-tab access, or delete.
            Sandboxes are users’ private scenarios; you can see and delete them, but their owner edits them.
          </p>
        </div>
        <Button onClick={() => { setNewErr(null); setNewOpen(true); }}><Plus className="h-4 w-4" /> New official plan</Button>
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
              <th className="px-3 py-2 text-left font-medium">Kind</th>
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
                <td className="px-3 py-2 text-muted-foreground">{kindOf(p)}</td>
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
                    {!p.is_sandbox && (
                      <Button variant="outline" size="sm" onClick={() => setAccessPlan(p)}>
                        <KeyRound className="h-3.5 w-3.5" /> Access
                      </Button>
                    )}
                    {!p.is_sandbox && (
                      <Button variant="outline" size="sm" disabled={pending} onClick={() => toggleLock(p)}>
                        {p.is_locked ? <><LockOpen className="h-3.5 w-3.5" /> Unlock</> : <><Lock className="h-3.5 w-3.5" /> Lock</>}
                      </Button>
                    )}
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

      {accessPlan && (
        <AccessDialog plan={accessPlan} users={users} onClose={() => setAccessPlan(null)} />
      )}

      <Dialog
        open={newOpen}
        onClose={() => setNewOpen(false)}
        title="New official plan"
        description="Clones the current master into a new official plan you can then set access on and lock. Not a personal sandbox."
      >
        <div className="space-y-3">
          <label className="block text-sm">
            <span className="mb-1 block font-medium">Plan name</span>
            <Input value={newName} onChange={(e) => setNewName(e.target.value)} placeholder="e.g. FY26 DFCC approved" autoFocus />
          </label>
          {newErr && <p role="alert" className="rounded-md bg-destructive/10 px-3 py-2 text-sm text-destructive">{newErr}</p>}
          <div className="flex justify-end gap-2">
            <Button variant="outline" onClick={() => setNewOpen(false)}>Cancel</Button>
            <Button onClick={createOfficial} disabled={creating}>{creating ? 'Creating…' : 'Create plan'}</Button>
          </div>
        </div>
      </Dialog>
    </div>
  );
}

/** Per-plan access editor: for each non-admin user, which input tabs they may edit. */
function AccessDialog({ plan, users, onClose }: { plan: AdminPlan; users: AccessUser[]; onClose: () => void }) {
  const router = useRouter();
  // user_id -> Set of granted sections
  const [grants, setGrants] = useState<Record<string, Set<string>> | null>(null);
  const [saving, startSave] = useTransition();

  // Load current grants once, when the dialog opens for this plan.
  useEffect(() => {
    let cancelled = false;
    getPlanGrants(plan.id).then((res) => {
      if (cancelled) return;
      const map: Record<string, Set<string>> = {};
      for (const u of users) map[u.id] = new Set();
      for (const g of res.grants) (map[g.user_id] ??= new Set()).add(g.section);
      setGrants(map);
    });
    return () => { cancelled = true; };
  }, [plan.id, users]);

  function toggle(userId: string, section: string, on: boolean) {
    if (!grants) return;
    const cur = new Set(grants[userId] ?? []);
    if (on) cur.add(section); else cur.delete(section);
    setGrants({ ...grants, [userId]: cur });
    startSave(async () => {
      const res = await setPlanUserSections(plan.id, userId, [...cur]);
      if (res.error) { toast.error(res.error); }
      else { toast.success('Access updated.'); router.refresh(); }
    });
  }

  return (
    <Dialog
      open
      onClose={onClose}
      title={`Edit access — ${plan.name}`}
      description={plan.is_locked
        ? 'This plan is locked, so it’s read-only for everyone right now. Grants take effect once it’s unlocked.'
        : 'Tick the input tabs each person may edit on this plan. Admins always have full access.'}
    >
      {grants === null ? (
        <p className="text-sm text-muted-foreground">Loading…</p>
      ) : users.length === 0 ? (
        <p className="text-sm text-muted-foreground">No non-admin users to grant access to.</p>
      ) : (
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead className="text-muted-foreground">
              <tr>
                <th className="px-2 py-1.5 text-left font-medium">User</th>
                {PLAN_EDITABLE_SECTIONS.map((s) => (
                  <th key={s} className="px-2 py-1.5 text-center font-medium">{SECTION_LABEL[s]}</th>
                ))}
              </tr>
            </thead>
            <tbody>
              {users.map((u) => (
                <tr key={u.id} className="border-t">
                  <td className="px-2 py-1.5">{u.name}</td>
                  {PLAN_EDITABLE_SECTIONS.map((s) => (
                    <td key={s} className="px-2 py-1.5 text-center">
                      <input
                        type="checkbox"
                        checked={grants[u.id]?.has(s) ?? false}
                        disabled={saving}
                        onChange={(e) => toggle(u.id, s, e.target.checked)}
                        className="h-4 w-4 cursor-pointer accent-primary"
                        aria-label={`${u.name} — ${SECTION_LABEL[s]}`}
                      />
                    </td>
                  ))}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
      <div className="mt-4 flex justify-end">
        <Button variant="outline" onClick={onClose}>Done</Button>
      </div>
    </Dialog>
  );
}
