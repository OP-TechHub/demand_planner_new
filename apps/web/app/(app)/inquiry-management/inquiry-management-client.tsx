'use client';

import { useMemo, useState } from 'react';
import { Info, Printer } from 'lucide-react';
import { cn } from '@/lib/utils';
import { Button } from '@/components/ui/button';
import { MetricGrid, type Metric } from '@/components/metric-grid';
import type { GridRow } from '@/lib/grid-csv';
import { OfferSheet, type OfferBasis } from './offer-sheet';

export type OtbPath = { path: 'primary' | 'secondary' | 'tertiary'; bucket_id: string; yield: number };
export type OtbProgram = {
  id: string;
  customer: string;
  item_code: string;
  item_description: string;
  status: string;
  /** Sourcing paths in cascade order — primary first. */
  paths: OtbPath[];
};

const kg = (n: number) => `${Math.round(n).toLocaleString()} kg`;

export function InquiryManagementClient({
  planStartDate,
  horizon,
  buckets,
  programs,
  unallocated,
  pipeline,
}: {
  planStartDate: string;
  horizon: number;
  buckets: { id: string; name: string }[];
  programs: OtbProgram[];
  /** Spare whole round, keyed `${bucket_id}:${month_index}`. */
  unallocated: Record<string, number>;
  /** Whole round held by unconfirmed pipeline inquiries, same key. */
  pipeline: Record<string, number>;
}) {
  const months = useMemo(() => Array.from({ length: horizon }, (_, i) => i + 1), [horizon]);
  const bucketName = useMemo(() => new Map(buckets.map((b) => [b.id, b.name])), [buckets]);

  const customers = useMemo(
    () => [...new Set(programs.map((p) => p.customer).filter(Boolean))].sort(),
    [programs]
  );
  const [customer, setCustomer] = useState(customers[0] ?? '');
  const [programId, setProgramId] = useState('');
  // What the printable offer promises. Defaults to free capacity — the safe
  // number to put in front of a customer, since the rest is spoken for.
  const [basis, setBasis] = useState<OfferBasis>('free');

  // A customer's products. Selection falls back to the first one, so changing
  // customer never leaves a stale product from the previous customer selected.
  const theirs = useMemo(() => programs.filter((p) => p.customer === customer), [programs, customer]);
  const program = theirs.find((p) => p.id === programId) ?? theirs[0] ?? null;

  /**
   * Which size range converts at which yield. With no demand ceiling the engine's
   * cascade fills the primary path first, taking that bucket's whole pool before
   * the secondary is considered — so where two paths point at the same bucket,
   * the earlier path claims it outright and its yield is the one that applies.
   */
  const sources = useMemo(() => {
    const seen = new Map<string, OtbPath>();
    for (const p of program?.paths ?? []) if (!seen.has(p.bucket_id)) seen.set(p.bucket_id, p);
    return [...seen.values()];
  }, [program]);

  // Whole round available per source, per month — the Total OTB split in two.
  const wrOf = (rec: Record<string, number>, bucketId: string, m: number) => rec[`${bucketId}:${m}`] ?? 0;

  const rowsFor = (pick: (bucketId: string, m: number) => number): GridRow[] =>
    sources.map((s) => ({
      key: s.bucket_id,
      label: bucketName.get(s.bucket_id) ?? 'Bucket',
      sublabel: `${s.path} · yield ${(s.yield * 100).toFixed(1)}%`,
      values: months.map((m) => pick(s.bucket_id, m) * s.yield),
    }));

  const metrics: Metric[] = useMemo(
    () => [
      {
        key: 'total',
        label: 'Total OTB (FG)',
        format: 'num0',
        rows: rowsFor((b, m) => wrOf(unallocated, b, m) + wrOf(pipeline, b, m)),
      },
      {
        key: 'unallocated',
        label: 'From unallocated WR (FG)',
        format: 'num0',
        rows: rowsFor((b, m) => wrOf(unallocated, b, m)),
      },
      {
        key: 'allocated',
        label: 'From WR held by inquiries (FG)',
        format: 'num0',
        rows: rowsFor((b, m) => wrOf(pipeline, b, m)),
      },
    ],
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [sources, unallocated, pipeline, months, bucketName]
  );

  // Horizon-wide headline. The grid below carries its own month filter; these
  // deliberately cover the whole plan, which is what an inquiry is sized against.
  const totals = useMemo(() => {
    let unalloc = 0, pipe = 0, unallocWr = 0, pipeWr = 0;
    for (const s of sources) {
      for (const m of months) {
        const u = wrOf(unallocated, s.bucket_id, m);
        const p = wrOf(pipeline, s.bucket_id, m);
        unallocWr += u; pipeWr += p;
        unalloc += u * s.yield; pipe += p * s.yield;
      }
    }
    return { unalloc, pipe, total: unalloc + pipe, unallocWr, pipeWr, totalWr: unallocWr + pipeWr };
  }, [sources, unallocated, pipeline, months]);

  // Finished goods for the printable sheet, at the chosen basis — summed across
  // the size ranges, since the customer offer is a single figure per month.
  const offerFg = useMemo(() => {
    const out: Record<number, number> = {};
    for (const m of months) {
      let fg = 0;
      for (const s of sources) {
        const wr = wrOf(unallocated, s.bucket_id, m) + (basis === 'total' ? wrOf(pipeline, s.bucket_id, m) : 0);
        fg += wr * s.yield;
      }
      out[m] = fg;
    }
    return out;
  }, [sources, months, unallocated, pipeline, basis]);

  if (customers.length === 0) {
    return <p className="text-sm text-muted-foreground">No customers yet — add a program first.</p>;
  }

  return (
    <div className="space-y-4">
      <div className="grid gap-3 rounded-lg border bg-card p-4 sm:grid-cols-2">
        <label className="block text-sm">
          <span className="mb-1 block font-medium">Customer</span>
          <select
            value={customer}
            onChange={(e) => { setCustomer(e.target.value); setProgramId(''); }}
            className={selectCls}
          >
            {customers.map((c) => <option key={c} value={c}>{c}</option>)}
          </select>
        </label>
        <label className="block text-sm">
          <span className="mb-1 block font-medium">Product (sets the yields)</span>
          <select value={program?.id ?? ''} onChange={(e) => setProgramId(e.target.value)} className={selectCls}>
            {theirs.map((p) => (
              <option key={p.id} value={p.id}>
                {p.item_description} ({p.item_code}){p.status !== 'active' ? ` · ${p.status}` : ''}
              </option>
            ))}
          </select>
        </label>
      </div>

      {!program || sources.length === 0 ? (
        <p className="rounded-lg border border-dashed p-4 text-sm text-muted-foreground">
          This product has no sourcing path with a yield, so there's nothing to convert. Set its buckets and yields on
          the Programs page.
        </p>
      ) : (
        <>
          <div className="grid grid-cols-2 gap-3 sm:grid-cols-3">
            <Stat
              label="Most we can provide"
              value={kg(totals.total)}
              sub={`FG · from ${kg(totals.totalWr)} WR`}
              tone="good"
            />
            <Stat
              label="From unallocated WR"
              value={kg(totals.unalloc)}
              sub={`FG · free capacity (${kg(totals.unallocWr)} WR)`}
            />
            <Stat
              label="From WR held by inquiries"
              value={kg(totals.pipe)}
              sub={`FG · needs freeing up (${kg(totals.pipeWr)} WR)`}
              tone="warn"
            />
          </div>

          <div className="flex flex-wrap items-end justify-between gap-3 rounded-lg border bg-muted/20 p-3">
            <label className="text-sm">
              <span className="mb-1 block font-medium">Customer offer — what to promise</span>
              <select value={basis} onChange={(e) => setBasis(e.target.value as OfferBasis)} className={cn(selectCls, 'sm:w-96')}>
                <option value="free">Free capacity only — safe to offer ({kg(totals.unalloc)} FG)</option>
                <option value="total">Everything incl. volume held by other inquiries ({kg(totals.total)} FG)</option>
              </select>
            </label>
            <Button variant="outline" onClick={() => window.print()}>
              <Printer className="h-4 w-4" /> Print / Save as PDF
            </Button>
          </div>

          <MetricGrid
            planStartDate={planStartDate}
            horizon={horizon}
            metrics={metrics}
            firstColLabel="Size range"
            filenameBase={`otb-${customer.replace(/\W+/g, '-').toLowerCase()}`}
          />

          <OfferSheet
            customer={customer}
            productLabel={`${program.item_description} (${program.item_code})`}
            planStartDate={planStartDate}
            months={months}
            fgByMonth={offerFg}
            basis={basis}
            reference={`${customer.replace(/\W+/g, '').slice(0, 6).toUpperCase()}-${program.item_code}`}
          />

          <p className="flex items-start gap-1 text-[11px] text-muted-foreground">
            <Info className="mt-0.5 h-3 w-3 shrink-0" />
            <span>
              Finished goods = whole round × that path&apos;s yield. <b>Total OTB</b> is spare whole round plus the whole
              round currently held by <b>unconfirmed</b> pipeline inquiries — confirming one promotes it to active and
              takes it out of this number, so the second figure is only reachable by trimming those inquiries (New
              Inquiry → “Free up capacity from pipeline”). Where two of the product&apos;s paths share a size range, the
              earlier path claims it, matching how the engine cascades. This is a ceiling across the whole plan, not a
              commitment — a Recalculate settles who actually gets the capacity, by rank.
            </span>
          </p>
        </>
      )}
    </div>
  );
}

function Stat({ label, value, sub, tone }: { label: string; value: string; sub?: string; tone?: 'good' | 'warn' }) {
  return (
    <div className="rounded-lg border bg-card px-3 py-2">
      <div className="text-xs text-muted-foreground">{label}</div>
      <div
        className={cn(
          'text-lg font-semibold tabular-nums',
          tone === 'good' && 'text-success',
          tone === 'warn' && 'text-warning'
        )}
      >
        {value}
      </div>
      {sub && <div className="text-[11px] text-muted-foreground">{sub}</div>}
    </div>
  );
}

const selectCls = 'w-full rounded-md border px-2.5 py-1.5 text-sm outline-none focus:ring-2 focus:ring-primary';
