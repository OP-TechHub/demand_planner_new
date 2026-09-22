'use client';

import { useEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { ChevronDown, Download, FileSpreadsheet, FileText, Loader2, Printer } from 'lucide-react';
import { monthLabel } from '@oceanpick/shared';
import { Button } from '@/components/ui/button';
import { Dialog } from '@/components/ui/dialog';
import { kg, usd, usd0, usd2, num0, pct } from '@/lib/format';
import {
  columnTotal,
  downloadGridCsv,
  downloadGridXlsx,
  emptyRows,
  exportMonths,
  withoutEmptyRows,
  grandTotal,
  parseSplit,
  rangeText,
  rowLabel,
  rowTotal,
  type GridExport,
} from '@/lib/grid-export';

const FMT = { kg, usd, usd0, usd2, num0, pct } as const;

type Kind = 'csv' | 'xlsx' | 'pdf';

/**
 * Export a grid as CSV, Excel or PDF. `build` is called at the moment of export,
 * so what comes out is whatever the grid shows then — its months, its rows.
 *
 * PDF goes through the browser's print dialog ("Save as PDF"): the sheet below
 * is rendered only while printing, and the print CSS reveals it alone.
 */
export function ExportMenu({ build, disabled }: { build: () => GridExport; disabled?: boolean }) {
  const [open, setOpen] = useState(false);
  const [busy, setBusy] = useState(false);
  const [printing, setPrinting] = useState<GridExport | null>(null);
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!open) return;
    const close = (e: MouseEvent) => {
      if (!ref.current?.contains(e.target as Node)) setOpen(false);
    };
    const esc = (e: KeyboardEvent) => e.key === 'Escape' && setOpen(false);
    document.addEventListener('mousedown', close);
    document.addEventListener('keydown', esc);
    return () => {
      document.removeEventListener('mousedown', close);
      document.removeEventListener('keydown', esc);
    };
  }, [open]);

  // The sheet has to be painted before the print dialog reads the page, and the
  // document title is what the browser offers as the PDF's file name.
  useEffect(() => {
    if (!printing) return;
    const title0 = document.title;
    document.title = printing.filename;
    const done = () => setPrinting(null);
    window.addEventListener('afterprint', done);
    const t = window.setTimeout(() => window.print(), 60);
    return () => {
      window.clearTimeout(t);
      window.removeEventListener('afterprint', done);
      document.title = title0;
    };
  }, [printing]);

  // Set while asking whether to leave out rows with nothing in the period.
  const [asking, setAsking] = useState<{ kind: Kind; g: GridExport; empty: string[] } | null>(null);

  const run = (kind: Kind) => {
    setOpen(false);
    const g = build();
    const empty = emptyRows(g);
    // Only a real choice when some rows have figures: if none do, leaving the
    // rest out would produce an empty file.
    if (empty.length > 0 && empty.length < g.rows.length) {
      setAsking({ kind, g, empty: empty.map(rowLabel) });
      return;
    }
    void finish(kind, g);
  };

  const finish = async (kind: Kind, g: GridExport) => {
    if (kind === 'csv') return downloadGridCsv(g);
    if (kind === 'pdf') return setPrinting(g);
    setBusy(true);
    try {
      await downloadGridXlsx(g);
    } finally {
      setBusy(false);
    }
  };

  return (
    <div ref={ref} className="relative">
      <Button variant="outline" size="sm" disabled={disabled || busy} onClick={() => setOpen((o) => !o)} aria-expanded={open}>
        {busy ? <Loader2 className="animate-spin" /> : <Download />}
        Export
        <ChevronDown />
      </Button>
      {open && (
        <div className="absolute right-0 z-30 mt-1 w-48 overflow-hidden rounded-md border border-border bg-card py-1 text-sm shadow-lg">
          <MenuItem icon={<FileText />} label="CSV" hint="Plain numbers" onClick={() => run('csv')} />
          <MenuItem icon={<FileSpreadsheet />} label="Excel" hint="With colours" onClick={() => run('xlsx')} />
          <MenuItem icon={<Printer />} label="PDF" hint="Print → Save as PDF" onClick={() => run('pdf')} />
        </div>
      )}
      {/* Portalled to <body>: the print CSS positions the sheet at the page's
          top-left, which only works with no positioned ancestor in between. */}
      {printing && createPortal(<PrintSheet g={printing} />, document.body)}
      {asking && createPortal(
        <Dialog
          open
          onClose={() => setAsking(null)}
          title={`${asking.empty.length} of ${asking.g.rows.length} rows have no figures in this period`}
          className="max-w-md"
          footer={
            <>
              <Button variant="outline" onClick={() => { const a = asking; setAsking(null); void finish(a.kind, a.g); }}>
                Keep all rows
              </Button>
              <Button onClick={() => { const a = asking; setAsking(null); void finish(a.kind, withoutEmptyRows(a.g)); }}>
                Leave them out
              </Button>
            </>
          }
        >
          <p className="text-sm text-muted-foreground">
            Every month from {rangeText(asking.g)} is zero or blank for these rows. Leave them out of the export?
          </p>
          <ul className="mt-3 max-h-40 space-y-0.5 overflow-y-auto rounded-md border border-border bg-muted/40 px-3 py-2 text-xs">
            {asking.empty.slice(0, 50).map((name, i) => <li key={i} className="truncate">{name}</li>)}
            {asking.empty.length > 50 && <li className="text-muted-foreground">… and {asking.empty.length - 50} more</li>}
          </ul>
        </Dialog>,
        document.body
      )}
    </div>
  );
}

function MenuItem({ icon, label, hint, onClick }: { icon: React.ReactNode; label: string; hint: string; onClick: () => void }) {
  return (
    <button
      type="button"
      onClick={onClick}
      className="flex w-full items-center gap-2 px-3 py-1.5 text-left hover:bg-muted [&_svg]:h-4 [&_svg]:w-4 [&_svg]:text-muted-foreground"
    >
      {icon}
      <span className="font-medium">{label}</span>
      <span className="ml-auto text-[11px] text-muted-foreground">{hint}</span>
    </button>
  );
}

/** The printed copy: title, legend and table, coloured as on screen. */
function PrintSheet({ g }: { g: GridExport }) {
  const months = exportMonths(g);
  const fmt = FMT[g.format];
  const extra = g.extraCols ?? [];
  const rowTotals = g.rowTotals ?? true;
  // Sixty columns only fit a landscape page in a smaller face.
  const fontSize = months.length > 24 ? '6pt' : months.length > 12 ? '7pt' : '8pt';

  return (
    <div className="print-sheet hidden print:block">
      {/* Months across a page only fit the long way round. Scoped to this
          sheet's lifetime, so the costing sheets keep portrait. */}
      <style>{'@page { size: landscape; margin: 10mm; }'}</style>
      <h1 style={{ fontSize: '14pt', fontWeight: 600, margin: 0 }}>{g.title}</h1>
      <p style={{ fontSize: '9pt', margin: '2mm 0 3mm' }}>{[g.subtitle, rangeText(g)].filter(Boolean).join(' · ')}</p>
      {!!g.legend?.length && (
        <div style={{ display: 'flex', flexWrap: 'wrap', gap: '4mm', fontSize: '8pt', margin: '0 0 3mm' }}>
          {g.legend.map((l) => (
            <span key={l.label} style={{ display: 'inline-flex', alignItems: 'center', gap: '1.5mm' }}>
              <span style={{ display: 'inline-block', width: '4mm', height: '3mm', border: '1px solid #999', background: l.bg }} />
              {l.label}
            </span>
          ))}
        </div>
      )}
      <table style={{ width: '100%', borderCollapse: 'collapse', fontSize }}>
        <thead>
          <tr>
            <th style={{ ...th, textAlign: 'left' }}>{g.firstCol}</th>
            {extra.map((c) => <th key={c} style={{ ...th, textAlign: 'left' }}>{c}</th>)}
            {months.map((m) => <th key={m} style={th}>{monthLabel(g.planStartDate, m)}</th>)}
            {rowTotals && <th style={{ ...th, fontWeight: 700 }}>Total</th>}
          </tr>
        </thead>
        <tbody>
          {g.rows.map((r) => (
            <tr key={r.key}>
              <td style={{ ...td, textAlign: 'left', whiteSpace: 'nowrap' }}>{rowLabel(r)}</td>
              {extra.map((c, i) => <td key={c} style={{ ...td, textAlign: 'left' }}>{r.extra?.[i] ?? ''}</td>)}
              {months.map((m) => {
                const s = g.cellStyle?.(r, m);
                return (
                  <td key={m} style={{ ...td, ...cellCss(s?.bg), ...(s?.fg ? { color: s.fg } : {}) }}>
                    {fmt(r.values[m - 1] ?? null)}
                  </td>
                );
              })}
              {rowTotals && <td style={{ ...td, fontWeight: 700 }}>{fmt(rowTotal(g, r, months))}</td>}
            </tr>
          ))}
          {g.columnTotals && (
            <tr>
              <td style={{ ...td, textAlign: 'left', fontWeight: 700 }}>TOTAL</td>
              {extra.map((c) => <td key={c} style={td} />)}
              {months.map((m) => <td key={m} style={{ ...td, fontWeight: 700 }}>{fmt(columnTotal(g, m))}</td>)}
              {rowTotals && <td style={{ ...td, fontWeight: 700 }}>{fmt(grandTotal(g, months))}</td>}
            </tr>
          )}
        </tbody>
      </table>
      <p style={{ fontSize: '7pt', marginTop: '4mm' }}>
        Printed {new Date().toLocaleDateString()} · figures as last computed.
      </p>
    </div>
  );
}

/** A cell background for print: a hex as-is, a two-tone split as a hard-edged gradient. */
function cellCss(bg: string | undefined): React.CSSProperties {
  if (!bg) return {};
  const split = parseSplit(bg);
  return split ? { backgroundImage: bg } : { background: bg };
}

const th: React.CSSProperties = { border: '1px solid #999', padding: '1mm 1.5mm', textAlign: 'right', background: '#eee', whiteSpace: 'nowrap' };
const td: React.CSSProperties = { border: '1px solid #bbb', padding: '0.8mm 1.5mm', textAlign: 'right' };
