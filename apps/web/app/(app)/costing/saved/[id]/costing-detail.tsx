'use client';

import Link from 'next/link';
import { useMemo, useState } from 'react';
import { ArrowLeft, Download, FileText, Printer, TrendingDown, TrendingUp } from 'lucide-react';
import {
  COST_STATE_LABEL,
  type CostCosting,
  type CostCostingDestination,
  type CostCostingLine,
  type CostProductState,
} from '@oceanpick/shared';
import { toCsv, downloadCsv } from '@/lib/csv';
import { downloadDoc, slugify } from '@/lib/doc-export';
import { Dialog } from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import { ScrollX } from '@/components/ui/scroll-x';
import { cn } from '@/lib/utils';
import { BaseCostToggle } from '@/components/cost-sheet-parts';
import { CostSheet, COST_SHEET_ID } from './cost-sheet';

export interface RepricedLine {
  finalCost: number;
  sellingPrice: number | null;
}

export function CostingDetail({
  costing,
  lines,
  destinations,
  pinnedLabel,
  pinnedIsCurrent,
  currentLabel,
  authorName,
  repriced,
  showBaseCost,
}: {
  costing: CostCosting;
  lines: CostCostingLine[];
  destinations: CostCostingDestination[];
  pinnedLabel: string;
  pinnedIsCurrent: boolean;
  currentLabel: string | null;
  authorName: string;
  repriced: Record<string, RepricedLine>;
  /**
   * Whether the reader may see what the fish costs to grow. False also means
   * the page stripped those figures out of `lines` and `costing` before they
   * were sent — this flag only decides what the sheet draws.
   */
  showBaseCost: boolean;
}) {
  const [showReprice, setShowReprice] = useState(false);
  const [state, setState] = useState<CostProductState | 'all'>('all');
  // The line whose breakdown sheet is open, for print / Word / preview.
  const [sheetLine, setSheetLine] = useState<CostCostingLine | null>(null);
  // Whether this sheet carries the base cost build-up. Starts on, so a reader
  // who is allowed the detail keeps getting it, and comes off in one click for
  // a copy that is going outside. Only reachable when showBaseCost is true.
  const [includeBaseCost, setIncludeBaseCost] = useState(true);
  const sheetBaseCost = showBaseCost && includeBaseCost;

  const overrides = Object.entries(costing.assumption_overrides ?? {});
  const states = useMemo(
    () => [...new Set(lines.map((l) => l.state))] as CostProductState[],
    [lines]
  );
  const visible = useMemo(
    () => (state === 'all' ? lines : lines.filter((l) => l.state === state)),
    [lines, state]
  );

  const domestic = costing.market === 'domestic';
  const money = domestic ? (n: number) => Math.round(n).toLocaleString() : (n: number) => n.toFixed(2);

  // Only meaningful once the pinned version is no longer the current one.
  const repriceAvailable = !pinnedIsCurrent && Object.keys(repriced).length > 0;

  function onWord() {
    if (!sheetLine) return;
    const title = `${costing.name} — ${sheetLine.sku_name}`;
    const name = `${slugify(costing.name, 'costing')}-${slugify(sheetLine.sku_name, 'sku')}-${sheetLine.state}`;
    // The sheet is always mounted while a line is selected, so a miss here means
    // the id moved rather than a timing problem — say so instead of failing mute.
    if (!downloadDoc(name, COST_SHEET_ID, title)) {
      window.alert('Could not build the document — the breakdown sheet was not found on the page.');
    }
  }

  function onExport() {
    const head = ['SKU', 'Port', 'State', 'Currency', 'FINAL cost', 'Selling price', 'Contribution/kg'];
    const body = visible.map((l) => [
      l.sku_name,
      l.destination_name ?? '',
      COST_STATE_LABEL[l.state],
      l.currency,
      round(l.final_cost),
      round(l.selling_price),
      round(l.contribution_per_kg),
    ]);
    downloadCsv(`${slug(costing.name)}.csv`, toCsv([head, ...body]));
  }

  return (
    <div className="mx-auto max-w-6xl space-y-4">
      <Link href="/costing/saved" className="inline-flex items-center gap-1 text-xs text-muted-foreground hover:text-foreground">
        <ArrowLeft className="h-3.5 w-3.5" /> All costings
      </Link>

      <header className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h1 className="text-2xl font-semibold tracking-tight">{costing.name}</h1>
          <p className="mt-0.5 text-sm text-muted-foreground">
            <span className="capitalize">{costing.market}</span> · {authorName} ·{' '}
            {new Date(costing.created_at).toLocaleDateString()}
            {destinations.length > 0 && ` · ${destinations.map((d) => d.destination_name).join(', ')}`}
          </p>
        </div>
        <button onClick={onExport} className="inline-flex items-center gap-1.5 rounded-md border px-2.5 py-1.5 text-xs font-medium hover:bg-muted">
          <Download className="h-3.5 w-3.5" /> Export
        </button>
      </header>

      {costing.notes && <p className="rounded-md bg-muted/50 px-3 py-2 text-sm">{costing.notes}</p>}

      <div className="flex flex-wrap items-center gap-2 rounded-lg border bg-card p-3 text-xs">
        <span className="font-medium">Built on {pinnedLabel}</span>
        {pinnedIsCurrent ? (
          <span className="text-muted-foreground">— still the current assumptions</span>
        ) : (
          <span className="text-warning">— assumptions have moved on since ({currentLabel} is current)</span>
        )}

        {repriceAvailable && (
          <button
            onClick={() => setShowReprice((v) => !v)}
            className={cn(
              'ml-auto rounded-md border px-2.5 py-1 font-medium',
              showReprice ? 'border-primary bg-primary/10 text-primary' : 'hover:bg-muted'
            )}
          >
            {showReprice ? 'Hide reprice' : 'Reprice at current assumptions'}
          </button>
        )}
      </div>

      {overrides.length > 0 && (
        <div className="rounded-md border border-primary/40 bg-primary/5 px-3 py-2 text-xs">
          <strong className="font-medium text-primary">Custom assumptions.</strong>{' '}
          This costing deviates from the company&apos;s official numbers on:{' '}
          {overrides.map(([k, v]) => `${k.replace(/_/g, ' ')} = ${v}`).join(', ')}.
        </div>
      )}

      {showReprice && (
        <p className="rounded-md bg-muted/50 px-3 py-2 text-xs text-muted-foreground">
          The stored figures are what was quoted and never change. The reprice column shows what the
          same SKU would cost today — a SKU archived since is left blank rather than guessed at.
        </p>
      )}

      {states.length > 1 && (
        <div className="flex flex-wrap items-center gap-1.5">
          <button onClick={() => setState('all')} className={chip(state === 'all')}>
            All states
          </button>
          {states.map((s) => (
            <button key={s} onClick={() => setState(s)} className={chip(state === s)}>
              {COST_STATE_LABEL[s]}
            </button>
          ))}
        </div>
      )}

      <ScrollX className="rounded-lg border bg-card">
        <table className="w-full border-collapse text-right text-xs tabular-nums">
          <thead>
            <tr className="border-b bg-muted/40 text-[10px] uppercase tracking-wide text-muted-foreground">
              <th className={cn(th, 'sticky left-0 z-10 bg-muted/40 text-left')}>SKU</th>
              {destinations.length > 1 && <th className={cn(th, 'text-left')}>Port</th>}
              <th className={cn(th, 'text-left')}>State</th>
              <th className={th}>FINAL cost</th>
              <th className={th}>Selling price</th>
              <th className={th}>Contribution</th>
              {showReprice && (
                <>
                  <th className={cn(th, 'border-l')}>Today&apos;s cost</th>
                  <th className={th}>Change</th>
                </>
              )}
              <th className={cn(th, 'text-right')} />
            </tr>
          </thead>
          <tbody>
            {visible.map((l) => {
              const now = repriced[l.id];
              const delta = now ? now.finalCost - l.final_cost : null;
              return (
                <tr key={l.id} className="border-b last:border-0 hover:bg-muted/30">
                  <th className={cn(td, 'sticky left-0 z-10 max-w-[240px] truncate bg-card text-left font-medium')} title={l.sku_name}>
                    {l.sku_name}
                  </th>
                  {destinations.length > 1 && <td className={cn(td, 'text-left')}>{l.destination_name ?? '—'}</td>}
                  <td className={cn(td, 'text-left text-muted-foreground')}>{COST_STATE_LABEL[l.state]}</td>
                  <td className={cn(td, 'font-semibold')}>{money(l.final_cost)}</td>
                  <td className={td}>{l.selling_price != null ? money(l.selling_price) : '—'}</td>
                  <td className={td}>
                    {l.contribution_per_kg != null ? (
                      <span className={l.contribution_per_kg >= 0 ? 'text-success' : 'text-destructive'}>
                        {money(l.contribution_per_kg)}
                      </span>
                    ) : (
                      '—'
                    )}
                  </td>
                  {showReprice && (
                    <>
                      <td className={cn(td, 'border-l')}>{now ? money(now.finalCost) : '—'}</td>
                      <td className={td}>
                        {delta == null ? (
                          '—'
                        ) : Math.abs(delta) < 0.005 ? (
                          <span className="text-muted-foreground">no change</span>
                        ) : (
                          <span className={cn('inline-flex items-center gap-1', delta > 0 ? 'text-destructive' : 'text-success')}>
                            {delta > 0 ? <TrendingUp className="h-3 w-3" /> : <TrendingDown className="h-3 w-3" />}
                            {delta > 0 ? '+' : ''}
                            {money(delta)}
                          </span>
                        )}
                      </td>
                    </>
                  )}
                  <td className={cn(td, 'text-right')}>
                    <button
                      onClick={() => setSheetLine(l)}
                      className="whitespace-nowrap font-medium text-primary hover:underline"
                    >
                      Breakdown
                    </button>
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </ScrollX>

      {/*
        Two copies of the same sheet, deliberately. The one in the dialog is the
        on-screen preview; the one below carries COST_SHEET_ID and is what print
        reveals and the Word export serialises — it sits at page level, outside
        the dialog's fixed positioning, so a sheet longer than a page still
        prints in full.
      */}
      {sheetLine && (
        <>
          <Dialog
            open
            onClose={() => setSheetLine(null)}
            title="Cost breakdown"
            description={`${sheetLine.sku_name} · ${COST_STATE_LABEL[sheetLine.state]}${sheetLine.destination_name ? ` · ${sheetLine.destination_name}` : ''}`}
            className="max-w-3xl print:hidden"
            footer={
              <>
                <Button variant="outline" onClick={() => setSheetLine(null)}>Close</Button>
                <Button variant="outline" onClick={onWord}>
                  <FileText className="h-4 w-4" /> Download Word
                </Button>
                <Button onClick={() => window.print()}>
                  <Printer className="h-4 w-4" /> Print / Save as PDF
                </Button>
              </>
            }
          >
            {showBaseCost && (
              <div className="mb-3">
                <BaseCostToggle include={includeBaseCost} onChange={setIncludeBaseCost} />
              </div>
            )}
            <div className="max-h-[65vh] overflow-y-auto rounded-md border">
              <CostSheet costing={costing} line={sheetLine} pinnedLabel={pinnedLabel} authorName={authorName} showBaseCost={sheetBaseCost} />
            </div>
            <p className="mt-3 text-xs text-muted-foreground">
              Both formats hold the figures as saved, not as they would price today. The Word file is editable, so
              anything else not meant for the recipient can be taken out before it is sent.
            </p>
          </Dialog>

          <div className="hidden print:block">
            <CostSheet
              costing={costing}
              line={sheetLine}
              pinnedLabel={pinnedLabel}
              authorName={authorName}
              showBaseCost={sheetBaseCost}
              elementId={COST_SHEET_ID}
            />
          </div>
        </>
      )}
    </div>
  );
}

const round = (n: number | null): number | null => (n == null ? null : Math.round(n * 10000) / 10000);
const slug = (s: string) => s.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '') || 'costing';
const chip = (active: boolean) =>
  cn(
    'rounded-full border px-2.5 py-0.5 text-xs',
    active ? 'border-primary bg-primary/10 font-medium text-primary' : 'text-muted-foreground hover:bg-muted'
  );
const th = 'whitespace-nowrap px-2 py-2 font-medium';
const td = 'whitespace-nowrap px-2 py-1.5';
