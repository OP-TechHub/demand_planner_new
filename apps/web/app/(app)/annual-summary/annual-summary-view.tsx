'use client';

import { Fragment, type ReactNode } from 'react';
import { NotComputed } from '@/components/output-grid';
import { ExportCsvButton } from '@/components/export-csv-button';
import {
  SUMMARY_METRICS, SUMMARY_PERIODS, summaryCell, type SummaryByPeriod,
} from '@/lib/annual-summary';

/** Everything the Annual Summary shows, shaped server-side — serializable, so the offline copy can hold it. */
export type AnnualSummaryViewProps = {
  /** period → row, side products already folded in (see lib/annual-summary). */
  byPeriod: SummaryByPeriod;
  /** False when the plan has never been computed — renders the empty state. */
  hasRows: boolean;
};

/**
 * The page's content, rendered purely from props. The table is static and the
 * CSV export builds in the browser, so both work identically on the saved
 * offline copy. `staleNotice` is the server-rendered freshness banner —
 * online only, never serialized.
 */
export function AnnualSummaryView({ byPeriod, hasRows, staleNotice }: AnnualSummaryViewProps & { staleNotice?: ReactNode }) {
  const csvRows: (string | number | null)[][] = [
    ['Metric', ...SUMMARY_PERIODS.map(([, label]) => label)],
    ...SUMMARY_METRICS.map((m) => [`${m.label} (${m.unit})`, ...SUMMARY_PERIODS.map(([p]) => summaryCell(m, byPeriod, p))]),
  ];

  return (
    <div className="space-y-4">
      {staleNotice}
      <div className="flex items-center justify-between">
        <h1 className="text-2xl font-semibold tracking-tight">Annual Summary</h1>
        {hasRows && <ExportCsvButton filename="annual-summary.csv" rows={csvRows} />}
      </div>
      {!hasRows ? (
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
                    <td className="px-3 py-1.5">{m.label} <span className="text-xs font-normal text-muted-foreground">({m.unit})</span></td>
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
      {hasRows && (
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
