// Flat-table Excel export — for pages that are a ranked or listed table rather
// than a programs × months grid (those go through grid-export.ts).
//
// A table describes its columns once: header, how its figures are formatted,
// and how wide it is. Rows are plain values; percentages are passed as
// fractions (0.25, not 25) so Excel can format them as real percentages.

export type TableFmt = 'text' | 'int' | 'usd0' | 'usd2' | 'pct';

export interface TableCol {
  header: string;
  fmt?: TableFmt;
  width?: number;
}

export type TableCell = string | number | null;

export interface TableExport {
  /** File name without extension. */
  filename: string;
  title: string;
  /** One line under the title: filters in force, plan name, anything else worth noting. */
  subtitle?: string;
  columns: TableCol[];
  rows: TableCell[][];
  /** An optional bold TOTAL row at the bottom; same shape as a row. */
  totals?: TableCell[];
  /** Zero-based index of a column to shade, e.g. the one the table is ranked on. */
  highlightCol?: number;
}

const XL_FMT: Record<TableFmt, string | undefined> = {
  text: undefined,
  int: '#,##0',
  usd0: '"$"#,##0',
  usd2: '"$"#,##0.00',
  pct: '0.0%',
};

const edge = { style: 'thin' as const, color: { argb: 'FFD4D4D8' } };
const thin = { top: edge, left: edge, bottom: edge, right: edge };
const solid = (argb: string) => ({ type: 'pattern' as const, pattern: 'solid' as const, fgColor: { argb } });

export async function downloadTableXlsx(t: TableExport) {
  // Loaded on demand: the spreadsheet library is large and only needed on click.
  const ExcelJS = (await import('exceljs')).default;
  const wb = new ExcelJS.Workbook();
  const ws = wb.addWorksheet(t.title.slice(0, 31).replace(/[\/?*[\]:]/g, '-'));

  ws.addRow([t.title]).font = { bold: true, size: 14 };
  if (t.subtitle) ws.addRow([t.subtitle]).font = { color: { argb: 'FF555555' } };
  ws.addRow([]);

  const isNum = (c: TableCol) => (c.fmt ?? 'text') !== 'text';

  const header = ws.addRow(t.columns.map((c) => c.header));
  header.font = { bold: true };
  header.eachCell((cell, i) => {
    const col = t.columns[i - 1]!;
    cell.fill = solid(i - 1 === t.highlightCol ? 'FFDBEAFE' : 'FFF1F5F9');
    cell.border = thin;
    cell.alignment = { horizontal: isNum(col) ? 'right' : 'left', vertical: 'middle', wrapText: true };
  });
  const headerRowNo = header.number;

  const styleRow = (row: import('exceljs').Row, bold = false) => {
    row.eachCell({ includeEmpty: true }, (cell, i) => {
      const col = t.columns[i - 1];
      if (!col) return;
      cell.border = thin;
      const fmt = XL_FMT[col.fmt ?? 'text'];
      if (fmt) cell.numFmt = fmt;
      if (i - 1 === t.highlightCol) {
        cell.fill = solid('FFEFF6FF');
        cell.font = { bold: true };
      }
      if (bold) cell.font = { bold: true };
    });
  };

  for (const r of t.rows) styleRow(ws.addRow(r));

  if (t.totals) {
    const row = ws.addRow(t.totals);
    styleRow(row, true);
    row.eachCell({ includeEmpty: true }, (cell) => { cell.fill = solid('FFF1F5F9'); });
  }

  t.columns.forEach((c, i) => {
    const longest = Math.max(c.header.length, ...t.rows.map((r) => String(r[i] ?? '').length));
    ws.getColumn(i + 1).width = c.width ?? Math.min(48, Math.max(10, longest + 2));
  });
  // Keep the header in view while scrolling.
  ws.views = [{ state: 'frozen', ySplit: headerRowNo }];

  const buf = await wb.xlsx.writeBuffer();
  const url = URL.createObjectURL(
    new Blob([buf], { type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet' })
  );
  const a = document.createElement('a');
  a.href = url;
  a.download = `${t.filename}.xlsx`;
  a.click();
  URL.revokeObjectURL(url);
}
