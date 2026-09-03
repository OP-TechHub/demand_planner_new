# Costing & Quoting Module — Decisions Record

**Date:** 2026-08-24
**Status:** Agreed. Supersedes `Costing_Module_Handoff.md` wherever the two differ.
**Oracle:** `barramundi_costing_v11.xlsx` remains the parity test oracle for the cost chain, with the deliberate exceptions recorded in §7 and §12.

The handoff document was written without access to this repo. This record captures what was decided once the codebase and the workbook were both read, and it wins on every point below.

---

## 1. Scope and placement

Costing is a **new section inside the existing demand planner app** — same login, same deployment, a new navigation item.

It is **data-independent**: its own tables, **no foreign keys to `plans`, `programs`, or any existing planner table**, and no write path that can alter a planner number. Independence is achieved by isolation of data, not by a separate application.

**Not built now:** any join between a costing SKU and `programs.item_code`. The handoff's `sku_cost_config.item_id` reference (handoff §7) is dropped. Integration with the demand plan is a later, separate decision.

**No feature flag.** The module ships visible to all users on first deploy. It cannot affect the planner, so the flag's safety rationale does not apply.

---

## 2. The SKU model

**One standalone SKU list.** Costing SKUs are their own master, seeded from the 34 rows of the v11 workbook. They are not derived from, and do not reference, planner programs.

There is **one list serving both markets**, not two. Yield, %fish, %marinade, marinade $/kg, process $/kg, packing $/kg and pack size are entered once and shared.

A **customer master** will be added later as its own standalone. When it exists, creating a costing will optionally prompt for a customer. Nothing built now needs changing to allow this.

---

## 3. Market handling

Market (**Domestic** or **Export**) is a **mode selected when costing**, not a second SKU list.

| | Domestic | Export |
|---|---|---|
| Import tax on feed | 35% (as entered) | 0% — duty drawback |
| Per-kg adders | LKR: transport 60, cold-hold 40 | USD: freight-to-port 0.10, cold-chain 0.10 |
| Display currency | **LKR** | **USD only** |
| States | Unglazed, glazed | Frozen plain, frozen glazed, fresh (air) |

No LKR reference view for export costings. No fresh/air variant for domestic.

Feed cost, clearing, FCR and ODC are entered **once** and shared across both markets, exactly as the workbook intends. The import tax rate is the only base-cost difference.

---

## 4. Assumptions: ownership and versioning

Assumptions are **org-level and versioned**, not plan-scoped.

- **Admins maintain the official set** — feed cost, clearing, import tax, FCR, FX, ODC components, destination freight table, container fill and air lot weights, and the margin defaults.
- **Any user may override any assumption within their own costing.** The override is **stamped visibly on that costing**, so a quote built on non-standard assumptions is obvious to anyone reviewing it.
- **Feed cost stays a typed input.** The Feed WACC tab is not wired in. It remains a reference for working the number out by hand. (Noted for later: SK computes to 1.3552 and AD to 1.49268, while the live input is 1.35 — matching neither.)

### Saved costings and repricing

A saved costing **stores its resolved lines and pins the assumptions version it was built on**. Reopening it shows what was actually quoted. A **"reprice at current assumptions"** action shows today's numbers and the delta, without overwriting the original.

This is why assumptions are versioned rather than a single editable set — retrofitting version history later would mean backfilling every quote.

---

## 5. Access and ownership

**Open to every signed-in user.** No new role, no new permission gate.

- Anyone can create a costing.
- **All costings are visible to all users.**
- **Only the creator can edit their own.** Admins may delete an orphaned costing.

### The base fish cost is the exception

Two sections of the Assumptions screen — **Base fish cost** (feed, clearing,
import tax, FCR, FX) and **Other direct costs** (the ODC components) — are
commercially sensitive: they are supplier prices and a tax position. They are
**hidden from everyone by default**, and an admin releases them per user in
Admin → Users with two grants:

- `base_cost_view` — see the two sections, and the whole-fish build-up on a
  cost sheet ("Effective feed cost", "FCR used", "Feed cost per kg fish",
  "Other direct costs").
- `base_cost_edit` — additionally publish an assumptions version that changes
  them. Implies view. Everything *else* on the Assumptions screen stays
  admin-only, so a grantee's publish takes every other field from the version
  it was based on, whatever the form posted.

Costs and prices built on those numbers stay visible to everyone — the grid's
whole-fish column, every FINAL, every selling price. Only the inputs are held
back.

**Enforced by not sending them.** The grid, the SKU dialog and the sheet
previews all price in the browser, so a user without the grant is served an
*algebraically equivalent* set of assumptions instead of the real one
(`apps/web/lib/costing-base-cost.ts`): the effective feed cost is folded into
one feed-plus-tax pair, and the ODC table collapses to a per-kg and a per-fish
total. Prices come out identical to the last decimal — pinned by
`packages/engine/test/costing-base-cost-mask.test.ts` — while the feed price,
the tax rate and the individual components never reach the page.

Two limits worth stating plainly:

- **The aggregates are derivable.** The whole-fish cost is on screen and the
  per-grade FCR is in Size grades, so someone determined can work back to the
  effective feed cost. Hiding the line items is the achievable goal; hiding
  their sum is not, while the cost itself is shown.
- **RLS is unchanged.** `cost_assumption_versions` and `cost_odc_components`
  are still readable by any active user of the org at the database level, so an
  account querying Supabase directly with its own token can still read them.
  Closing that means restricting those policies and moving every costing screen
  onto the service-role loader.

The `/api/v1/costing` endpoints are unaffected: they return final costs and
prices per SKU, never the assumptions or the whole-fish build-up.

### Sending a cost sheet out

Seeing the build-up and *sending* it are different decisions. Wherever a sheet
can be printed or exported to Word — the grid's breakdown, the SKU editor's
download menu, a saved costing's line — a reader who holds the grant gets a
**"Include the base cost build-up"** tick box. It governs the on-screen preview
as well as the printed and Word copies, so what is on screen is what the
recipient gets.

It defaults to **on**: unticking is a deliberate act for a document going
outside, and leaving it on changes nothing for the internal reader who has
always had the detail. Whichever way it is set, the whole-fish cost and every
price, margin and downstream figure stay on the sheet — only the four lines
that decompose the whole-fish cost come out.

Users without the grant never see the box, because those lines were never on
their sheet to begin with.

---

## 6. Size buckets and yield

Built bucket-shaped from day one, per handoff §5. Two departures from the handoff:

**Costing keeps its own copy of the size buckets.** The planner's `buckets` table already holds the identical seven grades (0–600g through 2200–4000g), but costing owning its own copy honours the independence requirement — a rename in the planner cannot shift a costing. Integrating the two lists is a later consideration.

**Yield comes from a per-bucket table, not from the Master Yield summary.** For each SKU and each bucket, one yield at the bucket's **median weight** — structurally identical to the FCR table. Both tables ship with **editable placeholders** and are populated with real farm data later.

The Master Yield summary is the **shape to copy, not a file to import**. This deliberately avoids its three data problems: most product × size combinations are blank; its columns mix generic names with customer item codes; and two columns (KM Skin On 170/230) have 20% glaze already multiplied in, which would double-count against the glaze logic. The `W10 = 4.88` typo becomes moot.

Placeholder FCR (1.10 → 1.75 across the buckets) ships as-is, editable.

While buckets are off, every SKU resolves through a single default bucket and behaves exactly as the flat model does today.

---

## 7. By-products vs co-products — the substantive change from v11

This is the one place where the agreed model **deliberately departs from the workbook**.

### The problem with v11

Every SKU is costed independently as `whole_fish_cost ÷ its own yield`. Belly flaps at 6% yield therefore carry the **entire** whole-fish cost, landing at LKR 18,593/kg. Costed this way, the sum of a fish's parts is several times the cost of the fish. By-products look catastrophically unprofitable when in fact they are the residue of a fillet run that has already paid for the fish.

### By-products: absorbed cost

The raw material cost of a by-product **has already been absorbed by the main product**. Its true cost is only what is spent after the split — processing, packing, cold-hold and freight.

A per-SKU setting, `raw_material_basis`, takes one of two values:

- **`full_fish`** — carries whole-fish cost ÷ yield. **Default for all 34 SKUs**, reproducing v11 exactly.
- **`absorbed`** — carries **zero raw material**; cost is downstream costs only. Applied to the six by-product rows.

Effect at v11's own inputs:

| SKU | v11 (`full_fish`) | Agreed (`absorbed`) |
|---|---|---|
| Belly flaps | LKR 18,593 | **LKR 270** |
| Head | LKR 10,213 | **LKR 219** |
| Collar | LKR 22,309 | **LKR 321** |
| Frames / bones | LKR 13,927 | **LKR 185** |
| Fish skin | LKR 36,882 | **LKR 236** |
| Trimmings / mince | LKR 15,941 | **LKR 236** |

### By-products are priced on contribution, not margin

Cost-plus-40% is the wrong rule here — it would cap belly flaps at LKR 450/kg when the market may pay far more. For `absorbed` SKUs the output is **cost floor, market price, and contribution per kg**. The user enters what the market bears; the tool shows what each kg contributes.

The workbook's orange block — *"current market prices you entered — benchmark only, not used in costing"* — becomes load-bearing for these SKUs. **Goal: capture all downstream cost and maximise revenue per kg.**

### Co-products: costed as main products

Center cuts, tail portions and similar are costed at their **standalone yields** exactly as v11 does — as though each were the target product of its own run. The yield advantage when they actually arise together as co-products is treated as **upside, not modelled cost relief**.

No change to these rows. **28 of the 34 SKUs are untouched; only the six by-product rows change.**

### Deferred: by-product credit

Once by-products earn real revenue, that revenue genuinely reduces what the fillet cost. The engine will be shaped to allow a by-product credit to flow back into the main SKU, but it stays **switched off** until real by-product prices exist — otherwise fillet cost would be discounted against revenue not yet earned.

---

## 8. Overrides

**Margins and per-kg adders are overridable per SKU, inheriting the global value as default.**

Covers rack margin, FOB margin, transport, cold-hold, freight-to-port and cold-chain. This matches the workbook's own stated intent ("default, overridable per SKU") and its green-cell convention.

While nothing is overridden, numbers are identical to v11, so parity is unaffected.

Rationale: a 40% margin on belly flaps and on skin-on fillet are different commercial propositions; frozen product sits in a freezer for weeks while fresh air-freights out in days.

---

## 9. What a costing is

**Both a live grid and saved snapshots.**

- A **standing grid** showing every SKU at current assumptions — the day-to-day working view, because comparing fillet against portions against whole gutted is the point.
- **Saved costings** — deliberate, named snapshots pinned to their assumptions version, visible to everyone, editable only by their creator.

**Destinations:** each costing chooses whether it covers **one destination or several**. Multi-destination shows the same SKU landed at each port in adjacent columns. Everything up to FOB is generic — only CIF and below vary by destination — so comparison is nearly free.

---

## 10. Outputs

**Two distinct outputs.**

**Internal sheet** — full build-up, every intermediate, **matching the v11 column layout** so anyone who knows the spreadsheet can read it and cross-check during changeover. Built first: it is what proves parity.

**Customer quote** — stops at **your selling price**, FOB or CIF selectable. SKU, pack size, size grade, state, destination, incoterm, price per kg, terms. **The importer clearing, importer markup and distributor markup stay internal** — they model the buyer's economics to check your price leaves them room, and must never appear on a customer-facing document.

### Margin at whole round

Alongside the per-kg gross margin, every priced state also reports **margin at whole round** — what a kilogram of round fish earned, measured against **what the farm spent growing it**:

    ((selling price − conversion inputs) × yield − whole fish cost) ÷ whole fish cost

The whole round cost is the §3 build-up: **feed × FCR + ODC**. Conversion inputs are everything the fish meets after the farm gate — marinade, processing, packing, cold-hold and freight to port. The fish itself is **not** deducted per kg; it is charged **once, in full**, after yield has scaled the result back to the round weight it came from. Glaze raises the pack per kilo of fish, so the effective multiplier is `yield × (1 + glaze)`.

**The denominator is the fish cost, deliberately.** Taken over revenue instead, this figure would be arithmetically identical to the per-kg gross margin for any `full_fish` SKU that is 100% fish, because `fish component × yield` **is** the whole fish cost and it cancels:

    (price − FINAL + fish comp) × yield − whole fish   =   (price − FINAL) × yield

Read as a **return on the farm cost** it stays a distinct number for every SKU, and it routinely **exceeds 100%** — earning several times the cost of the fish is the normal case, not an error. It goes negative when the price does not cover the fish.

**Absorbed by-products report nothing here.** Charging a by-product a whole fish would contradict §7 — the fillet run already paid for it — so the figure is null rather than a fabricated loss.

**Price tiers** (retail / member / wholesale) are **not built**. Price output is shaped internally so a second tier is data entry rather than an engine change, but nothing tier-related appears in the UI.

---

## 11. Validation and precision

**Σ% check is blocking.** When %fish + %marinade does not equal 100%, the row **highlights and does not calculate**. This differs from v11, which highlights but still computes. All 34 workbook rows total 100%, so parity is unaffected.

**Precision.** Full precision internally, rounding only for display, matching Excel's own behaviour. Parity assertions to 1e-9, not to the rupee.

---

## 12. What the workbook cannot prove

Recorded so the parity suite's limits are explicit:

- **Size buckets are computed but never consumed.** SKU column `I` on both tabs always reads the flat reference cell; the per-bucket column is calculated and unused. **The bucketed path has no Excel oracle** and is tested against the handoff's §5.2 arithmetic directly.
- **Every glaze cell is zero.** The glaze logic is algebraically untested by the file. Tested against the handoff anchors instead: 20% glaze on domestic skin-on fillet gives FINAL 2,577.88 and rack 4,296.47 — confirmed to follow from the formula.
- **The `absorbed` by-product path is new** (§7) and has no oracle. The `full_fish` path is what parity locks to.

### Confirmed against the workbook

Traced and matching before any code was written:

- Domestic skin-on fillet: FINAL **LKR 2,985.06** → rack **LKR 4,975.09**
- Export skin-on fillet (Dubai): FINAL **$7.1105** → FOB **$11.8508** → CIF **$12.3008** → Dist→T3 **$16.3385**; fresh via air → CIF **$14.6508** → **$19.4599**
- Freight conversion: Dubai sea $3,150 ÷ 7,000 kg = **$0.450/kg**; air $1,400 ÷ 500 kg = **$2.80/kg**
- ODC amortisation: 0–600g bucket (median 300g) = **$1.1686/kg**; 2200–4000g (median 3100g) = **$0.2087/kg**

---

## 13. Build sequence

1. **Foundations** — costing tables (no FKs to planner tables); `computeCost` in `packages/engine`; parity suite locking the `full_fish` path to v11.
2. **SKU master and assumptions editors** — the 34 SKUs, admin-maintained assumptions with per-costing override, destinations table.
3. **The grid** — live costing grid, both markets, three export states, glaze, by-product contribution view.
4. **Saved costings** — snapshot with pinned assumptions version, reprice action, single or multi-destination.
5. **Outputs** — internal v11-layout sheet, then customer quote at FOB/CIF.
6. **Buckets on** — populate per-bucket FCR and yield with real farm data, flip the switch.

### Deferred, in rough order

Customer master · by-product credit loop · price tiers · Feed WACC wiring · per-bucket feed cost · integration with demand plan programs · shared bucket list · co-product allocation

---

## 14. Open items awaiting your input

- **Which feed supplier is real** — SK ($1.3552) or AD ($1.49268)? The live input is $1.35, matching neither.
- **Per-bucket feed cost.** Small pellets cost markedly more (1.5mm at $1.82 vs 10mm at $1.29, a 40% premium) and the mix is dominated by large sizes. A 0–600g fish is currently costed on a feed blend it never ate. Worth revisiting if the effect is material at the farm.
- **Real per-bucket FCR and yield** from the farm, to replace the placeholders.
