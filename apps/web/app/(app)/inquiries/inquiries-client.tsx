'use client';

import { useMemo, useState } from 'react';
import { Download, ClipboardCheck } from 'lucide-react';
import { cn } from '@/lib/utils';
import { toCsv, downloadCsv } from '@/lib/csv';
import { Button } from '@/components/ui/button';
import { EmptyState } from '@/components/ui/empty-state';

export type InquiryRow = {
  id: string;
  created_at: string;
  created_by: string;
  kind: string;
  customer: string;
  item_code: string;
  item_description: string;
  months: number;
  total_fp: number;
};

const kg = (n: number) => `${Math.round(n).toLocaleString()} kg`;
const dt = (iso: string) => {
  const d = new Date(iso);
  return Number.isNaN(d.getTime()) ? '—' : d.toLocaleString(undefined, { year: 'numeric', month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit' });
};
/** Local YYYY-MM-DD for date-input comparison. */
const dayKey = (iso: string) => {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return '';
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
};

export function InquiriesClient({ planName, inquiries }: { planName: string; inquiries: InquiryRow[] }) {
  const [from, setFrom] = useState('');
  const [to, setTo] = useState('');
  const [person, setPerson] = useState('all');

  const people = useMemo(
    () => Array.from(new Set(inquiries.map((i) => i.created_by).filter(Boolean))).sort(),
    [inquiries]
  );

  const filtered = useMemo(
    () => inquiries.filter((i) => {
      const day = dayKey(i.created_at);
      if (from && day < from) return false;
      if (to && day > to) return false;
      if (person !== 'all' && i.created_by !== person) return false;
      return true;
    }),
    [inquiries, from, to, person]
  );

  const totalFp = filtered.reduce((s, i) => s + i.total_fp, 0);
  const clear = () => { setFrom(''); setTo(''); setPerson('all'); };
  const active = from || to || person !== 'all';

  function onExport() {
    const header = ['created_at', 'created_by', 'kind', 'customer', 'item_code', 'item_description', 'months', 'total_fp'];
    const data = filtered.map((i) => [i.created_at, i.created_by, i.kind, i.customer, i.item_code, i.item_description, i.months, i.total_fp]);
    downloadCsv('inquiries.csv', toCsv([header, ...data]));
  }

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div>
          <h1 className="text-2xl font-semibold tracking-tight">Inquiries</h1>
          <p className="mt-1 text-sm text-muted-foreground">Customer inquiries saved into <span className="font-medium text-foreground">{planName}</span>&apos;s pipeline.</p>
        </div>
        {filtered.length > 0 && <Button variant="outline" size="sm" onClick={onExport}><Download />Export CSV</Button>}
      </div>

      <div className="flex flex-wrap items-end gap-2 text-sm">
        <label>
          <span className="mb-1 block text-xs font-medium text-muted-foreground">From date</span>
          <input type="date" value={from} onChange={(e) => setFrom(e.target.value)} className={filterCls} />
        </label>
        <label>
          <span className="mb-1 block text-xs font-medium text-muted-foreground">To date</span>
          <input type="date" value={to} onChange={(e) => setTo(e.target.value)} className={filterCls} />
        </label>
        <label>
          <span className="mb-1 block text-xs font-medium text-muted-foreground">Created by</span>
          <select value={person} onChange={(e) => setPerson(e.target.value)} className={filterCls}>
            <option value="all">Anyone</option>
            {people.map((p) => <option key={p} value={p}>{p}</option>)}
          </select>
        </label>
        {active && <button type="button" onClick={clear} className="pb-1.5 text-xs font-medium text-primary hover:underline">Clear</button>}
        <span className="pb-1.5 text-xs text-muted-foreground">{filtered.length} inquir{filtered.length === 1 ? 'y' : 'ies'} · {kg(totalFp)} total</span>
      </div>

      {inquiries.length === 0 ? (
        <EmptyState
          icon={ClipboardCheck}
          title="No inquiries yet"
          description="Saved customer inquiries for this plan will appear here — raise one from the New Inquiry tab."
        />
      ) : filtered.length === 0 ? (
        <p className="rounded-lg border border-dashed p-6 text-sm text-muted-foreground">No inquiries match the current filters.</p>
      ) : (
        <div className="overflow-x-auto rounded-lg border">
          <table className="w-full text-sm">
            <thead className="bg-muted/50 text-muted-foreground">
              <tr>
                <th className="px-3 py-2 text-left font-medium">When</th>
                <th className="px-3 py-2 text-left font-medium">Created by</th>
                <th className="px-3 py-2 text-left font-medium">Customer</th>
                <th className="px-3 py-2 text-left font-medium">Item</th>
                <th className="px-3 py-2 text-left font-medium">Kind</th>
                <th className="px-3 py-2 text-right font-medium">Months</th>
                <th className="px-3 py-2 text-right font-medium">Total FP</th>
              </tr>
            </thead>
            <tbody>
              {filtered.map((i) => (
                <tr key={i.id} className="border-t">
                  <td className="px-3 py-2 whitespace-nowrap text-muted-foreground">{dt(i.created_at)}</td>
                  <td className="px-3 py-2">{i.created_by}</td>
                  <td className="px-3 py-2">{i.customer}</td>
                  <td className="px-3 py-2">
                    <span className="text-muted-foreground">{i.item_code}</span> {i.item_description}
                  </td>
                  <td className="px-3 py-2">
                    <span className={cn('rounded px-1.5 py-0.5 text-xs font-medium', i.kind === 'new' ? 'bg-primary/10 text-primary' : 'bg-muted text-muted-foreground')}>
                      {i.kind === 'new' ? 'New program' : 'Existing'}
                    </span>
                  </td>
                  <td className="px-3 py-2 text-right tabular-nums">{i.months}</td>
                  <td className="px-3 py-2 text-right tabular-nums font-medium">{kg(i.total_fp)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}

const filterCls = 'rounded-md border px-2.5 py-1.5 text-sm outline-none focus:ring-2 focus:ring-primary';
