'use client';

import { useMemo } from 'react';
import { OutputGrid } from '@/components/output-grid';
import type { GridRow } from '@/lib/grid-csv';
import { PrintableGrid } from '@/components/printable-grid';
import { MonthRangeProvider } from '@/components/month-range';
import { ScrollSyncProvider } from '@/components/ui/scroll-x';

/** What the inquiry-fulfilment shading means, for its exports. */
const INQUIRY_LEGEND = [
  { label: 'Fully fulfilled', bg: '#bbf7d0' },
  { label: 'Short', bg: '#fecaca' },
  {
    label: 'Partly fulfilled (green share = fulfilled)',
    bg: 'linear-gradient(90deg, #bbf7d0 0 50%, #fecaca 50% 100%)',
  },
];

/**
 * Everything Open to buy shows once the plan is computed — the two Total OTB
 * tables and the three breakdown sections, sharing one month range and one
 * sideways scroll — rendered purely from serializable props, so the online
 * page (inside <OfflineCopy>) and the offline entry draw the identical thing.
 * Cell hover text and shading travel as plain objects (an offline copy can't
 * hold a Map) and are folded back into the Maps the grids expect here.
 */
export type OpenToBuyViewProps = {
  planName: string;
  planStartDate: string;
  horizon: number;
  otbRows: GridRow[];
  otbTotalRows: GridRow[];
  unallocatedRows: GridRow[];
  allocatedRows: GridRow[];
  fulfilRows: GridRow[];
  /** Per-cell hover text / CSS background, keyed `${rowKey}:${month}`. */
  otbTitles: Record<string, string>;
  allocatedTitles: Record<string, string>;
  fulfilTitle: Record<string, string>;
  fulfilBg: Record<string, string>;
  /** Whether each result table had rows, which is what gates its export. */
  hasUnallocated: boolean;
  hasAllocated: boolean;
  anyFulfil: boolean;
};

export function OpenToBuyView({
  planName,
  planStartDate,
  horizon,
  otbRows,
  otbTotalRows,
  unallocatedRows,
  allocatedRows,
  fulfilRows,
  otbTitles,
  allocatedTitles,
  fulfilTitle,
  fulfilBg,
  hasUnallocated,
  hasAllocated,
  anyFulfil,
}: OpenToBuyViewProps) {
  const otbTitleMap = useMemo(() => new Map(Object.entries(otbTitles)), [otbTitles]);
  const allocatedTitleMap = useMemo(() => new Map(Object.entries(allocatedTitles)), [allocatedTitles]);
  const fulfilTitleMap = useMemo(() => new Map(Object.entries(fulfilTitle)), [fulfilTitle]);
  const fulfilBgMap = useMemo(() => new Map(Object.entries(fulfilBg)), [fulfilBg]);

  return (
    <MonthRangeProvider
      planStartDate={planStartDate}
      horizon={horizon}
      note="applies to every table below"
    >
      {/* Every table on this page scrolls sideways together */}
      <ScrollSyncProvider>
        {/* Total OTB — unallocated + unconfirmed (pipeline) inquiry WR, in one table */}
        <PrintableGrid
          title="Total OTB"
          planName={planName}
          planStartDate={planStartDate}
          horizon={horizon}
          rows={otbRows}
          firstColLabel="Bucket"
          unit="kg WR"
          cellTitle={otbTitleMap}
          csvFilename="total-otb"
          description={
            <>
              Everything still available to sell (kg WR) per bucket × month:{" "}
              <b>unallocated WR</b> plus the WR held by
              <b> unconfirmed inquiries</b> (pipeline programs — confirming
              one promotes it to active and drops it out of OTB). Hover a
              value for the split. <b>Print / PDF</b> and <b>Export CSV</b>{" "}
              cover the months selected above.
            </>
          }
        />

        {/* Total OTB, no bucket breakdown — the same figures on one line */}
        <PrintableGrid
          title="Total OTB — all buckets"
          planName={planName}
          planStartDate={planStartDate}
          horizon={horizon}
          rows={otbTotalRows}
          firstColLabel="Open to buy"
          unit="kg WR"
          showColumnTotals={false}
          csvFilename="total-otb-all-buckets"
          description={
            <>
              The table above with the size buckets collapsed away —
              everything still available to sell (kg WR) per month across
              every bucket. <b>Print / PDF</b> and <b>Export CSV</b> cover
              the months selected above.
            </>
          }
        />

        {/* Unallocated WR */}
        <section className="space-y-3">
          <h2 className="text-lg font-semibold">Unallocated WR</h2>
          <p className="text-xs text-muted-foreground">
            Spare whole-round capacity (kg WR) per bucket × month, after
            own-month consumption and all borrowings.
          </p>
          <OutputGrid
            planStartDate={planStartDate}
            horizon={horizon}
            rows={unallocatedRows}
            format="num0"
            firstColLabel="Bucket"
            unit="kg WR"
            exportAs={
              hasUnallocated
                ? {
                    filename: "unallocated-wr",
                    title: "Unallocated WR",
                    subtitle: `${planName} · kg WR`,
                  }
                : undefined
            }
          />
        </section>

        {/* Allocated with inquiries (formerly Pipeline WR) */}
        <section className="space-y-3">
          <h2 className="text-lg font-semibold">
            Allocated with inquiries
          </h2>
          <p className="text-xs text-muted-foreground">
            Whole-round (kg WR) consumed from each month&apos;s harvest by{" "}
            <b>pipeline / inquiry</b> programs (own-month +
            forward-borrowings sourcing here). Hover a value to see which
            inquiries make it up.
          </p>
          <OutputGrid
            planStartDate={planStartDate}
            horizon={horizon}
            rows={allocatedRows}
            format="num0"
            firstColLabel="Bucket"
            unit="kg WR"
            cellTitle={allocatedTitleMap}
            exportAs={
              hasAllocated
                ? {
                    filename: "allocated-with-inquiries",
                    title: "Allocated with inquiries",
                    subtitle: `${planName} · kg WR`,
                  }
                : undefined
            }
          />
        </section>

        {/* Inquiry fulfilment — which pipeline orders can be met */}
        <section className="space-y-3">
          <h2 className="text-lg font-semibold">Inquiry fulfilment</h2>
          <p className="text-xs text-muted-foreground">
            Each pipeline order&apos;s demand (kg FP) per month, shaded by
            how much the plan can fulfil —
            <span
              className="mx-1 rounded px-1"
              style={{ background: "#bbf7d0", color: "#1e293b" }}
            >
              fully
            </span>
            ,
            <span
              className="mx-1 rounded px-1"
              style={{ background: "#fecaca", color: "#1e293b" }}
            >
              short
            </span>
            , or a green/red split for partial. Hover a value for the
            fulfilled vs short split.
          </p>
          {anyFulfil ? (
            <OutputGrid
              planStartDate={planStartDate}
              horizon={horizon}
              rows={fulfilRows}
              format="num0"
              firstColLabel="Program"
              unit="kg FP"
              cellTitle={fulfilTitleMap}
              cellBg={fulfilBgMap}
              exportAs={{
                filename: "inquiry-fulfilment",
                title: "Inquiry fulfilment",
                subtitle: `${planName} · demand kg FP`,
                legend: INQUIRY_LEGEND,
              }}
            />
          ) : (
            <p className="rounded-lg border border-dashed p-4 text-sm text-muted-foreground">
              No pipeline demand is being computed. Pipeline orders are
              fulfilled only when the plan&apos;s Scope is{" "}
              <b>Active + Pipeline</b> (Settings) — set that and Recalculate
              to see this.
            </p>
          )}
        </section>
      </ScrollSyncProvider>
    </MonthRangeProvider>
  );
}
