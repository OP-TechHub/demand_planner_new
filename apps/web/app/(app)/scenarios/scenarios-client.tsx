'use client';

import { useState, useTransition } from 'react';
import { useRouter } from 'next/navigation';
import { Plus } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Dialog } from '@/components/ui/dialog';
import { Input, Textarea } from '@/components/ui/input';
import { toast } from '@/components/ui/toast';
import { confirmDialog } from '@/components/ui/confirm';
import { createScenario, deleteScenario, renameScenario, setActivePlan } from '../plan-actions';

interface ScenarioRow { id: string; name: string; description: string; forked_at: string | null }

export function ScenariosClient({
  scenarios,
  activeId,
  hasMaster,
}: {
  scenarios: ScenarioRow[];
  activeId: string;
  hasMaster: boolean;
}) {
  const router = useRouter();
  const [creating, setCreating] = useState(false);
  const [renaming, setRenaming] = useState<ScenarioRow | null>(null);
  const [isPending, start] = useTransition();
  const [error, setError] = useState<string | null>(null);

  function open(id: string) {
    start(async () => { await setActivePlan(id); router.push('/home'); });
  }
  async function onDelete(s: ScenarioRow) {
    const ok = await confirmDialog({
      title: `Delete “${s.name}”?`,
      description: 'The scenario is archived and can be recovered within 90 days.',
      confirmLabel: 'Delete scenario',
      destructive: true,
    });
    if (!ok) return;
    setError(null);
    start(async () => {
      const res = await deleteScenario(s.id);
      if (res?.error) { setError(res.error); toast.error(res.error); }
      else { toast.success(`Deleted “${s.name}”`); router.refresh(); }
    });
  }

  return (
    <div className="mx-auto max-w-3xl space-y-4">
      <div className="flex items-center justify-between">
        <h1 className="text-2xl font-semibold tracking-tight">My Scenarios</h1>
        <Button onClick={() => { setError(null); setCreating(true); }} disabled={!hasMaster || scenarios.length >= 20}>
          <Plus />
          New Scenario
        </Button>
      </div>

      <p className="text-xs text-muted-foreground">
        A scenario is a full fork of the master plan you can edit freely — the master is never affected. {scenarios.length} of 20 used.
      </p>

      {error && !creating && (
        <p role="alert" className="rounded-md bg-destructive/10 px-3 py-2 text-sm text-destructive">{error}</p>
      )}

      <div className="overflow-x-auto rounded-lg border">
        <table className="w-full text-sm">
          <thead className="border-b bg-muted/50 text-left text-xs uppercase tracking-wide text-muted-foreground">
            <tr>
              <th className="px-3 py-2">Name</th>
              <th className="px-3 py-2">Created</th>
              <th className="px-3 py-2" />
            </tr>
          </thead>
          <tbody>
            {scenarios.map((s) => (
              <tr key={s.id} className="border-b last:border-0 hover:bg-muted/30">
                <td className="px-3 py-2">
                  <div className="font-medium">
                    {s.name}
                    {s.id === activeId && <Badge variant="success" className="ml-2">active</Badge>}
                  </div>
                  {s.description && <div className="text-xs text-muted-foreground">{s.description}</div>}
                </td>
                <td className="px-3 py-2 text-muted-foreground">{s.forked_at ? new Date(s.forked_at).toLocaleDateString() : '—'}</td>
                <td className="px-3 py-2">
                  <div className="flex justify-end gap-3">
                    <button onClick={() => open(s.id)} disabled={isPending} className="text-primary hover:underline">Open</button>
                    <button onClick={() => setRenaming(s)} disabled={isPending} className="text-muted-foreground hover:text-foreground">Rename</button>
                    <button onClick={() => onDelete(s)} disabled={isPending} className="text-muted-foreground hover:text-destructive">Delete</button>
                  </div>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
        {scenarios.length === 0 && (
          <div className="p-8 text-center text-sm text-muted-foreground">
            No scenarios yet. Fork the master plan to run a what-if.
          </div>
        )}
      </div>

      {creating && (
        <CreateModal
          onClose={() => setCreating(false)}
          onCreate={(name, description) => {
            setError(null);
            start(async () => {
              const res = await createScenario(name, description);
              if (res.error) setError(res.error);
              else { toast.success(`Created “${name.trim()}”`); setCreating(false); router.push('/home'); }
            });
          }}
          pending={isPending}
          error={error}
        />
      )}

      {renaming && (
        <RenameDialog
          scenario={renaming}
          pending={isPending}
          onClose={() => setRenaming(null)}
          onSubmit={(name) => {
            start(async () => {
              const res = await renameScenario(renaming.id, name);
              if (res?.error) toast.error(res.error);
              else { toast.success(`Renamed to “${name.trim()}”`); setRenaming(null); router.refresh(); }
            });
          }}
        />
      )}
    </div>
  );
}

function RenameDialog({
  scenario,
  pending,
  onClose,
  onSubmit,
}: {
  scenario: ScenarioRow;
  pending: boolean;
  onClose: () => void;
  onSubmit: (name: string) => void;
}) {
  const [name, setName] = useState(scenario.name);
  const unchanged = !name.trim() || name.trim() === scenario.name;
  return (
    <Dialog
      open
      onClose={onClose}
      title="Rename scenario"
      className="max-w-sm"
      footer={
        <>
          <Button variant="outline" onClick={onClose}>Cancel</Button>
          <Button onClick={() => onSubmit(name)} disabled={pending || unchanged}>
            {pending ? 'Saving…' : 'Save'}
          </Button>
        </>
      }
    >
      <Input
        value={name}
        onChange={(e) => setName(e.target.value)}
        autoFocus
        onKeyDown={(e) => { if (e.key === 'Enter' && !unchanged) onSubmit(name); }}
      />
    </Dialog>
  );
}

function CreateModal({
  onClose,
  onCreate,
  pending,
  error,
}: {
  onClose: () => void;
  onCreate: (name: string, description: string) => void;
  pending: boolean;
  error: string | null;
}) {
  const [name, setName] = useState('');
  const [description, setDescription] = useState('');
  return (
    <Dialog
      open
      onClose={onClose}
      title="New scenario"
      description="Forks the current master state (programs, demand, harvest, settings)."
      className="max-w-sm"
      footer={
        <>
          <Button variant="outline" onClick={onClose}>Cancel</Button>
          <Button onClick={() => onCreate(name, description)} disabled={pending || !name.trim()}>
            {pending ? 'Forking…' : 'Create'}
          </Button>
        </>
      }
    >
      <div className="space-y-3">
        <label className="block space-y-1.5">
          <span className="text-xs font-medium text-muted-foreground">Name</span>
          <Input value={name} onChange={(e) => setName(e.target.value)} placeholder='e.g. "Q4 uplift +20%"' autoFocus />
        </label>
        <label className="block space-y-1.5">
          <span className="text-xs font-medium text-muted-foreground">Description (optional)</span>
          <Textarea value={description} onChange={(e) => setDescription(e.target.value)} rows={2} />
        </label>
        {error && <p role="alert" className="rounded-md bg-destructive/10 px-3 py-2 text-sm text-destructive">{error}</p>}
      </div>
    </Dialog>
  );
}
