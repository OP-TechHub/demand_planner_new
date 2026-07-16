# Calculation Engine Specification

**Version**: Draft 1 (Sections 1-4)
**Reference**: `Oceanpick_Demand_Plan_30_NM_28_05_2026.xlsx` (V30, May 2026)
**Purpose**: Define exactly what the Oceanpick Demand Planner calculates. The web
application's calculation engine must produce output that matches this spec — and
transitively matches the Excel model — to defined tolerances.

## Reading conventions

- **kg FP** = kilograms of finished product (the sellable form)
- **kg WR** = kilograms of whole round (the raw barramundi harvest form)
- **Yield** = kg FP produced per kg WR. Always ∈ (0, 1].
- **Bucket** = size grade of whole round (e.g., "800-1100g"). Each bucket has monthly
  harvest capacity.
- **Program** = a customer × product combination (e.g., Woolworths portions 80-120g)
- **Path** = which of a program's three bucket options is used (Primary / Secondary /
  Tertiary). Each path has its own yield.
- **Own-month** = fulfilled from the same month's harvest
- **Borrowed** = fulfilled from an earlier month's harvest via forward-look
- **Rolling FP** = own-month fulfilment + borrowings, expressed in FP

## Table of contents

1. [Inputs (source data)](#1-inputs-source-data)
2. [Derived per-program values](#2-derived-per-program-values)
3. [Ranking and prioritization](#3-ranking-and-prioritization)
4. [Own-month allocation](#4-own-month-allocation)
5. Rolling Calc borrowing engine *(pending review of 1-4)*
6. Unallocated WR *(pending)*
7. Program-level aggregations (Fulfilment, Rev/Cost/Margin) *(pending)*
8. Plan-level aggregations (Annual Summary, Pipeline tab) *(pending)*
9. Edge cases and cross-validation *(pending)*

---

## 1. Inputs (source data)

Inputs are the data the user provides. Everything else is derived. Each input is
described with its fields, valid ranges, and how it maps to the Excel model.

### 1.1 Programs

The heart of the model. Each program is one row.

| Field | Type | Required | Excel col | Notes |
|---|---|---|---|---|
| `id` | uuid | yes | — | New (Excel uses row position) |
| `status` | enum | yes | A | `Active` / `Pipeline` / `Inactive`. Pipeline is treated identically to Active in v1. |
| `item_code` | string | yes | B | Unique per program |
| `item_description` | string | yes | C | Human-readable product name |
| `customer` | string | yes | D | Customer name (in v1: free text; consider FK to Customers table later) |
| `max_monthly_demand_fp` | number | yes | E | Baseline monthly demand in kg FP. Time-Variable Overrides may replace this per-month. |
| `primary_bucket` | FK bucket | yes | F | The main size grade this program uses |
| `secondary_bucket` | FK bucket | no | G | If primary is unavailable, fall back to this |
| `tertiary_bucket` | FK bucket | no | H | Last resort fallback |
| `primary_yield` | number ∈ (0,1] | yes | I | Derived from Master Yield Summary in Excel; user-editable in v1 |
| `secondary_yield` | number ∈ (0,1] | conditional | J | Required if secondary_bucket set |
| `tertiary_yield` | number ∈ (0,1] | conditional | K | Required if tertiary_bucket set |
| `price_per_fp` | number > 0 | yes | M | Selling price $/kg FP. Time-Variable Overrides may override per-month. |
| `barra_cost_wr` | number ≥ 0 | yes | O | Raw fish cost, $/kg WR |
| `packing_cost_fp` | number ≥ 0 | yes | Q | $/kg FP |
| `processing_cost_fp` | number ≥ 0 | yes | R | $/kg FP |
| `storage_cost_fp` | number ≥ 0 | yes | S | $/kg FP |
| `freight_cost_fp` | number ≥ 0 | yes | T | $/kg FP |
| `locked` | boolean | yes | AE | If true, this program gets absolute priority in ranking |

**Constraints:**
- If `secondary_bucket` is set, `secondary_yield` must be set (and vice versa). Same for tertiary.
- `primary_bucket` must always be set.
- `max_monthly_demand_fp` ≥ 0.
- Yields must be ∈ (0, 1] when set.

**Excel parity notes:**
- The "Bucket" column (AD) in Excel is just a display echo of Primary Size (F); no data.
- Columns AF-AP (Total Demand, Total Margin, Avg Price, etc.) are derived, not inputs. Covered in Section 2.
- `Other Costs` column (U) in Excel does a lookup against the Other Costs tab by item description; in v1 we'll fold this into a plain `other_costs_fp` field on the program (numeric input), with the lookup becoming a separate feature later.

### 1.2 Buckets (Size Grades)

| Field | Type | Required | Notes |
|---|---|---|---|
| `id` | uuid | yes | |
| `name` | string | yes | e.g., "800-1100g". Must be unique. |
| `sort_order` | int | yes | Determines display order; lower = higher priority |

Excel source: Bucket Legend tab, column B (rows 5-34, up to 30 buckets).

### 1.3 Monthly Harvest Plan

Whole round capacity by bucket by month. This is the SUPPLY side.

| Field | Type | Required | Notes |
|---|---|---|---|
| `bucket_id` | FK bucket | yes | |
| `month_index` | int 1-60 | yes | 1 = M1 (first month of planning horizon) |
| `capacity_kg_wr` | number ≥ 0 | yes | kg of whole round available in that bucket in that month |

Excel source: Monthly Harvest Plan tab, rows 6-35, cols B-BI. Each row is one
bucket, each column is one month (M1-M60).

**Total possible rows**: 30 buckets × 60 months = 1,800 max.

### 1.4 Monthly Demand Plan (with Time-Variable Overrides)

Demand by program by month. This is the DEMAND side.

Excel represents this in two layers:
- **Baseline**: Programs.E (max_monthly_demand_fp) — same value repeated for 60 months
- **Time-Variable Overrides**: per-program per-month override that replaces the baseline

In the web app we collapse these into one table:

| Field | Type | Required | Notes |
|---|---|---|---|
| `program_id` | FK program | yes | |
| `month_index` | int 1-60 | yes | |
| `demand_fp` | number ≥ 0 | yes | kg FP demanded in this month |

If a user hasn't entered any per-month override for a program, all 60 months default
to `program.max_monthly_demand_fp`. When they edit a specific month, only that
month's row exists in the database (or all months are materialized — TBD in data
model artifact).

### 1.5 Plan Settings

Global mode toggles that shape how the allocation runs.

| Field | Type | Required | Excel | Options |
|---|---|---|---|---|
| `margin_metric` | enum | yes | 60-MS B4 / Opt D4 | `Margin/kg FP` / `Margin/kg WR` / `Total Contribution` |
| `allocation_mode` | enum | yes | 60-MS D4 / Opt F4 | `Fill what you can` / `All-or-Nothing` |
| `scope` | enum | yes | 60-MS F4 / Opt H4 | `Active` / `Active+Pipeline`. Default: `Active+Pipeline`. |
| `lookback_months` | int | yes | (hardcoded 2 in v30) | Number of prior months to draw from. v1: fixed at 2; make it a setting for future. |

### 1.6 Time-Variable Overrides for Price and Cost

Excel has monthly overrides for price ($/kg FP) and total cost ($/kg FP) at rows
601 and 661 of the Time-Variable Overrides tab. In v1 web:

| Field | Type | Required | Notes |
|---|---|---|---|
| `program_id` | FK program | yes | |
| `month_index` | int 1-60 | yes | |
| `price_fp` | number > 0 | no | If null, use `program.price_per_fp` |
| `barra_cost_wr` | number ≥ 0 | no | If null, use `program.barra_cost_wr` |

*(Other cost components — packing, processing, storage, freight — are not
time-varying in the Excel model, so v1 doesn't need per-month overrides for them.)*

---

## 2. Derived per-program values

These are computed from inputs. Not stored — computed at read time.

### 2.1 Per-path costs and margins

For each program × each path (primary, secondary, tertiary):

```
total_cost_fp[path] = (barra_cost_wr / yield[path]) 
                    + packing_cost_fp 
                    + processing_cost_fp 
                    + storage_cost_fp 
                    + freight_cost_fp 
                    + other_costs_fp

margin_fp[path]     = price_fp - total_cost_fp[path]
margin_wr[path]     = margin_fp[path] × yield[path]
```

Excel parity: primary = cols V, W, X. Secondary = AK, AL, AM. Tertiary = AN, AO, AP.

### 2.2 Per-program totals (60-month horizon)

```
total_demand_fp     = sum of demand_fp over all 60 months for this program
total_demand_wr     = sum of (demand_fp[m] / primary_yield) over all 60 months
total_margin_$      = sum over all 60 months of (demand_fp[m] × margin_fp[primary]_at_month_m)
                      *using time-varying price/cost when present*
avg_price_fp        = average of price_fp[m] over all 60 months
avg_total_cost_fp   = average of total_cost_fp[m, primary path] over all 60 months
gp_pct              = margin_fp[primary] / avg_price_fp   (if avg_price_fp > 0, else 0)
```

Excel parity: cols AF, AH, AG, AI, AJ, Z.

---

## 3. Ranking and prioritization

For each month, programs compete for that month's harvest. Ranking determines
who gets served first when supply is scarce.

### 3.1 Rank scoring

Each program gets a **priority score**. Lower score = higher priority = served first.

```
priority_score = (1 - locked ? 1 : 0) × 1,000,000
               + bucket_priority × 100
               + in_bucket_rank
```

Where:
- **locked**: `1` if `programs.locked == true`, else `0`. Locked programs always
  come before unlocked ones.
- **bucket_priority**: sort_order of the program's `primary_bucket` (from Buckets
  table). Buckets are prioritized in Bucket Legend order.
- **in_bucket_rank**: rank of this program among programs sharing the same primary
  bucket, sorted by the `margin_metric` selected in Plan Settings:
  - If `Margin/kg FP`: sort by `margin_fp[primary]` descending; highest = rank 1
  - If `Margin/kg WR`: sort by `margin_wr[primary]` descending; highest = rank 1
  - If `Total Contribution`: sort by `total_margin_$` descending; highest = rank 1
  - Ties broken by program `id` (deterministic).

**Filter**: Only programs where `status ∈ scope` are ranked. If `scope = Active`,
only Active programs. If `scope = Active+Pipeline`, both. Inactive programs are
never ranked and never allocated.

### 3.2 Global rank

Programs are then sorted by `priority_score` ascending. The global rank is 1..N
where N is the number of in-scope programs (up to 50 in v1).

Excel parity: 60-MS columns BS (in-scope flag), BU (locked), BV (bucket num), BW
(in-bucket rank), BX (priority score), BY (global rank).

### 3.3 Recomputation triggers

The rank is invalidated (and must be recomputed) when any of these change:
- Any program's `status`, `locked`, `primary_bucket`, `primary_yield`, `price_per_fp`,
  or any cost component
- Any bucket's `sort_order`
- `plan_settings.margin_metric` or `plan_settings.scope`
- Time-varying price or cost for any program in any month (affects `total_margin_$`)

Implementation note: the rank should be cached per plan revision and recomputed
lazily when any of the above change.

---

## 4. Own-month allocation

For each month M, we allocate that month's harvest (whole round, by bucket) to
programs in rank order. This is the "own-month" step — no cross-month borrowing yet.

### 4.1 Loop structure

```
For each month M in 1..60:
  For each program P in rank order (rank 1, 2, 3, ...):
    Try to satisfy P's month-M demand from month-M harvest,
    cascading through P's paths (primary → secondary → tertiary):
      For each path in [primary, secondary, tertiary]:
        If P has this path (bucket + yield set):
          Attempt allocation from (path.bucket, month M).
```

### 4.2 Path allocation within a month

Given program P at month M, attempting a specific path:

```
bucket        = P.<path>_bucket
yield         = P.<path>_yield
plan_capacity = harvest_plan[bucket, M]

# How much of that bucket's month-M capacity is already spent by higher-ranked programs?
already_consumed = sum over all higher-rank programs H of:
                     H's own-month allocation from (bucket, M) via any path
                     (primary + secondary + tertiary combined for bucket match)

available_wr = max(0, plan_capacity - already_consumed)

# How much demand is left for P at month M (in FP terms)?
already_fulfilled_fp = sum over earlier paths in P's cascade this month
residual_demand_fp   = max(0, demand_fp[P, M] - already_fulfilled_fp)

# In All-or-Nothing mode, we only allocate if we can meet FULL residual demand.
# In Fill what you can, we allocate what fits.

residual_demand_wr = residual_demand_fp / yield

if allocation_mode == "Fill what you can":
    allocate_wr = min(residual_demand_wr, available_wr)

elif allocation_mode == "All-or-Nothing":
    if available_wr >= residual_demand_wr:
        allocate_wr = residual_demand_wr
    else:
        allocate_wr = 0

allocate_fp = allocate_wr × yield
record allocation[P, M, path] = allocate_wr
```

### 4.3 Ordering guarantees

- **Programs within a month are processed strictly in rank order.** Rank 1 gets first
  dibs on all buckets. Rank 2 sees what's left. Etc.
- **Paths within a program are processed strictly primary → secondary → tertiary.**
  A program never dips into secondary until its primary can't fulfil residual demand
  (or has been exhausted by higher-ranked programs).
- **Months are independent of each other** in this step. Own-month allocation
  produces per-(program, month) results with no cross-month dependencies.

### 4.4 Locked programs

Because locked programs have priority_score offset of `-1,000,000`, they always
appear at the top of the rank order. Within locked programs, the bucket + in-bucket
rank still apply. So multiple locked programs contend among themselves before
any unlocked program is considered.

### 4.5 Excel parity checkpoints

For any input state, the following should match the Excel model exactly (tolerance
0.01 kg):

- 60-MS grid cells: BZ:EG (primary WR), EI:GP (secondary WR), GV:JC (tertiary WR),
  each row = program at that rank, each column = month
- 60-MS visible cell in mode "Allocated WR" for a given (rank R, month M) =
  `allocation[program_at_rank_R, M, primary] + secondary + tertiary`

### 4.6 Edge cases

**Program has no primary bucket**: Not allowed. Programs must have primary set.

**Program has only primary**: Secondary and tertiary attempts are skipped.

**Program has zero demand at month M**: Skip immediately, no allocation.

**Bucket capacity is zero at month M**: Path attempt returns `allocate_wr = 0`;
cascade continues to next path.

**Two programs tie on priority_score exactly**: Deterministic order by program.id.
(This should be rare given the score has 100× and 1,000,000× weights, but possible
with two programs in the same bucket having identical margins.)

**Yield is 0 or null**: Skip that path; treat as if the program doesn't have that path.

---

## Open questions for you (before I write Sections 5-9)

1. **Other Costs lookup.** Excel does a per-program cost lookup via item description
   in the Other Costs tab. In v1 I proposed folding this into a plain `other_costs_fp`
   field. Is that OK, or do you want a proper cost-by-product-category lookup as a
   feature in v1?

2. **Time-variable price/cost overrides.** Excel supports per-month price and
   cost overrides for each program. Do you actively use these today? If not, we can
   defer to v2.

3. **Locked programs vs. bucket priority.** Right now Locked outweighs bucket
   priority by a factor of 10,000×. Is that intentional? A locked program in a
   "bad" bucket still beats an unlocked program in the "top" bucket. Confirming
   this is the desired behavior.

4. **Margin metric interpretation for cascade paths.** When ranking, we use
   `margin_fp[primary]` (or `margin_wr[primary]` or total_contribution). Should
   we ever consider a program's secondary/tertiary margin for ranking? Excel uses
   primary only — sticking with that.

5. **Bucket priority tie-breaker.** If two buckets have the same `sort_order` (a
   data-entry mistake), how do we break the tie? Proposal: fall back to alphabetic
   by bucket name, log a warning to admin.

Once you review Sections 1-4 and answer the 5 open questions, I'll write Sections
5-9 (the Rolling Calc borrowing engine, aggregations, and validation criteria).

---

## 5. Rolling Calc — the forward-borrowing engine

Own-month allocation (Section 4) fulfils demand from the SAME month's harvest. When
a program has demand at month M but insufficient own-month capacity, the Rolling
Calc engine attempts to fulfil that demand by drawing from PRIOR months' unused
capacity — a "forward-look" from M into M-1 and M-2.

This is the algorithm we spent the most time getting right. The subtlety is that
multiple programs compete for the same limited prior-month capacity, and the order
of operations must be deterministic.

### 5.1 What Rolling Calc produces

For each (program, month) pair, Rolling Calc produces:

| Output | Description |
|---|---|
| `demand_fp[P, M]` | The program's demand in FP for month M (input) |
| `own_fp[P, M]` | FP fulfilled from month M's own harvest (from Section 4) |
| `borrow_m1_prim_wr[P, M]` | WR borrowed from month M-1 in P's PRIMARY bucket |
| `borrow_m1_alt_wr[P, M]` | WR borrowed from month M-1 in P's SECONDARY bucket |
| `borrow_m1_tert_wr[P, M]` | WR borrowed from month M-1 in P's TERTIARY bucket |
| `borrow_m2_prim_wr[P, M]` | WR borrowed from month M-2 in P's PRIMARY bucket |
| `borrow_m2_alt_wr[P, M]` | WR borrowed from month M-2 in P's SECONDARY bucket |
| `borrow_m2_tert_wr[P, M]` | WR borrowed from month M-2 in P's TERTIARY bucket |
| `rolling_fp[P, M]` | Total FP fulfilled at month M = own + all 6 borrow channels × their yields |
| `rolling_wr[P, M]` | Total WR consumed for this program's month-M demand = own_wr + all 6 borrow channels |
| `rolling_margin[P, M]` | Total margin earned for this program's month-M demand |

Excel parity: Rolling Calc tab, Blocks 1-11.

### 5.2 The six borrow channels

For a program P at target month M, borrowing is attempted in this fixed cascade
order:

1. **M-1 primary**: draw from month M-1, in P's primary bucket
2. **M-1 secondary**: draw from month M-1, in P's secondary bucket
3. **M-1 tertiary**: draw from month M-1, in P's tertiary bucket
4. **M-2 primary**: draw from month M-2, in P's primary bucket
5. **M-2 secondary**: draw from month M-2, in P's secondary bucket
6. **M-2 tertiary**: draw from month M-2, in P's tertiary bucket

Each channel is attempted only if there's still residual demand after the previous
channels. Each channel is skipped if that bucket path doesn't exist on the program.

### 5.3 The core formula (per channel)

For program P, target month M, channel C = (source_offset ∈ {1, 2}, path ∈ {prim, alt, tert}):

```
source_month  = M - source_offset          # M-1 or M-2
source_bucket = P.<path>_bucket
yield         = P.<path>_yield
```

Skip conditions (returns 0):
- `source_month < 1` (no month to borrow from)
- `source_bucket` is null (program doesn't have this path)
- `yield ≤ 0`
- `residual_demand_fp ≤ 0` (nothing left to fulfil)

Otherwise:

```
# Residual demand not yet fulfilled by earlier channels in P's cascade for month M
residual_demand_fp = demand_fp[P, M] 
                   - own_fp[P, M]
                   - sum of (earlier_borrow_wr × earlier_yield) for channels 
                     processed before this one in the cascade order

residual_demand_wr = residual_demand_fp / yield

# How much of source_bucket's capacity in source_month is still available?
plan_capacity   = harvest_plan[source_bucket, source_month]
own_consumption = sum over all programs of their own-month allocations
                  from source_bucket at source_month, across ALL paths (prim + alt + tert)

earlier_drawdown = sum of borrowings ALREADY committed to (source_bucket, source_month)
                   by:
                   - higher-priority programs at target M (same cascade rank), 
                     across all 6 channels
                   - all programs at target months earlier than M whose channels 
                     drew from (source_bucket, source_month)

available_wr = max(0, plan_capacity - own_consumption - earlier_drawdown)

borrowed_wr = max(0, min(residual_demand_wr, available_wr))
```

### 5.4 Processing order (the tricky part)

The order in which we process (program, target month, channel) tuples determines
who gets first access to limited capacity. The order is:

**By target month ascending**, then **by program rank ascending**, then **by channel
in cascade order**.

Concretely, for a plan with N programs and 60 months:

```
for target_M in 1..60:
    for rank in 1..N:
        program = program_at_rank(rank)
        for channel in [M-1 prim, M-1 alt, M-1 tert, M-2 prim, M-2 alt, M-2 tert]:
            compute borrowed_wr[program, target_M, channel]
```

This means:
- Month M=1 has no borrowing (nothing to borrow from). All channels return 0.
- Month M=2: only M-1 channels are viable (source_month = 1). M-2 channels return 0.
- Month M=3 onwards: all 6 channels are viable.
- Within target month M, rank-1 program processes ALL 6 channels before rank-2 starts.

**Critical dependency invariant** (why acyclic):
- A borrowing at (target_M, rank, channel) can only depend on decisions ALREADY
  made — never on decisions yet to be made.
- Same-target-month, earlier-rank borrowings drain source capacity for this rank.
- Earlier-target-month decisions can affect source capacity for later targets:
  a decision at target_M-1 to borrow from source_month(target_M-1)-1 = M-2 
  reduces the M-2 capacity available to target M.

### 5.5 Rolling outputs (post-processing)

Once all borrowings are computed:

```
rolling_fp[P, M] = own_fp[P, M]
                 + borrow_m1_prim_wr[P, M] × P.primary_yield
                 + borrow_m1_alt_wr[P, M]  × P.secondary_yield
                 + borrow_m1_tert_wr[P, M] × P.tertiary_yield
                 + borrow_m2_prim_wr[P, M] × P.primary_yield
                 + borrow_m2_alt_wr[P, M]  × P.secondary_yield
                 + borrow_m2_tert_wr[P, M] × P.tertiary_yield

rolling_wr[P, M] = own_wr[P, M]              # from Section 4
                 + borrow_m1_prim_wr[P, M]
                 + borrow_m1_alt_wr[P, M]
                 + borrow_m1_tert_wr[P, M]
                 + borrow_m2_prim_wr[P, M]
                 + borrow_m2_alt_wr[P, M]
                 + borrow_m2_tert_wr[P, M]

rolling_margin[P, M] = 
    (own_prim_wr + borrow_m1_prim_wr + borrow_m2_prim_wr) × P.primary_yield × margin_fp[primary]
  + (own_alt_wr  + borrow_m1_alt_wr  + borrow_m2_alt_wr)  × P.secondary_yield × margin_fp[secondary]
  + (own_tert_wr + borrow_m1_tert_wr + borrow_m2_tert_wr) × P.tertiary_yield × margin_fp[tertiary]
```

Where `margin_fp[path] = price_fp - total_cost_fp[path]` from Section 2.1.

### 5.6 Guarantees Rolling Calc must satisfy

For any valid input, the output must satisfy:

1. **No negative borrowings**: `borrow_*_wr[P, M] ≥ 0` for all P, M, channel.
2. **Capped by residual demand**: `rolling_fp[P, M] ≤ demand_fp[P, M]` for all P, M.
3. **Capped by available capacity**: for any (source_bucket, source_month), the sum
   of all borrowings drawing from it plus own-month consumption at that
   (bucket, month) does not exceed `plan_capacity[bucket, source_month]`.
4. **Cascade order respected**: `borrow_m2_prim_wr > 0` implies primary residual
   was still positive AFTER M-1 primary, M-1 alt, M-1 tert attempts.
5. **Determinism**: Given identical inputs, the output must be identical every
   time (no floating-point ordering dependencies).

---

## 6. Unallocated WR

For any (bucket, month), Unallocated WR is the plan capacity remaining after all
own-month consumption AND all forward-borrowing drawdowns.

### 6.1 Formula

```
unallocated_wr[bucket B, month M] = max(0,
    plan_capacity[B, M]
    - own_consumption[B, M]         # all programs, all paths, own-month, at (B, M)
    - borrowings_into[B, M]         # all programs' borrowings whose source is (B, M)
)
```

Where:
```
own_consumption[B, M] = sum over all programs P and paths (prim, alt, tert) of:
                          allocation[P, M, path] where path_bucket[P] == B

borrowings_into[B, M] = sum over all programs P and target months M' ≠ M of:
                          borrow[P, M', channel] where channel targets (B, M) as source
```

The `borrowings_into[B, M]` term specifically means:
- For M-1 lookback: programs targeting month M+1 who chose path where path_bucket == B
- For M-2 lookback: programs targeting month M+2 who chose path where path_bucket == B

### 6.2 Invariant

For each (bucket, month):
```
plan_capacity[B, M] ≥ own_consumption[B, M] + borrowings_into[B, M]
```

Equivalent: `unallocated_wr[B, M] ≥ 0` is a hard invariant, not just a max(0,...).
If the algorithm ever produces a scenario where the raw calculation would be
negative, that indicates a bug in the borrowing logic — the max(0,...) is
defensive but must never actually clamp during correct operation.

Excel parity: Unallocated WR tab.

---

## 7. Program-level aggregations

### 7.1 Program Fulfilment

For each program P and each month M:

```
fulfilment_pct[P, M] = min(1.0, rolling_fp[P, M] / demand_fp[P, M])
                     if demand_fp[P, M] > 0
                     else undefined (display as blank)

unfulfilled_wr[P, M] = max(0, (demand_fp[P, M] - rolling_fp[P, M]) / P.primary_yield)
                     if demand_fp[P, M] > 0 and P.primary_yield > 0
                     else 0
```

Excel parity: Program Fulfilment tab.

### 7.2 Per-program Revenue, Cost, Margin (rolling)

For each program P and each month M:

```
revenue[P, M]     = rolling_fp[P, M] × price_fp[P]
cost[P, M]        = rolling_fp[P, M] × total_cost_fp[P, primary]  
                    *technically only correct if all rolling FP came via primary path;
                    for exact per-path accounting, use rolling_margin equation from 5.5*
margin[P, M]      = revenue[P, M] - cost[P, M]
                    (equivalently: rolling_margin[P, M] from 5.5 which handles per-path)
```

**Note on cost accuracy**: Excel's Revenue & Cost tab uses the primary-path cost
per program regardless of which path was actually used to fulfil demand. This
introduces small errors when secondary/tertiary paths carry meaningful volume.
The web app should use per-path accounting via the `rolling_margin` decomposition
in 5.5. This is a **deliberate improvement** over Excel parity, but should be
called out to users so they understand FY totals may differ by a small amount.

### 7.3 GP%

```
gp_pct[P, M] = margin[P, M] / revenue[P, M]     if revenue[P, M] > 0
             else 0
```

---

## 8. Plan-level aggregations

### 8.1 Annual Summary

Aggregated across all in-scope programs and over defined periods. In v1 the periods
are FY1, FY2, FY3, FY4, FY5, and Total (60-month).

For each period spanning months M_start..M_end:

```
demand_fp        = sum over P in scope, M in period of demand_fp[P, M]
allocated_fp     = sum over P in scope, M in period of rolling_fp[P, M]
unallocated_fp   = demand_fp - allocated_fp
allocated_wr     = sum over P in scope, M in period of rolling_wr[P, M]
unallocated_wr   = sum over bucket B, M in period of unallocated_wr[B, M]
revenue          = sum over P in scope, M in period of revenue[P, M]
cost             = sum over P in scope, M in period of cost[P, M]  
                   *using per-path accounting from 7.2*
margin           = revenue - cost
gp_pct           = margin / revenue    (if revenue > 0)
```

**FY boundary note**: Allocated WR sums by TARGET month (which period the demand
lived in). Unallocated WR sums by SOURCE month (which period had the plan capacity).
For cross-FY borrowings (M12→M13 or M12→M14), these two accountings diverge slightly
per FY. Total (60mo) always reconciles perfectly. This is spec'd behavior; not a
bug. Document it in the UI.

**Opportunity metrics** (Excel rows 22-25):
```
revenue_opportunity = sum over P in scope, M in period of demand_fp[P, M] × price_fp[P]
cost_opportunity    = sum over P in scope, M in period of demand_fp[P, M] × total_cost_fp[P, primary]
margin_opportunity  = revenue_opportunity - cost_opportunity
margin_gap          = margin_opportunity - margin        # potential vs realised
```

Excel parity: Annual Summary tab.

### 8.2 Pipeline WR Allocation tab

For each (bucket, source_month), the WR consumed by PIPELINE programs specifically:

```
pipeline_wr[B, M] = 
    own_consumption_by_pipeline[B, M]
  + borrowings_into[B, M] BY pipeline programs
```

Where:
```
own_consumption_by_pipeline[B, M] = sum over programs P where status='Pipeline'
                                    of allocation[P, M, any path] where path_bucket == B

borrowings_into[B, M] by pipeline = sum over pipeline programs P and target M' of
                                    borrow_channels[P, M', ch] where source == (B, M)
```

Row totals and column totals as displayed in Excel. Excel parity: Pipeline tab.

### 8.3 60-Month Summary (rolling view)

For each (rank R, month M), display one of three metrics based on user toggle:

- **Allocated FP** = `rolling_fp[program_at_rank_R, M]`
- **Allocated WR** = `rolling_wr[program_at_rank_R, M]`
- **Margin $** = `rolling_margin[program_at_rank_R, M]`

The row's Total column = sum of the metric across M=1..60 for that program.

Excel parity: 60-Month Summary tab visible cells.

---

## 9. Edge cases and cross-validation

### 9.1 Edge case catalog

| Scenario | Expected behavior |
|---|---|
| Zero programs in scope | All outputs = 0; UI shows "No programs to plan" |
| All programs locked with same primary bucket, sum of demand > capacity | Rank by in-bucket margin; excess demand → unallocated_fp reflects the shortfall |
| Program has demand but zero yield on primary path | Skip primary; try secondary if set; if all paths have zero yield, program is un-allocatable, rolling_fp = 0 for all months |
| Program has demand but no bucket set | Invalid input; block save at UI layer |
| Bucket capacity = 0 for all 60 months | No allocation possible via that bucket; programs whose ONLY viable bucket this is get 0 fulfilment |
| Two active programs identical in every field | Deterministic ordering by program.id; both fully fulfilled if capacity allows |
| Program status flipped from Active → Inactive mid-planning | Immediate re-rank; program removed from allocation; capacity that was allocated to it is returned to unallocated pool |
| Time-Variable Override sets demand to 0 for a month | Program allocated 0 that month; no downstream errors |
| Harvest capacity increased for a past month after allocation ran | Full re-run required; own-month and rolling may both change |
| User locks a program AFTER allocation | Re-rank + re-run; may drastically reallocate |
| Cascade paths all valid but no residual demand after own-month | All borrow channels return 0; rolling_fp == own_fp |
| Program has ONLY primary and tertiary set (no secondary) | Secondary channels skipped; tertiary attempted after primary |
| Negative demand entered | Reject at input validation |
| Yield > 1.0 entered | Reject at input validation |

### 9.2 Cross-validation criteria

The web app's calculation engine must produce results that match the Excel V30
reference for every input state within these tolerances:

| Output | Tolerance |
|---|---|
| Any WR value (own or borrowed) | ±0.01 kg |
| Any FP value | ±0.01 kg |
| Revenue / Cost / Margin | ±$0.01 |
| Fulfilment % | ±0.0001 (0.01 percentage point) |
| GP % | ±0.0001 |

**Test harness requirement**: Before Phase 2 (engine port) is considered complete,
the following test suite must pass:

1. **Baseline scenario**: Load V30 Excel exactly as delivered. Every visible number
   on Annual Summary, Program Fulfilment, Unallocated WR, Pipeline, and 60-MS must
   match the Excel output.
2. **Kangamuit M7 test**: Set demand of Programs row 11 to 15,000 kg FP in M7 (Oct
   2026). Verify Rolling Calc borrows from M5/M6 as expected. Verify Unallocated
   WR for 600-800g at M5/M6 decreases correspondingly.
3. **Locked flip test**: Take a top-ranked unlocked program and lock it. Rank
   should not change. Take a bottom-ranked unlocked program and lock it. It should
   jump to the top of its bucket.
4. **Scope toggle test**: Switch scope from Active+Pipeline to Active only.
   Pipeline programs should show fulfilment = 0, and their buckets' Unallocated
   WR should increase by the amount that was previously going to pipeline.
5. **Mode toggle test**: Switch allocation_mode from "Fill what you can" to
   "All-or-Nothing". Verify programs whose full demand can't fit get allocation = 0
   (instead of partial).
6. **Zero-demand month test**: Set a program's demand to 0 for a single month.
   Verify no allocation, no borrowing, no downstream errors.
7. **Determinism test**: Run same input twice. Verify identical output byte-for-byte
   (or within floating-point epsilon for the tolerance stated above).

### 9.3 Recalculation triggers

The engine must fully or partially re-run when:

| Change | Impact |
|---|---|
| Program status | Re-rank + re-run |
| Program locked | Re-rank + re-run |
| Program primary bucket / yield / price / any cost | Re-rank + re-run |
| Program secondary or tertiary path | Re-run (no re-rank) |
| Bucket sort_order | Re-rank + re-run |
| Harvest capacity for any (bucket, month) | Re-run (no re-rank) |
| Demand for any (program, month) | Re-run (no re-rank) |
| Plan setting: margin_metric | Re-rank + re-run |
| Plan setting: allocation_mode | Re-run |
| Plan setting: scope | Re-rank + re-run |
| Plan setting: lookback_months | Re-run |

**Performance target**: A full re-run (rank + own-month + Rolling Calc for all 50
programs × 60 months) must complete in under 2 seconds on the target server. This
constrains the engine port to be efficient (no naive nested loops with O(N³) SUMIFS
emulation).

---

## Resolved decisions

All 6 open questions from Draft 1 have been resolved:

1. **Simultaneous vs incremental recalc**: **Batch-on-commit**. Users edit in a
   "draft" state; Save triggers a full re-run (< 2s target).

2. **How live is live**: **On-navigation refresh**. Viewers see updates when they
   navigate to a page or click a "Recalculate now" button on the stale banner.
   No WebSocket push.

3. **Scenarios and Rolling Calc**: **Fresh recompute from scratch** on every
   commit. No diff-against-master optimization.

4. **Excel export**: **Deferred to v2**. v1 offers CSV export only.

5. **Historical actuals**: **Deferred to v2**. v1 is forward-planning only.

6. **Multi-currency**: **Deferred to v2**. v1 is single-currency.

Spec is locked. Ready for implementation.
