# Contributor — User Manual

**Oceanpick Demand Planner**

A **Contributor** can read everything a Viewer can, **edit the input sections they
have been granted** on a given plan, save inquiries, and run private **scenarios**
(sandboxes) for what-if analysis. Contributors cannot edit the Master plan
directly, manage users, edit buckets, or create official plans.

> New to the outputs? The [Viewer manual](user-manual-viewer.md) explains every
> read-only tab; this manual focuses on what you can change.

---

## 1. Access model — what you can edit

Your edit rights are **granted per plan, per tab** by an administrator
(Admin → Plans → Access). For a given plan you may be allowed to edit some of:

- **Programs**
- **Demand Plan**
- **Harvest Plan**
- **New Inquiry** (the right to save inquiries into that plan's pipeline)

If a tab is read-only for you, you'll see the values but the inputs are disabled.

**Two special rules:**
- **Locked plans** are read-only for everyone (including admins) until unlocked.
- **Your own scenarios** (sandboxes) are **fully editable by you** — all tabs, no
  grants needed. This is where you can experiment freely.

You **cannot** edit **Buckets** (size ranges are org-wide, admin-only) or the
**Master** plan.

---

## 2. Everyday tasks

### Edit demand
**Demand Plan** → find the program (search by customer or product; use the
Active / Pipeline / All view switch) → type the monthly finished-product (FP, kg)
figures. Save. Then **Recalculate** to refresh the outputs.

You can also **import** a month-by-month CSV (headers are month names, e.g.
"Apr 26") and **export** the current view.

### Edit harvest capacity
**Harvest Plan** → per size bucket, enter whole-round (WR, kg) capacity per month.
Save and recalculate.

### Raise an inquiry
See section 3.

### Run a what-if
See section 4.

Always **Recalculate** after edits — inputs don't move the outputs until you do.
A banner warns when results are stale.

---

## 3. New Inquiry

Use **New Inquiry** to check whether a customer request can be met from spare
capacity, and to add it to the pipeline.

1. **Existing program** — search and pick the program (the picker filters by
   customer, product, or item code). **New program** — enter the customer,
   product, sourcing buckets and yields.
2. Choose the **months** (a range, or hand-picked months) and enter the
   **additional** FP quantity per month.
3. The table checks each month against its **spare whole-round capacity** and shows
   what can be supplied.
4. **Short?** Use **Free up capacity from pipeline** to reduce speculative pipeline
   demand on the same buckets — freed capacity feeds your inquiry.
5. Click **Add to pipeline**. A **review dialog** summarises exactly what will
   change — the volume added, and each pipeline reduction (before → after, capacity
   freed). Confirm to commit.
6. Saving records the inquiry in the **Inquiries** register and adds pipeline
   volume (it never touches active demand). **Recalculate** to see the effect.

> Repeat inquiries for the same program **accumulate** onto its pipeline line.

---

## 4. Scenarios (your sandbox)

Scenarios are **private plans only you edit** — the safe place to try changes.

- **Scenarios → My scenarios → New Scenario** — a full clone of the current working
  plan (all programs and data). Best for a quick what-if.
- **New Plan** — a configured build: choose the start month, length, which programs
  to include, and whether to copy demand/harvest. Best for building a fresh plan.

Inside a scenario you can edit **all** tabs. Recalculate to see results. Use
**Compare plans** to diff your scenario against the master or any other plan.

Scenarios are yours to **rename** or **delete** and never affect official plans.

---

## 5. Good habits

- **Recalculate** after every set of edits; watch the stale banner.
- Prefer a **scenario** for anything experimental; edit the shared/live plan only
  for real, agreed changes (and only where you've been granted access).
- If you trimmed pipeline or added an inquiry by mistake, an **Admin can undo it**
  from the Audit Log within 30 days — flag it to them.
- Can't edit something you think you should? Ask an Admin to grant that tab on that
  plan.
