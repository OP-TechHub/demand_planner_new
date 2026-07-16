/* eslint-disable @typescript-eslint/no-explicit-any */
import { fetchAllByPlan } from '@/lib/fetch-all';
import type { Plan } from '@oceanpick/shared';

export interface FieldDiff { label: string; master: string; scenario: string }
export interface ProgramDiff { item_code: string; name: string; changes: FieldDiff[] }
export interface CellDiff { label: string; month: number; master: number; scenario: number }
export interface DiffResult {
  settings: FieldDiff[];
  programs: ProgramDiff[];
  programsAdded: string[];
  programsRemoved: string[];
  demand: CellDiff[];
  demandMore: number;
  harvest: CellDiff[];
  harvestMore: number;
  outputs: { metric: string; master: string; scenario: string }[];
}

const CAP = 60; // max detail rows per grid section

const eqNum = (a: number, b: number) => Math.abs((a ?? 0) - (b ?? 0)) < 1e-4;
const n = (v: any) => (v == null ? '—' : Number(v).toLocaleString(undefined, { maximumFractionDigits: 4 }));

export async function computeDiff(supabase: any, master: Plan, scenario: Plan): Promise<DiffResult> {
  // --- settings ---
  const settings: FieldDiff[] = [];
  const sf: [keyof Plan, string][] = [
    ['settings_margin_metric', 'Margin metric'], ['settings_allocation_mode', 'Allocation mode'],
    ['settings_scope', 'Scope'], ['settings_lookback_months', 'Lookback months'], ['plan_start_date', 'Plan start'],
  ];
  for (const [k, label] of sf) {
    if (String(master[k]) !== String(scenario[k])) settings.push({ label, master: String(master[k]), scenario: String(scenario[k]) });
  }

  const { data: buckets } = await supabase.from('buckets').select('id, name');
  const bucketName = (id: string | null) => (id ? (buckets ?? []).find((b: any) => b.id === id)?.name ?? '?' : '—');

  // --- programs (match by item_code) ---
  const [{ data: mp }, { data: sp }] = await Promise.all([
    supabase.from('programs').select('*').eq('plan_id', master.id).is('deleted_at', null),
    supabase.from('programs').select('*').eq('plan_id', scenario.id).is('deleted_at', null),
  ]);
  const mByCode = new Map<string, any>((mp ?? []).map((p: any) => [p.item_code, p]));
  const sByCode = new Map<string, any>((sp ?? []).map((p: any) => [p.item_code, p]));
  const programs: ProgramDiff[] = [];
  const FIELDS: [string, string, (v: any) => string][] = [
    ['status', 'Status', String], ['locked', 'Locked', (v) => (v ? 'Yes' : 'No')],
    ['max_monthly_demand_fp', 'Max demand', n], ['primary_bucket_id', 'Primary bucket', bucketName],
    ['primary_yield', 'Primary yield', n], ['price_per_fp', 'Price', n], ['barra_cost_wr', 'Barra cost', n],
    ['packing_cost_fp', 'Packing', n], ['processing_cost_fp', 'Processing', n],
    ['storage_cost_fp', 'Storage', n], ['freight_cost_fp', 'Freight', n], ['other_costs_fp', 'Other', n],
  ];
  for (const [code, m] of mByCode) {
    const s = sByCode.get(code);
    if (!s) continue;
    const changes: FieldDiff[] = [];
    for (const [key, label, fmt] of FIELDS) {
      const same = typeof m[key] === 'number' ? eqNum(m[key], s[key]) : m[key] === s[key];
      if (!same) changes.push({ label, master: fmt(m[key]), scenario: fmt(s[key]) });
    }
    if (changes.length) programs.push({ item_code: code, name: `${m.customer} · ${m.item_description}`, changes });
  }
  const programsAdded = [...sByCode.keys()].filter((c) => !mByCode.has(c));
  const programsRemoved = [...mByCode.keys()].filter((c) => !sByCode.has(c));

  // --- demand: compare EFFECTIVE demand per (program, month) ---
  const idToCodeM = new Map<string, string>((mp ?? []).map((p: any) => [p.id, p.item_code]));
  const idToCodeS = new Map<string, string>((sp ?? []).map((p: any) => [p.id, p.item_code]));
  const baseM = new Map<string, number>((mp ?? []).map((p: any) => [p.item_code, p.max_monthly_demand_fp]));
  const baseS = new Map<string, number>((sp ?? []).map((p: any) => [p.item_code, p.max_monthly_demand_fp]));
  const [dm, ds] = await Promise.all([
    fetchAllByPlan(supabase, 'demand_plan', 'program_id, month_index, demand_fp', master.id),
    fetchAllByPlan(supabase, 'demand_plan', 'program_id, month_index, demand_fp', scenario.id),
  ]);
  const ovM = new Map<string, number>(); for (const r of dm) ovM.set(`${idToCodeM.get(r.program_id)}:${r.month_index}`, r.demand_fp);
  const ovS = new Map<string, number>(); for (const r of ds) ovS.set(`${idToCodeS.get(r.program_id)}:${r.month_index}`, r.demand_fp);
  const demand: CellDiff[] = [];
  let demandMore = 0;
  for (const code of mByCode.keys()) {
    if (!sByCode.has(code)) continue;
    for (let mo = 1; mo <= master.horizon_months; mo++) {
      const em = ovM.get(`${code}:${mo}`) ?? baseM.get(code) ?? 0;
      const es = ovS.get(`${code}:${mo}`) ?? baseS.get(code) ?? 0;
      if (!eqNum(em, es)) {
        if (demand.length < CAP) demand.push({ label: `${(mByCode.get(code) as any).customer} · ${(mByCode.get(code) as any).item_description}`, month: mo, master: em, scenario: es });
        else demandMore++;
      }
    }
  }

  // --- harvest: compare capacity per (bucket, month) ---
  const [hm, hs] = await Promise.all([
    fetchAllByPlan(supabase, 'harvest_plan', 'bucket_id, month_index, capacity_kg_wr', master.id),
    fetchAllByPlan(supabase, 'harvest_plan', 'bucket_id, month_index, capacity_kg_wr', scenario.id),
  ]);
  const hM = new Map<string, number>(); for (const r of hm) hM.set(`${r.bucket_id}:${r.month_index}`, r.capacity_kg_wr);
  const hS = new Map<string, number>(); for (const r of hs) hS.set(`${r.bucket_id}:${r.month_index}`, r.capacity_kg_wr);
  const harvest: CellDiff[] = [];
  let harvestMore = 0;
  const keys = new Set([...hM.keys(), ...hS.keys()]);
  for (const k of keys) {
    const vm = hM.get(k) ?? 0, vs = hS.get(k) ?? 0;
    if (!eqNum(vm, vs)) {
      const [bid, mo] = k.split(':');
      if (harvest.length < CAP) harvest.push({ label: bucketName(bid!), month: Number(mo), master: vm, scenario: vs });
      else harvestMore++;
    }
  }

  // --- outputs summary (plan_summary total_60mo) ---
  const [{ data: msum }, { data: ssum }] = await Promise.all([
    supabase.from('plan_summary').select('*').eq('plan_id', master.id).eq('period', 'total_60mo').maybeSingle(),
    supabase.from('plan_summary').select('*').eq('plan_id', scenario.id).eq('period', 'total_60mo').maybeSingle(),
  ]);
  const outFmt = (row: any, key: string, pct = false) =>
    !row ? 'not computed' : pct ? (row.demand_fp > 0 ? (100 * row.allocated_fp / row.demand_fp).toFixed(1) + '%' : '—') : Math.round(row[key]).toLocaleString();
  const outputs = [
    { metric: 'Revenue', master: outFmt(msum, 'revenue'), scenario: outFmt(ssum, 'revenue') },
    { metric: 'Margin', master: outFmt(msum, 'margin'), scenario: outFmt(ssum, 'margin') },
    { metric: 'Allocated FP', master: outFmt(msum, 'allocated_fp'), scenario: outFmt(ssum, 'allocated_fp') },
    { metric: 'Fulfilment %', master: outFmt(msum, '', true), scenario: outFmt(ssum, '', true) },
  ];

  return { settings, programs, programsAdded, programsRemoved, demand, demandMore, harvest, harvestMore, outputs };
}
