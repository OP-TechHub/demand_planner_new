# Planner — User Manual

**Oceanpick Demand Planner**

A **Planner** builds and maintains plans. On top of everything a Contributor can
do, a Planner may **edit the Master plan** directly. Planners still cannot manage
users, edit buckets, create official plans, lock/unlock plans, or set the Live
plan — those are Admin actions.

> The [Viewer manual](user-manual-viewer.md) covers reading the outputs and the
> [Contributor manual](user-manual-contributor.md) covers inquiries and scenarios
> in more depth. This manual focuses on the planning workflow.

---

## 1. What a Planner can do

- **Edit the Master plan** (the baseline) — programs, demand, harvest.
- Edit official plans **where granted** the relevant tab (Admin → Plans → Access),
  same as a Contributor.
- Fully edit **your own scenarios**.
- Raise **inquiries**, run **what-ifs**, **compare** plans, import/export CSV.

**Not a Planner:** editing **Buckets** (org-wide, admin-only), **creating official
plans**, **locking/deleting** plans, **setting the Live plan**, or **managing
users**. Ask an Admin for those.

---

## 2. The planning building blocks

- **Programs** (Inputs → Programs) — each program has a customer, product, a
  **status** (active / pipeline / inactive), sourcing **buckets** with **yields**,
  a price, and costs. Yield converts whole round to finished product:
  `FP = WR × yield`.
- **Demand Plan** — monthly finished-product demand (kg FP) per program.
- **Harvest Plan** — monthly whole-round capacity (kg WR) per size bucket.
- **Settings** — margin metric, allocation mode, scope, lookback.

The **engine** allocates each program's demand across its buckets (primary →
secondary → tertiary), can borrow from earlier months, and produces fulfilment,
revenue, cost, and margin. It only runs when you **Recalculate**.

---

## 3. A typical planning cycle

1. **Update programs** — add/adjust customers, products, yields, prices, costs, and
   status. New programs default to a sort order after existing ones.
2. **Enter demand** — Demand Plan, per program per month. Use the Active/Pipeline/
   All view and the customer/product search to navigate; CSV import for bulk.
3. **Enter harvest capacity** — Harvest Plan, per bucket per month.
4. **Recalculate** — run the engine (background job; the button shows progress).
5. **Read the outputs** — Dashboard, Program Fulfilment, Open to buy, Revenue &
   Cost, etc. Look for shortfalls (red) and low-fulfilment warnings.
6. **Iterate** — adjust and recalculate until the plan is sound.

**Stale results:** a banner appears when inputs changed after the last compute —
recalculate to clear it.

---

## 4. Active vs. pipeline (the twin model)

A program has **one** status. To carry both committed and speculative demand for
the same product, the app uses **pipeline twins**: a pipeline line coded
`‹code›-P` alongside the active program. Inquiries add onto the twin, so active
demand is never disturbed.

- **Promote** a pipeline inquiry to active (per month) when an order is confirmed —
  from the pipeline program's promote action. For a partial promotion, the app
  splits the months, keeping the rest as a pipeline twin.

---

## 5. Inquiries and making room

Raise inquiries from **New Inquiry** (see the Contributor manual for the full
walk-through). Key points for planners:

- Each month is checked against its **spare** whole-round capacity.
- **Free up capacity from pipeline** lets you trim speculative pipeline demand on
  the same buckets to fund a new inquiry; a **review dialog** shows exactly what
  changes before you commit.
- Saving adds pipeline volume and logs the inquiry. Recalculate to see fulfilment.

---

## 6. Scenarios and comparison

- **New Scenario** — full private clone of the working plan for a quick what-if.
- **New Plan** — configured build (choose window, programs, whether to copy data).
- **Compare plans** — diff any two plans (settings, programs, demand, harvest, and
  output totals). Use it to justify a change before asking an Admin to fold it into
  an official plan.

Scenarios are private and never affect official plans.

---

## 7. Handing off to Admin

You build and prove plans; the Admin governs them. Ask an Admin to:

- **Create an official plan** (e.g. an approved copy for a financial year) and set
  who may edit which tabs.
- **Set the Live plan** so the Dashboard and the external API follow your working
  plan.
- **Lock** a plan once approved (read-only), or **unlock** to edit again.
- **Undo** an erroneous change from the Audit Log (within 30 days).
