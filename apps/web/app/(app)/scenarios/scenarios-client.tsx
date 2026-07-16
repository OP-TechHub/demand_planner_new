'use client';

import { useState, useTransition } from 'react';
import { useRouter } from 'next/navigation';
import { Plus, CalendarPlus } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Dialog } from '@/components/ui/dialog';
import { Input, Textarea } from '@/components/ui/input';
import { Select } from '@/components/ui/select';
import { toast } from '@/components/ui/toast';
import { confirmDialog } from '@/components/ui/confirm';
import { createScenario, createPlan, deleteScenario, renameScenario, setActivePlan } from '../plan-actions';

interface ScenarioRow { id: string; name: string; description: string; forked_at: string | null }
export interface PickProgram { id: string; item_code: string; item_description: string; customer: string }

export function ScenariosClient({
  scenarios,
  activeId,
  hasMaster,
  canCreate,
  programs,
}: {
  scenarios: ScenarioRow[];
  activeId: string;
  hasMaster: boolean;
  canCreate: boolean;
  programs: PickProgram[];
}) {
  const router = useRouter();
  const [creating, setCreating] = useState(false);
  const [planning, setPlanning] = useState(false);
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
        <h1 className="text-2xl font-semibold tracking-tight">My Plans</h1>
        <div className="flex items-center gap-2">
          <Button variant="outline" onClick={() => { setError(null); setCreating(true); }} disabled={!canCreate || !hasMaster || scenarios.length >= 20}>
            <Plus />
            New Scenario
          </Button>
          <Button onClick={() => { setError(null); setPlanning(true); }} disabled={!canCreate || !hasMaster || scenarios.length >= 20}>
            <CalendarPlus />
            New Plan
          </Button>
        </div>
      </div>

      {!canCreate && (
        <p className="rounded-md border border-warning/30 bg-warning/10 px-3 py-2 text-xs text-warning">
          You have view-only access. Ask an admin for a Planner or Contributor role to create plans.
        </p>
      )}

      <p className="text-xs text-muted-foreground">
        <b>New Plan</b> starts a fresh plan for a financial year with the programs you choose. <b>New Scenario</b> is a full what-if fork of the master. Either way the master is never affected. {scenarios.length} of 20 used.
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
            No plans yet. Create a plan for a financial year, or fork a scenario to run a what-if.
          </div>
        )}
      </div>

      {planning && (
        <NewPlanModal
          programs={programs}
          pending={isPending}
          error={error}
          onClose={() => setPlanning(false)}
          onCreate={(input) => {
            setError(null);
            start(async () => {
              const res = await createPlan(input);
              if (res.error) setError(res.error);
              else { toast.success(`Created “${input.name.trim()}”`); setPlanning(false); router.push('/home'); }
            });
          }}
        />
      )}

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

function fyStartOptions(): { value: string; label: string }[] {
  const now = new Date();
  // Financial year starts in April; before April we're still in the prior FY.
  const base = now.getMonth() >= 3 ? now.getFullYear() : now.getFullYear() - 1;
  const out: { value: string; label: string }[] = [];
  // One prior FY through ten years ahead.
  for (let y = base - 1; y <= base + 10; y++) {
    out.push({ value: `${y}-04-01`, label: `FY ${y}/${String(y + 1).slice(2)} · Apr ${y} – Mar ${y + 1}` });
  }
  return out;
}

function NewPlanModal({
  programs,
  pending,
  error,
  onClose,
  onCreate,
}: {
  programs: PickProgram[];
  pending: boolean;
  error: string | null;
  onClose: () => void;
  onCreate: (input: { name: string; planStartDate: string; programIds: string[]; copyData: boolean }) => void;
}) {
  const options = fyStartOptions();
  const [name, setName] = useState('');
  const [startDate, setStartDate] = useState(options[1]?.value ?? options[0]?.value ?? '');
  const [selected, setSelected] = useState<Set<string>>(new Set(programs.map((p) => p.id)));
  const [copyData, setCopyData] = useState(false);

  const toggle = (id: string) =>
    setSelected((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });

  const disabled = pending || !name.trim() || selected.size === 0;

  return (
    <Dialog
      open
      onClose={onClose}
      title="New plan"
      description="Start a fresh plan for a financial year with the programs you choose."
      footer={
        <>
          <Button variant="outline" onClick={onClose}>Cancel</Button>
          <Button
            onClick={() => onCreate({ name, planStartDate: startDate, programIds: [...selected], copyData })}
            disabled={disabled}
          >
            {pending ? 'Creating…' : 'Create plan'}
          </Button>
        </>
      }
    >
      <div className="space-y-4">
        <div className="grid gap-3 sm:grid-cols-2">
          <label className="block space-y-1.5">
            <span className="text-xs font-medium text-muted-foreground">Plan name</span>
            <Input value={name} onChange={(e) => setName(e.target.value)} placeholder='e.g. "FY 2027 Plan"' autoFocus />
          </label>
          <label className="block space-y-1.5">
            <span className="text-xs font-medium text-muted-foreground">Financial year (starts April)</span>
            <Select value={startDate} onChange={(e) => setStartDate(e.target.value)}>
              {options.map((o) => <option key={o.value} value={o.value}>{o.label}</option>)}
            </Select>
          </label>
        </div>

        <div>
          <div className="mb-1.5 flex items-center justify-between">
            <span className="text-xs font-medium text-muted-foreground">
              Programs to include ({selected.size}/{programs.length})
            </span>
            <div className="flex gap-3 text-xs">
              <button type="button" className="text-primary hover:underline" onClick={() => setSelected(new Set(programs.map((p) => p.id)))}>All</button>
              <button type="button" className="text-muted-foreground hover:text-foreground" onClick={() => setSelected(new Set())}>None</button>
            </div>
          </div>
          {programs.length === 0 ? (
            <p className="rounded-md border border-dashed border-border p-3 text-xs text-muted-foreground">
              The master plan has no programs yet. Add programs first.
            </p>
          ) : (
            <div className="max-h-56 space-y-0.5 overflow-y-auto rounded-md border border-border p-1">
              {programs.map((p) => (
                <label key={p.id} className="flex cursor-pointer items-center gap-2 rounded px-2 py-1.5 text-sm hover:bg-muted">
                  <input type="checkbox" checked={selected.has(p.id)} onChange={() => toggle(p.id)} />
                  <span className="min-w-0 flex-1 truncate">
                    <span className="font-medium">{p.customer}</span>{' '}
                    <span className="text-muted-foreground">{p.item_description || p.item_code}</span>
                  </span>
                </label>
              ))}
            </div>
          )}
        </div>

        <label className="flex items-center gap-2 text-sm">
          <input type="checkbox" checked={copyData} onChange={(e) => setCopyData(e.target.checked)} />
          Also copy demand overrides &amp; harvest capacity from master
        </label>
        <p className="text-xs text-muted-foreground">
          Off = programs come in with their baseline demand and empty harvest, ready to plan the new year from scratch.
        </p>

        {error && <p role="alert" className="rounded-md bg-destructive/10 px-3 py-2 text-sm text-destructive">{error}</p>}
      </div>
    </Dialog>
  );
}
