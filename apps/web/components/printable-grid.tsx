'use client';

import { useState } from 'react';
import { ExportMenu } from '@/components/export-menu';
import { OutputGrid, type FmtKey, type GridRow } from '@/components/output-grid';

/**
 * A grid section with its Export menu (CSV / Excel / PDF) beside the heading.
 *
 * The month range lives inside OutputGrid, so the section follows it here (via
 * `onRangeChange`) and hands the same window to every export: what comes out
 * is the period on screen, not all sixty months.
 */
export function PrintableGrid({
  title,
  description,
  planName,
  planStartDate,
  horizon,
  rows,
  format = 'num0',
  firstColLabel,
  showColumnTotals = true,
  cellTitle,
  csvFilename,
}: {
  title: string;
  description?: React.ReactNode;
  planName: string;
  planStartDate: string;
  horizon: number;
  rows: GridRow[];
  format?: FmtKey;
  firstColLabel: string;
  showColumnTotals?: boolean;
  cellTitle?: Map<string, string>;
  /** Download name, without extension. */
  csvFilename: string;
}) {
  const [range, setRange] = useState({ from: 1, to: horizon });

  return (
    <section className="space-y-3">
      <div className="flex items-center justify-between gap-2">
        <h2 className="text-lg font-semibold">{title}</h2>
        <ExportMenu
          disabled={rows.length === 0}
          build={() => ({
            filename: csvFilename,
            title,
            subtitle: `${planName} · kg WR`,
            firstCol: firstColLabel,
            planStartDate,
            horizon,
            rows,
            range,
            format,
            rowTotals: true,
            // A TOTAL row under a single row only repeats it.
            columnTotals: showColumnTotals && rows.length > 1,
          })}
        />
      </div>
      {description && <p className="text-xs text-muted-foreground">{description}</p>}

      <OutputGrid
        planStartDate={planStartDate}
        horizon={horizon}
        rows={rows}
        format={format}
        firstColLabel={firstColLabel}
        showColumnTotals={showColumnTotals}
        cellTitle={cellTitle}
        onRangeChange={(from, to) => setRange((prev) => (prev.from === from && prev.to === to ? prev : { from, to }))}
      />
    </section>
  );
}
