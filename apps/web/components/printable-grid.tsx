'use client';

import { useEffect, useState } from 'react';
import { Printer } from 'lucide-react';
import { monthLabel } from '@oceanpick/shared';
import { Button } from '@/components/ui/button';
import { ExportCsvButton } from '@/components/export-csv-button';
import { OutputGrid, type FmtKey, type GridRow } from '@/components/output-grid';
import { kg, usd, usd0, usd2, num0, pct } from '@/lib/format';

const FMT = { kg, usd, usd0, usd2, num0, pct } as const;

/**
 * A grid section with a printable copy of itself.
 *
 * The month range lives inside OutputGrid, so the section owns it here (via
 * `onRangeChange`) and hands the same window to the print sheet: what comes out
 * as PDF is the period on screen, not all sixty months squeezed onto a page.
 *
 * The sheet is only in the DOM while printing. Two of these on one page would
 * otherwise both be revealed by the print rules and come out as one document.
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
  csvRows,
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
  csvFilename: string;
  csvRows: (string | number | null)[][];
}) {
  const [range, setRange] = useState({ from: 1, to: horizon });
  const [printing, setPrinting] = useState(false);

  // The sheet has to be painted before the print dialog reads the page, and the
  // document title is what the browser offers as the PDF's filename.
  useEffect(() => {
    if (!printing) return;
    const title0 = document.title;
    document.title = `${title} — ${monthLabel(planStartDate, range.from)} to ${monthLabel(planStartDate, range.to)}`;
    const done = () => setPrinting(false);
    window.addEventListener('afterprint', done);
    const t = window.setTimeout(() => window.print(), 60);
    return () => {
      window.clearTimeout(t);
      window.removeEventListener('afterprint', done);
      document.title = title0;
    };
  }, [printing, title, planStartDate, range.from, range.to]);

  const months: number[] = [];
  for (let m = range.from; m <= range.to; m++) months.push(m);
  const fmt = FMT[format];
  const rowTotal = (r: GridRow) => months.reduce((s, m) => s + (r.values[m - 1] ?? 0), 0);
  const colTotal = (m: number) => rows.reduce((s, r) => s + (r.values[m - 1] ?? 0), 0);
  const grandTotal = rows.reduce((s, r) => s + rowTotal(r), 0);
  const rangeLabel =
    range.from === 1 && range.to === horizon
      ? `${horizon} months (${monthLabel(planStartDate, 1)} – ${monthLabel(planStartDate, horizon)})`
      : `${monthLabel(planStartDate, range.from)} – ${monthLabel(planStartDate, range.to)} (${months.length} month${months.length === 1 ? '' : 's'})`;

  return (
    <section className="space-y-3">
      <div className="flex items-center justify-between gap-2">
        <h2 className="text-lg font-semibold">{title}</h2>
        <div className="flex items-center gap-2">
          <Button variant="outline" size="sm" onClick={() => setPrinting(true)} disabled={printing}>
            <Printer />
            {printing ? 'Preparing…' : 'Print / PDF'}
          </Button>
          <ExportCsvButton filename={csvFilename} rows={csvRows} />
        </div>
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
        onRangeChange={(from, to) => setRange({ from, to })}
      />

      {printing && (
        <div className="print-sheet hidden print:block">
          {/* Months across a page only fit the long way round. Scoped to this
              sheet's lifetime, so the costing sheets keep portrait. */}
          <style>{'@page { size: landscape; margin: 12mm; }'}</style>
          <h1 style={{ fontSize: '14pt', fontWeight: 600, margin: 0 }}>{title}</h1>
          <p style={{ fontSize: '9pt', margin: '2mm 0 4mm' }}>
            {planName} · {rangeLabel} · kg WR
          </p>
          <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: '8pt' }}>
            <thead>
              <tr>
                <th style={{ ...th, textAlign: 'left' }}>{firstColLabel}</th>
                {months.map((m) => <th key={m} style={th}>{monthLabel(planStartDate, m)}</th>)}
                <th style={{ ...th, fontWeight: 700 }}>Total</th>
              </tr>
            </thead>
            <tbody>
              {rows.map((r) => (
                <tr key={r.key}>
                  <td style={{ ...td, textAlign: 'left', whiteSpace: 'nowrap' }}>
                    {r.label}{r.sublabel ? ` — ${r.sublabel}` : ''}
                  </td>
                  {months.map((m) => <td key={m} style={td}>{fmt(r.values[m - 1] ?? null)}</td>)}
                  <td style={{ ...td, fontWeight: 700 }}>{fmt(rowTotal(r))}</td>
                </tr>
              ))}
              {showColumnTotals && rows.length > 1 && (
                <tr>
                  <td style={{ ...td, textAlign: 'left', fontWeight: 700 }}>Total</td>
                  {months.map((m) => <td key={m} style={{ ...td, fontWeight: 700 }}>{fmt(colTotal(m))}</td>)}
                  <td style={{ ...td, fontWeight: 700 }}>{fmt(grandTotal)}</td>
                </tr>
              )}
            </tbody>
          </table>
          <p style={{ fontSize: '7pt', marginTop: '4mm' }}>
            Printed {new Date().toLocaleDateString()} · figures as last computed.
          </p>
        </div>
      )}
    </section>
  );
}

const th: React.CSSProperties = {
  border: '1px solid #999',
  padding: '1.5mm 1mm',
  textAlign: 'right',
  background: '#eee',
  fontWeight: 600,
  whiteSpace: 'nowrap',
};
const td: React.CSSProperties = {
  border: '1px solid #ccc',
  padding: '1.2mm 1mm',
  textAlign: 'right',
  whiteSpace: 'nowrap',
};
