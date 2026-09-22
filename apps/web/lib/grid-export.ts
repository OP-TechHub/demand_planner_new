// Grid exports — CSV, Excel and the print (PDF) sheet — from one description.
//
// A grid describes itself once as a GridExport: the rows, the months on screen,
// how its figures are formatted, and how a cell is coloured. Every format is
// then built from that, so a CSV, a spreadsheet and a PDF of the same grid can
// never disagree about which months or which totals they carry.
//
// Colours come through as CSS colours: a hex fill, or the two-tone split the
// inquiry-fulfilment grid uses (`linear-gradient(90deg, A 0 s%, B s% 100%)`).
// CSV is plain text and cannot carry them; Excel and the print sheet do.
import { monthLabel } from '@oceanpick/shared';
import { gridCsvRows, weightedTotal, type Aggregate, type GridRow } from '@/lib/grid-csv';
import { toCsv, downloadCsv } from '@/lib/csv';

export type ExportFmt = 'kg' | 'usd' | 'usd0' | 'usd2' | 'num0' | 'pct';

/** A cell's colours, as CSS. `bg` may be a hex or a two-tone split gradient. */
export type CellStyle = { bg?: string; fg?: string };

/** One legend entry: what a colour means. */
export type LegendItem = { label: string; bg: string; fg?: string };

export interface GridExport {
  /** File name without extension, e.g. "program-fulfilment". */
  filename: string;
  title: string;
  /** Plan name, unit, anything else worth a line under the title. The month range is added automatically. */
  subtitle?: string;
  firstCol: string;
  extraCols?: string[];
  planStartDate: string;
  horizon: number;
  rows: GridRow[];
  range: { from: number; to: number };
  format: ExportFmt;
  aggregate?: Aggregate;
  /** A Total column per row. */
  rowTotals?: boolean;
  /** A TOTAL row per month. */
  columnTotals?: boolean;
  cellStyle?: (row: GridRow, month: number) => CellStyle | null;
  legend?: LegendItem[];
}

// --- Shared shape ------------------------------------------------------------

export function exportMonths(g: GridExport): number[] {
  const from = Math.max(1, g.range.from);
  const to = Math.min(g.horizon, g.range.to);
  return Array.from({ length: Math.max(0, to - from + 1) }, (_, i) => from + i);
}

export function rangeText(g: GridExport): string {
  const months = exportMonths(g);
  if (!months.length) return '';
  const first = monthLabel(g.planStartDate, months[0]!);
  const last = monthLabel(g.planStartDate, months[months.length - 1]!);
  return `${first} – ${last} (${months.length} month${months.length === 1 ? '' : 's'})`;
}

export const rowLabel = (r: GridRow) => (r.sublabel ? `${r.label} — ${r.sublabel}` : r.label);

/** A row's total over the exported months, aggregated as the grid does. */
export function rowTotal(g: GridExport, r: GridRow, months: number[]): number | null {
  if (g.aggregate === 'ratio') return weightedTotal(r, months);
  return months.reduce((s, mo) => s + (r.values[mo - 1] ?? 0), 0);
}

/** A month's figure across every row: summed, or for a rate re-derived from its weights. */
export function columnTotal(g: GridExport, month: number): number | null {
  if (g.aggregate !== 'ratio') return g.rows.reduce((s, r) => s + (r.values[month - 1] ?? 0), 0);
  let num = 0;
  let den = 0;
  for (const r of g.rows) {
    const w = r.weights?.[month - 1] ?? 0;
    if (!w) continue;
    num += (r.values[month - 1] ?? 0) * w;
    den += w;
  }
  return den > 0 ? num / den : null;
}

/** Every row over every exported month, aggregated once. */
export function grandTotal(g: GridExport, months: number[]): number | null {
  if (g.aggregate !== 'ratio') return g.rows.reduce((s, r) => s + (rowTotal(g, r, months) ?? 0), 0);
  let num = 0;
  let den = 0;
  for (const r of g.rows) {
    for (const mo of months) {
      const w = r.weights?.[mo - 1] ?? 0;
      if (!w) continue;
      num += (r.values[mo - 1] ?? 0) * w;
      den += w;
    }
  }
  return den > 0 ? num / den : null;
}

/**
 * Rows with nothing in the exported months: every value zero or blank. Judged
 * cell by cell, not by the total, so a row whose months cancel out (+5, −5 on
 * a change view) still counts as having figures.
 *
 * For a rate grid a row must also carry no weight — a $0.00 rate on real kilos
 * is a figure, and dropping it would shift the weighted column averages.
 */
export function emptyRows(g: GridExport): GridRow[] {
  const months = exportMonths(g);
  const blank = (v: number | null | undefined) => v == null || v === 0;
  return g.rows.filter((r) =>
    months.every((mo) => blank(r.values[mo - 1]) && (g.aggregate !== 'ratio' || blank(r.weights?.[mo - 1])))
  );
}

/** The export with its empty rows left out, and a note saying so on the Excel and PDF copies. */
export function withoutEmptyRows(g: GridExport): GridExport {
  const drop = new Set(emptyRows(g).map((r) => r.key));
  if (!drop.size) return g;
  const note = `${drop.size} row${drop.size === 1 ? '' : 's'} with no figures in this period left out`;
  return {
    ...g,
    rows: g.rows.filter((r) => !drop.has(r.key)),
    subtitle: [g.subtitle, note].filter(Boolean).join(' · '),
  };
}

/** A two-tone split `linear-gradient(90deg, A 0 s%, B s% 100%)`, or null for anything else. */
export function parseSplit(bg: string): { a: string; b: string; at: number } | null {
  const m = /^linear-gradient\(90deg,\s*(#[0-9a-f]{6})\s+0\s+(\d+(?:\.\d+)?)%,\s*(#[0-9a-f]{6})\s+\d+(?:\.\d+)?%\s+100%\)$/i.exec(bg.trim());
  return m ? { a: m[1]!, at: Number(m[2]) / 100, b: m[3]! } : null;
}

// --- CSV ---------------------------------------------------------------------

export function downloadGridCsv(g: GridExport) {
  const matrix = gridCsvRows(
    g.firstCol,
    g.planStartDate,
    g.horizon,
    g.rows,
    g.rowTotals ?? true,
    g.extraCols ?? [],
    g.aggregate ?? 'sum',
    g.range
  );
  downloadCsv(`${g.filename}.csv`, toCsv(matrix));
}

// --- Excel -------------------------------------------------------------------

/** Excel number formats matching the on-screen formatters. kg is exported in full, not as "12k". */
const XL_FMT: Record<ExportFmt, string> = {
  kg: '#,##0',
  num0: '#,##0',
  usd: '"$"#,##0',
  usd0: '"$"#,##0',
  usd2: '"$"#,##0.00',
  pct: '0.0%',
};

const argb = (hex: string) => 'FF' + hex.replace('#', '').toUpperCase();

/** An ExcelJS fill for a CSS background, or undefined when it can't be expressed. */
function xlFill(bg: string | undefined): object | undefined {
  if (!bg) return undefined;
  if (/^#[0-9a-f]{6}$/i.test(bg)) return { type: 'pattern', pattern: 'solid', fgColor: { argb: argb(bg) } };
  const split = parseSplit(bg);
  if (!split) return undefined;
  if (split.at >= 1) return xlFill(split.a);
  if (split.at <= 0) return xlFill(split.b);
  // Two stops at the same position give Excel a hard edge rather than a blend.
  return {
    type: 'gradient',
    gradient: 'angle',
    degree: 0,
    stops: [
      { position: 0, color: { argb: argb(split.a) } },
      { position: split.at, color: { argb: argb(split.a) } },
      { position: split.at, color: { argb: argb(split.b) } },
      { position: 1, color: { argb: argb(split.b) } },
    ],
  };
}

export async function downloadGridXlsx(g: GridExport) {
  // Loaded on demand: the spreadsheet library is large and only needed on click.
  const ExcelJS = (await import('exceljs')).default;
  const wb = new ExcelJS.Workbook();
  const ws = wb.addWorksheet(g.title.slice(0, 31).replace(/[\\/?*[\]:]/g, '-'));

  const months = exportMonths(g);
  const extra = g.extraCols ?? [];
  const rowTotals = g.rowTotals ?? true;
  const numFmt = XL_FMT[g.format];
  const lead = 1 + extra.length; // label + descriptive columns

  ws.addRow([g.title]).font = { bold: true, size: 14 };
  ws.addRow([[g.subtitle, rangeText(g)].filter(Boolean).join(' · ')]).font = { color: { argb: 'FF555555' } };

  if (g.legend?.length) {
    for (const item of g.legend) {
      const r = ws.addRow(['', item.label]);
      const swatch = r.getCell(1);
      const fill = xlFill(item.bg);
      if (fill) swatch.fill = fill as never;
      swatch.border = thin;
    }
  }
  ws.addRow([]);

  const header = ws.addRow([
    g.firstCol,
    ...extra,
    ...months.map((mo) => monthLabel(g.planStartDate, mo)),
    ...(rowTotals ? ['Total'] : []),
  ]);
  header.font = { bold: true };
  header.eachCell((c) => {
    c.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FFF1F5F9' } };
    c.border = thin;
    c.alignment = { horizontal: Number(c.col) > lead ? 'right' : 'left', vertical: 'middle' };
  });
  const headerRowNo = header.number;

  for (const r of g.rows) {
    const values = months.map((mo) => r.values[mo - 1] ?? null);
    const row = ws.addRow([
      rowLabel(r),
      ...extra.map((_, i) => r.extra?.[i] ?? ''),
      ...values,
      ...(rowTotals ? [rowTotal(g, r, months)] : []),
    ]);
    row.eachCell({ includeEmpty: true }, (c) => {
      c.border = thin;
      if (Number(c.col) > lead) c.numFmt = numFmt;
    });
    months.forEach((mo, i) => {
      const style = g.cellStyle?.(r, mo);
      if (!style) return;
      const c = row.getCell(lead + 1 + i);
      const fill = xlFill(style.bg);
      if (fill) c.fill = fill as never;
      if (style.fg && /^#[0-9a-f]{6}$/i.test(style.fg)) c.font = { color: { argb: argb(style.fg) } };
    });
    if (rowTotals) row.getCell(lead + months.length + 1).font = { bold: true };
  }

  if (g.columnTotals) {
    const row = ws.addRow([
      'TOTAL',
      ...extra.map(() => ''),
      ...months.map((mo) => columnTotal(g, mo)),
      ...(rowTotals ? [grandTotal(g, months)] : []),
    ]);
    row.font = { bold: true };
    row.eachCell({ includeEmpty: true }, (c) => {
      c.border = thin;
      c.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FFF1F5F9' } };
      if (Number(c.col) > lead) c.numFmt = numFmt;
    });
  }

  ws.getColumn(1).width = Math.min(60, Math.max(14, ...g.rows.map((r) => rowLabel(r).length + 2)));
  extra.forEach((_, i) => (ws.getColumn(2 + i).width = 16));
  for (let c = lead + 1; c <= lead + months.length + (rowTotals ? 1 : 0); c++) ws.getColumn(c).width = 11;
  // Keep the month headers and the row labels in view while scrolling.
  ws.views = [{ state: 'frozen', xSplit: lead, ySplit: headerRowNo }];

  const buf = await wb.xlsx.writeBuffer();
  const url = URL.createObjectURL(
    new Blob([buf], { type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet' })
  );
  const a = document.createElement('a');
  a.href = url;
  a.download = `${g.filename}.xlsx`;
  a.click();
  URL.revokeObjectURL(url);
}

const edge = { style: 'thin' as const, color: { argb: 'FFD4D4D8' } };
const thin = { top: edge, left: edge, bottom: edge, right: edge };
