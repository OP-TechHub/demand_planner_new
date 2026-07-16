'use client';

import { Download } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { toCsv, downloadCsv } from '@/lib/csv';

/** Downloads a 2D array (header row + data rows) as a CSV file. */
export function ExportCsvButton({ filename, rows }: { filename: string; rows: (string | number | null)[][] }) {
  return (
    <Button variant="outline" size="sm" onClick={() => downloadCsv(filename, toCsv(rows))}>
      <Download />
      Export CSV
    </Button>
  );
}
