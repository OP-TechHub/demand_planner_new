import { Fragment } from 'react';
import { createClient } from '@/lib/supabase/server';
import { getActivePlan } from '@/lib/plan';
import { NotComputed } from '@/components/output-grid';
import { ExportCsvButton } from '@/components/export-csv-button';
import { kg, usd, pct } from '@/lib/format';

const PERIODS = [
  ['fy1', 'FY1'], ['fy2', 'FY2'], ['fy3', 'FY3'], ['fy4', 'FY4'], ['fy5', 'FY5'], ['total_60mo', 'Total'],
] as const;

type Fmt = (n: number | null) => string;
const METRICS: { label: string; key: string; fmt: Fmt; group?: string }[] = [
  { label: 'Demand FP', key: 'demand_fp', fmt: kg, group: 'Volume (kg)' },
  { label: 'Allocated FP', key: 'allocated_fp', fmt: kg },
  { label: 'Unallocated FP', key: 'unallocated_fp', fmt: kg },
  { label: 'Allocated WR', key: 'allocated_wr', fmt: kg },
  { label: 'Unallocated WR', key: 'unallocated_wr', fmt: kg },
  { label: 'Revenue', key: 'revenue', fmt: usd, group: 'Financials ($)' },
  { label: 'Cost', key: 'cost', fmt: usd },
  { label: 'Gross Margin', key: 'margin', fmt: usd },
  { label: 'GP %', key: 'gp_pct', fmt: pct },
  { label: 'Revenue Opportunity', key: 'revenue_opportunity', fmt: usd, group: 'If fully fulfilled' },
  { label: 'Cost Opportunity', key: 'cost_opportunity', fmt: usd },
  { label: 'Margin Opportunity', key: 'margin_opportunity', fmt: usd },
  { label: 'Margin Gap', key: 'margin_gap', fmt: usd },
];

export default async function AnnualSummaryPage() {
  const plan = await getActivePlan();
  if (!plan) return <NoPlan />;
  const supabase = await createClient();
  const { data: rows } = await supabase.from('plan_summary').select('*').eq('plan_id', plan.id);
  const byPeriod: Record<string, Record<string, number>> = {};
  for (const r of rows ?? []) byPeriod[r.period] = r;
  const csvRows: (string | number | null)[][] = [
    ['Metric', ...PERIODS.map(([, label]) => label)],
    ...METRICS.map((m) => [m.label, ...PERIODS.map(([p]) => byPeriod[p]?.[m.key] ?? null)]),
  ];

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <h1 className="text-2xl font-semibold tracking-tight">Annual Summary</h1>
        {rows && rows.length > 0 && <ExportCsvButton filename="annual-summary.csv" rows={csvRows} />}
      </div>
      {!rows || rows.length === 0 ? (
        <NotComputed />
      ) : (
        <div className="overflow-x-auto rounded-lg border">
          {(() => {
            return (
              <table className="w-full text-sm">
                <thead className="bg-muted/50 text-xs uppercase tracking-wide text-muted-foreground">
                  <tr>
                    <th className="px-3 py-2 text-left">Metric</th>
                    {PERIODS.map(([, label]) => <th key={label} className="px-3 py-2 text-right">{label}</th>)}
                  </tr>
                </thead>
                <tbody>
                  {METRICS.map((m) => (
                    <Fragment key={m.key}>
                      {m.group && (
                        <tr className="border-t bg-muted/30">
                          <td colSpan={7} className="px-3 py-1 text-xs font-semibold uppercase tracking-wide text-muted-foreground">{m.group}</td>
                        </tr>
                      )}
                      <tr className="border-t">
                        <td className="px-3 py-1.5">{m.label}</td>
                        {PERIODS.map(([p]) => (
                          <td key={p} className="px-3 py-1.5 text-right tabular-nums">{m.fmt(byPeriod[p]?.[m.key] ?? null)}</td>
                        ))}
                      </tr>
                    </Fragment>
                  ))}
                </tbody>
              </table>
            );
          })()}
        </div>
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
