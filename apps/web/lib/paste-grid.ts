/**
 * Reading a block copied out of Excel (or Google Sheets) off the clipboard.
 *
 * Excel puts a copied range on the clipboard as plain text: one line per row,
 * cells separated by tabs, with a trailing newline. Numbers come across as they
 * are *displayed*, so "1,234", "$1,234.50", "(500)" and "-" (Excel's accounting
 * zero) all have to be read back into numbers here.
 */

/** A pasted cell: a number, null for a blank cell, or NaN for text that isn't a number. */
export type PastedCell = number | null;

/** One cell's text as Excel displays it → a number, null when blank. NaN when it isn't a number. */
export function parseCellNumber(raw: string): PastedCell {
  let s = raw.trim().replace(/^"(.*)"$/s, '$1').trim();
  if (s === '') return null;
  if (s === '-' || s === '–' || s === '—') return 0;
  let negative = false;
  if (/^\(.*\)$/.test(s)) { negative = true; s = s.slice(1, -1); } // accounting negative
  // Thousands separators, currency and stray spaces (Excel uses non-breaking ones).
  s = s.replace(/[,\s $€£¥]/g, '');
  if (s.endsWith('-')) { negative = !negative; s = s.slice(0, -1); } // "500-"
  if (!/^[-+]?(\d+\.?\d*|\.\d+)(e[-+]?\d+)?$/i.test(s)) return NaN;
  const n = Number(s);
  return negative ? -n : n;
}

/** Clipboard text → rows × cells. A trailing empty line (Excel always adds one) is dropped. */
export function parseClipboardGrid(text: string): PastedCell[][] {
  const lines = text.replace(/\r\n?/g, '\n').split('\n');
  while (lines.length && lines[lines.length - 1] === '') lines.pop();
  return lines.map((line) => line.split('\t').map(parseCellNumber));
}

export type PasteSummary = { written: number; invalid: number; clipped: boolean };

/**
 * Lay a pasted block onto a grid starting at (row, col), calling `write` once
 * per cell that lands inside it. Cells past the grid's last row or column are
 * dropped and reported as `clipped`; text that isn't a number, or a negative,
 * is skipped and counted in `invalid`.
 */
export function applyPastedBlock(
  block: PastedCell[][],
  at: { row: number; col: number },
  size: { rows: number; cols: number },
  write: (row: number, col: number, value: number | null) => void
): PasteSummary {
  let written = 0, invalid = 0, clipped = false;
  block.forEach((cells, dr) => {
    cells.forEach((v, dc) => {
      const r = at.row + dr, c = at.col + dc;
      if (r >= size.rows || c >= size.cols) { clipped = true; return; }
      if (v !== null && (Number.isNaN(v) || v < 0)) { invalid++; return; }
      write(r, c, v);
      written++;
    });
  });
  return { written, invalid, clipped };
}

/** One line for a toast: what the paste did, and what it had to leave out. */
export function describePaste({ written, invalid, clipped }: PasteSummary): string {
  const parts = [`Pasted ${written} cell${written === 1 ? '' : 's'}`];
  if (invalid) parts.push(`${invalid} skipped (not a number, or negative)`);
  if (clipped) parts.push('some fell outside the table and were left out');
  return parts.join(' · ');
}
