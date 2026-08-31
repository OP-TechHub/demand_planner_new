'use client';

import { useEffect, useRef, useState, useTransition } from 'react';
import { useRouter } from 'next/navigation';
import { Plus, CalendarPlus } from 'lucide-react';
import { cn } from '@/lib/utils';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Dialog } from '@/components/ui/dialog';
import { Input, Textarea } from '@/components/ui/input';
import { Select } from '@/components/ui/select';
import { toast } from '@/components/ui/toast';
import { confirmDialog } from '@/components/ui/confirm';
import { createScenario, createPlan, deleteScenario, listPlanPrograms, renameScenario, setActivePlan } from '../plan-actions';

interface ScenarioRow { id: string; name: string; description: string; forked_at: string | null }

/** One row of the New plan dialog's program picker, as returned by `listPlanPrograms`. */
interface PickProgram { id: string; item_code: string; item_description: string; customer: string }

/** A plan a new scenario can be forked from. */
export interface ForkSource {
  id: string;
  name: string;
  /** 'master' and 'official' are the org's shared plans; 'mine' is the caller's own sandbox. */
  kind: 'master' | 'official' | 'mine';
  isLive: boolean;
  horizonMonths: number;
  planStartDate: string;
}

export function ScenariosClient({
  scenarios,
  activeId,
  hasMaster,
  canCreate,
  yearsAhead,
  forkSources,
}: {
  scenarios: ScenarioRow[];
  activeId: string;
  hasMaster: boolean;
  canCreate: boolean;
  yearsAhead: number;
  forkSources: ForkSource[];
}) {
  const router = useRouter();
  // Both open the same dialog; `creating` starts it at the default source,
  // while the row's Duplicate button pre-selects that scenario.
  const [creating, setCreating] = useState(false);
  const [duplicating, setDuplicating] = useState<ScenarioRow | null>(null);
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
        Both start from a plan you can see — the master, an official plan, or one of your own scenarios — so you can
        branch off work you&apos;ve already done instead of starting from the master each time. <b>New Plan</b> takes that
        plan&apos;s programs and settings but a start and length you choose. <b>New Scenario</b> is a full what-if copy,
        window and all. <b>Duplicate</b> on a row is a scenario with that row pre-picked. Whatever you base on is never
        affected.{' '}
        {scenarios.length} of 20 used.
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
                    <button
                      onClick={() => { setError(null); setDuplicating(s); }}
                      disabled={isPending || !canCreate || scenarios.length >= 20}
                      className="text-muted-foreground hover:text-foreground disabled:opacity-50"
                    >
                      Duplicate
                    </button>
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
          sources={forkSources}
          activeId={activeId}
          yearsAhead={yearsAhead}
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

      {(creating || duplicating) && (
        <CreateModal
          key={duplicating?.id ?? 'new'}
          sources={forkSources}
          activeId={activeId}
          initialSourceId={duplicating?.id}
          initialName={duplicating ? `${duplicating.name} (copy)` : ''}
          onClose={() => { setCreating(false); setDuplicating(null); }}
          onCreate={(name, description, sourcePlanId) => {
            setError(null);
            start(async () => {
              const res = await createScenario(name, description, { sourcePlanId });
              if (res.error) setError(res.error);
              else {
                toast.success(`Created “${name.trim()}”`);
                setCreating(false);
                setDuplicating(null);
                router.push('/home');
              }
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

/**
 * Which plan a dialog should start on: an explicit pick (a row's Duplicate),
 * else whatever you're looking at — you reach for "New scenario"/"New plan"
 * while working in a plan far more often than from a standing start — else the
 * org's live plan, then the master.
 */
function pickDefaultSource(sources: ForkSource[], activeId: string, preferred?: string): string {
  return (
    sources.find((s) => s.id === preferred)?.id ??
    sources.find((s) => s.id === activeId)?.id ??
    sources.find((s) => s.isLive)?.id ??
    sources.find((s) => s.kind === 'master')?.id ??
    sources[0]?.id ??
    ''
  );
}

/** The grouped "Copy from" / "Base on" picker shared by New scenario and New plan. */
function SourceSelect({
  sources,
  value,
  onChange,
  label,
}: {
  sources: ForkSource[];
  value: string;
  onChange: (id: string) => void;
  label: string;
}) {
  const shared = sources.filter((s) => s.kind !== 'mine');
  const mine = sources.filter((s) => s.kind === 'mine');
  return (
    <label className="block space-y-1.5">
      <span className="text-xs font-medium text-muted-foreground">{label}</span>
      <Select value={value} onChange={(e) => onChange(e.target.value)}>
        {shared.length > 0 && (
          <optgroup label="Plans">
            {shared.map((s) => (
              <option key={s.id} value={s.id}>
                {s.name}
                {s.kind === 'master' ? ' (master)' : ''}
                {s.isLive ? ' — live' : ''}
              </option>
            ))}
          </optgroup>
        )}
        {mine.length > 0 && (
          <optgroup label="My scenarios">
            {mine.map((s) => (
              <option key={s.id} value={s.id}>{s.name}</option>
            ))}
          </optgroup>
        )}
      </Select>
    </label>
  );
}

/** 'Apr 2026 · 12 months' — the window a fork would inherit from its source. */
function windowOf(s: ForkSource): string {
  const d = new Date(`${s.planStartDate}T00:00:00`);
  const start = Number.isNaN(d.getTime())
    ? s.planStartDate
    : d.toLocaleDateString(undefined, { month: 'short', year: 'numeric' });
  return `${start} · ${s.horizonMonths} month${s.horizonMonths === 1 ? '' : 's'}`;
}

function CreateModal({
  sources,
  activeId,
  initialSourceId,
  initialName = '',
  onClose,
  onCreate,
  pending,
  error,
}: {
  sources: ForkSource[];
  activeId: string;
  /** Pre-selected source — set when the dialog was opened by a row's Duplicate. */
  initialSourceId?: string;
  initialName?: string;
  onClose: () => void;
  onCreate: (name: string, description: string, sourcePlanId: string) => void;
  pending: boolean;
  error: string | null;
}) {
  const [sourceId, setSourceId] = useState(() => pickDefaultSource(sources, activeId, initialSourceId));
  const [name, setName] = useState(initialName);
  const [description, setDescription] = useState('');
  const source = sources.find((s) => s.id === sourceId);

  return (
    <Dialog
      open
      onClose={onClose}
      title="New scenario"
      description="A full what-if copy — programs, demand, harvest, POs and settings. The plan you copy is never affected."
      className="max-w-sm"
      footer={
        <>
          <Button variant="outline" onClick={onClose}>Cancel</Button>
          <Button onClick={() => onCreate(name, description, sourceId)} disabled={pending || !name.trim() || !sourceId}>
            {pending ? 'Forking…' : 'Create'}
          </Button>
        </>
      }
    >
      <div className="space-y-3">
        <div className="space-y-1.5">
          <SourceSelect sources={sources} value={sourceId} onChange={setSourceId} label="Copy from" />
          {source && (
            <span className="block text-xs text-muted-foreground">
              Inherits its window: {windowOf(source)}.
            </span>
          )}
        </div>
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

function fyStartOptions(yearsAhead: number): { value: string; label: string }[] {
  const now = new Date();
  // Financial year starts in April; before April we're still in the prior FY.
  const base = now.getMonth() >= 3 ? now.getFullYear() : now.getFullYear() - 1;
  const out: { value: string; label: string }[] = [];
  // One prior FY through `yearsAhead` years ahead (admin-configurable).
  for (let y = base - 1; y <= base + Math.max(1, yearsAhead); y++) {
    out.push({ value: `${y}-04-01`, label: `FY ${y}/${String(y + 1).slice(2)} · Apr ${y} – Mar ${y + 1}` });
  }
  return out;
}

/** Inclusive month count between two 'YYYY-MM' values; 0 if invalid or end < start. */
function monthsBetween(startYM: string, endYM: string): number {
  const s = /^(\d{4})-(\d{2})$/.exec(startYM);
  const e = /^(\d{4})-(\d{2})$/.exec(endYM);
  if (!s || !e) return 0;
  const diff = (Number(e[1]) - Number(s[1])) * 12 + (Number(e[2]) - Number(s[2])) + 1;
  return diff >= 1 ? diff : 0;
}

/** Add n months to a 'YYYY-MM' value, returning 'YYYY-MM'. */
function addMonthsYM(ym: string, n: number): string {
  const m = /^(\d{4})-(\d{2})$/.exec(ym);
  if (!m) return '';
  const total = Number(m[1]) * 12 + (Number(m[2]) - 1) + n;
  const y = Math.floor(total / 12);
  const mo = (total % 12) + 1;
  return `${y}-${String(mo).padStart(2, '0')}`;
}

function NewPlanModal({
  sources,
  activeId,
  yearsAhead,
  pending,
  error,
  onClose,
  onCreate,
}: {
  sources: ForkSource[];
  activeId: string;
  yearsAhead: number;
  pending: boolean;
  error: string | null;
  onClose: () => void;
  onCreate: (input: { name: string; planStartDate: string; horizonMonths: number; programIds: string[]; copyData: boolean; sourcePlanId: string }) => void;
}) {
  const options = fyStartOptions(yearsAhead);
  const [name, setName] = useState('');
  const [sourceId, setSourceId] = useState(() => pickDefaultSource(sources, activeId));
  const source = sources.find((s) => s.id === sourceId);
  const [startMode, setStartMode] = useState<'fy' | 'custom'>('fy');
  const [fyStart, setFyStart] = useState(options[1]?.value ?? options[0]?.value ?? '');
  const [customMonth, setCustomMonth] = useState(''); // 'YYYY-MM'
  const startDate = startMode === 'fy' ? fyStart : customMonth ? `${customMonth}-01` : '';
  const startYM = startDate ? startDate.slice(0, 7) : '';
  // Default to a 12-month plan (end = start + 11 months).
  const [endMonth, setEndMonth] = useState<string>(() => addMonthsYM((options[1]?.value ?? '').slice(0, 7), 11));
  const horizon = monthsBetween(startYM, endMonth);
  const [programs, setPrograms] = useState<PickProgram[]>([]);
  const [loadingPrograms, setLoadingPrograms] = useState(sources.length > 0);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [copyData, setCopyData] = useState(false);

  // The program list belongs to the source plan, so it is fetched when the
  // dialog opens and again whenever you switch source. Plans already seen this
  // session are served from the cache so flicking between them stays instant;
  // switching always re-selects everything, since a half-kept selection from
  // the previous plan would be meaningless here.
  const cache = useRef(new Map<string, PickProgram[]>());
  useEffect(() => {
    if (!sourceId) { setPrograms([]); setSelected(new Set()); setLoadingPrograms(false); return; }
    const hit = cache.current.get(sourceId);
    if (hit) {
      setPrograms(hit);
      setSelected(new Set(hit.map((p) => p.id)));
      setLoadError(null);
      setLoadingPrograms(false);
      return;
    }
    let cancelled = false;
    setLoadingPrograms(true);
    setLoadError(null);
    listPlanPrograms(sourceId).then((res) => {
      if (cancelled) return;
      setLoadingPrograms(false);
      if (res.error) { setLoadError(res.error); setPrograms([]); setSelected(new Set()); return; }
      cache.current.set(sourceId, res.programs);
      setPrograms(res.programs);
      setSelected(new Set(res.programs.map((p) => p.id)));
    });
    return () => { cancelled = true; };
  }, [sourceId]);

  const toggle = (id: string) =>
    setSelected((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });

  const disabled = pending || loadingPrograms || !name.trim() || !startDate || horizon < 1 || horizon > 60 || selected.size === 0 || !sourceId;

  return (
    <Dialog
      open
      onClose={onClose}
      title="New plan"
      description="Create a plan of any length (up to 60 months), based on any plan you can see and the programs you choose."
      footer={
        <>
          <Button variant="outline" onClick={onClose}>Cancel</Button>
          <Button
            onClick={() => onCreate({ name, planStartDate: startDate, horizonMonths: horizon, programIds: [...selected], copyData, sourcePlanId: sourceId })}
            disabled={disabled}
          >
            {pending ? 'Creating…' : 'Create plan'}
          </Button>
        </>
      }
    >
      <div className="space-y-4">
        <div className="space-y-1.5">
          <SourceSelect sources={sources} value={sourceId} onChange={setSourceId} label="Base on" />
          <span className="block text-xs text-muted-foreground">
            Its programs and settings seed the new plan. You pick your own start and length below — unlike New
            scenario, the window is not inherited. {source?.name ? <>&ldquo;{source.name}&rdquo; is never affected.</> : null}
          </span>
        </div>

        <div className="grid gap-3 sm:grid-cols-2">
          <label className="block space-y-1.5">
            <span className="text-xs font-medium text-muted-foreground">Plan name</span>
            <Input value={name} onChange={(e) => setName(e.target.value)} placeholder='e.g. "FY 2027 Plan"' autoFocus />
          </label>
          <div className="space-y-1.5">
            <div className="flex items-center justify-between">
              <span className="text-xs font-medium text-muted-foreground">Plan start</span>
              <div className="inline-flex rounded-md border border-border bg-card p-0.5">
                <button
                  type="button"
                  onClick={() => setStartMode('fy')}
                  className={cn('rounded px-2 py-0.5 text-xs font-medium transition-colors', startMode === 'fy' ? 'bg-primary text-primary-foreground' : 'text-muted-foreground hover:text-foreground')}
                >
                  Financial year
                </button>
                <button
                  type="button"
                  onClick={() => setStartMode('custom')}
                  className={cn('rounded px-2 py-0.5 text-xs font-medium transition-colors', startMode === 'custom' ? 'bg-primary text-primary-foreground' : 'text-muted-foreground hover:text-foreground')}
                >
                  Custom month
                </button>
              </div>
            </div>
            {startMode === 'fy' ? (
              <Select value={fyStart} onChange={(e) => setFyStart(e.target.value)}>
                {options.map((o) => <option key={o.value} value={o.value}>{o.label}</option>)}
              </Select>
            ) : (
              <Input type="month" value={customMonth} onChange={(e) => setCustomMonth(e.target.value)} />
            )}
          </div>
        </div>

        <div className="grid gap-3 sm:grid-cols-2">
          <label className="block space-y-1.5">
            <span className="text-xs font-medium text-muted-foreground">End month (last month of the plan)</span>
            <Input type="month" value={endMonth} onChange={(e) => setEndMonth(e.target.value)} />
          </label>
          <div className="flex items-end pb-2 text-sm">
            {horizon >= 1 && horizon <= 60 ? (
              <span className="text-muted-foreground">
                Plan length: <span className="font-medium text-foreground">{horizon} month{horizon === 1 ? '' : 's'}</span>
                {horizon >= 12 && <> (~{(horizon / 12).toFixed(horizon % 12 === 0 ? 0 : 1)} yr)</>}
              </span>
            ) : (
              <span className="text-destructive">
                {startYM && endMonth ? 'End must be on/after the start, within 60 months.' : 'Pick an end month.'}
              </span>
            )}
          </div>
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
          {loadingPrograms ? (
            <p className="rounded-md border border-dashed border-border p-3 text-xs text-muted-foreground">
              Loading programs…
            </p>
          ) : loadError ? (
            <p role="alert" className="rounded-md bg-destructive/10 px-3 py-2 text-xs text-destructive">
              Could not load programs: {loadError}
            </p>
          ) : programs.length === 0 ? (
            <p className="rounded-md border border-dashed border-border p-3 text-xs text-muted-foreground">
              {source?.name ? `“${source.name}” has` : 'This plan has'} no programs yet. Pick another plan to base
              this on, or add programs there first.
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
          Also copy demand overrides, POs &amp; harvest capacity from {source?.name ? `“${source.name}”` : 'the source plan'}
        </label>
        <p className="text-xs text-muted-foreground">
          Off = programs come in with their baseline demand and empty harvest, ready to plan the new year from scratch.
          On = months past the new plan&apos;s length are dropped.
        </p>

        {error && <p role="alert" className="rounded-md bg-destructive/10 px-3 py-2 text-sm text-destructive">{error}</p>}
      </div>
    </Dialog>
  );
}
