import { Fragment } from 'react';
import { createClient } from '@/lib/supabase/server';
import { getActivePlan } from '@/lib/plan';
import { NotComputed } from '@/components/output-grid';
import { StalePlanNotice } from '../stale-banner';
import { ExportCsvButton } from '@/components/export-csv-button';
import {
  SUMMARY_METRICS, SUMMARY_PERIODS, bySummaryPeriod, summaryCell, withSideProducts,
} from '@/lib/annual-summary';
import { sideProductTotals } from '@/lib/side-products';

export default async function AnnualSummaryPage() {
  const plan = await getActivePlan();
  if (!plan) return <NoPlan />;
  const supabase = await createClient();
  // Secondary and other products sit outside `plan_summary` — the engine only
  // knows about programs — so they are added on read.
  const [{ data: rows }, side] = await Promise.all([
    supabase.from('plan_summary').select('*').eq('plan_id', plan.id),
    sideProductTotals(supabase, plan.id, plan.horizon_months),
  ]);
  const byPeriod = withSideProducts(bySummaryPeriod(rows), side);
  const csvRows: (string | number | null)[][] = [
    ['Metric', ...SUMMARY_PERIODS.map(([, label]) => label)],
    ...SUMMARY_METRICS.map((m) => [m.label, ...SUMMARY_PERIODS.map(([p]) => summaryCell(m, byPeriod, p))]),
  ];

  return (
    <div className="space-y-4">
      <StalePlanNotice planId={plan.id} lastComputedAt={plan.last_computed_at} />
      <div className="flex items-center justify-between">
        <h1 className="text-2xl font-semibold tracking-tight">Annual Summary</h1>
        {rows && rows.length > 0 && <ExportCsvButton filename="annual-summary.csv" rows={csvRows} />}
      </div>
      {!rows || rows.length === 0 ? (
        <NotComputed />
      ) : (
        <div className="overflow-x-auto rounded-lg border">
          <table className="w-full text-sm">
            <thead className="bg-muted/50 text-xs uppercase tracking-wide text-muted-foreground">
              <tr>
                <th className="px-3 py-2 text-left">Metric</th>
                {SUMMARY_PERIODS.map(([, label]) => <th key={label} className="px-3 py-2 text-right">{label}</th>)}
              </tr>
            </thead>
            <tbody>
              {SUMMARY_METRICS.map((m) => (
                <Fragment key={m.key}>
                  {m.group && (
                    <tr className="border-t bg-muted/30">
                      <td colSpan={SUMMARY_PERIODS.length + 1} className="px-3 py-1 text-xs font-semibold uppercase tracking-wide text-muted-foreground">{m.group}</td>
                    </tr>
                  )}
                  <tr className={m.strong ? 'border-t font-medium' : 'border-t'}>
                    <td className="px-3 py-1.5">{m.label}</td>
                    {SUMMARY_PERIODS.map(([p]) => (
                      <td key={p} className="px-3 py-1.5 text-right tabular-nums">{m.fmt(summaryCell(m, byPeriod, p))}</td>
                    ))}
                  </tr>
                </Fragment>
              ))}
            </tbody>
          </table>
        </div>
      )}
      {rows && rows.length > 0 && (
        <p className="text-xs text-muted-foreground">
          <b>Revenue (programs)</b>, <b>Cost (programs)</b>, <b>Gross Margin (programs)</b> and <b>GP % (programs)</b>{' '}
          cover the programs <b>only</b> — they do not include secondary or other products — and are the figures that
          reproduce the V30 workbook. Beneath them sit the rest of the business, taken from the{' '}
          <b>Secondary products</b> page: by-products recovered while processing (feedstock whole round × recovery rate
          × price), which carry no cost of their own, so every dollar they earn is a dollar of margin; and{' '}
          <b>other products</b> — traded lines outside the harvest plan — at their typed-in quantity × per-unit revenue
          and cost. The <b>Total</b> rows add all three together and are the plan&apos;s whole figure. Both are read
          live rather than stored with the computed results, so they are up to date without a Recalculate.
        </p>
      )}
    </div>
  );
}

function NoPlan() {
  return (
    <div className="rounded-lg border border-warning/30 bg-warning/10 p-5 text-sm">
      <p className="font-semibold text-warning">No master plan found</p>
    </div>
  );
}
