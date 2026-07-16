# Wireframes Specification

**Version**: Draft 1
**Reference**: `calculation-engine-spec.md`, `data-model.md`
**Purpose**: Define page-by-page structure, interactions, and navigation for the
Oceanpick Demand Planner web application v1.

## Reading conventions

- Wireframes are **functional descriptions**, not visual designs. Font choices,
  colors, and pixel positions are decided later.
- ASCII layouts sketch spatial relationships. Real UI will be built with a
  component library (shadcn/ui recommended).
- "→" indicates a navigation action or state change.
- Each page section describes: **purpose**, **layout**, **actions**, **empty state**.
- Where interactions matter (scenarios, edits, imports), interaction flows are
  described step-by-step.

## Table of contents

1. [Global navigation and shell](#1-global-navigation-and-shell)
2. [Authentication and onboarding](#2-authentication-and-onboarding)
3. [Home / Dashboard](#3-home-dashboard)
4. [Programs](#4-programs)
5. [Monthly Demand Plan](#5-monthly-demand-plan)
6. [Monthly Harvest Plan](#6-monthly-harvest-plan)
7. [Buckets (reference data)](#7-buckets-reference-data)
8. [Plan settings](#8-plan-settings)
9. [Annual Summary](#9-annual-summary)
10. [Program Fulfilment](#10-program-fulfilment)
11. [Unallocated WR](#11-unallocated-wr)
12. [Pipeline WR](#12-pipeline-wr)
13. [60-Month Summary](#13-60-month-summary)
14. [Revenue & Cost](#14-revenue--cost)
15. [Fulfilment Optimizer](#15-fulfilment-optimizer)
16. [Scenarios](#16-scenarios)
17. [CSV import/export](#17-csv-import-export)
18. [Admin: users and roles](#18-admin-users-and-roles)

---

## 1. Global navigation and shell

Every page shares the same shell.

```
┌────────────────────────────────────────────────────────────────────────┐
│ Oceanpick Demand Planner    [Plan: Master ▾]      [🔔] [User avatar ▾] │
├────────────────────────────────────────────────────────────────────────┤
│ ┌──────────────┐                                                       │
│ │ INPUTS       │                                                       │
│ │ • Programs   │                                                       │
│ │ • Demand Plan│           [Page content]                              │
│ │ • Harvest    │                                                       │
│ │ • Buckets    │                                                       │
│ │ • Settings   │                                                       │
│ │              │                                                       │
│ │ OUTPUTS      │                                                       │
│ │ • Dashboard  │                                                       │
│ │ • Annual Sum │                                                       │
│ │ • Fulfilment │                                                       │
│ │ • Unallocated│                                                       │
│ │ • Pipeline   │                                                       │
│ │ • 60-Month   │                                                       │
│ │ • Rev & Cost │                                                       │
│ │ • Optimizer  │                                                       │
│ │              │                                                       │
│ │ SCENARIOS    │                                                       │
│ │ • My scenarios                                                       │
│ │ • + New      │                                                       │
│ │              │                                                       │
│ │ ADMIN (if admin)                                                     │
│ │ • Users      │                                                       │
│ │ • Audit log  │                                                       │
│ └──────────────┘                                                       │
└────────────────────────────────────────────────────────────────────────┘
```

**Top bar**:
- App name (left, clickable → Home)
- **Plan selector**: dropdown showing current plan. Default is "Master". User's
  own scenarios listed. Clicking switches the whole app to that plan's data.
- Notifications icon (v2, placeholder in v1)
- User avatar dropdown: profile, settings, logout

**Sidebar**:
- Sections: Inputs, Outputs, Scenarios, Admin (last one only if role='admin')
- Current page highlighted
- Sidebar collapses to icons on narrow screens

**Stale-data banner** (appears below top bar when relevant):
```
┌────────────────────────────────────────────────────────────────────────┐
│ ⚠ Results are out of date. Last computed 3 min ago.  [Recalculate now] │
└────────────────────────────────────────────────────────────────────────┘
```
Shows on any output page when `plans.last_computed_at` is older than the latest
input mutation. "Recalculate now" triggers a re-run; page updates when it
completes (< 2s target).

**Plan context indicator** (appears when user is viewing a scenario, not master):
```
┌────────────────────────────────────────────────────────────────────────┐
│ 📎 Viewing scenario: "What if we lose Woolworths"    [Switch to Master]│
└────────────────────────────────────────────────────────────────────────┘
```

---

## 2. Authentication and onboarding

### Sign-in page

```
┌─────────────────────────────────────┐
│   Oceanpick Demand Planner          │
│                                     │
│   Email: [               ]          │
│   Password: [            ]          │
│                                     │
│         [Sign in]                   │
│                                     │
│   Forgot password?                  │
└─────────────────────────────────────┘
```

- Only `@<allowed_domain>` emails accepted (validated on submit)
- Password reset flow via email (standard)
- No self-signup: admin creates users, or first-time users see "Contact your admin"
  after entering an unknown email

### First-time signup (if admin has invited them)

Admin creates a user → user gets an email with a signup link → user sets password
→ lands on Home.

### Idle timeout

Session expires after 8 hours of inactivity. User redirected to sign-in with a
"Your session expired" toast.

---

## 3. Home / Dashboard

Landing page after sign-in. Answers: "What's happening with my plan?"

**Purpose**: Give an at-a-glance view of plan health. No editing here.

**Layout**:

```
┌──────────────────────────────────────────────────────────────────────┐
│ Home                                          Plan: Master           │
│                                                                      │
│ ┌─────────────┐ ┌─────────────┐ ┌─────────────┐ ┌─────────────┐    │
│ │ Total Demand│ │ Fulfilled   │ │ Revenue     │ │ Margin      │    │
│ │ 8.8M kg FP  │ │ 68% (6.0M)  │ │ $55.8M      │ │ $14.3M      │    │
│ │ 60 mo       │ │             │ │             │ │ GP% 25.6%   │    │
│ └─────────────┘ └─────────────┘ └─────────────┘ └─────────────┘    │
│                                                                      │
│ ┌────────────────────────────────────────────────────────────────┐  │
│ │ 📈 Monthly demand vs fulfilment                                │  │
│ │    [line chart: 60 months, demand line, fulfilled line]        │  │
│ └────────────────────────────────────────────────────────────────┘  │
│                                                                      │
│ ┌───────────────────────────┐ ┌───────────────────────────────────┐ │
│ │ Recent activity           │ │ Alerts                            │ │
│ │ • Alice updated harvest.. │ │ ⚠ 3 programs unfulfilled >50%     │ │
│ │ • Bob created scenario... │ │ ⚠ M14 harvest capacity is zero    │ │
│ │ • You changed price for.. │ │                                   │ │
│ └───────────────────────────┘ └───────────────────────────────────┘ │
└──────────────────────────────────────────────────────────────────────┘
```

**KPI tiles** (top row): 4 cards showing 60-month totals from `plan_summary`:
- Total Demand FP
- Fulfilled (% and absolute kg)
- Revenue $
- Margin $ + GP%

Each tile: label, big number, small subtext. Click → goes to Annual Summary.

**Main chart**: monthly demand vs. fulfilled FP, over 60 months. Two line series.
Toggle button to switch to WR view.

**Recent activity**: last 10 audit log entries scoped to master plan (or current
scenario). Each: user avatar, action description, timestamp. Click → jumps to
the affected row.

**Alerts**: computed conditions worth flagging.
- Programs with fulfilment < 50% (list up to 5, "and X more" link)
- Buckets with total 60mo capacity = 0
- Programs with demand but missing yield
- Plans not recomputed in > 24 hours

**Empty state** (fresh plan, no data yet): "Your plan is empty. Start by adding
programs and harvest capacity." with buttons to Programs and Harvest Plan.

---

## 4. Programs

The list of all programs. Where users manage the customer × product combinations.

**Purpose**: Add / edit / archive programs. Set status (Active / Pipeline / Inactive),
buckets, yields, prices, costs, locks.

**Layout**:

```
┌──────────────────────────────────────────────────────────────────────┐
│ Programs                              [+ New Program] [Import CSV]   │
│                                                                      │
│ Filter: [Status ▾] [Customer ▾] [Bucket ▾] [Search __________]      │
│                                                                      │
│ ┌───┬──────────┬───────────┬──────────┬────────┬─────────┬───────┐ │
│ │ 🔒│ Status   │ Customer  │ Product  │ Primary│ Demand  │ Actions│ │
│ │   │          │           │          │ Bucket │ (kg/mo) │        │ │
│ ├───┼──────────┼───────────┼──────────┼────────┼─────────┼───────┤ │
│ │ 🔒│ Active   │ Woolworths│ Portions │ 800-11 │ 15,000  │ [...] │ │
│ │   │ Pipeline │ Costco    │ Skin on  │ 800-11 │  6,000  │ [...] │ │
│ │   │ Inactive │ HORECA    │ Center C │ 1500-18│ 500     │ [...] │ │
│ └───┴──────────┴───────────┴──────────┴────────┴─────────┴───────┘ │
│                                                                      │
│ Showing 28 of 32 programs                        [1] 2 3 → Next     │
└──────────────────────────────────────────────────────────────────────┘
```

**Table columns**:
- Lock icon (only shown if `locked=true`)
- Status (colored chip: green Active, blue Pipeline, gray Inactive)
- Customer
- Product (item_description, truncated with tooltip)
- Primary Bucket
- Max monthly demand (kg FP)
- Actions menu (⋯): Edit, Clone, Archive, Lock/Unlock

**Filters**:
- Status: multi-select checkbox (Active, Pipeline, Inactive)
- Customer: dropdown of unique customers
- Bucket: dropdown of unique primary buckets
- Search: free text over item_code, item_description, customer

**Sort**: Click any header to sort. Default: sort_order asc.

**Row click**: opens edit side panel (see below).

**Actions in top-right**:
- **+ New Program**: opens create panel
- **Import CSV**: opens import modal (see Section 17)

### Program edit side panel

```
┌────────────────────────────────────────┐
│ Edit Program              [Save] [✕]   │
├────────────────────────────────────────┤
│ Status:      [Active ▾]                │
│ Locked:      [☐] Prioritize absolutely │
│                                        │
│ Item code:   [7372              ]      │
│ Description: [Frozen Barra...   ]      │
│ Customer:    [Pac West - Wool.. ▾]     │
│                                        │
│ Max monthly demand (kg FP):            │
│              [15000             ]      │
│                                        │
│ ── Paths ────────────────────────────  │
│ Primary bucket:   [800-1100g ▾]        │
│ Primary yield:    [0.4980   ]          │
│                                        │
│ Secondary bucket: [1100-1500g ▾] [✕]   │
│ Secondary yield:  [0.4475   ]          │
│                                        │
│ Tertiary bucket:  [+ Add tertiary]     │
│                                        │
│ ── Pricing & cost ───────────────────  │
│ Price ($/kg FP):     [7.95      ]      │
│ Barra cost ($/kg WR):[2.30      ]      │
│ Packing:             [0.40      ]      │
│ Processing:          [0.90      ]      │
│ Storage:             [0.02      ]      │
│ Freight:             [0.26      ]      │
│ Other costs:         [0.00      ]      │
│                                        │
│ ── Computed ─────────────────────────  │
│ Total cost (primary): $5.20             │
│ Margin (primary): $2.75/kg FP           │
│ GP %: 34.6%                             │
│                                        │
│ [Save changes]                         │
└────────────────────────────────────────┘
```

- Fields validate on blur. Errors show inline.
- Computed section (bottom) recalculates live as user types.
- Save button disabled if any field is invalid.
- Save closes panel and refreshes the list.

**Cascade delete on bucket removal**: if user clicks [✕] on Secondary bucket, both
bucket_id and yield are cleared. Warning shown if the program was actively using
that path (per last computation).

### Empty state

"No programs yet. Get started by adding your first program or importing from CSV."

---

## 5. Monthly Demand Plan

The 50×60 grid of per-program per-month demand.

**Purpose**: View and edit demand overrides. Excel model uses a large sparse grid.
Web version breaks this into a viewing surface + a focused editor.

**Layout — main view (read-only heatmap)**:

```
┌──────────────────────────────────────────────────────────────────────┐
│ Monthly Demand Plan                              [Import CSV] [Export]│
│                                                                      │
│ Filter: [Program ▾] [Customer ▾]                                     │
│                                                                      │
│  Program              Apr26 May26 Jun26 Jul26 Aug26 Sep26 Oct26 ... │
│  ──────────────────  ───── ───── ───── ───── ───── ───── ─────      │
│  Woolworths Portions  15000 15000 15000 15000 15000 15000 15000     │
│  Costco Skin-on        6000  6000  6000  6000  6000  6000  6000     │
│  HORECA Center Cut      500   500   500   500   500   500   500     │
│  ...                                                                 │
│  ──────────────────                                                  │
│  TOTAL (Active+Pipe)  21500 21500 21500 21500 21500 21500 21500     │
│                                                                      │
│ (cells colored by fulfilment — green fully fulfilled, red not)       │
│                                                                      │
│ Click any cell to edit → opens program timeline editor              │
└──────────────────────────────────────────────────────────────────────┘
```

- Scrollable horizontally through 60 months
- Rows: one per program (only in-scope programs shown)
- Colored heatmap: cell background reflects fulfilment status from last computation
- Total row at bottom
- Frozen: first column (program name)
- Read-only in this view — click any cell to edit

**Layout — program timeline editor** (opens on cell click):

```
┌──────────────────────────────────────────────────────────────────────┐
│ Edit demand: Woolworths - Portions 80-120g          [Save] [Cancel] │
├──────────────────────────────────────────────────────────────────────┤
│ Baseline (from program): 15,000 kg FP/month                         │
│                                                                      │
│  📊 [Line chart: 60 months × demand; editable points]              │
│                                                                      │
│  Month     Baseline  Override    Effective  Fulfilled  %            │
│  ───────  ────────  ─────────   ─────────  ─────────  ────          │
│  Apr 2026    15000        —        15000       15000  100%          │
│  May 2026    15000        —        15000       15000  100%          │
│  Jun 2026    15000     16000       16000       15200   95%          │
│  Jul 2026    15000        —        15000       15000  100%          │
│  ...                                                                 │
│                                                                      │
│  [Reset all overrides]      [Apply pattern...]                      │
└──────────────────────────────────────────────────────────────────────┘
```

- Chart at top: line chart of effective demand across 60 months. Draggable points
  to edit visually. Baseline shown as a light dashed line.
- Table below: one row per month with Baseline, Override, Effective, Fulfilled, %.
  Override cell is editable; blank = "use baseline".
- "Reset all overrides": clears all per-month overrides for this program, reverting
  to baseline.
- "Apply pattern": opens a modal for bulk operations (see below).

**Apply pattern modal**:

```
┌────────────────────────────────────────┐
│ Apply pattern to selected months       │
├────────────────────────────────────────┤
│ ○ Set all to a fixed value: [_____]    │
│ ○ Scale baseline by:        [__.__] %  │
│ ○ Set months [__] to [__]              │
│   to a value:                [_____]   │
│ ○ Linear ramp from [_____] to [_____] │
│   over months [__] to [__]             │
│                                        │
│      [Apply]           [Cancel]        │
└────────────────────────────────────────┘
```

Useful for realistic scenarios like "Q4 uplift by 20%" or "linear growth from
5000 to 10000 over first year".

---

## 6. Monthly Harvest Plan

The 30×60 grid of per-bucket per-month harvest capacity.

**Purpose**: View and edit harvest capacity by bucket.

Same pattern as Demand Plan:

**Main view**: heatmap grid (bucket rows × month columns), cells colored by
utilization (from last computation: green = fully utilized, red = under-utilized).

**Edit view**: click any cell → per-bucket timeline editor with the same
chart + table + pattern-apply as Demand Plan.

The "Reset all overrides" concept doesn't apply here since harvest capacity has
no "baseline" — every cell is a direct input.

**Utilization column at right**: for each bucket, total 60mo capacity + total
used + % used.

---

## 7. Buckets (reference data)

Simple management page for the bucket master list.

**Layout**:

```
┌──────────────────────────────────────────────────────────────────────┐
│ Buckets                                        [+ New Bucket]        │
│                                                                      │
│  Order  Name          Programs using  Total capacity (60mo)  Actions │
│  ─────  ────────────  ──────────────  ──────────────────────  ────── │
│    1    600-800g            3            180,000 kg          [Edit] │
│    2    800-1100g            8            1,200,000 kg        [Edit] │
│    3    1100-1500g          12            2,400,000 kg        [Edit] │
│  ...                                                                 │
└──────────────────────────────────────────────────────────────────────┘
```

- Draggable rows to reorder (updates `sort_order`)
- Admin only can edit
- Cannot delete a bucket in use — must archive instead
- "Programs using" column counts as any of primary/secondary/tertiary
- Renaming warning: "This bucket appears in X historical scenarios. The name will
  update everywhere."

---

## 8. Plan settings

Simple form.

```
┌──────────────────────────────────────────────────────────────────────┐
│ Plan Settings                                        [Save]          │
│                                                                      │
│ Margin metric:                                                       │
│   ○ Margin per kg FP                                                 │
│   ○ Margin per kg WR                                                 │
│   ● Total contribution                                               │
│                                                                      │
│ Allocation mode:                                                     │
│   ● Fill what you can                                                │
│   ○ All-or-nothing                                                   │
│                                                                      │
│ Scope:                                                               │
│   ○ Active only                                                      │
│   ● Active + Pipeline                                                │
│                                                                      │
│ Lookback months (borrowing):                                         │
│   [2 ▾]  (1, 2, or 3)                                                │
│                                                                      │
│ Plan start month:                                                    │
│   [April 2026 ▾]                                                     │
│                                                                      │
│ [Save changes]                                                       │
└──────────────────────────────────────────────────────────────────────┘
```

Changing any of these triggers a recompute on save. Warn user: "Saving will
recompute the plan (~2 seconds)."

---

## 9. Annual Summary

Read-only output page.

**Layout**:

```
┌──────────────────────────────────────────────────────────────────────┐
│ Annual Summary                            [Export CSV]               │
│                                                                      │
│ ┌───────────────────┬───────┬───────┬───────┬───────┬───────┬──────┐│
│ │                   │ FY1   │ FY2   │ FY3   │ FY4   │ FY5   │Total ││
│ ├───────────────────┼───────┼───────┼───────┼───────┼───────┼──────┤│
│ │ Demand FP         │ 1.7M  │ 1.8M  │ 1.8M  │ 1.7M  │ 1.7M  │ 8.8M ││
│ │ Allocated FP      │ 1.2M  │ 1.2M  │ 1.2M  │ 1.2M  │ 1.2M  │ 6.0M ││
│ │ Unallocated FP    │ 500K  │ 600K  │ 600K  │ 500K  │ 500K  │ 2.8M ││
│ │ Allocated WR      │ 2.7M  │ 2.7M  │ 2.7M  │ 2.7M  │ 2.7M  │13.6M ││
│ │ Unallocated WR    │  50K  │  40K  │  50K  │  40K  │  50K  │ 230K ││
│ ├───────────────────┼───────┼───────┼───────┼───────┼───────┼──────┤│
│ │ Revenue           │ $11M  │ $11M  │ $11M  │ $11M  │ $11M  │$55.8M││
│ │ Cost              │ $8.3M │ $8.3M │ $8.3M │ $8.3M │ $8.3M │$41.6M││
│ │ Margin            │ $2.9M │ $2.9M │ $2.9M │ $2.9M │ $2.9M │$14.3M││
│ │ GP %              │ 25.6% │ 25.5% │ 25.6% │ 25.6% │ 25.5% │ 25.6%││
│ ├───────────────────┼───────┼───────┼───────┼───────┼───────┼──────┤│
│ │ Revenue opportunity│ $14M │ $14M  │ $14M  │ $14M  │ $14M  │ $70M ││
│ │ Cost opportunity  │$10.5M │$10.5M │$10.5M │$10.5M │$10.5M │$52.5M││
│ │ Margin opportunity│ $3.5M │ $3.5M │ $3.5M │ $3.5M │ $3.5M │$17.5M││
│ │ Margin gap        │ $600K │ $600K │ $600K │ $600K │ $600K │ $3.2M││
│ └───────────────────┴───────┴───────┴───────┴───────┴───────┴──────┘│
│                                                                      │
│ 📊 [Chart: revenue vs cost stacked bars by FY]                      │
└──────────────────────────────────────────────────────────────────────┘
```

- Table + one chart below
- Cells clickable → drill into Program Fulfilment filtered to that period

---

## 10. Program Fulfilment

Per-program monthly fulfilment %.

```
┌──────────────────────────────────────────────────────────────────────┐
│ Program Fulfilment                                    [Export CSV]   │
│                                                                      │
│ Filter: [Status ▾] [Customer ▾]                                      │
│                                                                      │
│  Program                Apr26 May26 Jun26 Jul26 Aug26 Sep26 ...     │
│                          %/WR  %/WR  %/WR  %/WR  %/WR  %/WR         │
│  ──────────────────      ───── ───── ───── ───── ───── ─────        │
│  Woolworths Portions      100% 100%  95%  100% 100% 100%             │
│  Costco Skin-on           80%  80%  80%   80%  80%  80%              │
│  HORECA Center Cut        100% 100% 100%  100% 100% 100%             │
│  ...                                                                 │
│                                                                      │
│ Cell background: green ≥95%, yellow 80-95%, red <80%                │
│ Hover: show absolute FP demanded / fulfilled / unfulfilled WR       │
│                                                                      │
│ 📊 [Chart: average fulfilment % over 60 months, per program]        │
└──────────────────────────────────────────────────────────────────────┘
```

Click any cell → tooltip modal with full breakdown of that (program, month):
demand FP, own FP, borrowed FP (all channels), rolling FP, fulfilment %,
unfulfilled WR.

---

## 11. Unallocated WR

Per-bucket per-month leftover.

```
┌──────────────────────────────────────────────────────────────────────┐
│ Unallocated WR                                        [Export CSV]   │
│                                                                      │
│  Bucket        Apr26 May26 Jun26 Jul26 Aug26 Sep26 ...              │
│  ───────────   ───── ───── ───── ───── ───── ─────                  │
│  600-800g       500  200   0   0   1200 800                          │
│  800-1100g      0    0     100 0   0    50                           │
│  1100-1500g     1500 800  400 200 100  0                             │
│  ...                                                                 │
│  ───────────                                                         │
│  TOTAL         2000 1000 500 200 1300 850                            │
│                                                                      │
│ Highlight non-zero cells: still have unused capacity                │
│                                                                      │
│ 📊 [Chart: total unallocated WR by month, stacked by bucket]        │
└──────────────────────────────────────────────────────────────────────┘
```

---

## 12. Pipeline WR

Per-bucket per-month WR consumed BY pipeline programs specifically.

Same layout as Unallocated WR but shows pipeline consumption. Total row across
bottom.

Cell hover: shows which pipeline programs consumed from this (bucket, month).

---

## 13. 60-Month Summary

Per-program per-month allocated values. Toggle between three views.

```
┌──────────────────────────────────────────────────────────────────────┐
│ 60-Month Summary                                      [Export CSV]   │
│                                                                      │
│ View: ● Allocated FP  ○ Allocated WR  ○ Margin $                     │
│                                                                      │
│ Filter: [Status ▾] [Customer ▾]                                      │
│                                                                      │
│  Program (by rank)      Apr26 May26 Jun26 Jul26 Aug26 ...  Total    │
│  ────────────────────   ───── ───── ───── ───── ─────  ─────────   │
│  #1 Woolworths Portions 15000 15000 15000 15000 15000    900,000   │
│  #2 Costco Skin-on       6000  6000  6000  6000  6000    360,000   │
│  ...                                                                 │
│                                                                      │
│ 📊 [Chart: view metric over 60 months, stacked by program]          │
└──────────────────────────────────────────────────────────────────────┘
```

- Sorted by rank ascending
- Cell hover: shows breakdown (own + borrowings)
- Total column: 60-month sum

---

## 14. Revenue & Cost

```
┌──────────────────────────────────────────────────────────────────────┐
│ Revenue & Cost                                        [Export CSV]   │
│                                                                      │
│ Metric: ● Revenue  ○ Cost  ○ Margin  ○ Margin %                      │
│ Basis:  ● Allocated  ○ Effective Demand                              │
│ Cost:   [Total ▾] (or specific component: Barra Meat, Packing, ...)  │
│                                                                      │
│  Program                Apr26 May26 Jun26 ...  Total                 │
│  ──────────────────     ───── ───── ─────    ─────                  │
│  Woolworths Portions   $119K $119K $119K    $7.15M                   │
│  Costco Skin-on        $48K  $48K  $48K     $2.88M                   │
│  ...                                                                 │
│  ────────────           ───── ───── ─────    ─────                  │
│  TOTAL                 $167K $167K $167K   $10.03M                   │
│                                                                      │
│ 📊 [Chart: metric over 60 months]                                    │
└──────────────────────────────────────────────────────────────────────┘
```

Metric + Basis + Cost dropdowns match Excel.

---

## 15. Fulfilment Optimizer

The single-month operational view.

```
┌──────────────────────────────────────────────────────────────────────┐
│ Fulfilment Optimizer                                                 │
│                                                                      │
│ Month: [Sep 2026 ▾]        Scope: [Active+Pipeline ▾]                │
│                                                                      │
│ ── This month's harvest ──                                          │
│  Bucket        Capacity  Used   Left                                 │
│  600-800g        6000    5800   200                                  │
│  800-1100g       10000   9500   500                                  │
│  ...                                                                 │
│                                                                      │
│ ── This month's demand fulfillment ──                                │
│  Rank Program           Demand FP  Own FP  Borrowed  Fulfilled  %   │
│  ──── ─────────────     ────────  ─────── ────────  ─────────  ──── │
│    1  Woolworths          15000    15000       0     15000    100% │
│    2  Costco               6000     6000       0      6000    100% │
│    3  HORECA                500      500       0       500    100% │
│  ...                                                                 │
│                                                                      │
│ ── Summary ──                                                        │
│  Total demand FP:  21,500                                            │
│  Total fulfilled:  15,000 (69%)                                      │
│  Total margin:     $32,500                                           │
└──────────────────────────────────────────────────────────────────────┘
```

Read-only. Users drill down here to see the mechanics of a single month.

---

## 16. Scenarios

**Purpose**: Create and manage per-user what-if scenarios forked from master.

### Scenarios list page

```
┌──────────────────────────────────────────────────────────────────────┐
│ My Scenarios                                    [+ New Scenario]     │
│                                                                      │
│  Name                          Created    Last edited  Actions       │
│  ──────────────────────────    ────────   ───────────  ──────────    │
│  What if we lose Woolworths    Apr 5     3 days ago    [...]         │
│  Q4 uplift +20%                Mar 22    1 week ago    [...]         │
│  Higher barra cost             Feb 18    2 weeks ago   [...]         │
│  ...                                                                 │
│                                                                      │
│ You have 3 of 20 scenarios.                                         │
└──────────────────────────────────────────────────────────────────────┘
```

- Actions menu: Open, Rename, Duplicate, Delete
- Delete: soft-delete with 90-day recovery window

### Create scenario modal

```
┌────────────────────────────────────────┐
│ New scenario                           │
├────────────────────────────────────────┤
│ Name (required):                       │
│ [                                    ] │
│ e.g., "Q4 uplift", "Lose Woolworths"   │
│                                        │
│ Description (optional):                │
│ [                                    ] │
│ [                                    ] │
│                                        │
│ Based on: Master (current state)       │
│                                        │
│      [Create]        [Cancel]          │
└────────────────────────────────────────┘
```

On create:
- Full clone of master (per data model Option A)
- User is redirected to the scenario (plan selector shows the new scenario)
- All pages show scenario data
- Plan context banner reads: "Viewing scenario: [name]"

### Scenario view (same pages as master)

All input and output pages work identically on a scenario. User can edit inputs
freely — no changes affect master.

### Diff view (against master)

Available from any input page while viewing a scenario:

```
┌──────────────────────────────────────────────────────────────────────┐
│ Compare to master                                       [✕ Close]    │
├──────────────────────────────────────────────────────────────────────┤
│ Programs                                                             │
│  Woolworths Portions                                                 │
│    Max monthly demand:  Master 15000  →  Scenario 12000              │
│    Locked:              Master No     →  Scenario Yes                │
│                                                                      │
│  Costco Skin-on                                                      │
│    Status:              Master Active →  Scenario Inactive           │
│                                                                      │
│ Demand plan overrides                                                │
│  Woolworths / Oct 2026: Master 15000  →  Scenario 20000              │
│  Woolworths / Nov 2026: Master 15000  →  Scenario 20000              │
│                                                                      │
│ Harvest plan changes                                                 │
│  (no changes)                                                        │
│                                                                      │
│ Plan settings                                                        │
│  Margin metric:  Master Total contrib  →  Scenario Margin/kg FP      │
│                                                                      │
│ Outputs summary                                                      │
│  Revenue (60mo):    Master $55.8M     →  Scenario $52.1M (-6.6%)     │
│  Margin  (60mo):    Master $14.3M     →  Scenario $12.9M (-9.8%)     │
│  Fulfilment %:      Master 68%         →  Scenario 62%                │
└──────────────────────────────────────────────────────────────────────┘
```

Lists ALL differences. Read-only view. Users can copy this to share findings with
the team.

**v2**: promote scenario → master workflow with approval.

---

## 17. CSV import/export

### Export

Every table view has an "Export CSV" button top-right. Clicking:
- Generates a CSV of current view (respecting filters)
- Downloads immediately

Data format:
- Header row: column names as displayed
- One row per data row
- Numeric formatting: no thousand separators, dot as decimal
- Dates: ISO 8601 (YYYY-MM-DD)

### Import

Only certain tables accept import: Programs, Monthly Demand Plan, Monthly Harvest
Plan. Not outputs.

**Import modal flow**:

```
┌──────────────────────────────────────────────────────────────────────┐
│ Import Programs                                       [✕ Close]      │
├──────────────────────────────────────────────────────────────────────┤
│ Step 1: Upload CSV                                                   │
│  [Drag & drop or click to upload]                                    │
│  Expected columns: status, item_code, description, customer, ...    │
│  [Download template]                                                 │
│                                                                      │
│ Step 2: Preview & validate                                           │
│  ✓ 25 rows valid                                                     │
│  ⚠ 2 rows have warnings (missing yield when secondary set)           │
│  ✗ 1 row invalid (unknown bucket "1200g-1500g")                     │
│                                                                      │
│  [Show details ▾]                                                    │
│                                                                      │
│ Step 3: Import mode                                                  │
│  ○ Replace all existing programs                                     │
│  ● Upsert by item_code (add new, update existing, keep unmatched)   │
│  ○ Add as new only (skip if item_code exists)                       │
│                                                                      │
│      [Import 25 valid rows]         [Cancel]                        │
└──────────────────────────────────────────────────────────────────────┘
```

- Validation happens before commit
- Errors block affected rows; user can either fix in file and re-upload, or
  proceed with valid rows only
- Bucket names in CSV must match existing bucket names (or user is prompted to
  create missing ones)
- After import: full recompute is triggered automatically

**Import is atomic per file**: either all valid rows commit, or none do (single
transaction).

---

## 18. Admin: users and roles

Only visible to `role='admin'`.

### Users list

```
┌──────────────────────────────────────────────────────────────────────┐
│ Users                                          [+ Invite User]       │
│                                                                      │
│  Email                       Role           Last login    Actions    │
│  ──────────────────────      ────────       ──────────    ────────   │
│  alice@oceanpick.com         Admin          2 hours ago   [Edit]     │
│  bob@oceanpick.com           Planner        Yesterday     [Edit]     │
│  carol@oceanpick.com         Contributor    3 days ago    [Edit]     │
│  dan@oceanpick.com           Viewer         Never         [Edit]     │
└──────────────────────────────────────────────────────────────────────┘
```

Edit modal: change role, deactivate user, reset password (sends email).

### Audit log

```
┌──────────────────────────────────────────────────────────────────────┐
│ Audit Log                                             [Export CSV]   │
│                                                                      │
│ Filter: [User ▾] [Entity ▾] [Date range] [Search]                    │
│                                                                      │
│  When            User      Action         Entity                     │
│  ───────────    ────────   ──────         ────────────────           │
│  10:23 Apr 5    alice      updated        program "Woolworths Port." │
│                            demand_fp: 15000 → 12000                  │
│  09:47 Apr 5    bob        created        scenario "Q4 uplift"       │
│  09:15 Apr 5    alice      updated        harvest 800-1100g / Sep26  │
│                            capacity: 5000 → 5500                     │
│  ...                                                                 │
│                                                                      │
│                                             [Load more]              │
└──────────────────────────────────────────────────────────────────────┘
```

Infinite scroll (or pagination). Click any row → expanded view with full JSON
of the change.

### Invite user modal

```
┌────────────────────────────────────────┐
│ Invite user                            │
├────────────────────────────────────────┤
│ Email: [               @oceanpick.com] │
│ Full name: [                        ]  │
│ Role: [Contributor ▾]                  │
│                                        │
│      [Send invite]     [Cancel]        │
└────────────────────────────────────────┘
```

- Email must end with `@<org.allowed_email_domain>` — pre-filled and locked
- User receives email with signup link (valid 7 days)
- Invited user creates their password on first sign-in

---

## Cross-cutting UX details

### Loading states

- Skeleton loaders for tables and charts (not blank screens)
- Stale banner with "Recalculate now" button never blocks the UI; user can keep
  browsing

### Empty states

Every list page has a defined empty state with a call to action. Documented per
page above.

### Error handling

- Validation errors: inline, red text below field
- Server errors: toast at top-right, "Something went wrong. [Retry]"
- Concurrent edit conflict (optimistic locking): modal shows "This was edited by
  Alice while you were editing. [Discard my changes] [Overwrite with mine]"

### Responsive design

- Full support for desktop (primary use case)
- Tablet: works, sidebar collapses to hamburger
- Mobile: read-only views only in v1. Editing on mobile is out of scope.

### Keyboard shortcuts

- `/` focuses the search / filter box on any list page
- `Cmd/Ctrl + K` opens a global command palette (jump to any page, program, scenario)
- `Esc` closes any modal or side panel
- `Cmd/Ctrl + S` saves the current form (where applicable)

### Accessibility

- Semantic HTML, ARIA labels on all interactive elements
- Full keyboard navigation
- Focus states visible
- Contrast: WCAG AA minimum
- Screen reader support for tables and charts

---

## Resolved decisions

All 6 open questions from Draft 1 have been resolved:

1. **Chart library**: **Recharts**. React-native, easy to work with, sufficient for
   v1 chart needs.

2. **Component library**: **shadcn/ui**. Copy-paste components on top of Tailwind,
   no vendor lock-in.

3. **Command palette (Cmd+K)**: **Deferred to v2**. Skip in v1 to save ~1 week.

4. **Diff view**: **Read-only in v1**. Selective merge (pull specific changes from
   master) deferred to v2.

5. **Fork scenarios from other scenarios**: **Yes**. Small addition, included in v1.

6. **Alert thresholds**: **Hardcoded in v1**, user-configurable in v2.

All three artifacts (calc engine spec, data model, wireframes) are locked. Ready
for Phase 1 implementation.
