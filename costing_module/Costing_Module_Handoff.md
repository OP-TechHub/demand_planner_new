# Costing & Quoting Module — Handoff Specification
### For: Round Island / OceanPick barramundi — to be built as a module inside the existing Demand Planner

> **Companion artifact:** `barramundi_costing_v11.xlsx`. That workbook is the **source of truth and the test oracle** — the web engine must reproduce its numbers exactly before anything is extended. This document explains the *logic and intent*; the workbook proves the *numbers*.

---

## 0. How to use this document

This spec was written in a separate conversation that built and refined the Excel model but does **not** have access to the demand-planner repo, migrations, or `docs/api.md`. Therefore:

- Treat this as the **costing-logic and product-intent specification**.
- Let **this** (the demand-planner) conversation own all stack-specific detail — exact table DDL, RLS policy wording, route signatures, engine file layout. Where this doc and the actual codebase disagree on stack mechanics, **the codebase wins**.
- The one thing that must not drift is the **calc logic in §3–§6** — that is the whole point of the module.

---

## 1. What we're building and why

A **costing & quoting engine** for OceanPick's farmed barramundi, covering:
- **Domestic (Sri Lanka, LKR)** cost + a standard "rack rate".
- **Export (USD)** cost → FOB → CIF → importer → distributor → end customer (T3), **per destination**.
- Three product states: **frozen (no glaze)**, **frozen (glazed)**, **fresh (air-freighted)**.
- Size-bucket-aware whole-fish costing (architected in now, switched on later).

**Why it's outgrowing Excel:** the cost model is genuinely multi-dimensional — *SKU × size-bucket × yield × glaze/fresh state × destination × freight mode*. A spreadsheet is a 2-D grid; each new dimension has made it more fragile (reference breakage, external-link cruft, column-shift risk). The data belongs in a relational model with a deterministic calc engine.

**Why a module, not a standalone tool:** the demand planner already has the product master, auth (API keys, SHA-256, org-scoped), a deterministic engine package with a vitest parity suite, and RLS helpers. A standalone costing app would duplicate all of that and force two copies of "what is a SKU" to stay in sync — the exact drift we're eliminating. As a module, **one product master, one SKU vocabulary, one engine discipline.**

---

## 2. Architecture decision (made — not for re-litigation)

Build **inside the existing monorepo**:

- **`packages/engine`** — add a pure, deterministic `computeCost(inputs) → outputs` alongside the demand calc, with its own vitest **parity suite** that reproduces v11's numbers. Determinism is non-negotiable: same inputs must always yield the same landed price (quotes depend on it).
- **`apps/web`** — add costing UI: assumptions editors, SKU cost grid, per-customer quote windows, Excel-style exports. Next.js App Router / Server Components / Server Actions, Tailwind, as per the existing app.
- **`packages/shared`** — shared types so costing and demand speak one SKU language.
- **Database** — new tables **inside the `demand_planner` schema**, RLS reusing the existing `can_read_plan()` / `can_write_section()` helpers (the pattern used for the last three features). Not a service-role bypass; not tables in another schema.

**Safety model — this ships into a live, in-use system, so:**
- All new tables and routes are **additive** and cannot alter existing behaviour.
- Everything ships **behind a feature flag defaulted OFF** and behind **RLS**. Until deliberately switched on, the demand planner behaves exactly as today.
- `/api/v1` stays **read-only and untouched** for the entire first build. Write-back (if ever) is a later, contained, fully-tested phase.

---

## 3. Core cost logic — DOMESTIC (LKR)

All feed/ODC costs originate in **USD**, converted to LKR via a single FX rate. Local adders (transport, cold-hold) are in LKR.

### 3.1 Base whole-fish cost (reference, ~1000 g fish)
```
effective_feed_cost   = feed_cost_per_kg_feed × (1 + import_tax_pct) + clearing_cost_per_kg
feed_cost_per_kg_fish = effective_feed_cost × FCR
whole_fish_cost_USD   = feed_cost_per_kg_fish + ODC
whole_fish_cost_LKR   = whole_fish_cost_USD × FX
```
- `import_tax_pct` applies to feed only (customs duty). `clearing_cost` (customs clearing/handling) is added **after** tax, not taxed.
- **Export differs from Domestic on exactly one line:** `import_tax_pct = 0` (duty drawback on exported inputs). Everything else is identical/shared. See §4.

### 3.2 ODC (Other Direct Costs) — component build-up
ODC is the **sum of components**, each entered in **LKR or USD** (currency toggle) and converted to USD:
```
component_USD = (currency == "USD") ? value : value / FX
ODC_total_USD = Σ component_USD
```
Components: `fingerling`, `transport (trinco/colombo)`, `ice`, `vaccine`, `additives`, `royalty`.

Each component has a **basis: per-kg or per-fish** (see §5 — this drives size-bucket amortisation):
- **per-fish:** `fingerling`, `vaccine`
- **per-kg:** `transport`, `ice`, `additives`, `royalty`

> In v11 the basis is hard-coded (fingerling + vaccine = per-fish). In the DB model, make **basis an explicit column** per component so it's editable.

### 3.3 Domestic SKU cost chain
Per SKU, given: `glaze% (D)`, `yield% (E)`, `%fish (F)`, `%marinade (G)`, `marinade$/kg (K)`, `process$/kg (N)`, `packing$/kg (O)`:
```
Σ%_check     = %fish + %marinade                        (should = 100%)
fish_comp    = %fish × whole_fish_LKR / yield           (BASE — glaze-free, see §6)
marinade_comp= %marinade × marinade$ × FX
raw_matl     = fish_comp + marinade_comp
cold_hold    = <Assumptions: cold-hold LKR/kg>          (folded INTO ex-factory)
ex_factory   = raw_matl + (process$ + packing$) × FX + cold_hold
freight      = <Assumptions: transport LKR/kg>          (AFTER ex-factory)
FINAL_cost   = ex_factory + freight                     (base, no glaze)
```
**Ordering matters (a prior change request):** holding/cold-hold is inside ex-factory; freight is after ex-factory → FINAL.

### 3.4 Domestic rack rate (standard price)
```
rack_rate = FINAL_cost / (1 − rack_rate_margin)         (rack_rate_margin default 40%, GM basis)
```

### 3.5 Domestic output blocks (per SKU)
- **Without glaze:** `FINAL = FINAL_cost`, `Rack = FINAL/(1−rack_margin)`
- **With glaze:** `FINAL_glaze` (see §6), `Rack_glaze = FINAL_glaze/(1−rack_margin)`

---

## 4. Core cost logic — EXPORT (USD)

Identical method to Domestic, but **all-USD, no FX conversion in the cost chain**, and `import_tax = 0`.

### 4.1 Shared inputs (single-entry — critical)
Feed cost, clearing, FCR, and ODC are **farm costs identical to Domestic**. In v11 they are *linked* from the Domestic tab (enter once). In the DB model this is automatic — both markets read the **same `cost_assumptions` rows**; export simply applies `import_tax = 0`.
```
export_effective_feed = feed × (1 + 0) + clearing = feed + clearing
export_whole_fish_USD = (export_effective_feed × FCR) + ODC          (no FX)
```

### 4.2 Export SKU cost chain (USD, no FX)
```
fish_comp   = %fish × export_whole_fish_USD / yield     (BASE)
marinade_comp = %marinade × marinade$                   (already USD)
raw_matl    = fish_comp + marinade_comp
ex_factory  = raw_matl + process$ + packing$ + cold_hold$
FINAL_cost  = ex_factory + freight_to_port$             (freight_to_port = factory→port, our cost)
```

### 4.3 Export value chain (per destination)
```
FOB   = FINAL_cost / (1 − FOB_margin)                   (FOB_margin default 40%, GM basis — "our margin")
CIF   = FOB + destination_freight_per_kg                (SEA for frozen, AIR for fresh — see §4.4)
importer_price   = CIF × (1 + importer_clearing%) × (1 + importer_markup%)
distributor_T3   = importer_price × (1 + distributor_markup%)
```
Defaults: `FOB_margin 40%`, `importer_clearing 5%`, `importer_markup 10%`, `distributor_markup 15%`.
**"Up to FOB is generic"** (one value per SKU); **CIF and below vary by destination.**

### 4.4 Destination freight — container/air-lot ÷ editable fill weights
Freight is entered **per shipment**, converted to per-kg by editable divisors:
```
sea_per_kg = sea_rate_per_20ft_container / container_fill_weight_kg   (default 7,000 kg)
air_per_kg = air_rate_per_lot            / air_lot_weight_kg          (default 500 kg)
```
Each destination row: `{ name, sea_rate_per_20ft, air_rate_per_lot }` → computed `{ sea_per_kg, air_per_kg }`.
A **selected destination** drives which freight the SKU grid uses. (Excel does one destination at a time; **the web tool should let each quote/customer pick its own destination** — this is a primary reason for the migration.)

### 4.5 Export output blocks (per SKU) — the three states
| State | FINAL | Freight | 
|---|---|---|
| **Frozen · no glaze** | `FINAL_cost` (base) | SEA |
| **Frozen · glazed** | `FINAL_glaze` (§6) | SEA |
| **Fresh** | `FINAL_cost` (same as no-glaze to FOB) | AIR |
Each state resolves the full chain: `FINAL → FOB → CIF → distributor_T3`. **Fresh = frozen-no-glaze up to FOB, then diverges on AIR freight.**

---

## 5. Size buckets — architected in NOW, switched on LATER

This is the single most important architectural instruction.

### 5.1 Resolution path (build it this shape from day one)
Cost resolution must be written as:
```
SKU → size_bucket → yield (from yield_matrix) → whole_fish_cost (bucket-specific)
```
**Not** a flat per-SKU yield. If built flat now and bucketed later, the engine core and every SKU config must be rewritten. Built bucket-shaped-but-defaulted, "later" is a flag flip.

### 5.2 Whole-fish cost per bucket
Only **FCR** and **ODC** vary by fish size:
```
whole_fish_USD(bucket) = effective_feed × FCR(bucket) + ODC(bucket)
```
- `FCR(bucket)` — rises with fish size (bigger fish = higher cumulative FCR). Farm-supplied per bucket.
- `ODC(bucket)` — **per-fish components amortise over median weight; per-kg components stay flat:**
```
ODC(bucket) = Σ(per_kg components) + Σ(per_fish components) / median_weight_kg
median_weight_kg = bucket_median_grams / 1000
```
At median = 1000 g this equals the reference ODC. Small fish → much higher ODC/kg (fingerling spread over fewer kg); big fish → lower.

### 5.3 Yield engine
The Excel **"Master Yield summary"** tab is the yield source: a matrix of **yield by (product type × fish size)**. It becomes `yield_matrix`. Glazed columns in it use `base_yield × (1 + glaze%)` — consistent with §6.
> **Data note:** the Excel Master Yield summary has a likely typo at cell **W10 = 4.88** (should be ~0.48). Validate/clean when importing.

### 5.4 Feature flag
`costing.size_buckets_enabled` defaults **off**. While off, every SKU resolves through a single **default bucket** (behaves like today's flat model). "Switching on" = populate `yield_matrix` + real per-bucket FCR, flip the flag. No schema change, no engine rewrite.

---

## 6. Glaze logic

Glaze (added ice on frozen product) **dilutes the fish cost only**, via effective yield:
```
effective_yield = yield × (1 + glaze%)
fish_comp(glaze) = %fish × whole_fish / effective_yield
```
Because only fish_comp changes, the glazed FINAL can be derived from the base FINAL:
```
FINAL_glaze = FINAL_base − fish_comp_base × ( glaze% / (1 + glaze%) )
```
- **Main body = base cost, glaze-free.** Glaze % is a per-SKU input that only drives the "with glaze" output block. This avoids duplicating SKUs for glazed variants — one SKU row shows both.
- v11 convention: glaze dilutes **fish cost only** (processing, packing, cold-hold, freight stay per-kg as entered). If fuller dilution is ever wanted, it's a defined extension — but match v11 for parity first.

---

## 7. Proposed data model (sketch — adapt to codebase conventions)

All in `demand_planner` schema, RLS via existing helpers. **Version `cost_assumptions`** so saved quotes are reproducible.

- **`cost_assumptions`** — versioned set: `feed_cost`, `clearing_cost`, `import_tax_pct` (per market), `fcr_reference`, `fx_rate`, per-market adders (transport/cold-hold LKR; freight-to-port/cold-hold USD), `rack_margin`, `fob_margin`, `importer_clearing/markup`, `distributor_markup`, `container_fill_kg`, `air_lot_kg`. Effective-dated / versioned.
- **`odc_components`** — `{ name, value, currency (LKR|USD), basis (per_kg|per_fish) }` → engine converts to USD and sums.
- **`size_buckets`** — `{ label, min_g, max_g, median_g, fcr }`.
- **`yield_matrix`** — `{ product_type, size_bucket_id, yield_pct }` (from Master Yield summary).
- **`destinations`** — `{ name, sea_rate_per_20ft, air_rate_per_lot }`; per-kg computed via assumptions divisors.
- **`sku_cost_config`** — per SKU (**keyed to the existing item master**): `{ item_id, status, category, product_type, size_bucket_id (nullable → default while flag off), glaze_pct, pct_fish, pct_marinade, marinade_usd, process_usd, packing_usd, pack_size }`.
- **`quotes`** — a saved customer quote: `{ customer, destination_id, state (frozen_plain|frozen_glazed|fresh), assumptions_version, resolved lines, created_at }`.

**The join to the planner:** `sku_cost_config.item_id` references the same item ids returned by `GET /plans/{id}/programs`. One SKU everywhere.

---

## 8. Integration with the Demand Planner

### Phase A — read-only (no changes to the live tool)
Costing consumes the existing read-only `/api/v1`:
- `GET /plans/{id}/programs` — item master (the SKU list costing configs attach to)
- `GET /plans/{id}/demand`, `GET /plans/{id}/results` — volumes / supply / fulfilment
This alone enables quotes **and** a **costed demand plan** (planned volume × landed cost/margin per SKU/destination). The production tool is untouched.

**Unit convention (important):** API quantities are **kg FP (finished product)** unless a field ends `_wr` (whole round). Costing must apply cost/kg on the correct basis — a landed cost is per kg FP; do not mix with `_wr`.

### Phase B — write-back (optional, later, contained)
To push costs/margin *into* planner results, add write endpoints to `/api/v1`. Per the API notes: auth, response envelope, and plan resolution already exist; `api_keys.scopes` defaults to `['read']` but **no route checks it and no write endpoint exists** — so this is new routes + honouring `scopes`, treated with the same parity/testing rigour as the engine. Ship only after costing is proven; keep the live tool safe.

---

## 9. Phasing

1. **Foundations** — cost tables in `demand_planner` (RLS via helpers); `computeCost` in `packages/engine` with a **parity suite** reproducing v11.
2. **Costing UI** — assumptions editors (domestic + export, destinations, container/air-lot freight), SKU cost grid, glaze/fresh/frozen states, rack rate. All behind the feature flag.
3. **Quote windows & exports** — per-customer landed-price windows (each quote picks its own destination); **Excel-format output sheets** matching v11 so nothing is lost.
4. **Costed demand plan** — join costing to the demand API (read-only): planned volumes × landed cost/margin.
5. **Buckets on** — populate `yield_matrix` + per-bucket FCR, flip `size_buckets_enabled`.
6. **Write-back (if wanted)** — new `/api/v1` cost endpoints; margin into planner results.

---

## 10. Parity requirement (do this first)

**Lock the engine to v11 as the source of truth before extending anything.** The parity suite loads the v11 inputs and asserts the engine reproduces v11 outputs to the cent/rupee. Worked examples to anchor tests (exact figures depend on the workbook's *current* input cells — read them from the file, don't hard-code from here):

- **Domestic skin-on fillet:** base FINAL ≈ LKR 2,985 → rack rate (40%) ≈ LKR 4,975; with 20% glaze, FINAL ≈ 2,578 → rack ≈ 4,296.
- **Export skin-on fillet (Dubai selected):** FINAL ≈ $7.11 → FOB ≈ $11.85 → frozen CIF ≈ $12.30 → distributor→T3 ≈ $16.34; **fresh (air)** CIF ≈ $14.65 → distributor→T3 ≈ $19.46.
- **ODC amortisation:** 0–600 g bucket (median 300 g) ODC ≈ $1.139/kg; 2200–4000 g (median 3100 g) ODC ≈ $0.206/kg; 800–1100 g bucket ≈ reference.
- **Freight conversion:** Dubai sea $3,150/20ft ÷ 7,000 kg = $0.450/kg; drop fill to 5,000 kg → $0.630/kg. Air $1,400/lot ÷ 500 kg = $2.80/kg.

> These illustrate the *relationships*. The authoritative check is: **given v11's input cells, the engine matches v11's computed cells.**

---

## 11. Open decisions for this (demand-planner) conversation

1. **Table DDL & RLS wording** — exact columns/policies per codebase conventions (this doc is intent, not final schema).
2. **Engine file layout** — where `computeCost` and its fixtures live in `packages/engine`.
3. **Assumptions versioning strategy** — effective-dated rows vs snapshot-on-quote (both work; pick per existing patterns).
4. **Currency display** — export in USD; do you also want an LKR reference view? (Excel keeps an FX-reference cell.)
5. **Quote export format** — replicate the exact v11 sheet layout, or a cleaner quote-sheet design?
6. **Feed WACC** — the Excel has a Feed WACC helper (weighted avg feed cost across pellet sizes/suppliers). Currently *not* linked to the feed cost input (manual). Decide whether the module computes feed cost from a WACC table or takes it as a direct input.

---

*End of handoff. Pair this with `barramundi_costing_v11.xlsx` — the doc explains the logic; the workbook proves the numbers.*
