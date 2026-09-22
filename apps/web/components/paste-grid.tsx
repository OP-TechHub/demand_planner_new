'use client';

import { useEffect, useId, useMemo, useRef, useState, type ClipboardEvent, type KeyboardEvent, type MouseEvent } from 'react';
import { Save, X } from 'lucide-react';
import { toast } from '@/components/ui/toast';
import { Button } from '@/components/ui/button';
import { applyPastedBlock, describePaste, parseClipboardGrid } from '@/lib/paste-grid';

/**
 * Paste an Excel block into a grid, starting at `at`. Always takes over the
 * paste — even for one value, since a number input refuses Excel's "1,234"
 * outright. `write` gets null for a blank Excel cell.
 *
 * `flatten` reads the block as one run of values, row by row — for a list of
 * months laid out top to bottom, where a row copied from a month-across sheet
 * and a column copied from a month-down one should both just run forward.
 */
export function pasteIntoGrid(
  e: ClipboardEvent,
  at: { row: number; col: number },
  size: { rows: number; cols: number },
  write: (row: number, col: number, value: number | null) => void,
  { flatten = false } = {}
) {
  const text = e.clipboardData.getData('text/plain');
  if (!text) return;
  e.preventDefault();
  const parsed = parseClipboardGrid(text);
  const summary = applyPastedBlock(flatten ? [parsed.flat()] : parsed, at, size, write);
  if (summary.written === 0) toast.error('Nothing pasted — the copied cells aren’t numbers.');
  else if (summary.written > 1 || summary.invalid || summary.clipped) toast.info(describePaste(summary));
}

type Cell = { row: number; col: number };

/**
 * A rectangular, Excel-style selection over a grid: click a cell, then drag,
 * Shift+click or Shift+arrow to stretch it. Indexes are positions on screen, so
 * the selection is dropped whenever the grid's rows or columns change under it
 * (a filter, the month range) rather than left pointing at different cells.
 */
function useRangeSelection(rows: number, cols: number, resetKey: string) {
  const [anchor, setAnchor] = useState<Cell | null>(null);
  const [focus, setFocus] = useState<Cell | null>(null);
  const dragging = useRef(false);

  useEffect(() => {
    const up = () => { dragging.current = false; };
    window.addEventListener('mouseup', up);
    return () => window.removeEventListener('mouseup', up);
  }, []);
  useEffect(() => { setAnchor(null); setFocus(null); }, [resetKey]);

  const clamp = (c: Cell): Cell => ({
    row: Math.min(rows - 1, Math.max(0, c.row)),
    col: Math.min(cols - 1, Math.max(0, c.col)),
  });
  const rect = anchor && focus
    ? { r0: Math.min(anchor.row, focus.row), r1: Math.max(anchor.row, focus.row), c0: Math.min(anchor.col, focus.col), c1: Math.max(anchor.col, focus.col) }
    : null;

  return {
    rect,
    count: rect ? (rect.r1 - rect.r0 + 1) * (rect.c1 - rect.c0 + 1) : 0,
    isSelected: (r: number, c: number) => !!rect && r >= rect.r0 && r <= rect.r1 && c >= rect.c0 && c <= rect.c1,
    /** Top-left of the selection — where a paste lands, as in Excel. */
    topLeft: (): Cell | null => (rect ? { row: rect.r0, col: rect.c0 } : null),
    cells: (): Cell[] => {
      if (!rect) return [];
      const out: Cell[] = [];
      for (let r = rect.r0; r <= rect.r1; r++) for (let c = rect.c0; c <= rect.c1; c++) out.push({ row: r, col: c });
      return out;
    },
    press: (c: Cell, shift: boolean) => {
      if (shift && anchor) setFocus(c);
      else { setAnchor(c); setFocus(c); }
      dragging.current = true;
    },
    enter: (c: Cell) => { if (dragging.current) setFocus(c); },
    /** Select one cell (plain arrow, or focus arriving by Tab). */
    select: (c: Cell) => { const k = clamp(c); setAnchor(k); setFocus(k); return k; },
    /** Stretch the far corner (Shift+arrow). */
    extend: (dr: number, dc: number) => {
      if (!focus) return;
      setFocus(clamp({ row: focus.row + dr, col: focus.col + dc }));
    },
    clear: () => { setAnchor(null); setFocus(null); },
  };
}

const ARROWS: Record<string, [number, number]> = {
  ArrowUp: [-1, 0], ArrowDown: [1, 0], ArrowLeft: [0, -1], ArrowRight: [0, 1],
};

/**
 * Excel-style editing for a grid whose cells are read-only text (Demand Plan,
 * harvest capacity): select cells, then Ctrl+V to paste a block copied from
 * Excel, or Delete / Backspace to clear them. Changes are held here as pending
 * edits, keyed by row id and month so they survive the grid being filtered,
 * until the page saves or discards them. A pending value of null means
 * "cleared" — what that falls back to is the page's call.
 *
 * Blank cells in a pasted block are left alone rather than cleared: a gap in
 * the copied range reads as "nothing to change here". Delete is how to clear.
 */
export function usePasteGrid({ rowIds, months, enabled }: { rowIds: string[]; months: number[]; enabled: boolean }) {
  const gridId = useId();
  const [pending, setPending] = useState<Map<string, number | null>>(() => new Map());
  const sel = useRangeSelection(rowIds.length, months.length, `${rowIds.join()}|${months.join()}`);

  const key = (rowId: string, month: number) => `${rowId}:${month}`;
  const focusEl = (c: Cell) =>
    document.querySelector<HTMLElement>(`[data-paste-cell="${CSS.escape(`${gridId}:${c.row}:${c.col}`)}"]`)?.focus();

  const onPaste = (e: ClipboardEvent, row: number, col: number) => {
    const at = sel.isSelected(row, col) ? sel.topLeft() ?? { row, col } : { row, col };
    const next = new Map(pending);
    let changed = false;
    pasteIntoGrid(e, at, { rows: rowIds.length, cols: months.length }, (r, c, v) => {
      if (v === null) return;
      next.set(key(rowIds[r], months[c]), v);
      changed = true;
    });
    if (changed) setPending(next);
  };

  const clearSelected = () => {
    const cells = sel.cells();
    if (!cells.length) return;
    const next = new Map(pending);
    for (const c of cells) next.set(key(rowIds[c.row], months[c.col]), null);
    setPending(next);
    if (cells.length > 1) toast.info(`Cleared ${cells.length} cells — save to keep it`);
  };

  const onKeyDown = (e: KeyboardEvent, row: number, col: number) => {
    const d = ARROWS[e.key];
    if (d) {
      e.preventDefault();
      if (e.shiftKey) sel.extend(d[0], d[1]);
      else focusEl(sel.select({ row: row + d[0], col: col + d[1] }));
    } else if (e.key === 'Delete' || e.key === 'Backspace') {
      e.preventDefault();
      clearSelected();
    } else if (e.key === 'Escape') {
      sel.clear();
      (e.currentTarget as HTMLElement).blur();
    }
  };

  /** Spread onto each editable month cell. */
  const cellProps = (row: number, col: number) =>
    enabled
      ? {
          tabIndex: 0,
          'data-paste-cell': `${gridId}:${row}:${col}`,
          'aria-selected': sel.isSelected(row, col),
          onMouseDown: (e: MouseEvent) => {
            if (e.button !== 0) return;
            if (e.shiftKey) e.preventDefault(); // keep the anchor's focus; no text selection
            sel.press({ row, col }, e.shiftKey);
          },
          onMouseEnter: () => sel.enter({ row, col }),
          // Keyboard focus arriving from outside (Tab) selects the cell it lands on.
          onFocus: () => { if (!sel.isSelected(row, col)) sel.select({ row, col }); },
          // The row behind opens the single-row editor; a month cell is for selecting.
          onClick: (e: MouseEvent) => e.stopPropagation(),
          onKeyDown: (e: KeyboardEvent) => onKeyDown(e, row, col),
          onPaste: (e: ClipboardEvent) => onPaste(e, row, col),
        }
      : {};

  const entries = useMemo(
    () => [...pending].map(([k, value]) => {
      const i = k.lastIndexOf(':');
      return { rowId: k.slice(0, i), month: Number(k.slice(i + 1)), value };
    }),
    [pending]
  );

  return {
    cellProps,
    isSelected: sel.isSelected,
    /** The unsaved value for a cell: a number, null when cleared, undefined when untouched. */
    pendingValue: (rowId: string, month: number) => pending.get(key(rowId, month)),
    entries,
    discard: () => setPending(new Map()),
  };
}

/**
 * The same selection for a grid of number inputs (Request Plan, Actual
 * Harvest), which hold their own values: select across the boxes, then Delete
 * or Backspace empties them all, and a paste lands at the selection's
 * top-left. With a single box selected, keys behave as they always do inside
 * it — Delete edits the number, arrows move the caret.
 */
export function useInputGridSelection({
  rows, cols, resetKey, clear, paste,
}: {
  rows: number;
  cols: number;
  /** Changes whenever the rows or months on screen do; the selection is dropped then. */
  resetKey: string;
  /** Empty one cell. */
  clear: (row: number, col: number) => void;
  /** Write one pasted cell (null for a blank one). */
  paste: (row: number, col: number, value: number | null) => void;
}) {
  const sel = useRangeSelection(rows, cols, resetKey);

  const inputProps = (row: number, col: number) => ({
    'aria-selected': sel.isSelected(row, col),
    onMouseDown: (e: MouseEvent) => {
      if (e.button !== 0) return;
      if (e.shiftKey) e.preventDefault();
      sel.press({ row, col }, e.shiftKey);
    },
    onMouseEnter: () => sel.enter({ row, col }),
    onFocus: () => { if (!sel.isSelected(row, col)) sel.select({ row, col }); },
    onKeyDown: (e: KeyboardEvent) => {
      const d = ARROWS[e.key];
      if (d && e.shiftKey) {
        e.preventDefault();
        sel.extend(d[0], d[1]);
      } else if ((e.key === 'Delete' || e.key === 'Backspace') && sel.count > 1) {
        e.preventDefault();
        for (const c of sel.cells()) clear(c.row, c.col);
        toast.info(`Cleared ${sel.count} cells — save to keep it`);
      }
    },
    onPaste: (e: ClipboardEvent) => {
      const at = sel.count > 1 && sel.isSelected(row, col) ? sel.topLeft() ?? { row, col } : { row, col };
      pasteIntoGrid(e, at, { rows, cols }, paste);
    },
  });

  return { inputProps, isSelected: sel.isSelected };
}

/** Classes for an editable grid cell: a focus ring, a tint when selected, amber when it holds an unsaved change. */
export const pasteCellCls = {
  base: 'select-none outline-none focus:ring-2 focus:ring-inset focus:ring-primary cursor-cell',
  selected: 'bg-primary/15',
  pending: 'bg-amber-100 text-amber-900 font-semibold',
};

/** The bar that appears once something has been pasted or cleared and not yet saved. */
export function PendingPasteBar({
  count, saving, onSave, onDiscard,
}: { count: number; saving: boolean; onSave: () => void; onDiscard: () => void }) {
  if (count === 0) return null;
  return (
    <div className="flex flex-wrap items-center justify-between gap-2 rounded-lg border border-amber-300 bg-amber-50 px-3 py-2 text-sm text-amber-900">
      <span><b>{count}</b> changed cell{count === 1 ? '' : 's'} not saved yet — highlighted in the table.</span>
      <span className="flex gap-2">
        <Button variant="outline" size="sm" onClick={onDiscard} disabled={saving}><X />Discard</Button>
        <Button size="sm" onClick={onSave} disabled={saving}><Save />{saving ? 'Saving…' : 'Save changes'}</Button>
      </span>
    </div>
  );
}
