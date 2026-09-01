# Administrator — User Manual

**Oceanpick Demand Planner**

An **Admin** has full access: everything a Planner can do, **plus** managing users,
buckets, and the governance of plans (official plans, the Live plan, locking,
access grants, undo, and the external API). This manual focuses on the admin-only
responsibilities.

> For the planning workflow itself see the [Planner manual](user-manual-planner.md);
> for inquiries/scenarios see the [Contributor manual](user-manual-contributor.md);
> for the outputs see the [Viewer manual](user-manual-viewer.md).

---

## 1. Roles and what each can do

Set a user's role in **Admin → Users**.

| Capability | Admin | Planner | Contributor | Viewer |
|---|:---:|:---:|:---:|:---:|
| View all outputs, compare plans, export CSV | ✅ | ✅ | ✅ | ✅ |
| Create private **scenarios** (sandboxes) | ✅ | ✅ | ✅ | — |
| Edit **granted** tabs on a plan | ✅ (all) | ✅ (+Master) | granted only | — |
| Edit the **Master** plan directly | ✅ | ✅ | — | — |
| Edit **Buckets** (org-wide size ranges) | ✅ | — | — | — |
| Create **official** plans | ✅ | — | — | — |
| Set the **Live** plan, **lock/unlock**, **delete** | ✅ | — | — | — |
| Manage **users** & roles | ✅ | — | — | — |
| **Undo** changes from the Audit Log | ✅ | — | — | — |

**Locked plans** are read-only for everyone, including admins — unlock first.

---

## 2. User management (Admin → Users)

- **Approvals** — new sign-ups start **inactive** and cannot log in until you
  approve them. (The very first account created becomes the admin automatically.)
- **Roles** — assign admin / planner / contributor / viewer.
- **Activate / deactivate** — deactivate to revoke access without deleting history.
- **Access** — per-user grants for anyone who is not an admin. Ticking a box
  takes effect on their next page load; each change is written to the audit log.
  - **Can edit buckets** — as before.
  - **Can view base cost** — shows the two restricted sections of Costing →
    Assumptions: **Base fish cost** (feed, clearing, import tax, FCR, FX) and
    **Other direct costs** (fingerling, transport, ice, vaccine, …). It also
    restores the whole-fish build-up at the top of a printed cost sheet.
  - **Can edit base cost** — the above, plus the right to publish a new
    assumptions version that changes those two sections. Everything else on the
    Assumptions screen stays admin-only, so a grantee's publish leaves the
    adders, margins, freight table and size grades exactly as they were.

**What "restricted" means.** Without a grant, a user never sees what the fish
costs to grow — not the feed price, not the tax position, not the individual
ODC components — anywhere in the app, including the page source. What they do
still see is everything built on those numbers: the whole-fish cost in the grid,
every FINAL, every selling price and margin. That is deliberate — a costing is
unusable otherwise — but it does mean the aggregate can be worked backwards from
what is on screen. The grants protect the line items, not their sum.

A user without the grant also cannot override those fields inside their own
costing; the override list simply omits them.

---

## 3. Plans (Admin → Plans)

### Kinds of plan
- **Master** — the frozen baseline imported from the workbook. Keep it pristine.
- **Official** — admin-approved copies (e.g. "FY26 DFCC approved"). Governed here.
- **Live** — the one official plan the **Dashboard, the external API, and new
  scenarios** treat as "current". Exactly one at a time.
- **Sandbox/Scenario** — users' private what-ifs. You can see and delete them; their
  owner edits them.

### Create an official plan
**New official plan** →
- **Name** it.
- **Clone from** a source plan (copies its programs, demand, harvest, settings).
- **Start month / End month** — pick **any custom window** up to 60 months (defaults
  to the source's window; data past the end month isn't copied).
- **Create plan**. You can then set access and lock it.

### The Live plan
Click **Set live** on an unlocked official plan to make it the shared working plan.
The current live plan stops being the default (its data is untouched). The Master
stays the frozen baseline; day-to-day edits happen on the Live plan.

> Note: naming a plan "Live Plan" does **not** make it live — only **Set live**
> does, and only an **official** (non-sandbox), **unlocked** plan can be set live.

### Per-plan, per-tab access (Access)
Click **Access** on an official plan to grant each non-admin user edit rights to
specific tabs — **Programs, Demand Plan, Harvest Plan, New Inquiry**. Empty = view
only. (Buckets are org-wide and always admin-only.)

### Lock / unlock / delete
- **Lock** an approved plan to make it read-only for everyone; **Unlock** to edit.
- **Delete** hides a plan (recoverable in the database); the Master can't be deleted.

### Roll forward / restore (Settings)
- **Roll forward** advances a plan's start month, shifting month data down; a
  read-only **snapshot** is taken first so nothing is lost.
- **Restore from snapshot** reverses it. Both require a recalculation afterwards.

---

## 4. Buckets (Inputs → Buckets)

Buckets are the **size ranges** (whole-round grades), shared across the whole org
(admin-only). Adding, renaming, or archiving a bucket affects every plan's harvest
and sourcing, so change them deliberately.

---

## 5. Recalculation

Any editor can **Recalculate**; as an admin you'll do it after governance changes.
It runs the engine as a **background job** and updates all output tabs. A **stale**
banner shows when inputs changed after the last compute.

### Change emails
When an **official/admin plan** is recalculated and its **Harvest Plan** changed
since the previous recalculation, **every active user is emailed** a summary
(who changed what, when, and which output tabs are affected). Requires email to be
configured (see the Developer Guide → Email).

---

## 6. Audit Log & Undo (Admin → Audit log)

Every change is recorded: who, which section, what changed, when.

- **Undo** — for **30 days**, you can reverse eligible changes: demand/harvest cell
  edits, program add/edit/remove, pipeline trims, and inquiry saves (which also
  removes the inquiry from the register). Undoing an inquiry that created a program
  archives that program.
- **Not undoable** — bulk CSV imports, very large edits, and promotions (shown with
  a reason). After 30 days a change is permanent.
- Undo refuses to touch a **locked** plan, is re-checked server-side, can't be done
  twice, and is itself logged. After an undo, **recalculate** to refresh outputs.

---

## 7. External API (PO matching)

A read-only **`/api/v1`** exists for a colleague's purchase-order-matching app,
authenticated by an **API key**. It serves the **Live plan** by default. Keys are
managed in the database (see the Developer Guide). Share a key only with trusted
integrations; treat it like a password.

---

## 8. Admin checklists

**Onboard a user:** Admin → Users → approve → set role → (if needed) Admin → Plans →
Access → grant tabs on the relevant plan.

**Publish a new working plan:** New official plan (clone + window) → set access →
**Set live** → tell the team → recalculate.

**Freeze an approved plan:** confirm the numbers → **Lock**. Unlock only to amend.

**Fix a mistake:** Admin → Audit log → find the change → **Undo** (within 30 days) →
recalculate.
