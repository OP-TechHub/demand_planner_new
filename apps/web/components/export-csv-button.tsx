'use client';

import { toCsv, downloadCsv } from '@/lib/csv';

/** Downloads a 2D array (header row + data rows) as a CSV file. */
export function ExportCsvButton({ filename, rows }: { filename: string; rows: (string | number | null)[][] }) {
  return (
    <button
      onClick={() => downloadCsv(filename, toCsv(rows))}
      className="rounded-md border px-3 py-1.5 text-sm hover:bg-muted"
    >
      Export CSV
    </button>
  );
}
