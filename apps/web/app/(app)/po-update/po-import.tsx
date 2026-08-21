'use client';

import { useState, useTransition } from 'react';
import { CheckCircle2 } from 'lucide-react';
import { monthLabel, parseMonthHeader } from '@oceanpick/shared';
import { parseCsv, toCsv, downloadCsv } from '@/lib/csv';
import { Dialog } from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import { importPos, type PoImportRow } from './actions';
import type { ProgramRow } from './po-update-client';

/**
 * Long-format PO importer: one CSV row per shipment line.
 *
 * Deliberately NOT the wide month-per-column shape the Demand and Harvest grids
 * use. A PO carries its own number and dates, which a wide sheet has nowhere to
 * put, and sales-order exports are long anyway.
 *
 * Shaped to take the sales system's export as-is:
 *
 *   ETD Date | Sale Order Number | Customer Name | Item | Description |
 *   Sale Order Quantity | PO Reference
 *
 * Columns are matched by heading, so order doesn't matter and extra columns
 * (Customer Name, Description) are ignored — the item code already determines the
 * program, and trusting it over a free-text customer name avoids a whole class of
 * near-miss matching.
 */
const COLUMNS = {
  // `item` is the sales export's heading; the rest are what people type by hand.
  item_code: ['item', 'item_code', 'item code', 'code', 'sku', 'export_code', 'export code'],
  // The CUSTOMER's PO number — what the order book is keyed on.
  po_ref: ['po reference', 'po_reference', 'po_ref', 'po ref', 'po', 'po number', 'po_number', 'customer po', 'customer po number'],
  // Our internal sales order (EXP-1841). Kept as a note, not as the PO identity.
  order_ref: ['sale order number', 'sale_order_number', 'sales order number', 'sales order', 'so number', 'order number', 'order'],
  // ETD is a real date; `month` covers hand-written files.
  month: ['etd date', 'etd', 'etd_date', 'month', 'delivery month', 'delivery_month', 'period', 'ship date', 'shipment date'],
  quantity: ['sale order quantity', 'sale_order_quantity', 'order quantity', 'quantity_fp', 'quantity', 'qty', 'kg', 'quantity kg'],
  received_on: ['received_on', 'received', 'received on', 'po date', 'order date'],
  notes: ['notes', 'note', 'remarks', 'comment'],
} as const;

/** Month index (1-based) of a calendar year/month within the plan's window. */
function monthIndexOf(planStartDate: string, year: number, month1: number, horizon: number): number | null {
  const start = new Date(planStartDate + 'T00:00:00Z');
  const idx = (year - start.getUTCFullYear()) * 12 + (month1 - 1 - start.getUTCMonth()) + 1;
  return idx >= 1 && idx <= horizon ? idx : null;
}

/**
 * The month a delivery line belongs to.
 *
 * Accepts month labels ("Apr 26", "2026-04", "M1") and real dates, because the
 * sales export sends an ETD. Day-of-month is discarded — the plan is monthly, so
 * an ETD of the 3rd and one of the 28th both land in that month.
 *
 * Slash dates are read DAY-FIRST (15/08/26 = 15 Aug 2026), which is the format
 * the sales system emits. The one case that can't be day-first — a first number
 * above 12 in the month position — is swapped rather than rejected, so a
 * month-first file still lands correctly.
 */
export function monthFromCell(planStartDate: string, raw: string, horizon: number): number | null {
  const t = raw.trim();
  if (!t) return null;

  // "Apr 26" / "2026-04" / "M1". Returns null on a 3-part date, so it can't
  // mis-read one.
  const byLabel = parseMonthHeader(planStartDate, t, horizon);
  if (byLabel !== null) return byLabel;

  const iso = /^(\d{4})-(\d{1,2})-(\d{1,2})/.exec(t);
  if (iso) return monthIndexOf(planStartDate, Number(iso[1]), Number(iso[2]), horizon);

  const parts = /^(\d{1,2})[/.\-](\d{1,2})[/.\-](\d{2}|\d{4})$/.exec(t);
  if (parts) {
    let d = Number(parts[1]);
    let m = Number(parts[2]);
    if (m > 12 && d <= 12) { const swap = d; d = m; m = swap; } // month-first file
    if (m < 1 || m > 12 || d < 1 || d > 31) return null;
    const y = parts[3].length === 2 ? 2000 + Number(parts[3]) : Number(parts[3]);
    return monthIndexOf(planStartDate, y, m, horizon);
  }

  // Excel serial date — what a spreadsheet writes when the cell was a real date
  // and the CSV was produced without formatting. Day 0 is 1899-12-30.
  if (/^\d{4,5}$/.test(t)) {
    const n = Number(t);
    if (n >= 20000 && n <= 80000) {
      const d = new Date(Date.UTC(1899, 11, 30) + n * 86400000);
      return monthIndexOf(planStartDate, d.getUTCFullYear(), d.getUTCMonth() + 1, horizon);
    }
  }
  return null;
}

type Parsed = {
  lines: PoImportRow[];
  pos: number;
  /** Lines folded into an earlier one because they shared PO, program and month. */
  merged: number;
  errors: { line: number; msg: string }[];
};

export function PoImport({
  planId,
  planStartDate,
  horizon,
  programs,
  onClose,
  onDone,
}: {
  planId: string;
  planStartDate: string;
  horizon: number;
  programs: ProgramRow[];
  onClose: () => void;
  onDone: () => void;
}) {
  const [parsed, setParsed] = useState<Parsed | null>(null);
  const [result, setResult] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [isPending, startTransition] = useTransition();

  // Either code identifies a program, matching the server's resolution.
  const known = new Set<string>();
  for (const p of programs) {
    known.add(p.item_code);
    if (p.export_code) known.add(p.export_code);
  }
  const firstLabel = monthLabel(planStartDate, 1);
  const lastLabel = monthLabel(planStartDate, horizon);

  function validate(rows: string[][]): Parsed {
    const errors: { line: number; msg: string }[] = [];
    const empty: Parsed = { lines: [], pos: 0, merged: 0, errors };
    if (rows.length < 2) return { ...empty, errors: [{ line: 0, msg: 'File has no data rows.' }] };

    const header = rows[0].map((h) => h.trim().toLowerCase());
    const find = (names: readonly string[]) => header.findIndex((h) => names.includes(h));
    const iCode = find(COLUMNS.item_code);
    const iRef = find(COLUMNS.po_ref);
    const iOrder = find(COLUMNS.order_ref);
    const iMonth = find(COLUMNS.month);
    const iQty = find(COLUMNS.quantity);
    const iRecv = find(COLUMNS.received_on);
    const iNotes = find(COLUMNS.notes);

    // A file with only a sales-order number and no customer PO still imports —
    // the order number becomes the reference rather than the rows being lost.
    const refIdx = iRef !== -1 ? iRef : iOrder;
    const missing = [
      iCode === -1 && 'Item',
      refIdx === -1 && 'PO Reference',
      iMonth === -1 && 'ETD Date',
      iQty === -1 && 'Sale Order Quantity',
    ].filter(Boolean);
    if (missing.length) {
      return { ...empty, errors: [{ line: 1, msg: `Missing column(s): ${missing.join(', ')}. Download the template for the exact shape.` }] };
    }

    // Several ETDs inside one month under one PO are one monthly figure, so lines
    // sharing (program, PO, month) SUM rather than being rejected — the table's
    // unique key would only accept one of them anyway.
    const byKey = new Map<string, PoImportRow>();
    const refs = new Set<string>();
    let merged = 0;

    for (let i = 1; i < rows.length; i++) {
      const r = rows[i];
      const at = i + 1;
      const g = (idx: number) => (idx === -1 ? '' : (r[idx] ?? '').trim());
      const code = g(iCode);
      const ref = g(refIdx);
      const rawMonth = g(iMonth);
      const rawQty = g(iQty);

      // A wholly blank line is the template's unused rows, not a mistake.
      if (!code && !ref && !rawMonth && !rawQty) continue;
      if (!code) { errors.push({ line: at, msg: 'no item code' }); continue; }
      if (!known.has(code)) { errors.push({ line: at, msg: `"${code}" isn't an item or export code in this plan` }); continue; }
      if (!ref) { errors.push({ line: at, msg: 'no PO reference' }); continue; }

      const month = monthFromCell(planStartDate, rawMonth, horizon);
      if (month === null) {
        errors.push({ line: at, msg: `"${rawMonth}" isn't a date or month inside ${firstLabel}…${lastLabel}` });
        continue;
      }
      const qty = Number(rawQty.replace(/[, ]/g, ''));
      if (!rawQty || !Number.isFinite(qty) || qty < 0) {
        errors.push({ line: at, msg: `quantity "${rawQty}" must be a number >= 0` });
        continue;
      }

      const recv = g(iRecv);
      if (recv && !/^\d{4}-\d{2}-\d{2}$/.test(recv)) {
        errors.push({ line: at, msg: `received "${recv}" must be YYYY-MM-DD` });
        continue;
      }

      // Our sales order number isn't the PO's identity, but losing it would throw
      // away the link back to the order system, so it rides along as a note.
      const order = iRef !== -1 ? g(iOrder) : '';
      const note = [g(iNotes), order && `SO ${order}`].filter(Boolean).join(' · ');

      const key = `${code}|${ref}|${month}`;
      const existing = byKey.get(key);
      if (existing) {
        existing.quantity_fp += qty;
        // Keep the earliest received date and the first note we were given.
        if (!existing.received_on && recv) existing.received_on = recv;
        if (!existing.notes && note) existing.notes = note;
        merged++;
      } else {
        byKey.set(key, {
          item_code: code, po_ref: ref, month, quantity_fp: qty,
          received_on: recv || null, notes: note || null,
        });
        refs.add(`${code} ${ref}`);
      }
    }
    return { lines: [...byKey.values()], pos: refs.size, merged, errors };
  }

  /**
   * A sheet in the sales export's own shape, with every item and export code in
   * this plan already listed so nobody has to spell one. The example rows carry a
   * blank quantity, so importing the template untouched writes nothing.
   */
  function downloadTemplate() {
    const header = ['ETD Date', 'Sale Order Number', 'Customer Name', 'Item', 'Description', 'Sale Order Quantity', 'PO Reference'];
    const first = programs[0];
    const code = first?.export_code ?? first?.item_code ?? 'EXPORT001';
    const rows = [
      ['15/08/26', 'EXP-0000', first?.customer ?? '', code, first?.item_description ?? '', '', 'PO#0000'],
      ...programs.map((p) => ['', '', p.customer, p.export_code ?? p.item_code, p.item_description, '', '']),
    ];
    downloadCsv('po-import-template.csv', toCsv([header, ...rows]));
  }

  function onFile(e: React.ChangeEvent<HTMLInputElement>) {
    setError(null); setResult(null);
    const file = e.target.files?.[0];
    if (!file) return;
    file.text().then((text) => setParsed(validate(parseCsv(text)))).catch(() => setError('Could not read file.'));
  }

  function doImport() {
    if (!parsed?.lines.length) return;
    setError(null);
    startTransition(async () => {
      const res = await importPos(planId, parsed.lines);
      if (res.error) { setError(res.error); return; }
      const extra = res.unknown.length ? ` ${res.unknown.length} unknown item code(s) skipped.` : '';
      setResult(`Imported ${res.count} PO month${res.count === 1 ? '' : 's'} across ${res.pos} PO${res.pos === 1 ? '' : 's'}.${extra} Recalculate to see it in the outputs.`);
    });
  }

  return (
    <Dialog
      open
      onClose={onClose}
      title="Import received POs"
      description={
        <>
          Takes the sales export as it comes: <code className="rounded bg-muted px-1">ETD Date</code>,{' '}
          <code className="rounded bg-muted px-1">Item</code>,{' '}
          <code className="rounded bg-muted px-1">Sale Order Quantity</code> and{' '}
          <code className="rounded bg-muted px-1">PO Reference</code> are the ones it needs;{' '}
          <code className="rounded bg-muted px-1">Sale Order Number</code>,{' '}
          <code className="rounded bg-muted px-1">Customer Name</code> and{' '}
          <code className="rounded bg-muted px-1">Description</code> are optional. Columns are matched by heading, so
          order doesn&apos;t matter.
        </>
      }
    >
      {result ? (
        <div className="space-y-4">
          <p className="flex items-start gap-1.5 rounded-md bg-success/10 px-3 py-2 text-sm text-success">
            <CheckCircle2 className="mt-0.5 h-4 w-4 shrink-0" /> {result}
          </p>
          <div className="flex justify-end">
            <Button onClick={onDone}>Done</Button>
          </div>
        </div>
      ) : (
        <div className="space-y-4">
          <div>
            <div className="mb-1.5 text-sm font-medium">Upload CSV</div>
            <input
              type="file"
              accept=".csv,text/csv"
              onChange={onFile}
              className="block w-full cursor-pointer rounded-md border border-input bg-card text-sm text-muted-foreground file:mr-3 file:cursor-pointer file:border-0 file:bg-muted file:px-3 file:py-2 file:text-sm file:font-medium file:text-foreground hover:file:bg-muted/70"
            />
            <button onClick={downloadTemplate} className="mt-2 text-xs font-medium text-primary hover:underline">
              Download template
            </button>
            <span className="ml-1.5 text-xs text-muted-foreground">
              — the same columns, with every item code in this plan.
            </span>
          </div>

          <ul className="space-y-1 rounded-md bg-muted/50 px-3 py-2 text-xs text-muted-foreground">
            <li>
              <b>ETD Date</b> sets the month — the day is discarded, since the plan is monthly. Slash dates read
              day-first ({'15/08/26'} = Aug 26).
            </li>
            <li>
              <b>Item</b> matches either the export code ({'EXPORT006'}) or the item code.
            </li>
            <li>
              Several ETDs in one month under one PO are <b>added together</b> into that month&apos;s figure.
            </li>
            <li>
              Importing <b>adds to</b> what is already recorded; POs not in the file are left alone. Each affected
              month&apos;s demand then becomes the sum of its POs.
            </li>
          </ul>

          {parsed && (
            <div className="space-y-3">
              <div className="rounded-md border border-border p-3">
                <p className="flex items-center gap-1.5 text-sm text-success">
                  <CheckCircle2 className="h-4 w-4" /> {parsed.lines.length} PO month(s) across {parsed.pos} PO(s) to write
                </p>
                {parsed.merged > 0 && (
                  <p className="mt-1 text-xs text-muted-foreground">
                    {parsed.merged} line(s) shared a PO, item and month and were added together.
                  </p>
                )}
                {parsed.errors.length > 0 && (
                  <details className="mt-1">
                    <summary className="cursor-pointer text-sm text-destructive">
                      {parsed.errors.length} problem(s) — these lines are skipped
                    </summary>
                    <ul className="mt-1 max-h-40 overflow-y-auto text-xs text-destructive">
                      {parsed.errors.slice(0, 50).map((e, i) => <li key={i}>Line {e.line}: {e.msg}</li>)}
                    </ul>
                  </details>
                )}
              </div>
              {error && <p role="alert" className="rounded-md bg-destructive/10 px-3 py-2 text-sm text-destructive">{error}</p>}
              <div className="flex justify-end gap-2">
                <Button variant="outline" onClick={onClose}>Cancel</Button>
                <Button onClick={doImport} disabled={isPending || parsed.lines.length === 0}>
                  {isPending ? 'Importing…' : `Import ${parsed.lines.length} line(s)`}
                </Button>
              </div>
            </div>
          )}
        </div>
      )}
    </Dialog>
  );
}
