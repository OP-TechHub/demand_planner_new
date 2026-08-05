# Oceanpick Demand Planner — Documentation

Reproduces the "V30" demand-planning workbook as a multi-user web app: enter
programs, demand, and harvest capacity; run the allocation engine; read fulfilment,
revenue, and margin across a 60-month horizon.

## User manuals (by role)

Everyone signs in at `/login`. What you can see and change depends on your role,
set by an administrator.

| Role | Read this |
|------|-----------|
| **Admin** — runs the system, manages users and plans | [user-manual-admin.md](user-manual-admin.md) |
| **Planner** — builds and maintains plans | [user-manual-planner.md](user-manual-planner.md) |
| **Contributor** — edits granted sections, runs what-ifs | [user-manual-contributor.md](user-manual-contributor.md) |
| **Viewer** — reads the numbers | [user-manual-viewer.md](user-manual-viewer.md) |

## For engineers

- [developer-guide.md](developer-guide.md) — architecture, local setup, the calc
  engine, database & migrations, deployment, and where things live.

## Concepts everyone shares

- **Plan** — a self-contained set of programs + demand + harvest + settings over a
  month window. Kinds: **Master** (the frozen baseline from the workbook),
  **Official** plans (admin-approved copies), **Scenarios/Sandboxes** (private
  what-ifs), and the **Live plan** (the one official plan the Dashboard and API
  treat as "current").
- **Months** — a plan runs M1…M60 from its start date. "Apr 26" etc. are derived
  from the start month.
- **FP vs WR** — demand is in **finished product (FP, kg)**; harvest capacity is in
  **whole round (WR, kg)**. They convert by **yield**: `FP = WR × yield`.
- **Recalculate** — inputs don't change outputs until you run the engine. A banner
  warns when results are older than the latest edits.
