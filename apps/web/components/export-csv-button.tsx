'use client';

import { Download } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { toCsv, downloadCsv } from '@/lib/csv';

type Matrix = (string | number | null)[][];

/**
 * Downloads a 2D array (header row + data rows) as a CSV file. Pass a function
 * to build the rows only when clicked — a wide grid need not rebuild its export
 * on every render.
 */
export function ExportCsvButton({ filename, rows }: { filename: string; rows: Matrix | (() => Matrix) }) {
  return (
    <Button
      variant="outline"
      size="sm"
      onClick={() => downloadCsv(filename, toCsv(typeof rows === 'function' ? rows() : rows))}
    >
      <Download />
      Export CSV
    </Button>
  );
}
