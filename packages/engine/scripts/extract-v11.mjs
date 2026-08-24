// Extract the v11 costing workbook into a committed JSON fixture.
//
// Source: costing_module/barramundi_costing_v11.xlsx — the costing module's
// parity oracle (Costing_Module_Decisions.md §12). Same pattern as
// extract-v30.mjs: the workbook is a binary that stays as supplied, and this
// script plus its JSON output are the durable, reviewable artifacts.
//
// We take BOTH the inputs (so the engine can be fed exactly what Excel was fed)
// and the computed outputs (so the parity suite can assert we reproduce them).
//
// Run from repo root:  node packages/engine/scripts/extract-v11.mjs
import XLSX from 'xlsx';
import { writeFileSync, mkdirSync } from 'node:fs';

const WB = 'costing_module/barramundi_costing_v11.xlsx';
const wb = XLSX.readFile(WB);
const sheet = (name) => {
  const found = wb.SheetNames.find((n) => n.trim() === name);
  if (!found) throw new Error(`sheet not found: ${name}`);
  return wb.Sheets[found];
};
const at = (ws, addr) => {
  const c = ws[addr];
  return c ? c.v : undefined;
};
const num = (ws, addr) => {
  const v = at(ws, addr);
  if (v === undefined || v === '') return 0;
  const n = Number(v);
  if (Number.isNaN(n)) throw new Error(`${addr} is not numeric: ${JSON.stringify(v)}`);
  return n;
};
const str = (ws, addr) => String(at(ws, addr) ?? '').trim();

const AD = sheet('Assumptions (Domestic)');
const AE = sheet('Assumptions (Export)');
const SD = sheet('SKU Costing (Domestic)');
const SE = sheet('SKU Costing (Export)');

// --- Assumptions -----------------------------------------------------------
// Farm costs live on the Domestic tab and are inherited by Export; the only
// base-cost difference is the import tax on feed (35% vs 0% duty drawback).
const assumptions = {
  feedCostPerKg: num(AD, 'B5'),
  clearingCostPerKg: num(AD, 'B6'),
  fcrReference: num(AD, 'B9'),
  fxRate: num(AD, 'B20'),
  importTaxPct: { domestic: num(AD, 'B7'), export: num(AE, 'B7') },
  domestic: { transportLkr: num(AD, 'B24'), coldHoldLkr: num(AD, 'B25') },
  export: { freightToPortUsd: num(AE, 'B17'), coldChainUsd: num(AE, 'B18') },
  margins: {
    rackPct: num(AD, 'B32'),
    fobPct: num(AE, 'B26'),
    importerClearingPct: num(AE, 'B28'),
    importerMarkupPct: num(AE, 'B29'),
    distributorMarkupPct: num(AE, 'B30'),
  },
  freight: { containerFillKg: num(AE, 'B38'), airLotKg: num(AE, 'B39') },
  // ODC components: rows 12-17, value in col B, currency in col C.
  // Basis is hard-coded in v11 (fingerling + vaccine amortise per fish); the DB
  // model makes it an explicit column, so we record it here.
  odc: [
    { name: 'fingerling', row: 12, basis: 'per_fish' },
    { name: 'transport - trinco/colombo', row: 13, basis: 'per_kg' },
    { name: 'ice', row: 14, basis: 'per_kg' },
    { name: 'vaccine', row: 15, basis: 'per_fish' },
    { name: 'additives', row: 16, basis: 'per_kg' },
    { name: 'royalty', row: 17, basis: 'per_kg' },
  ].map((c) => ({
    name: c.name,
    value: num(AD, `B${c.row}`),
    currency: str(AD, `C${c.row}`) === 'USD' ? 'USD' : 'LKR',
    basis: c.basis,
  })),
};

// --- Size buckets ----------------------------------------------------------
// Medians on row 5, per-bucket FCR on row 9, across columns E..K.
// FCR is flagged in the workbook as placeholder farm data (cell A22).
const BUCKET_COLS = ['E', 'F', 'G', 'H', 'I', 'J', 'K'];
const BUCKET_LABELS = ['0-600g', '600-800g', '800-1100g', '1100-1500g', '1500-1800g', '1800-2200g', '2200-4000g'];
const buckets = BUCKET_COLS.map((col, i) => ({
  id: BUCKET_LABELS[i],
  label: BUCKET_LABELS[i],
  medianG: num(AD, `${col}5`),
  fcr: num(AD, `${col}9`),
  // Excel's own computed per-bucket ODC (row 11) and whole-fish cost (rows 19/21).
  // These ARE calculated in v11 but never consumed by the SKU rows, so they are
  // the only oracle available for the bucketed path.
  expected: {
    odcUsd: num(AD, `${col}11`),
    wholeFishUsd: num(AD, `${col}19`),
    wholeFishLkr: num(AD, `${col}21`),
  },
}));

// --- Destinations ----------------------------------------------------------
// Rows 42-62; blank rows are placeholders for ports not yet added.
const destinations = [];
for (let r = 42; r <= 62; r++) {
  const name = str(AE, `A${r}`);
  if (!name) continue;
  destinations.push({
    name,
    seaRatePer20ft: num(AE, `B${r}`),
    airRatePerLot: num(AE, `C${r}`),
    expected: { seaPerKg: num(AE, `D${r}`), airPerKg: num(AE, `E${r}`) },
  });
}
const selectedDestination = str(AE, 'B35');

// --- SKUs ------------------------------------------------------------------
// Rows 4-37 on both SKU tabs. The two tabs hold identical per-SKU inputs (one
// SKU list, two markets — Decisions §2/§3), which we assert rather than assume.
const SKU_ROWS = [];
for (let r = 4; r <= 37; r++) SKU_ROWS.push(r);

const skus = SKU_ROWS.map((r) => {
  const name = str(SD, `A${r}`);
  if (!name) throw new Error(`domestic SKU row ${r} has no name`);
  const exportName = str(SE, `A${r}`);
  if (exportName !== name) {
    throw new Error(`SKU row ${r} differs between tabs: ${JSON.stringify(name)} vs ${JSON.stringify(exportName)}`);
  }

  const shared = {
    name,
    status: str(SD, `B${r}`).toLowerCase(),
    category: str(SD, `C${r}`),
    glazePct: num(SD, `D${r}`),
    baseYield: num(SD, `E${r}`),
    pctFish: num(SD, `F${r}`),
    pctMarinade: num(SD, `G${r}`),
    marinadeUsdPerKg: num(SD, `K${r}`),
    processUsdPerKg: num(SD, `N${r}`),
    packingUsdPerKg: num(SD, `O${r}`),
    packSize: str(SD, `T${r}`) || null,
  };

  // Per-SKU inputs must match across the two tabs, or "one SKU list" is wrong.
  const exportInputs = {
    glazePct: num(SE, `D${r}`),
    baseYield: num(SE, `E${r}`),
    pctFish: num(SE, `F${r}`),
    pctMarinade: num(SE, `G${r}`),
    marinadeUsdPerKg: num(SE, `K${r}`),
    processUsdPerKg: num(SE, `N${r}`),
    packingUsdPerKg: num(SE, `O${r}`),
  };
  for (const [k, v] of Object.entries(exportInputs)) {
    if (Math.abs(v - shared[k]) > 1e-12) {
      throw new Error(`SKU ${name}: ${k} differs between tabs (domestic ${shared[k]}, export ${v})`);
    }
  }

  return {
    ...shared,
    expected: {
      domestic: {
        wholeFishLkr: num(SD, `I${r}`),
        fishComponent: num(SD, `J${r}`),
        marinadeComponent: num(SD, `L${r}`),
        rawMaterial: num(SD, `M${r}`),
        coldHold: num(SD, `P${r}`),
        exFactory: num(SD, `Q${r}`),
        freight: num(SD, `R${r}`),
        finalCost: num(SD, `S${r}`),
        unglazed: { final: num(SD, `U${r}`), rackRate: num(SD, `V${r}`) },
        glazed: { final: num(SD, `W${r}`), rackRate: num(SD, `X${r}`) },
      },
      export: {
        wholeFishUsd: num(SE, `I${r}`),
        fishComponent: num(SE, `J${r}`),
        marinadeComponent: num(SE, `L${r}`),
        rawMaterial: num(SE, `M${r}`),
        coldHold: num(SE, `P${r}`),
        exFactory: num(SE, `Q${r}`),
        freight: num(SE, `R${r}`),
        finalCost: num(SE, `S${r}`),
        frozenPlain: { final: num(SE, `U${r}`), fob: num(SE, `V${r}`), cif: num(SE, `W${r}`), distributorT3: num(SE, `X${r}`) },
        frozenGlazed: { final: num(SE, `Y${r}`), fob: num(SE, `Z${r}`), cif: num(SE, `AA${r}`), distributorT3: num(SE, `AB${r}`) },
        fresh: { final: num(SE, `AC${r}`), fob: num(SE, `AD${r}`), cif: num(SE, `AE${r}`), distributorT3: num(SE, `AF${r}`) },
      },
    },
  };
});

// Reference whole-fish cost (the flat, non-bucketed model the SKU rows use).
const reference = {
  domestic: {
    effectiveFeedCostUsd: num(AD, 'B8'),
    feedCostPerKgFishUsd: num(AD, 'B10'),
    odcUsd: num(AD, 'B11'),
    wholeFishUsd: num(AD, 'B19'),
    wholeFishLkr: num(AD, 'B21'),
  },
  export: {
    effectiveFeedCostUsd: num(AE, 'B8'),
    feedCostPerKgFishUsd: num(AE, 'B10'),
    odcUsd: num(AE, 'B11'),
    wholeFishUsd: num(AE, 'B12'),
  },
};

const out = { source: WB, assumptions, reference, buckets, destinations, selectedDestination, skus };

mkdirSync('packages/engine/fixtures', { recursive: true });
writeFileSync('packages/engine/fixtures/v11.json', JSON.stringify(out, null, 2) + '\n');
console.log(
  `v11.json: ${skus.length} SKUs, ${buckets.length} buckets, ${destinations.length} destinations, selected = ${selectedDestination}`
);
