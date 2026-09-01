import { createClient } from '@/lib/supabase/server';
import { getActivePlan, getSelectablePlans } from '@/lib/plan';
import { computeDiff, type FieldDiff, type CellDiff } from '@/lib/diff';
import { computeMonthlyCompare } from '@/lib/plan-compare';
import { monthLabel, type Plan } from '@oceanpick/shared';
import { ComparePicker, type PickPlan } from './compare-picker';
import { MonthlyCompare } from './monthly-compare';
import { AnnualCompare } from './annual-compare';
import { bySummaryPeriod, withSideProducts } from '@/lib/annual-summary';
import { sideProductTotals } from '@/lib/side-products';

/** Short kind label for a plan, for the picker. */
function kindOf(p: Plan): string {
  if (p.type === 'master') return 'Master';
  if (p.is_live) return 'Live';
  if (p.is_sandbox) return 'Sandbox';
  return 'Official';
}

export default async function DiffPage({ searchParams }: { searchParams: Promise<{ a?: string; b?: string }> }) {
  const sp = await searchParams;
  const [plans, active] = await Promise.all([getSelectablePlans(), getActivePlan()]);

  if (plans.length < 2) {
    return (
      <div className="mx-auto max-w-3xl space-y-4">
        <h1 className="text-2xl font-semibold tracking-tight">Compare plans</h1>
        <div className="rounded-lg border border-dashed bg-muted/30 p-8 text-sm text-muted-foreground">
          You need at least two plans to compare. Create a scenario or an official plan first.
        </div>
      </div>
    );
  }

  const master = plans.find((p) => p.type === 'master');
  // A defaults to the master; B defaults to the active plan (if it isn't A).
  const planA = plans.find((p) => p.id === sp.a) ?? master ?? plans[0];
  let planB =
    plans.find((p) => p.id === sp.b) ??
    (active && active.id !== planA.id ? active : undefined) ??
    plans.find((p) => p.id !== planA.id) ??
    plans[0];
  if (planB.id === planA.id) planB = plans.find((p) => p.id !== planA.id) ?? planB;

  const pick: PickPlan[] = plans.map((p) => ({ id: p.id, name: p.name, label: kindOf(p) }));

  const supabase = await createClient();
  const sameplan = planA.id === planB.id;
  // The by-product and other-product rows aren't in `plan_summary` — they're
  // computed on read, per plan: by-product revenue follows each plan's own
  // allocated whole round, while the other-product lines are org-wide and so
  // read the same on both sides.
  const [d, monthly, summaryA, summaryB, sideA, sideB] = await Promise.all([
    computeDiff(supabase, planA, planB),
    sameplan ? Promise.resolve(null) : computeMonthlyCompare(supabase, planA, planB),
    supabase.from('plan_summary').select('*').eq('plan_id', planA.id),
    supabase.from('plan_summary').select('*').eq('plan_id', planB.id),
    sideProductTotals(supabase, planA.id, planA.horizon_months),
    sideProductTotals(supabase, planB.id, planB.horizon_months),
  ]);
  // The annual figures only exist once a plan has been computed; a plan that
  // never was would otherwise read as a column of zeroes rather than as absent.
  const annualMissing = [
    !summaryA.data?.length ? planA.name : null,
    !summaryB.data?.length ? planB.name : null,
  ].filter(Boolean) as string[];
  // FY1 is the plan's own first year, so two plans that start in different
  // years line up column-by-column but not calendar-by-calendar.
  const annualYearsDiffer = planA.plan_start_date.slice(0, 7) !== planB.plan_start_date.slice(0, 7);
  const empty =
    !d.settings.length && !d.programs.length && !d.programsAdded.length && !d.programsRemoved.length &&
    !d.demand.length && !d.harvest.length;

  return (
    <div className="mx-auto max-w-6xl space-y-6">
      <div>
        <h1 className="text-2xl font-semibold tracking-tight">Compare plans</h1>
        <p className="mt-1 text-sm text-muted-foreground">
          Differences from <span className="font-medium text-foreground">{planA.name}</span> (A) to <span className="font-medium text-foreground">{planB.name}</span> (B).
        </p>
      </div>

      <ComparePicker plans={pick} a={planA.id} b={planB.id} />

      {planA.id === planB.id ? (
        <div className="rounded-lg border border-dashed bg-muted/30 p-8 text-sm text-muted-foreground">Pick two different plans to compare.</div>
      ) : (
        <>
          <Section title="Outputs summary">
            <table className="w-full text-sm">
              <thead className="text-xs uppercase tracking-wide text-muted-foreground">
                <tr><th className="py-1 text-left">Metric</th><th className="py-1 text-right">{planA.name}</th><th className="py-1 text-right">{planB.name}</th></tr>
              </thead>
              <tbody>
                {d.outputs.map((o) => (
                  <tr key={o.metric} className="border-t"><td className="py-1.5">{o.metric}</td><td className="py-1.5 text-right tabular-nums">{o.master}</td><td className="py-1.5 text-right font-medium tabular-nums">{o.scenario}</td></tr>
                ))}
              </tbody>
            </table>
          </Section>

          <Section title="Annual summary">
            {annualMissing.length === 2 ? (
              <p className="text-sm text-muted-foreground">
                Neither plan has computed results, so there are no annual figures to compare. Open each plan, hit{' '}
                <b>Recalculate</b>, then come back.
              </p>
            ) : (
              <div className="space-y-3">
                {annualMissing.length === 1 && (
                  <p className="rounded-md border border-warning/30 bg-warning/10 px-3 py-2 text-xs text-warning">
                    <b>{annualMissing[0]}</b> has no computed results, so its side reads as <b>—</b> throughout and every
                    change below is the whole of the other plan&apos;s figure. Open it, hit <b>Recalculate</b>, then come
                    back.
                  </p>
                )}
                {annualYearsDiffer && (
                  <p className="rounded-md border border-warning/30 bg-warning/10 px-3 py-2 text-xs text-warning">
                    These plans start in different months ({planA.plan_start_date.slice(0, 7)} and{' '}
                    {planB.plan_start_date.slice(0, 7)}), so <b>FY1 means a different year on each side</b>. The columns
                    line up each plan&apos;s own first year against the other&apos;s, not calendar year against calendar
                    year.
                  </p>
                )}
                <AnnualCompare
                  a={withSideProducts(bySummaryPeriod(summaryA.data), summaryA.data?.length ? sideA : null)}
                  b={withSideProducts(bySummaryPeriod(summaryB.data), summaryB.data?.length ? sideB : null)}
                  aName={planA.name}
                  bName={planB.name}
                />
                <p className="text-xs text-muted-foreground">
                  The same rows as the <b>Annual Summary</b> page, with <b>A</b> = {planA.name} and <b>B</b> ={' '}
                  {planB.name}, including the secondary and other-product rows and the <b>Total</b> that carries them.
                  By-product revenue follows each plan&apos;s own allocated whole round, so it moves with the plan;
                  other products are org-wide, so that row reads the same on both sides and never shows a change.{' '}
                  <b>Δ</b> is B − A, so a positive figure means B is higher; on the <b>GP %</b> rows it is a movement in
                  percentage points, and no <b>Δ %</b> is shown for them since a percentage of a percentage reads as
                  neither. <b>Δ %</b> is blank where A was zero — there is no percentage change from nothing.
                </p>
              </div>
            )}
          </Section>

          {monthly && (
            <Section title="Month on month">
              {monthly.tooWide ? (
                <p className="text-sm text-muted-foreground">
                  These two plans sit too far apart in time to lay out side by side. Compare plans whose windows are
                  closer together.
                </p>
              ) : (
                <div className="space-y-3">
                  {monthly.overlapMonths === 0 ? (
                    <p className="rounded-md border border-warning/30 bg-warning/10 px-3 py-2 text-xs text-warning">
                      These plans cover <b>no months in common</b> — {planA.name} ends before {planB.name} begins, or the
                      other way round. Every figure below is therefore one plan against nothing, not a like-for-like
                      change.
                    </p>
                  ) : monthly.windowsDiffer ? (
                    <p className="rounded-md border border-warning/30 bg-warning/10 px-3 py-2 text-xs text-warning">
                      These plans run on different windows, so the months are lined up by <b>calendar month</b>, not by
                      position. They overlap for {monthly.overlapMonths} month
                      {monthly.overlapMonths === 1 ? '' : 's'}; outside that a month belongs to only one plan and reads
                      as <b>—</b> on the other side.
                    </p>
                  ) : null}
                  {monthly.outputsMissing && (
                    <p className="rounded-md border border-warning/30 bg-warning/10 px-3 py-2 text-xs text-warning">
                      Only <b>Harvest</b> and <b>Demand</b> can be compared — one of these plans has no computed results,
                      so there is no revenue, cost or margin to put beside the other. Open it, hit <b>Recalculate</b>,
                      then come back.
                    </p>
                  )}
                  <MonthlyCompare data={monthly} aName={planA.name} bName={planB.name} />
                  <p className="text-xs text-muted-foreground">
                    <b>Change</b> is B − A, so a positive figure means B is higher; <b>Change %</b> is that against
                    A&apos;s figure, blank where A was zero (there is no percentage change from nothing), and its totals
                    are re-derived as total change ÷ total baseline rather than summed, since percentages don&apos;t add.
                    Programs are matched on <b>item code</b> and buckets on identity, both of which survive a fork — a
                    program in only one plan is marked as such and shows its whole figure as the change.
                  </p>
                </div>
              )}
            </Section>
          )}

          {empty ? (
            <div className="rounded-lg border border-dashed bg-muted/30 p-6 text-sm text-muted-foreground">
              No input differences between these two plans (programs, demand, harvest, settings).
            </div>
          ) : (
            <>
              {d.settings.length > 0 && (
                <Section title="Plan settings"><FieldTable rows={d.settings} aLabel={planA.name} bLabel={planB.name} /></Section>
              )}

              {(d.programs.length > 0 || d.programsAdded.length > 0 || d.programsRemoved.length > 0) && (
                <Section title="Programs">
                  {d.programs.map((p) => (
                    <div key={p.item_code} className="border-t py-2 first:border-t-0">
                      <div className="font-medium">{p.name} <span className="text-muted-foreground">({p.item_code})</span></div>
                      <FieldTable rows={p.changes} indent />
                    </div>
                  ))}
                  {d.programsAdded.length > 0 && <p className="pt-2 text-sm text-green-700">Only in B: {d.programsAdded.join(', ')}</p>}
                  {d.programsRemoved.length > 0 && <p className="text-sm text-red-700">Only in A: {d.programsRemoved.join(', ')}</p>}
                </Section>
              )}

              {d.demand.length > 0 && (
                <Section title={`Demand differences (${d.demand.length}${d.demandMore ? '+' + d.demandMore + ' more' : ''})`}>
                  <CellTable rows={d.demand} startDate={planB.plan_start_date} />
                </Section>
              )}

              {d.harvest.length > 0 && (
                <Section title={`Harvest differences (${d.harvest.length}${d.harvestMore ? '+' + d.harvestMore + ' more' : ''})`}>
                  <CellTable rows={d.harvest} startDate={planB.plan_start_date} />
                </Section>
              )}
            </>
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

function FieldTable({ rows, indent, aLabel, bLabel }: { rows: FieldDiff[]; indent?: boolean; aLabel?: string; bLabel?: string }) {
  return (
    <div className={indent ? 'pl-4 text-sm' : 'text-sm'}>
      {(aLabel || bLabel) && (
        <div className="flex gap-2 pb-1 text-xs uppercase tracking-wide text-muted-foreground">
          <span className="w-32" /><span>{aLabel}</span><span className="w-4" /><span>{bLabel}</span>
        </div>
      )}
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
