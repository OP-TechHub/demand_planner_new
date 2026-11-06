import { createClient } from "@/lib/supabase/server";
import { getActivePlan } from "@/lib/plan";
import { NotComputed } from "@/components/output-grid";
import { type GridRow } from "@/lib/grid-csv";
import { StalePlanNotice } from "../stale-banner";
import { OfflineCopy } from "@/components/pwa/offline-copy";
import { OpenToBuyView } from "./open-to-buy-view";
import { fetchAllByPlan } from "@/lib/fetch-all";
import { CHANNELS } from "@oceanpick/engine";
import { ALLOC_PATHS, PATH_SELECT, programPath, type AllocPath } from "@oceanpick/shared";

/**
 * The engine's borrow channels as `rolling_results` columns, paired with the
 * source they draw from: offset months back, in the bucket at `pathIdx`.
 * Taken from the engine's own channel list so a deeper lookback or another path
 * never silently drops channels out of this attribution.
 */
const BORROW_CHANNELS: { col: string; offset: number; pathIdx: number }[] =
  CHANNELS.map((ch) => ({
    col: `borrow_${ch.field}_wr`,
    offset: ch.offset,
    pathIdx: ALLOC_PATHS.indexOf(ch.path as AllocPath),
  }));
const BORROW_COLS = BORROW_CHANNELS.map((c) => c.col);

export default async function OpenToBuyPage() {
  const plan = await getActivePlan();
  if (!plan) return <h1 className="text-2xl font-semibold">Open to buy</h1>;
  const supabase = await createClient();

  const months = Array.from({ length: plan.horizon_months }, (_, i) => i + 1);
  const [{ data: buckets }, uw, pw, { data: pipePrograms }, allocs, rr] =
    await Promise.all([
      supabase
        .from("buckets")
        .select("id, name, sort_order")
        .eq("is_archived", false)
        .order("sort_order"),
      fetchAllByPlan(
        supabase,
        "unallocated_wr",
        "bucket_id, month_index, unallocated_wr",
        plan.id,
      ),
      fetchAllByPlan(
        supabase,
        "pipeline_wr",
        "bucket_id, month_index, pipeline_wr",
        plan.id,
      ),
      // For the per-cell breakdown: which pipeline programs consumed each bucket-month.
      supabase
        .from("programs")
        .select(
          "id, item_code, item_description, customer, " + PATH_SELECT,
        )
        .eq("plan_id", plan.id)
        .eq("status", "pipeline")
        .is("deleted_at", null)
        .order("sort_order"),
      fetchAllByPlan(
        supabase,
        "allocations",
        "program_id, month_index, path, allocated_wr",
        plan.id,
      ),
      fetchAllByPlan(
        supabase,
        "rolling_results",
        "program_id, month_index, demand_fp, rolling_fp, " +
          BORROW_COLS.join(", "),
        plan.id,
      ),
    ]);

  // Reconstruct pipeline_wr's per-program breakdown per (bucket, month), exactly as
  // the engine attributes it: own-month allocations + every borrow channel (each
  // sourcing from its path's bucket at month−offset).
  type Prog = { label: string; buckets: (string | null)[] }; // indexed in ALLOC_PATHS order
  const pipe = new Map<string, Prog>();
  for (const p of (pipePrograms ?? []) as unknown as ({
    id: string;
    item_code: string;
    item_description: string;
  } & Parameters<typeof programPath>[0])[]) {
    pipe.set(p.id, {
      label: `${p.item_code} — ${p.item_description}`,
      buckets: ALLOC_PATHS.map((path) => programPath(p, path).bucket_id),
    });
  }
  const contrib = new Map<string, Map<string, number>>(); // `${bucket}:${month}` -> programId -> wr
  const add = (
    bucket: string | null | undefined,
    month: number,
    progId: string,
    wr: number,
  ) => {
    if (!bucket || month < 1 || !(wr > 0)) return;
    const k = `${bucket}:${month}`;
    let inner = contrib.get(k);
    if (!inner) {
      inner = new Map();
      contrib.set(k, inner);
    }
    inner.set(progId, (inner.get(progId) ?? 0) + wr);
  };
  for (const a of allocs as {
    program_id: string;
    month_index: number;
    path: AllocPath;
    allocated_wr: number;
  }[]) {
    const p = pipe.get(a.program_id);
    if (p)
      add(
        p.buckets[ALLOC_PATHS.indexOf(a.path)],
        a.month_index,
        a.program_id,
        Number(a.allocated_wr),
      );
  }
  for (const r of rr as Record<string, number | string>[]) {
    const p = pipe.get(r.program_id as string);
    if (!p) continue;
    const T = r.month_index as number;
    for (const ch of BORROW_CHANNELS) {
      add(
        p.buckets[ch.pathIdx],
        T - ch.offset,
        r.program_id as string,
        Number(r[ch.col] ?? 0),
      );
    }
  }
  // Per-cell hover texts are plain objects, not Maps: the whole props bag is
  // saved as the page's offline copy, so it must stay plain serializable data.
  const allocatedTitles: Record<string, string> = {};
  for (const [k, inner] of contrib) {
    const items = [...inner.entries()]
      .filter(([, wr]) => wr > 0.5)
      .sort((a, b) => b[1] - a[1]);
    if (!items.length) continue;
    const lines = items
      .slice(0, 12)
      .map(
        ([pid, wr]) =>
          `${pipe.get(pid)?.label ?? pid}: ${Math.round(wr).toLocaleString()} kg`,
      );
    const extra = items.length > 12 ? `\n… +${items.length - 12} more` : "";
    allocatedTitles[k] = `Inquiries allocated here:\n${lines.join("\n")}${extra}`;
  }

  const gridFor = (rowsByBM: Map<string, number>): GridRow[] =>
    (buckets ?? []).map((b) => ({
      key: b.id,
      label: b.name,
      values: months.map((m) => rowsByBM.get(`${b.id}:${m}`) ?? 0),
    }));

  const uwByBM = new Map<string, number>();
  for (const r of uw)
    uwByBM.set(`${r.bucket_id}:${r.month_index}`, r.unallocated_wr);
  const pwByBM = new Map<string, number>();
  for (const r of pw)
    pwByBM.set(`${r.bucket_id}:${r.month_index}`, r.pipeline_wr);

  const unallocatedRows = gridFor(uwByBM);
  const allocatedRows = gridFor(pwByBM);
  const computed = uw.length > 0 || pw.length > 0;

  const kg = (n: number) => `${Math.round(n).toLocaleString()} kg`;

  // Total OTB = spare capacity + the WR still held by UNCONFIRMED inquiries.
  // Every `pipeline` program is unconfirmed by definition — confirming one promotes
  // it to `active`, which moves its WR out of pipeline_wr and so out of OTB.
  const otbRows: GridRow[] = (buckets ?? []).map((b) => ({
    key: b.id,
    label: b.name,
    values: months.map(
      (m) =>
        (uwByBM.get(`${b.id}:${m}`) ?? 0) + (pwByBM.get(`${b.id}:${m}`) ?? 0),
    ),
  }));
  const otbTitles: Record<string, string> = {};
  for (const b of buckets ?? []) {
    for (const m of months) {
      const u = uwByBM.get(`${b.id}:${m}`) ?? 0;
      const p = pwByBM.get(`${b.id}:${m}`) ?? 0;
      if (u + p <= 0) continue;
      otbTitles[`${b.id}:${m}`] =
        `Unallocated: ${kg(u)}\nUnconfirmed inquiries: ${kg(p)}\nTotal OTB: ${kg(u + p)}`;
    }
  }

  // The same OTB figures with the size buckets collapsed away — one line per
  // component, so the month totals can be read without scanning seven rows.
  const monthSum = (by: Map<string, number>, m: number) =>
    (buckets ?? []).reduce((s, b) => s + (by.get(`${b.id}:${m}`) ?? 0), 0);
  const otbTotalRows: GridRow[] = [
    {
      key: "total",
      label: "Total OTB",
      values: months.map((m) => monthSum(uwByBM, m) + monthSum(pwByBM, m)),
    },
  ];

  // Inquiry fulfilment: each pipeline program's demand vs what the plan can fulfil,
  // per month — coloured green (fulfilled) to red (short), proportionally.
  // The concatenated select defeats Supabase's row-type inference, so name the shape.
  const pipeRows = (pipePrograms ?? []) as unknown as {
    id: string;
    item_code: string;
    item_description: string;
    customer: string;
  }[];
  const demByPM = new Map<string, number>();
  const fulByPM = new Map<string, number>();
  for (const r of rr as Record<string, number | string>[]) {
    if (!pipe.has(r.program_id as string)) continue;
    demByPM.set(`${r.program_id}:${r.month_index}`, Number(r.demand_fp));
    fulByPM.set(`${r.program_id}:${r.month_index}`, Number(r.rolling_fp));
  }
  const fulfilRows: GridRow[] = pipeRows.map((p) => ({
    key: p.id,
    label: p.customer,
    sublabel: `${p.item_description} (${p.item_code})`,
    values: months.map((m) => demByPM.get(`${p.id}:${m}`) ?? null),
  }));
  const fulfilBg: Record<string, string> = {};
  const fulfilTitle: Record<string, string> = {};
  for (const p of pipeRows) {
    for (const m of months) {
      const dem = demByPM.get(`${p.id}:${m}`) ?? 0;
      if (dem <= 0) continue;
      const ful = Math.min(fulByPM.get(`${p.id}:${m}`) ?? 0, dem);
      const s = Math.round(Math.max(0, Math.min(1, ful / dem)) * 100);
      fulfilBg[`${p.id}:${m}`] =
        `linear-gradient(90deg, #bbf7d0 0 ${s}%, #fecaca ${s}% 100%)`;
      fulfilTitle[`${p.id}:${m}`] =
        `Fulfilled ${kg(ful)} of ${kg(dem)} (${s}%) — short ${kg(dem - ful)}`;
    }
  }
  const anyFulfil = fulfilRows.some((r) => r.values.some((v) => (v ?? 0) > 0));

  // Everything below the stale-plan notice renders from this one bag — the
  // same object feeds the offline copy, so the copy holds exactly this view.
  const props = {
    planName: plan.name,
    planStartDate: plan.plan_start_date,
    horizon: plan.horizon_months,
    otbRows,
    otbTotalRows,
    unallocatedRows,
    allocatedRows,
    fulfilRows,
    otbTitles,
    allocatedTitles,
    fulfilTitle,
    fulfilBg,
    hasUnallocated: uw.length > 0,
    hasAllocated: pw.length > 0,
    anyFulfil,
  };

  return (
    <div className="space-y-8">
      <div>
        <h1 className="text-2xl font-semibold tracking-tight">Open to buy</h1>
        <p className="mt-1 text-sm text-muted-foreground">
          What&apos;s still available to sell — spare capacity plus unconfirmed
          inquiry whole round, per bucket × month.
        </p>
      </div>

      <StalePlanNotice
        planId={plan.id}
        lastComputedAt={plan.last_computed_at}
      />

      {!computed ? (
        <NotComputed />
      ) : (
        <OfflineCopy route="open-to-buy" props={props}>
          <OpenToBuyView {...props} />
        </OfflineCopy>
      )}
    </div>
  );
}
