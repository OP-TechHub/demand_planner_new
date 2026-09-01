import { createClient } from '@/lib/supabase/server';
import { getActivePlan, getProfile } from '@/lib/plan';
import { NotComputed } from '@/components/output-grid';
import { StalePlanNotice } from '../stale-banner';
import { fetchAllByPlan } from '@/lib/fetch-all';
import { SecondaryProductsClient, type SecondaryDef, type SourceOption } from './secondary-products-client';
import { OtherProductsClient, type OtherProduct } from './other-products-client';

/**
 * Secondary products — the by-products recovered while processing a main product.
 *
 * Processing whole round into a finished product also yields saleable off-cuts.
 * Each by-product carries a recovery rate and a price:
 *
 *   quantity = feedstock WR × yield_pct        revenue = quantity × price_per_kg
 *
 * Feedstock is `rolling_results.rolling_wr` for the source program — the whole
 * round the engine actually allocated to it, borrowings included. By-products
 * only exist if fish was really processed, so unfulfilled demand yields nothing.
 */
export default async function SecondaryProductsPage() {
  const plan = await getActivePlan();
  if (!plan) return <h1 className="text-2xl font-semibold">Secondary products</h1>;
  const supabase = await createClient();
  const horizon = plan.horizon_months;

  const [{ data: defs }, { data: progs }, rr, profile, { data: others }, { data: otherMonths }] = await Promise.all([
    supabase
      .from('secondary_products')
      .select('id, basis, source_item_code, name, yield_pct, price_per_kg, sort_order, is_archived')
      .order('sort_order'),
    supabase
      .from('programs')
      .select('id, item_code, item_description')
      .eq('plan_id', plan.id).is('deleted_at', null).order('sort_order'),
    fetchAllByPlan(supabase, 'rolling_results', 'program_id, month_index, rolling_wr', plan.id),
    getProfile(),
    // Other products are org-wide, like the by-product definitions: no plan_id,
    // so they survive a scenario fork with no clone logic.
    supabase
      .from('other_products')
      .select('id, name, unit_label, unit_cost, unit_revenue, sort_order, is_archived')
      .order('sort_order'),
    supabase.from('other_product_months').select('product_id, month_index, quantity'),
  ]);

  const programs = (progs ?? []) as { id: string; item_code: string; item_description: string }[];

  // Feedstock per source product per month. Keyed by item_code because that's how
  // by-products are defined — it survives scenario forks, which give programs new ids.
  const byCode = new Map<string, string[]>();
  for (const p of programs) {
    const list = byCode.get(p.item_code) ?? [];
    list.push(p.id);
    byCode.set(p.item_code, list);
  }
  const wrByProgMonth = new Map<string, number>();
  // Group 2's feedstock: every kilo of whole round the plan actually processed.
  const totalWr = new Array<number>(horizon).fill(0);
  for (const r of rr as { program_id: string; month_index: number; rolling_wr: number }[]) {
    const wr = Number(r.rolling_wr);
    wrByProgMonth.set(`${r.program_id}:${r.month_index}`, wr);
    const i = r.month_index - 1;
    if (i >= 0 && i < horizon) totalWr[i] += wr;
  }
  const feedstock: Record<string, number[]> = {};
  for (const [code, ids] of byCode) {
    const arr = new Array<number>(horizon).fill(0);
    for (const id of ids) {
      for (let i = 0; i < horizon; i++) arr[i] += wrByProgMonth.get(`${id}:${i + 1}`) ?? 0;
    }
    feedstock[code] = arr;
  }

  const definitions: SecondaryDef[] = ((defs ?? []) as SecondaryDef[]).map((d) => ({
    ...d,
    yield_pct: Number(d.yield_pct),
    price_per_kg: Number(d.price_per_kg),
  }));

  // Every distinct product in the plan, for the "recovered from" picker.
  const sources: SourceOption[] = [...byCode.keys()].sort().map((code) => ({
    item_code: code,
    item_description: programs.find((p) => p.item_code === code)?.item_description ?? code,
  }));

  const otherProducts: OtherProduct[] = ((others ?? []) as OtherProduct[]).map((p) => ({
    ...p,
    unit_cost: Number(p.unit_cost),
    unit_revenue: Number(p.unit_revenue),
  }));
  // Months a product has nothing planned in are absent from the table, so each
  // series starts at zero and only the stored months are written into it.
  const otherQuantities: Record<string, number[]> = {};
  for (const p of otherProducts) otherQuantities[p.id] = new Array<number>(horizon).fill(0);
  for (const m of (otherMonths ?? []) as { product_id: string; month_index: number; quantity: number }[]) {
    const arr = otherQuantities[m.product_id];
    const i = m.month_index - 1;
    if (arr && i >= 0 && i < horizon) arr[i] = Number(m.quantity);
  }

  const computed = rr.length > 0;
  const canEdit = (profile?.role ?? 'viewer') === 'admin';

  return (
    <div className="space-y-4">
      <div>
        <h1 className="text-2xl font-semibold tracking-tight">Secondary products</h1>
        <p className="mt-1 text-sm text-muted-foreground">
          By-products recovered while processing a main product — quantity and the revenue they generate.
        </p>
      </div>

      <StalePlanNotice planId={plan.id} lastComputedAt={plan.last_computed_at} />

      {!computed ? (
        <NotComputed />
      ) : (
        <SecondaryProductsClient
          orgId={plan.org_id}
          planStartDate={plan.plan_start_date}
          horizon={horizon}
          definitions={definitions}
          feedstock={feedstock}
          totalWr={totalWr}
          sources={sources}
          canEdit={canEdit}
        />
      )}

      <div className="border-t pt-6">
        <OtherProductsClient
          orgId={plan.org_id}
          planStartDate={plan.plan_start_date}
          horizon={horizon}
          products={otherProducts}
          quantities={otherQuantities}
          canEdit={canEdit}
        />
      </div>
    </div>
  );
}
