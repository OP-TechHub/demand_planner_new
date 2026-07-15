'use client';

import { useState, useTransition } from 'react';
import { parseCsv } from '@/lib/csv';

export type WideRow = { key: string; cells: { month: number; value: number }[] };
export type WideImportResult = { error: string | null; count: number; unknown: string[] };

type Parsed = { rows: WideRow[]; cellCount: number; errors: { line: number; msg: string }[] };

/**
 * Generic importer for the wide input grids (Demand, Harvest): a key column
 * (item_code / bucket) plus M1..M{horizon} month columns. Blank cells are
 * skipped; non-blank cells must be numbers >= 0. Keys not in `knownKeys` are
 * flagged. The parent supplies `onImport`, which resolves keys and upserts.
 */
export function WideGridImport({
  title,
  keyColumn,
  knownKeys,
  horizon,
  onImport,
  onClose,
  onDone,
}: {
  title: string;
  keyColumn: string;
  knownKeys: Set<string>;
  horizon: number;
  onImport: (rows: WideRow[]) => Promise<WideImportResult>;
  onClose: () => void;
  onDone: () => void;
}) {
  const [parsed, setParsed] = useState<Parsed | null>(null);
  const [result, setResult] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [isPending, startTransition] = useTransition();

  function validate(rows: string[][]): Parsed {
    const errors: { line: number; msg: string }[] = [];
    if (rows.length < 2) return { rows: [], cellCount: 0, errors: [{ line: 0, msg: 'File has no data rows.' }] };

    const header = rows[0].map((h) => h.trim().toLowerCase());
    const keyIdx = header.indexOf(keyColumn.toLowerCase());
    if (keyIdx === -1) return { rows: [], cellCount: 0, errors: [{ line: 1, msg: `Missing "${keyColumn}" column.` }] };

    // Map month columns: header "M1".."M{horizon}" -> column index.
    const monthCols: { month: number; idx: number }[] = [];
    header.forEach((h, idx) => {
      const m = /^m(\d+)$/.exec(h);
      if (m) {
        const month = Number(m[1]);
        if (month >= 1 && month <= horizon) monthCols.push({ month, idx });
      }
    });
    if (monthCols.length === 0) {
      return { rows: [], cellCount: 0, errors: [{ line: 1, msg: `No month columns found (expected M1..M${horizon}).` }] };
    }

    const out: WideRow[] = [];
    let cellCount = 0;
    for (let i = 1; i < rows.length; i++) {
      const r = rows[i];
      const key = (r[keyIdx] ?? '').trim();
      if (!key) continue;
      if (!knownKeys.has(key)) { errors.push({ line: i + 1, msg: `unknown ${keyColumn} "${key}"` }); continue; }
      const cells: { month: number; value: number }[] = [];
      let bad = false;
      for (const mc of monthCols) {
        const raw = (r[mc.idx] ?? '').trim();
        if (raw === '') continue;
        const v = Number(raw);
        if (!Number.isFinite(v) || v < 0) { errors.push({ line: i + 1, msg: `M${mc.month} "${raw}" must be a number >= 0` }); bad = true; break; }
        cells.push({ month: mc.month, value: v });
      }
      if (!bad && cells.length) { out.push({ key, cells }); cellCount += cells.length; }
    }
    return { rows: out, cellCount, errors };
  }

  function onFile(e: React.ChangeEvent<HTMLInputElement>) {
    setError(null); setResult(null);
    const file = e.target.files?.[0];
    if (!file) return;
    file.text().then((text) => setParsed(validate(parseCsv(text)))).catch(() => setError('Could not read file.'));
  }

  function doImport() {
    if (!parsed?.rows.length) return;
    setError(null);
    startTransition(async () => {
      const res = await onImport(parsed.rows);
      if (res.error) { setError(res.error); return; }
      const extra = res.unknown.length ? ` (${res.unknown.length} unknown ${keyColumn}s skipped)` : '';
      setResult(`Imported ${res.count} cells across ${parsed.rows.length} rows${extra}.`);
    });
  }

  return (
    <div className="fixed inset-0 z-40 flex items-center justify-center bg-black/30 p-4" onClick={onClose}>
      <div className="w-full max-w-lg rounded-lg bg-card p-5 text-sm shadow-xl" onClick={(e) => e.stopPropagation()}>
        <div className="mb-3 flex items-center justify-between">
          <h2 className="text-sm font-semibold">{title}</h2>
          <button onClick={onClose} className="text-muted-foreground hover:text-foreground">✕</button>
        </div>

        {result ? (
          <div className="space-y-4">
            <p className="rounded-md bg-green-50 px-3 py-2 text-green-800">{result}</p>
            <div className="flex justify-end">
              <button onClick={onDone} className="rounded-md bg-primary px-3 py-1.5 font-medium text-primary-foreground">Done</button>
            </div>
          </div>
        ) : (
          <div className="space-y-4">
            <div>
              <div className="mb-1 font-medium">Upload CSV</div>
              <input type="file" accept=".csv,text/csv" onChange={onFile} className="block w-full text-sm" />
              <p className="mt-1 text-xs text-muted-foreground">
                Columns: <code>{keyColumn}</code> plus month columns <code>M1</code>…<code>M{horizon}</code>.
                Tip: export first to get the exact shape.
              </p>
            </div>

            {parsed && (
              <div className="space-y-3">
                <div className="rounded-md border p-3">
                  <p className="text-green-700">✓ {parsed.rows.length} rows, {parsed.cellCount} cells to write</p>
                  {parsed.errors.length > 0 && (
                    <details className="mt-1">
                      <summary className="cursor-pointer text-red-700">✗ {parsed.errors.length} problem(s)</summary>
                      <ul className="mt-1 max-h-40 overflow-y-auto text-xs text-red-700">
                        {parsed.errors.slice(0, 50).map((e, i) => <li key={i}>Line {e.line}: {e.msg}</li>)}
                      </ul>
                    </details>
                  )}
                </div>
                {error && <p role="alert" className="rounded-md bg-red-50 px-3 py-2 text-red-700">{error}</p>}
                <div className="flex justify-end gap-2">
                  <button onClick={onClose} className="rounded-md border px-3 py-1.5 hover:bg-muted">Cancel</button>
                  <button
                    onClick={doImport}
                    disabled={isPending || parsed.rows.length === 0}
                    className="rounded-md bg-primary px-3 py-1.5 font-medium text-primary-foreground disabled:opacity-50"
                  >
                    {isPending ? 'Importing…' : `Import ${parsed.cellCount} cells`}
                  </button>
                </div>
              </div>
            )}
          </div>
        )}
      </div>
    </div>
  );
}
