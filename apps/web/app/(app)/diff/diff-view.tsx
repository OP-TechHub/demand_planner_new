'use client';

import { monthLabel } from '@oceanpick/shared';
import type { FieldDiff, CellDiff, DiffResult } from '@/lib/diff';
import type { MonthlyCompare as MonthlyCompareData } from '@/lib/plan-compare';
import type { SummaryByPeriod } from '@/lib/annual-summary';
import { ComparePicker, type PickPlan } from './compare-picker';
import { MonthlyCompare } from './monthly-compare';
import { AnnualCompare } from './annual-compare';

/**
 * Everything one comparison shows, shaped server-side — serializable, so the
 * offline copy can hold the last comparison viewed online.
 */
export type DiffViewProps = {
  plans: PickPlan[];
  aId: string;
  bId: string;
  aName: string;
  bName: string;
  /** plan_start_date of each side, for month labels and the FY warning. */
  aStart: string;
  bStart: string;
  d: DiffResult;
  monthly: MonthlyCompareData | null;
  /** Annual figures per side, side products folded in; `{}` when never computed. */
  annualA: SummaryByPeriod;
  annualB: SummaryByPeriod;
  /** Names of the plans (0–2 of them) that have no computed results. */
  annualMissing: string[];
  annualYearsDiffer: boolean;
  /**
   * The offline copy holds ONE comparison — the one last viewed online — so
   * the plan pickers (which navigate, i.e. need the server) are hidden.
   */
  offline?: boolean;
};

export function DiffView({
  plans, aId, bId, aName, bName, aStart, bStart,
  d, monthly, annualA, annualB, annualMissing, annualYearsDiffer, offline,
}: DiffViewProps) {
  const empty =
    !d.settings.length && !d.programs.length && !d.programsAdded.length && !d.programsRemoved.length &&
    !d.demand.length && !d.harvest.length;

  return (
    <div className="mx-auto max-w-6xl space-y-6">
      <div>
        <h1 className="text-2xl font-semibold tracking-tight">Compare plans</h1>
        <p className="mt-1 text-sm text-muted-foreground">
          Differences from <span className="font-medium text-foreground">{aName}</span> (A) to <span className="font-medium text-foreground">{bName}</span> (B).
        </p>
      </div>

      {!offline && <ComparePicker plans={plans} a={aId} b={bId} />}

      {aId === bId ? (
        <div className="rounded-lg border border-dashed bg-muted/30 p-8 text-sm text-muted-foreground">Pick two different plans to compare.</div>
      ) : (
        <>
          <Section title="Outputs summary">
            <table className="w-full text-sm">
              <thead className="text-xs uppercase tracking-wide text-muted-foreground">
                <tr><th className="py-1 text-left">Metric</th><th className="py-1 text-right">{aName}</th><th className="py-1 text-right">{bName}</th></tr>
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
                    These plans start in different months ({aStart.slice(0, 7)} and{' '}
                    {bStart.slice(0, 7)}), so <b>FY1 means a different year on each side</b>. The columns
                    line up each plan&apos;s own first year against the other&apos;s, not calendar year against calendar
                    year.
                  </p>
                )}
                <AnnualCompare
                  a={annualA}
                  b={annualB}
                  aName={aName}
                  bName={bName}
                />
                <p className="text-xs text-muted-foreground">
                  The same rows as the <b>Annual Summary</b> page, with <b>A</b> = {aName} and <b>B</b> ={' '}
                  {bName}, including the secondary and other-product rows and the <b>Total</b> that carries them.
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
                      These plans cover <b>no months in common</b> — {aName} ends before {bName} begins, or the
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
                  <MonthlyCompare data={monthly} aName={aName} bName={bName} />
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
                <Section title="Plan settings"><FieldTable rows={d.settings} aLabel={aName} bLabel={bName} /></Section>
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
                  <CellTable rows={d.demand} startDate={bStart} />
                </Section>
              )}

              {d.harvest.length > 0 && (
                <Section title={`Harvest differences (${d.harvest.length}${d.harvestMore ? '+' + d.harvestMore + ' more' : ''})`}>
                  <CellTable rows={d.harvest} startDate={bStart} />
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
