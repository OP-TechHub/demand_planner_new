'use client';

import { useMemo } from 'react';
import type { GridRow } from '@/lib/grid-csv';
import { OrderBookGrid } from './order-book-grid';
import { BLUE, PINK, YELLOW } from './colors';

/**
 * Everything the Order Book shows below the stale-plan notice — legend, grid
 * and reading guide — rendered purely from serializable props, so the online
 * page (inside <OfflineCopy>) and the offline entry draw the identical thing.
 * Cell shading and hover text travel as plain objects (an offline copy can't
 * hold a Map) and are folded back into the Maps OrderBookGrid expects here.
 */
export type OrderBookViewProps = {
  planStartDate: string;
  horizon: number;
  /** `group` carries the program's status. */
  rows: GridRow[];
  /** Months (1-based) each row holds a PO for, keyed by row key. */
  poMonths: Record<string, number[]>;
  /** Per-cell CSS background / hover text, keyed `${rowKey}:${month}`. */
  cellBg: Record<string, string>;
  cellTitle: Record<string, string>;
  /** Whether the engine has produced results (pipeline rows read zero until then). */
  computed: boolean;
  anyPipeline: boolean;
};

export function OrderBookView({
  planStartDate,
  horizon,
  rows,
  poMonths,
  cellBg,
  cellTitle,
  computed,
  anyPipeline,
}: OrderBookViewProps) {
  const bgMap = useMemo(() => new Map(Object.entries(cellBg)), [cellBg]);
  const titleMap = useMemo(() => new Map(Object.entries(cellTitle)), [cellTitle]);

  return (
    <>
      <div className="flex flex-wrap items-center gap-x-5 gap-y-2 rounded-lg border bg-card px-4 py-3 text-xs">
        <Key color={BLUE} title="PO received">the month&apos;s PO quantity — firm</Key>
        <Key color={PINK} title="Active, no PO">forecast demand — not yet sold</Key>
        <Key color={YELLOW} title="Pipeline">what the plan can fulfil, not the full ask</Key>
      </div>

      {!computed && anyPipeline && (
        <p className="rounded-md border border-warning/30 bg-warning/10 px-3 py-2 text-xs text-warning">
          Pipeline rows read zero until the plan is calculated — their figure is what the engine can fulfil, and there
          are no results yet. <b>Recalculate</b> to fill them in.
        </p>
      )}

      {rows.length === 0 ? (
        <p className="rounded-lg border border-dashed p-6 text-center text-sm text-muted-foreground">
          This plan has no programs yet — add them on the Programs tab first.
        </p>
      ) : (
        <OrderBookGrid
          planStartDate={planStartDate}
          horizon={horizon}
          rows={rows}
          poMonths={poMonths}
          cellBg={bgMap}
          cellTitle={titleMap}
          legend={[
            { label: 'PO received — firm', bg: BLUE },
            { label: 'Active, no PO — forecast', bg: PINK },
            { label: 'Pipeline — what the plan can fulfil', bg: YELLOW },
          ]}
        />
      )}

      <p className="text-xs text-muted-foreground">
        Pick the months you want, then narrow to the programs you care about — the picker beside the tabs takes any
        number of them, and searching by customer lets you add a whole account at once. The tabs then sort what&apos;s
        left by what it does <i>in those months</i>: <b>PO received</b> is any program holding a PO in that window,
        <b> Active, no PO</b> is an active program with none, and <b>Pipeline</b> is the inquiry rows. Narrowing the
        months re-answers the question, so a program whose only PO lands outside the window moves between the first two,
        and the counts on the tabs move with it. Active and pipeline programs are kept apart, active first. For an <b>active</b> program the figure is its demand
        plan quantity — <span className="rounded px-1" style={{ background: BLUE, color: '#1e293b' }}>blue</span> once a
        PO has been received for that month (the PO Update tab has already set demand to the PO sum), and{' '}
        <span className="rounded px-1" style={{ background: PINK, color: '#1e293b' }}>pink</span> while it is still
        only a forecast. A <b>pipeline</b> program is{' '}
        <span className="rounded px-1" style={{ background: YELLOW, color: '#1e293b' }}>yellow</span> and shows what the
        plan <b>can fulfil</b> rather than what was asked for, because an unconfirmed inquiry only belongs in an order
        book to the extent supply can actually cover it — hover one to see the ask behind it. Months with no demand, and
        pipeline months the plan can&apos;t fulfil at all, are left uncoloured. The TOTAL row therefore adds firm and
        forecast active demand to fulfilable pipeline, which is the order book as a whole.
      </p>
    </>
  );
}

function Key({ color, title, children }: { color: string; title: string; children: React.ReactNode }) {
  return (
    <span className="flex items-center gap-2">
      <span className="h-4 w-6 shrink-0 rounded border border-border" style={{ background: color }} />
      <span>
        <b>{title}</b> <span className="text-muted-foreground">— {children}</span>
      </span>
    </span>
  );
}
