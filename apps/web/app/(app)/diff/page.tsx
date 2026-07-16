import { createClient } from '@/lib/supabase/server';
import { getActivePlan, getSelectablePlans } from '@/lib/plan';
import { computeDiff, type FieldDiff, type CellDiff } from '@/lib/diff';
import { monthLabel } from '@oceanpick/shared';

export default async function DiffPage() {
  const active = await getActivePlan();
  if (!active) return <h1 className="text-2xl font-semibold">Compare to master</h1>;
  if (active.type !== 'scenario') {
    return (
      <div className="mx-auto max-w-3xl space-y-4">
        <h1 className="text-2xl font-semibold tracking-tight">Compare to master</h1>
        <div className="rounded-lg border border-dashed bg-muted/30 p-8 text-sm text-muted-foreground">
          You&apos;re viewing the <b>master</b> plan. Switch to a scenario (top-bar selector) to compare it against master.
        </div>
      </div>
    );
  }

  const plans = await getSelectablePlans();
  const master = plans.find((p) => p.type === 'master');
  if (!master) return <div className="text-sm text-muted-foreground">No master plan.</div>;

  const supabase = await createClient();
  const d = await computeDiff(supabase, master, active);
  const empty =
    !d.settings.length && !d.programs.length && !d.programsAdded.length && !d.programsRemoved.length &&
    !d.demand.length && !d.harvest.length;

  return (
    <div className="mx-auto max-w-3xl space-y-6">
      <div>
        <h1 className="text-2xl font-semibold tracking-tight">Compare to master</h1>
        <p className="mt-1 text-sm text-muted-foreground">Scenario <span className="font-medium">{active.name}</span> vs. Master Plan.</p>
      </div>

      <Section title="Outputs summary">
        <table className="w-full text-sm">
          <thead className="text-xs uppercase tracking-wide text-muted-foreground">
            <tr><th className="py-1 text-left">Metric</th><th className="py-1 text-right">Master</th><th className="py-1 text-right">Scenario</th></tr>
          </thead>
          <tbody>
            {d.outputs.map((o) => (
              <tr key={o.metric} className="border-t"><td className="py-1.5">{o.metric}</td><td className="py-1.5 text-right tabular-nums">{o.master}</td><td className="py-1.5 text-right font-medium tabular-nums">{o.scenario}</td></tr>
            ))}
          </tbody>
        </table>
      </Section>

      {empty ? (
        <div className="rounded-lg border border-dashed bg-muted/30 p-6 text-sm text-muted-foreground">
          No input differences from master yet. Edit the scenario&apos;s programs, demand, harvest, or settings, then come back.
        </div>
      ) : (
        <>
          {d.settings.length > 0 && (
            <Section title="Plan settings"><FieldTable rows={d.settings} /></Section>
          )}

          {(d.programs.length > 0 || d.programsAdded.length > 0 || d.programsRemoved.length > 0) && (
            <Section title="Programs">
              {d.programs.map((p) => (
                <div key={p.item_code} className="border-t py-2 first:border-t-0">
                  <div className="font-medium">{p.name} <span className="text-muted-foreground">({p.item_code})</span></div>
                  <FieldTable rows={p.changes} indent />
                </div>
              ))}
              {d.programsAdded.length > 0 && <p className="pt-2 text-sm text-green-700">Added: {d.programsAdded.join(', ')}</p>}
              {d.programsRemoved.length > 0 && <p className="text-sm text-red-700">Removed: {d.programsRemoved.join(', ')}</p>}
            </Section>
          )}

          {d.demand.length > 0 && (
            <Section title={`Demand overrides (${d.demand.length}${d.demandMore ? '+' + d.demandMore + ' more' : ''})`}>
              <CellTable rows={d.demand} startDate={active.plan_start_date} />
            </Section>
          )}

          {d.harvest.length > 0 && (
            <Section title={`Harvest changes (${d.harvest.length}${d.harvestMore ? '+' + d.harvestMore + ' more' : ''})`}>
              <CellTable rows={d.harvest} startDate={active.plan_start_date} />
            </Section>
          )}
        </>
      )}
    </div>
  );
}

function Section({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <div className="rounded-lg border bg-card p-5">
      <h2 className="mb-2 text-sm font-semibold">{title}</h2>
      {children}
    </div>
  );
}

function FieldTable({ rows, indent }: { rows: FieldDiff[]; indent?: boolean }) {
  return (
    <div className={indent ? 'pl-4 text-sm' : 'text-sm'}>
      {rows.map((r, i) => (
        <div key={i} className="flex gap-2 py-0.5">
          <span className="w-32 text-muted-foreground">{r.label}</span>
          <span className="tabular-nums">{r.master}</span>
          <span className="text-muted-foreground">→</span>
          <span className="font-medium tabular-nums">{r.scenario}</span>
        </div>
      ))}
    </div>
  );
}

function CellTable({ rows, startDate }: { rows: CellDiff[]; startDate: string }) {
  return (
    <table className="w-full text-sm">
      <tbody>
        {rows.map((r, i) => (
          <tr key={i} className="border-t first:border-t-0">
            <td className="py-1">{r.label}</td>
            <td className="py-1 text-muted-foreground">{monthLabel(startDate, r.month)}</td>
            <td className="py-1 text-right tabular-nums">{r.master.toLocaleString()}</td>
            <td className="py-1 text-center text-muted-foreground">→</td>
            <td className="py-1 text-right font-medium tabular-nums">{r.scenario.toLocaleString()}</td>
          </tr>
        ))}
      </tbody>
    </table>
  );
}
