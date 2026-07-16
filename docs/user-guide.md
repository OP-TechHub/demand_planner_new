# Oceanpick Demand Planner — User Guide

A practical, end-to-end guide to using the Demand Planner: what every page does,
the workflow from raw inputs to a computed plan, and the concepts behind the
numbers. The app reproduces the Oceanpick V30 planning workbook to the number,
so if you know the spreadsheet the terms here will feel familiar.

---

## Contents

1. [Concepts & glossary](#1-concepts--glossary)
2. [Getting started](#2-getting-started)
3. [The screen layout](#3-the-screen-layout)
4. [The planning workflow at a glance](#4-the-planning-workflow-at-a-glance)
5. [Inputs](#5-inputs)
   - [Programs](#programs)
   - [Demand Plan](#demand-plan)
   - [Harvest Plan](#harvest-plan)
   - [Buckets](#buckets)
   - [Settings](#settings)
6. [Recompute — turning inputs into a plan](#6-recompute--turning-inputs-into-a-plan)
7. [Outputs](#7-outputs)
   - [Dashboard](#dashboard)
   - [Annual Summary](#annual-summary)
   - [Program Fulfilment](#program-fulfilment)
   - [Unallocated WR](#unallocated-wr)
   - [Pipeline WR](#pipeline-wr)
   - [60-Month Summary](#60-month-summary)
   - [Revenue & Cost](#revenue--cost)
   - [Fulfilment Optimizer](#fulfilment-optimizer)
8. [Scenarios](#8-scenarios)
9. [Admin](#9-admin)
10. [Importing & exporting CSV](#10-importing--exporting-csv)
11. [Tips & troubleshooting](#11-tips--troubleshooting)

---

## 1. Concepts & glossary

The whole model runs on a handful of ideas. Read this section once and the rest
of the app explains itself.

| Term | Meaning |
|---|---|
| **FP** | **Finished Product** — the packed, sellable weight. Demand and allocation are measured in FP. |
| **WR** | **Whole Round** — raw fish weight before processing. Harvest capacity is measured in WR. |
| **Yield** | The fraction of WR that becomes FP for a given path (0–1). 0.45 means 45% of raw weight ends up as finished product. |
| **Bucket** | A supply pool — a species/size/source of fish with its own monthly harvest capacity (in WR). Programs draw their supply from buckets. |
| **Program** | A customer order line: a product for a customer, with a monthly demand and a recipe of buckets it can be filled from. |
| **Primary / Secondary / Tertiary path** | Each program can be filled from up to three buckets. The **primary** is the main source; secondary and tertiary are fallbacks, each with its own yield. |
| **Locked** | A program flagged as guaranteed. Locked programs are served **first**, in sheet order, before any unlocked program competes for supply. |
| **Priority / rank** | The order in which programs claim supply. Locked programs rank by their row order; unlocked programs rank by margin (most profitable first). |
| **Own-month allocation** | Each month, demand is first filled from that same month's harvest. |
| **Forward-borrowing** | If a month is short, later months' spare harvest can be pulled forward to cover it (across a 6-month window). This is how the pipeline is modelled. |
| **Unallocated** | Demand that could not be filled from any bucket in any eligible month — the shortfall. |
| **Pipeline WR** | Harvest that has been committed forward to cover earlier demand — supply "in the pipeline." |
| **Plan / Scenario** | A complete set of inputs + computed results. The **master plan** is your live baseline; **scenarios** are forks you can experiment in without touching the master. |
| **Horizon** | The plan runs over **60 months** (M1–M60), i.e. five years. |

**The one-sentence model:** each program has monthly **demand (FP)**; each bucket
has monthly **harvest (WR)**; the engine ranks programs, converts WR→FP by yield,
and allocates supply to demand month-by-month (borrowing forward when short),
then reports what got filled, what didn't, and what it's worth.

---

## 2. Getting started

### Signing up

1. Go to the app URL and choose **Sign up**.
2. Enter your work email and a password. New accounts join the Oceanpick
   organisation automatically.
3. The first user in the organisation is an **admin**; later users join as
   **viewers** and an admin can promote them (see [Admin](#9-admin)).

### Signing in

Use **Log in** with your email and password. Your session keeps you signed in
across visits until you log out.

### Roles at a glance

| Role | Can do |
|---|---|
| **Viewer** | See every input and output page; export CSV. Cannot edit. |
| **Editor** | Everything a viewer can, plus edit inputs and run recompute. |
| **Admin** | Everything an editor can, plus manage users/roles and view the audit log. |

---

## 3. The screen layout

- **Left sidebar** — navigation, grouped into **Inputs**, **Outputs**,
  **Scenarios**, and (admins only) **Admin**.
- **Top bar** — shows the **active plan** and lets you switch between the master
  plan and your scenarios. Whatever plan is active drives every page you see.
- **Main area** — the page content.

> **Active plan matters.** Every page — inputs and outputs — reflects the plan
> currently selected in the top bar. If a number looks wrong, first check which
> plan you're in.

---

## 4. The planning workflow at a glance

```
        ┌─────────── Inputs ───────────┐
        │  Buckets   → monthly harvest │
        │  Programs  → demand + recipe │
        │  Demand    → per-month tweaks│
        │  Harvest   → per-month cap.  │
        └──────────────┬───────────────┘
                       │  press "Recompute"
                       ▼
                ┌────────────┐
                │ Calc engine│  rank → allocate → borrow forward → total up
                └──────┬─────┘
                       ▼
        ┌─────────── Outputs ──────────┐
        │  Dashboard, Annual Summary,  │
        │  Fulfilment, Unallocated,    │
        │  Pipeline, 60-Month,         │
        │  Revenue & Cost, Optimizer   │
        └──────────────────────────────┘
```

**Typical loop:** edit an input → **Recompute** → read the outputs → adjust →
repeat. For "what if" experiments, do it inside a [scenario](#8-scenarios) so the
master plan stays clean.

---

## 5. Inputs

### Programs

The catalogue of customer order lines. Each program row carries:

- **Item code** — unique within the plan (your SKU/order identifier).
- **Item description** and **Customer**.
- **Status** — active or inactive. Inactive programs are excluded from the calc.
- **Max monthly demand (FP)** — the baseline demand used for every month unless
  you override a specific month on the Demand Plan page.
- **Recipe / paths** — a **primary bucket** (required, with a yield 0–1) and
  optional **secondary** and **tertiary** buckets, each with their own yield.
  This is the list of supply pools the program may draw from.
- **Price per FP** and the cost fields (barra cost WR, packing, processing,
  storage, freight, other) — used for Revenue & Cost.
- **Locked** — tick to guarantee this program is served first (see ranking).

**To add a program:** click **New program**, fill the form, save. New programs
sort after existing ones.
**To edit:** click a row, change fields, save.
**To remove:** archive it (a soft delete — it disappears from the plan but the
record is retained for audit).

> **Why yield matters:** demand is in FP but harvest is in WR. The engine divides
> the FP it needs by the path's yield to find the WR it must draw from the
> bucket. A lower yield consumes more raw harvest per unit shipped.

### Demand Plan

A wide grid of **program × month (M1–M60)**, in FP.

- Every cell defaults to the program's **Max monthly demand** (its baseline).
- Type a value into a cell to **override** just that month.
- Clear a cell to **revert** it to the baseline.
- **Reset** on a program row clears all its overrides at once.

Use this when a customer's demand isn't flat — seasonal peaks, a ramp, a one-off.

### Harvest Plan

A wide grid of **bucket × month (M1–M60)**, in WR (kg).

- Unlike demand, harvest has **no baseline** — every cell is a direct input and
  an empty cell means **zero capacity** that month.
- Enter the raw harvest you expect each bucket to yield each month.

This is the supply side of the model. If programs are going unfilled, this is
usually the first place to look.

### Buckets

Manage the supply pools themselves — create, rename, and archive buckets. A
bucket is referenced by programs (as a path) and carries the monthly harvest
capacity you enter on the Harvest Plan. Archiving a bucket removes it from
selection lists without deleting history.

### Settings

Plan-level configuration and metadata. Set the values here before you build out
programs and harvest so the horizon and defaults are consistent across the plan.

---

## 6. Recompute — turning inputs into a plan

Inputs are just data until you **Recompute**. Recompute runs the calc engine over
the active plan and writes fresh results to every output page.

**When to recompute:** after any change to programs, demand, harvest, buckets, or
settings. Outputs do **not** update automatically — they show the results of the
last recompute, with a "last computed" timestamp.

**What the engine does, in order:**

1. **Rank** every active program into a priority order.
   - **Locked** programs come first, in their **sheet row order**.
   - **Unlocked** programs follow, ordered by **margin** (most profitable first).
2. **Allocate own-month supply** — for each month, fill each program's demand
   from that month's harvest in the buckets on its recipe, best path first,
   converting WR→FP by yield, in priority order.
3. **Borrow forward** — where a month is short, pull spare harvest from later
   months (within a rolling window) to cover it. This models the supply pipeline.
4. **Aggregate** — total everything into the summaries: what was allocated, what
   stayed unallocated, the pipeline commitments, and the money.

The result is deterministic: the same inputs always produce the same plan.

---

## 7. Outputs

All output pages read the **last recomputed** results for the active plan, and
most offer **Export CSV**.

### Dashboard

Your at-a-glance home page:

- **KPIs** — headline totals (demand, fulfilled, fill rate, and financial
  summary).
- **Demand vs. fulfilled** line chart across the 60-month horizon — the dashed
  line is demand, the solid line is what got filled. The gap is your shortfall.
- **Recent activity** — the latest edits across programs, demand, and harvest
  (who changed what, when).
- **Alerts** — flags worth your attention (e.g. large unallocated demand).

### Annual Summary

The headline scorecard, totalled by year: demand, allocated, and unallocated (in
both FP and WR), plus revenue, cost, and margin. This is the tab that matches the
workbook's Annual Summary exactly.

### Program Fulfilment

A **program × month heatmap** of fill rate — how much of each program's demand
was met each month. Colour makes shortfalls jump out: cooler/!full cells are
where a program went under-served. Use it to see *which customers* are affected
and *when*.

### Unallocated WR

The shortfall view: demand that couldn't be filled, expressed in WR. Shows where
and when supply fell short of demand. If this is non-zero and you want it lower,
add harvest (Harvest Plan) or reduce/redistribute demand.

### Pipeline WR

The forward-commitment view: harvest that's been borrowed forward to cover
earlier demand — i.e. supply already "spoken for." Reads alongside Unallocated to
show how hard the pipeline is working to keep programs filled.

### 60-Month Summary

The full month-by-month allocation across the whole five-year horizon — the
detailed backbone the annual figures roll up from. This is the grid verified
cell-for-cell against the workbook.

### Revenue & Cost

The financials. Toggle between metrics (revenue, cost, margin) to see each across
the horizon. Money is computed from allocated FP × the program's price, less its
per-unit costs.

### Fulfilment Optimizer

A single-month operational drill-down. Pick a month and see, for that month, how
supply was distributed across programs and buckets — the detailed "who got what
from where" view for operational planning.

---

## 8. Scenarios

Scenarios let you explore changes without risking the master plan.

- **Create a scenario** — forks the current plan into a full private copy
  (programs, demand, harvest, everything). Edit it freely.
- **Switch active plan** — use the top bar to move between the master and your
  scenarios. Every page follows the active plan.
- **Diff** — compare a scenario against the master to see exactly what your
  changes did to the outputs, side by side.
- **Rename / delete** — manage your scenarios from the **My scenarios** page.

**Recommended workflow:** never experiment in the master. Fork a scenario, make
your changes, recompute, read the diff, and only fold the idea back into the
master once you're happy.

---

## 9. Admin

Admin-only, in the sidebar's **Admin** section.

### Users

See everyone in the organisation. Change a user's **role** (viewer / editor /
admin) and **activate/deactivate** accounts. Deactivated users can't sign in.

### Audit log

An append-only record of changes across the app — user role/status changes and
input edits (programs, demand, harvest), showing **who** did **what** and
**when**, with a summary of the change. Use it to trace how the plan reached its
current state.

---

## 10. Importing & exporting CSV

### Importing

- **Programs** — import a CSV of program rows. Choose **Add new only** (skip
  existing item codes) or **Upsert** (update rows whose item code already exists).
- **Demand** — import a wide CSV of `item_code × M1..M60`. Cells fill the demand
  overrides; unknown item codes are skipped and reported back to you.
- **Harvest** — import a wide CSV of `bucket_name × M1..M60`. Cells fill harvest
  capacity; unknown bucket names are skipped and reported.

After any import, **recompute** to see the effect.

### Exporting

Most output pages have an **Export CSV** button that downloads exactly what's on
screen — handy for sharing, archiving, or reconciling against the workbook.

---

## 11. Tips & troubleshooting

**"My outputs look stale / don't reflect my edit."**
Recompute. Outputs show the last computed result, not live inputs. Check the
"last computed" timestamp.

**"A program is going unallocated and I don't know why."**
Work down this list:
1. Is the program **active**? Inactive programs are excluded.
2. Does its **harvest** exist? Check the buckets on its recipe have capacity in
   the months it needs (Harvest Plan) — empty means zero.
3. Is its **rank** low? Higher-priority programs claim supply first. Locked
   programs and higher-margin programs eat the harvest before it.
4. Is the **yield** right? A low yield burns more WR per FP shipped.

**"The numbers don't match the spreadsheet."**
First confirm you're on the right **plan** in the top bar, and that you've
recomputed. The engine is verified to full parity with the V30 workbook, so a
genuine mismatch usually means an input differs.

**"I want to try something risky."**
Fork a [scenario](#8-scenarios) and experiment there. The master plan stays
untouched, and the diff view shows you the impact.

**"I can't edit anything."**
You're probably a **viewer**. Ask an admin to make you an editor.

---

*This guide describes the app's behaviour as built. For the underlying data model
and calculation rules, see `docs/data-model.md` and the engine package
(`packages/engine`).*
