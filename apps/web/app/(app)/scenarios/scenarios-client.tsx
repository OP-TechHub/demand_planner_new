'use client';

import { useState, useTransition } from 'react';
import { useRouter } from 'next/navigation';
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
  const [isPending, start] = useTransition();
  const [error, setError] = useState<string | null>(null);

  function open(id: string) {
    start(async () => { await setActivePlan(id); router.push('/home'); });
  }
  function onDelete(s: ScenarioRow) {
    if (!confirm(`Delete scenario "${s.name}"? It can be recovered within 90 days.`)) return;
    start(async () => { await deleteScenario(s.id); router.refresh(); });
  }
  function onRename(s: ScenarioRow) {
    const name = prompt('Rename scenario', s.name);
    if (!name || name.trim() === s.name) return;
    start(async () => { await renameScenario(s.id, name); router.refresh(); });
  }

  return (
    <div className="mx-auto max-w-3xl space-y-4">
      <div className="flex items-center justify-between">
        <h1 className="text-2xl font-semibold tracking-tight">My Scenarios</h1>
        <button
          onClick={() => { setError(null); setCreating(true); }}
          disabled={!hasMaster || scenarios.length >= 20}
          className="rounded-md bg-primary px-3 py-1.5 text-sm font-medium text-primary-foreground disabled:opacity-50"
        >
          + New Scenario
        </button>
      </div>

      <p className="text-xs text-muted-foreground">
        A scenario is a full fork of the master plan you can edit freely — the master is never affected. {scenarios.length} of 20 used.
      </p>

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
                    {s.id === activeId && <span className="ml-2 rounded-full bg-green-100 px-2 py-0.5 text-xs text-green-800">active</span>}
                  </div>
                  {s.description && <div className="text-xs text-muted-foreground">{s.description}</div>}
                </td>
                <td className="px-3 py-2 text-muted-foreground">{s.forked_at ? new Date(s.forked_at).toLocaleDateString() : '—'}</td>
                <td className="px-3 py-2">
                  <div className="flex justify-end gap-3">
                    <button onClick={() => open(s.id)} disabled={isPending} className="text-primary hover:underline">Open</button>
                    <button onClick={() => onRename(s)} disabled={isPending} className="text-muted-foreground hover:text-foreground">Rename</button>
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
              else { setCreating(false); router.push('/home'); }
            });
          }}
          pending={isPending}
          error={error}
        />
      )}
    </div>
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
    <div className="fixed inset-0 z-40 flex items-center justify-center bg-black/30 p-4" onClick={onClose}>
      <div className="w-full max-w-sm rounded-lg bg-card p-5 text-sm shadow-xl" onClick={(e) => e.stopPropagation()}>
        <h2 className="mb-3 text-sm font-semibold">New scenario</h2>
        <label className="block">
          <span className="text-xs font-medium text-muted-foreground">Name</span>
          <input value={name} onChange={(e) => setName(e.target.value)} placeholder='e.g. "Q4 uplift +20%"' className={inputCls} autoFocus />
        </label>
        <label className="mt-3 block">
          <span className="text-xs font-medium text-muted-foreground">Description (optional)</span>
          <textarea value={description} onChange={(e) => setDescription(e.target.value)} rows={2} className={inputCls} />
        </label>
        <p className="mt-2 text-xs text-muted-foreground">Forks the current master state (programs, demand, harvest, settings).</p>
        {error && <p role="alert" className="mt-2 rounded-md bg-red-50 px-3 py-2 text-red-700">{error}</p>}
        <div className="mt-4 flex justify-end gap-2">
          <button onClick={onClose} className="rounded-md border px-3 py-1.5 hover:bg-muted">Cancel</button>
          <button
            onClick={() => onCreate(name, description)}
            disabled={pending || !name.trim()}
            className="rounded-md bg-primary px-3 py-1.5 font-medium text-primary-foreground disabled:opacity-50"
          >
            {pending ? 'Forking…' : 'Create'}
          </button>
        </div>
      </div>
    </div>
  );
}

const inputCls = 'mt-1 w-full rounded-md border px-2.5 py-1.5 text-sm outline-none focus:ring-2 focus:ring-primary';
