import { createClient } from '@/lib/supabase/server';
import { getActivePlan, getSelectablePlans } from '@/lib/plan';
import { computeDiff } from '@/lib/diff';
import { computeMonthlyCompare } from '@/lib/plan-compare';
import type { Plan } from '@oceanpick/shared';
import { type PickPlan } from './compare-picker';
import { bySummaryPeriod, withSideProducts } from '@/lib/annual-summary';
import { sideProductTotals } from '@/lib/side-products';
import { OfflineCopy } from '@/components/pwa/offline-copy';
import { DiffView } from './diff-view';

/** Short kind label for a plan, for the picker. */
function kindOf(p: Plan): string {
  if (p.type === 'master') return 'Master';
  if (p.is_live) return 'Live';
  if (p.is_sandbox) return 'Sandbox';
  return 'Official';
}

export default async function DiffPage({ searchParams }: { searchParams: Promise<{ a?: string; b?: string }> }) {
  const sp = await searchParams;
  const [plans, active] = await Promise.all([getSelectablePlans(), getActivePlan()]);

  if (plans.length < 2) {
    return (
      <div className="mx-auto max-w-3xl space-y-4">
        <h1 className="text-2xl font-semibold tracking-tight">Compare plans</h1>
        <div className="rounded-lg border border-dashed bg-muted/30 p-8 text-sm text-muted-foreground">
          You need at least two plans to compare. Create a scenario or an official plan first.
        </div>
      </div>
    );
  }

  const master = plans.find((p) => p.type === 'master');
  // A defaults to the master; B defaults to the active plan (if it isn't A).
  const planA = plans.find((p) => p.id === sp.a) ?? master ?? plans[0];
  let planB =
    plans.find((p) => p.id === sp.b) ??
    (active && active.id !== planA.id ? active : undefined) ??
    plans.find((p) => p.id !== planA.id) ??
    plans[0];
  if (planB.id === planA.id) planB = plans.find((p) => p.id !== planA.id) ?? planB;

  const pick: PickPlan[] = plans.map((p) => ({ id: p.id, name: p.name, label: kindOf(p) }));

  const supabase = await createClient();
  const sameplan = planA.id === planB.id;
  // The by-product and other-product rows aren't in `plan_summary` — they're
  // computed on read, per plan: by-product revenue follows each plan's own
  // allocated whole round, while the other-product lines are org-wide and so
  // read the same on both sides.
  const [d, monthly, summaryA, summaryB, sideA, sideB] = await Promise.all([
    computeDiff(supabase, planA, planB),
    sameplan ? Promise.resolve(null) : computeMonthlyCompare(supabase, planA, planB),
    supabase.from('plan_summary').select('*').eq('plan_id', planA.id),
    supabase.from('plan_summary').select('*').eq('plan_id', planB.id),
    sideProductTotals(supabase, planA.id, planA.horizon_months),
    sideProductTotals(supabase, planB.id, planB.horizon_months),
  ]);
  // The annual figures only exist once a plan has been computed; a plan that
  // never was would otherwise read as a column of zeroes rather than as absent.
  const annualMissing = [
    !summaryA.data?.length ? planA.name : null,
    !summaryB.data?.length ? planB.name : null,
  ].filter(Boolean) as string[];
  // FY1 is the plan's own first year, so two plans that start in different
  // years line up column-by-column but not calendar-by-calendar.
  const annualYearsDiffer = planA.plan_start_date.slice(0, 7) !== planB.plan_start_date.slice(0, 7);

  // The offline copy holds the comparison currently on screen — whichever two
  // plans were picked last while online.
  const props = {
    plans: pick,
    aId: planA.id,
    bId: planB.id,
    aName: planA.name,
    bName: planB.name,
    aStart: planA.plan_start_date,
    bStart: planB.plan_start_date,
    d,
    monthly,
    annualA: withSideProducts(bySummaryPeriod(summaryA.data), summaryA.data?.length ? sideA : null),
    annualB: withSideProducts(bySummaryPeriod(summaryB.data), summaryB.data?.length ? sideB : null),
    annualMissing,
    annualYearsDiffer,
  };
  return (
    <OfflineCopy route="diff" props={props}>
      <DiffView {...props} />
    </OfflineCopy>
  );
}
