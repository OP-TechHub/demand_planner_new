# Demand Planner API (v1)

A small, read-only HTTP API for another system — e.g. the PO matching app — to
read the demand plan and its computed outputs. It authenticates with an API key
(no user login), is scoped to one organisation, and speaks JSON.

- **Base URL:** `https://<your-app-domain>/api/v1`
- **Auth:** every request sends the API key, either as
  `Authorization: Bearer <key>` or `X-API-Key: <key>`.
- **Units:** all quantities are **kilograms of finished product (FP)** unless a
  field name ends in `_wr` (whole-round kg). The PO app converts cartons → kg
  before calling; this API never sees cartons.
- **Months:** every month is returned as both `month_index` (1 = the plan's
  start month) **and** `month` (its label, e.g. `"Jan 27"`). You can also pass a
  `delivery_date` and let the API work out the month.

## Getting a key

An admin creates one in the app under **Settings → API keys**. The secret is
shown once; store it in the PO app's secrets. Keys can be revoked at any time.

## Errors

Non-2xx responses use `{ "error": { "code": "...", "message": "..." } }`.
`401` = missing/invalid/revoked key. `404 plan_not_found`. `400` = bad request body.

---

## Endpoints

### `GET /plans`
The org's plans, so you can discover the master plan's id, start date and horizon.
```bash
curl https://<domain>/api/v1/plans \
  -H "Authorization: Bearer op_live_xxx"
```
```json
{ "data": [
  { "id": "…", "name": "Master Plan", "type": "master",
    "start_date": "2026-04-01", "horizon_months": 60, "is_locked": false }
] }
```
Most calls can skip the id entirely — omit `plan_id` and the API uses the master
plan.

### `GET /plans/{planId}/programs`
The item master: `item_code` (your join key), description, customer, price, baseline demand.

### `GET /plans/{planId}/demand`
Planned (effective) demand per item per month, in FP. Optional query:
`item_code`, `from_month`, `to_month`.

### `GET /plans/{planId}/results`
The engine output per item per month: `demand_fp`, `available_fp`,
`available_wr`, `fulfilment_pct`, `unfulfilled_wr`, `revenue`, `cost`. Reflects
the **last recompute** — edits made since aren't included until the plan is
recalculated. Same optional query params as `/demand`.

---

## The one you'll use most: `POST /match`

Send PO lines; get the plan's verdict per line. `plan_id` is optional (defaults
to master). Each line needs `item_code`, `qty_fp`, and either a `delivery_date`
(`YYYY-MM-DD`) or a `month_index`. `ref` is echoed back untouched so you can tie
a result to your PO line.

**Worked example — Purchase Order 7497** (delivery 07-Jan-2027). The PO is in
cartons; convert first: `7370` = 1040 × 3 kg = **3120**, `7372` = 700 × 6 kg = **4200**.

```bash
curl -X POST https://<domain>/api/v1/match \
  -H "Authorization: Bearer op_live_xxx" \
  -H "Content-Type: application/json" \
  -d '{
    "lines": [
      { "ref": "7497/1", "item_code": "7370", "delivery_date": "2027-01-07", "qty_fp": 3120 },
      { "ref": "7497/2", "item_code": "7372", "delivery_date": "2027-01-07", "qty_fp": 4200 }
    ]
  }'
```
```json
{
  "data": [
    {
      "item_code": "7370", "ref": "7497/1",
      "order_qty_fp": 3120, "month_index": 10, "month": "Jan 27",
      "matched": true,
      "program": { "description": "…", "customer": "…", "price_per_fp": 27.0 },
      "planned_demand_fp": 4000,
      "exceeds_planned": false,
      "available_fp": 5200,
      "fulfilment_pct": 1.0,
      "shortfall_fp": null,
      "verdict": "can_fulfil"
    }
  ],
  "meta": { "plan_id": "…", "plan_name": "Master Plan", "start_date": "2026-04-01", "horizon_months": 60 }
}
```

### Verdicts

| `verdict` | Meaning |
|---|---|
| `can_fulfil` | The plan can supply this line (`qty_fp` ≤ `available_fp`). |
| `short` | Not enough available; `shortfall_fp` = how much is missing. |
| `not_computed` | The plan hasn't been recalculated, so availability is unknown. Run a recompute, then retry. |
| `out_of_window` | The delivery date / month falls outside the plan's horizon. |
| `no_such_item` | No program with that `item_code` in the plan. |

`exceeds_planned` is a separate signal: `true` when the order is bigger than the
demand that was *planned* for that month, regardless of whether stock is
available. Use `verdict` to answer "can we supply it?" and `exceeds_planned` to
answer "was this order anticipated in the plan?".

---

## Notes for the integration

- **Item codes must match.** The PO's `Item Code` (`7370`, `7372`) is joined
  directly to `programs.item_code`. If either side renames an item, matches break.
- **Customer names may differ.** The PO shows the buyer (Pacific West / Primary
  Connect); the plan stores its own `customer` per program. The API matches on
  item code, not customer — treat the returned `customer` as informational.
- **Availability is only as fresh as the last recompute.** If planners edited
  demand/harvest and haven't recalculated, `/results` and `/match` availability
  lag. `not_computed` means it was never computed for that item/month.
