// Extract the V30 reference workbook into a committed JSON fixture.
//
// Source: "Oceanpick_Demand_Plan_30 NM 28.05.2026.xlsx" (the FORMULA-bearing
// model — not the flattened "... new.xlsx"). The workbook itself is a 5 MB
// binary and stays untracked; this script + its JSON output are the durable,
// reviewable artifacts.
//
// Run from repo root:  npm install --no-save xlsx && node packages/engine/scripts/extract-v30.mjs
import XLSX from 'xlsx';
import { writeFileSync, mkdirSync } from 'node:fs';

const WB = 'Oceanpick_Demand_Plan_30 NM 28.05.2026.xlsx';
const wb = XLSX.readFile(WB);
const sheet = (name) => wb.Sheets[wb.SheetNames.find((n) => n.trim() === name)];
const cell = (ws, r, c) => { const x = ws[XLSX.utils.encode_cell({ r, c })]; return x ? x.v : undefined; };
const num = (v) => (v === undefined || v === '' ? 0 : Number(v));
const yld = (v) => (v === undefined || v === '' ? null : Number(v));
const MONTHS = 60;

// --- Buckets (Bucket Legend, col B, rows 4..10) ---
const legend = sheet('Bucket Legend');
const buckets = [];
for (let R = 3; R < 40; R++) {
  const name = cell(legend, R, 1);
  if (!name || typeof name !== 'string' || /how to use/i.test(name)) break;
  const trimmed = String(name).trim();
  if (trimmed.toLowerCase() === 'bucket name') continue; // header row (legend layout can shift)
  buckets.push({ name: trimmed, sort_order: (buckets.length + 1) * 10 });
}

// --- Programs (Programs sheet, data from row 6) ---
const P = sheet('Programs');
const programs = [];
for (let R = 5; R < 120; R++) {
  const status = cell(P, R, 0);
  if (!status || !String(status).trim()) break;
  programs.push({
    status: String(status).trim().toLowerCase(),
    item_code: String(cell(P, R, 1) ?? '').trim(),
    item_description: String(cell(P, R, 2) ?? '').trim(),
    customer: String(cell(P, R, 3) ?? '').trim(),
    max_monthly_demand_fp: num(cell(P, R, 4)),
    primary_bucket: String(cell(P, R, 5) ?? '').trim() || null,
    secondary_bucket: String(cell(P, R, 6) ?? '').trim() || null,
    tertiary_bucket: String(cell(P, R, 7) ?? '').trim() || null,
    primary_yield: yld(cell(P, R, 8)),
    secondary_yield: yld(cell(P, R, 9)),
    tertiary_yield: yld(cell(P, R, 10)),
    price_per_fp: num(cell(P, R, 12)),
    barra_cost_wr: num(cell(P, R, 14)),
    packing_cost_fp: num(cell(P, R, 16)),
    processing_cost_fp: num(cell(P, R, 17)),
    storage_cost_fp: num(cell(P, R, 18)),
    freight_cost_fp: num(cell(P, R, 19)),
    other_costs_fp: num(cell(P, R, 20)),
    locked: String(cell(P, R, 30) ?? '').trim().toLowerCase() === 'yes',
    // Excel-computed columns — expected values for validating spec §2/§3.
    expected: {
      total_cost_fp: num(cell(P, R, 21)),   // V
      margin_fp: num(cell(P, R, 22)),        // W
      margin_wr: num(cell(P, R, 23)),        // X
      gp_pct: num(cell(P, R, 25)),           // Z
      rank_margin_fp: num(cell(P, R, 26)),   // AA
      rank_margin_wr: num(cell(P, R, 27)),   // AB
      rank_total_contribution: num(cell(P, R, 28)), // AC
      total_demand_fp_60mo: num(cell(P, R, 31)),    // AF
      total_margin_60mo: num(cell(P, R, 32)),       // AG
    },
    demand: [], // filled from Monthly Demand Plan below
  });
}

// --- Monthly Harvest Plan (rows 6.., col A = bucket, cols B..BI = M1..M60) ---
const H = sheet('Monthly Harvest Plan');
const harvest = {};
for (let R = 5; R < 60; R++) {
  const name = cell(H, R, 0);
  if (!name || !String(name).trim()) break;
  harvest[String(name).trim()] = Array.from({ length: MONTHS }, (_, m) => num(cell(H, R, m + 1)));
}

// --- Monthly Demand Plan (rows 6.., col D = program, cols F.. = M1..M60 effective) ---
const D = sheet('Monthly Demand Plan');
const demandRows = [];
for (let R = 5; R < 120; R++) {
  const prog = cell(D, R, 3);
  if (!prog || !String(prog).trim()) break;
  demandRows.push({
    description: String(prog).trim(),
    customer: String(cell(D, R, 2) ?? '').trim(),
    values: Array.from({ length: MONTHS }, (_, m) => num(cell(D, R, m + 5))),
  });
}
// Attach by row order; verify descriptions align.
let mismatches = 0;
programs.forEach((p, i) => {
  const d = demandRows[i];
  if (d && d.description === p.item_description) p.demand = d.values;
  else { mismatches++; if (d) p.demand = d.values; }
});

// --- 60-Month Summary: expected rolling_fp grid (Cell Metric = "Allocated FP",
//     lens Margin/kg WR, Fill-what-you-can, Active+Pipeline). Months = cols 8..67,
//     program rows from row 12, ordered by rank. Match to programs by identity. ---
const MS = sheet('60-Month Summary');
const norm = (s) => String(s ?? '').trim().toLowerCase().replace(/\s+/g, ' ');
const byKey = new Map(programs.map((p) => [norm(p.customer) + '|' + norm(p.item_description), p]));
let matched = 0;
const unmatched = [];
for (let R = 11; R < 61; R++) {
  const name = cell(MS, R, 2);
  if (!name || !String(name).trim()) continue;
  const p = byKey.get(norm(cell(MS, R, 1)) + '|' + norm(name));
  const fp = Array.from({ length: MONTHS }, (_, m) => num(cell(MS, R, 8 + m)));
  if (p) {
    p.expected_rolling_fp = fp;
    // col 74 "InBkt" drives SortKey (priority); col 6 "Rank" is a display rank.
    p.expected_in_bucket_rank = num(cell(MS, R, 74));
    p.expected_global_rank = num(cell(MS, R, 76));
    p.expected_sort_key = num(cell(MS, R, 75));
    matched++;
  }
  else unmatched.push(String(name).slice(0, 40));
}
console.log('60-MS rolling_fp matched:', matched, '/', programs.length,
  '| unmatched 60-MS rows:', unmatched.length, unmatched.length ? '-> ' + unmatched.slice(0, 6).join(' ; ') : '');

// --- Unallocated WR tab (bucket rows, cols 1..60) — parity reference ---
const UW = sheet('Unallocated WR');
const expectedUnallocatedWr = {};
for (let R = 4; R < 40; R++) {
  const name = cell(UW, R, 0);
  if (!name || !String(name).trim()) break;
  const nm = String(name).trim();
  if (nm.toLowerCase() === 'bucket') continue;
  expectedUnallocatedWr[nm] = Array.from({ length: MONTHS }, (_, m) => num(cell(UW, R, m + 1)));
}

// --- Pipeline WR tab (bucket rows, cols 1..60) — parity reference ---
const PW = sheet('Pipeline');
const expectedPipelineWr = {};
for (let R = 4; R < 40; R++) {
  const name = cell(PW, R, 0);
  if (!name || !String(name).trim()) break;
  const nm = String(name).trim();
  if (nm.toLowerCase() === 'bucket') continue;
  expectedPipelineWr[nm] = Array.from({ length: MONTHS }, (_, m) => num(cell(PW, R, m + 1)));
}

// --- Annual Summary volume rows (cols 1..6 = FY1..FY5, total_60mo) ---
const AS = sheet('Annual Summary');
const asRow = (label) => {
  for (let R = 0; R < 26; R++) {
    const v = cell(AS, R, 0);
    if (v && String(v).trim().toLowerCase().startsWith(label.toLowerCase())) return R;
  }
  return -1;
};
const asVals = (label) => { const R = asRow(label); return R < 0 ? null : Array.from({ length: 6 }, (_, c) => num(cell(AS, R, c + 1))); };
const expectedAnnual = {
  demandFp: asVals('demand fp'),
  allocatedFp: asVals('allocated fp'),
  unallocatedFp: asVals('unallocated fp'),
  allocatedWr: asVals('allocated wr'),
  unallocatedWr: asVals('unallocated wr'),
  revenue: asVals('revenue'),
  cost: asVals('cost'),
  margin: asVals('gross margin'),
};
console.log('unallocated WR buckets:', Object.keys(expectedUnallocatedWr).length,
  '| annual demand total:', expectedAnnual.demandFp && expectedAnnual.demandFp[5]);

mkdirSync('packages/engine/fixtures', { recursive: true });
const out = { source: WB, months: MONTHS, buckets, programs, harvest, expected: { unallocated_wr: expectedUnallocatedWr, pipeline_wr: expectedPipelineWr, annual: expectedAnnual } };
writeFileSync('packages/engine/fixtures/v30.json', JSON.stringify(out, null, 2));

console.log('buckets   :', buckets.length, buckets.map((b) => b.name).join(', '));
console.log('programs  :', programs.length, '| locked:', programs.filter((p) => p.locked).length,
  '| statuses:', [...new Set(programs.map((p) => p.status))].join('/'));
console.log('harvest   :', Object.keys(harvest).length, 'buckets ×', MONTHS, 'months');
console.log('demand    : rows', demandRows.length, '| description mismatches:', mismatches);
console.log('sample prog[0]:', programs[0].item_code, programs[0].item_description,
  '| pyield', programs[0].primary_yield, '| demand[0..2]', programs[0].demand.slice(0, 3));
console.log('wrote packages/engine/fixtures/v30.json');
