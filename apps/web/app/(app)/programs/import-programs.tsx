'use client';

import { useState, useTransition } from 'react';
import { useRouter } from 'next/navigation';
import { CheckCircle2 } from 'lucide-react';
import type { Bucket } from '@oceanpick/shared';
import { parseCsv, toCsv, downloadCsv } from '@/lib/csv';
import { Dialog } from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import { importPrograms, type ImportProgramRow } from './actions';

export const PROGRAM_CSV_HEADER = [
  'status', 'item_code', 'item_description', 'customer', 'max_monthly_demand_fp',
  'primary_bucket', 'primary_yield', 'secondary_bucket', 'secondary_yield',
  'tertiary_bucket', 'tertiary_yield', 'price_per_fp', 'barra_cost_wr',
  'packing_cost_fp', 'processing_cost_fp', 'storage_cost_fp', 'freight_cost_fp',
  'other_costs_fp', 'locked',
] as const;

type Parsed = {
  valid: ImportProgramRow[];
  errors: { line: number; msg: string }[];
  newCount: number;
  updateCount: number;
};

const STATUSES = ['active', 'pipeline', 'inactive'];

export function ImportPrograms({
  planId,
  buckets,
  existingCodes,
  onClose,
  onDone,
}: {
  planId: string;
  buckets: Bucket[];
  existingCodes: Set<string>;
  onClose: () => void;
  onDone: () => void;
}) {
  const router = useRouter();
  const [parsed, setParsed] = useState<Parsed | null>(null);
  const [mode, setMode] = useState<'upsert' | 'add_new'>('upsert');
  const [result, setResult] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [isPending, startTransition] = useTransition();

  const bucketByName = new Map(buckets.map((b) => [b.name.trim().toLowerCase(), b.id]));

  function validate(rows: string[][]): Parsed {
    const errors: { line: number; msg: string }[] = [];
    const valid: ImportProgramRow[] = [];
    if (rows.length < 2) {
      return { valid, errors: [{ line: 0, msg: 'File has no data rows.' }], newCount: 0, updateCount: 0 };
    }
    const header = rows[0].map((h) => h.trim().toLowerCase());
    const col = (name: string) => header.indexOf(name);
    const missing = PROGRAM_CSV_HEADER.filter((h) => col(h) === -1);
    if (missing.length) {
      return { valid, errors: [{ line: 1, msg: `Missing columns: ${missing.join(', ')}` }], newCount: 0, updateCount: 0 };
    }

    let newCount = 0;
    let updateCount = 0;
    for (let i = 1; i < rows.length; i++) {
      const r = rows[i];
      const g = (name: string) => (r[col(name)] ?? '').trim();
      const rowErr = (m: string) => errors.push({ line: i + 1, msg: m });
      const before = errors.length;

      const status = (g('status') || 'active').toLowerCase();
      if (!STATUSES.includes(status)) rowErr(`status "${g('status')}" must be active/pipeline/inactive`);
      const item_code = g('item_code');
      if (!item_code) rowErr('item_code is required');
      if (!g('item_description')) rowErr('item_description is required');
      if (!g('customer')) rowErr('customer is required');

      const numAtLeast0 = (name: string) => {
        const v = Number(g(name) || '0');
        if (!Number.isFinite(v) || v < 0) { rowErr(`${name} must be zero or greater`); return 0; }
        return v;
      };
      const max_monthly_demand_fp = numAtLeast0('max_monthly_demand_fp');

      const resolveBucket = (name: string): string | null => {
        const raw = g(name);
        if (!raw) return null;
        const id = bucketByName.get(raw.toLowerCase());
        if (!id) { rowErr(`unknown bucket "${raw}" in ${name}`); return null; }
        return id;
      };
      const yieldIn = (name: string): number | null => {
        const raw = g(name);
        if (raw === '') return null;
        const v = Number(raw);
        if (!(v > 0 && v <= 1)) { rowErr(`${name} must be between 0 and 1`); return null; }
        return v;
      };

      const primary_bucket_id = resolveBucket('primary_bucket');
      if (!primary_bucket_id) rowErr('primary_bucket is required');
      const primary_yield = yieldIn('primary_yield');
      if (primary_yield == null) rowErr('primary_yield is required');

      const secondary_bucket_id = resolveBucket('secondary_bucket');
      const secondary_yield = yieldIn('secondary_yield');
      if (secondary_bucket_id && secondary_yield == null) rowErr('secondary_yield required when secondary_bucket is set');
      const tertiary_bucket_id = resolveBucket('tertiary_bucket');
      const tertiary_yield = yieldIn('tertiary_yield');
      if (tertiary_bucket_id && tertiary_yield == null) rowErr('tertiary_yield required when tertiary_bucket is set');

      const price_per_fp = Number(g('price_per_fp'));
      if (!(price_per_fp > 0)) rowErr('price_per_fp must be greater than 0');

      const locked = ['true', '1', 'yes', 'y'].includes(g('locked').toLowerCase());

      if (errors.length === before) {
        valid.push({
          status, item_code, item_description: g('item_description'), customer: g('customer'),
          max_monthly_demand_fp,
          primary_bucket_id: primary_bucket_id as string, primary_yield: primary_yield as number,
          secondary_bucket_id, secondary_yield: secondary_bucket_id ? secondary_yield : null,
          tertiary_bucket_id, tertiary_yield: tertiary_bucket_id ? tertiary_yield : null,
          price_per_fp,
          barra_cost_wr: numAtLeast0('barra_cost_wr'),
          packing_cost_fp: numAtLeast0('packing_cost_fp'),
          processing_cost_fp: numAtLeast0('processing_cost_fp'),
          storage_cost_fp: numAtLeast0('storage_cost_fp'),
          freight_cost_fp: numAtLeast0('freight_cost_fp'),
          other_costs_fp: numAtLeast0('other_costs_fp'),
          locked,
        });
        if (existingCodes.has(item_code)) updateCount++; else newCount++;
      }
    }
    return { valid, errors, newCount, updateCount };
  }

  function onFile(e: React.ChangeEvent<HTMLInputElement>) {
    setError(null); setResult(null);
    const file = e.target.files?.[0];
    if (!file) return;
    file.text().then((text) => setParsed(validate(parseCsv(text)))).catch(() => setError('Could not read file.'));
  }

  function downloadTemplate() {
    const example = ['active', '7372', 'Frozen Barra Portions', 'Woolworths', '15000', '800-1100g', '0.498', '', '', '', '', '7.95', '2.30', '0.40', '0.90', '0.02', '0.26', '0', 'false'];
    downloadCsv('programs-template.csv', toCsv([[...PROGRAM_CSV_HEADER], example]));
  }

  function doImport() {
    if (!parsed?.valid.length) return;
    setError(null);
    startTransition(async () => {
      const res = await importPrograms(planId, parsed.valid, mode);
      if (res.error) { setError(res.error); return; }
      setResult(`Imported: ${res.inserted} added, ${res.updated} updated, ${res.skipped} skipped.`);
      router.refresh();
    });
  }

  return (
    <Dialog open onClose={onClose} title="Import Programs">
      {result ? (
        <div className="space-y-4">
          <p className="flex items-center gap-1.5 rounded-md bg-success/10 px-3 py-2 text-sm text-success">
            <CheckCircle2 className="h-4 w-4" /> {result}
          </p>
          <div className="flex justify-end">
            <Button onClick={onDone}>Done</Button>
          </div>
        </div>
      ) : (
        <div className="space-y-4">
          <div>
            <div className="mb-1.5 text-sm font-medium">1. Upload CSV</div>
            <input
              type="file"
              accept=".csv,text/csv"
              onChange={onFile}
              className="block w-full cursor-pointer rounded-md border border-input bg-card text-sm text-muted-foreground file:mr-3 file:cursor-pointer file:border-0 file:bg-muted file:px-3 file:py-2 file:text-sm file:font-medium file:text-foreground hover:file:bg-muted/70"
            />
            <button onClick={downloadTemplate} className="mt-2 text-xs font-medium text-primary hover:underline">Download template</button>
          </div>

          {parsed && (
            <div className="space-y-3">
              <div className="rounded-md border border-border p-3">
                <div className="text-sm font-medium">2. Preview</div>
                <p className="mt-1 flex items-center gap-1.5 text-sm text-success">
                  <CheckCircle2 className="h-4 w-4" /> {parsed.valid.length} valid ({parsed.newCount} new, {parsed.updateCount} existing)
                </p>
                {parsed.errors.length > 0 && (
                  <details className="mt-1">
                    <summary className="cursor-pointer text-sm text-destructive">{parsed.errors.length} problem row(s)</summary>
                    <ul className="mt-1 max-h-40 overflow-y-auto text-xs text-destructive">
                      {parsed.errors.slice(0, 50).map((e, i) => (
                        <li key={i}>Line {e.line}: {e.msg}</li>
                      ))}
                    </ul>
                  </details>
                )}
              </div>

              <div>
                <div className="mb-1.5 text-sm font-medium">3. Import mode</div>
                <label className="flex items-center gap-2 text-sm">
                  <input type="radio" checked={mode === 'upsert'} onChange={() => setMode('upsert')} />
                  Upsert by item_code (add new, update existing)
                </label>
                <label className="flex items-center gap-2 text-sm">
                  <input type="radio" checked={mode === 'add_new'} onChange={() => setMode('add_new')} />
                  Add new only (skip existing item_codes)
                </label>
                <p className="mt-1 text-xs text-muted-foreground">Replace-all is deferred; invalid rows are skipped either way.</p>
              </div>

              {error && <p role="alert" className="rounded-md bg-destructive/10 px-3 py-2 text-sm text-destructive">{error}</p>}

              <div className="flex justify-end gap-2">
                <Button variant="outline" onClick={onClose}>Cancel</Button>
                <Button onClick={doImport} disabled={isPending || parsed.valid.length === 0}>
                  {isPending ? 'Importing…' : `Import ${parsed.valid.length} valid row(s)`}
                </Button>
              </div>
            </div>
          )}
        </div>
      )}
    </Dialog>
  );
}
