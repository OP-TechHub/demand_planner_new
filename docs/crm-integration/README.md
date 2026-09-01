# CRM → Demand Planner (read-only SKU pricing)

The CRM shows a salesperson, for any SKU: **total cost before margin**, **the
margin**, and **the selling price**. Those numbers come from the demand
planner over its existing `/api/v1` machine-to-machine API.

## Why the CRM cannot read Supabase directly

The costing grid is *computed on the fly and stored nowhere*. There is no price
column to read: cost, margin and price all come out of `@oceanpick/engine` at
request time from the current assumptions version. Querying Supabase from the
CRM would mean re-implementing the costing engine there, and it would drift the
first time a feed cost or FX rate changed. So the CRM calls the planner, and the
planner runs the engine.

## Shape

```
CRM page (HTML on Netlify)
  └─ fetch('/.netlify/functions/dp-skus?customer=Acme')   ← no key in the browser
       └─ dp-skus.js — holds DP_API_KEY as an env var
            └─ GET https://<planner>.vercel.app/api/v1/costing/skus
               Authorization: Bearer op_live_…
                 └─ authenticateApiRequest() → org-scoped → engine → JSON
```

The API key **must not** appear in the CRM's HTML or client JS. Anything in the
browser bundle is readable by anyone who opens devtools, and the key grants read
access to the org's entire costing. The Netlify function is the only place it is
safe. Going through the function also means no CORS to configure — it is
server-to-server.

## Setup

1. **Mint a key** in the planner: Settings → API keys. It is shown once and
   stored only as a SHA-256 hash; it cannot be recovered, only revoked and
   replaced.
2. **Copy** `dp-skus.js` into the CRM repo at `netlify/functions/dp-skus.js`.
3. **Set env vars** in Netlify → Site settings → Environment:
   - `DP_API_BASE` = `https://<your-planner>.vercel.app`
   - `DP_API_KEY` = the key from step 1
4. **Decide who may call the function** — see below. It refuses to serve data
   until you do.
5. Deploy the CRM.

To revoke the planner's trust later, revoke the key in the planner — no CRM code
changes needed.

## Authenticating the CRM's own users

A Netlify function is **public by default**. Anyone who knows
`/.netlify/functions/dp-skus` would get the whole costing table, margins
included — the planner's API key protects the planner, not this function.

So `dp-skus.js` **fails closed**: with no credentials configured it returns 401
rather than quietly serving cost data to the internet. Satisfy it one of two
ways, depending on how the CRM logs people in:

- **Netlify Identity** — the CRM sends the Identity JWT and the user arrives on
  `context.clientContext.user`:
  ```js
  fetch(url, { headers: { Authorization: 'Bearer ' + user.token.access_token } })
  ```
- **Shared secret** — set `CRM_SHARED_SECRET` in the Netlify environment and send
  it as `X-CRM-Secret`. Only worth doing if that header is added somewhere the
  browser cannot read it (an edge function or a proxy); putting the secret in
  page JS just moves the open door rather than closing it.

Tell me which the CRM uses and I will wire the calling side to match.

## Endpoints

### `GET /api/v1/costing/skus`

| Param | Default | Notes |
|---|---|---|
| `market` | both | `domestic` or `export`; each SKU's `market_scope` still applies |
| `destination` | all active | export only; id or name. Freight is inside `cost`, so it changes the number |
| `customer` | — | case-insensitive contains — the filter that pairs with a CRM lead |
| `q` | — | name or category contains |
| `status` | `active` | or `inactive`, `all` |
| `bucket` | flat model | size bucket id or label |
| `version` | current | assumptions version id |

Unknown values for `market`, `destination`, `bucket` and `status` return **400**
rather than falling back to a default — a typo'd destination silently priced for
every port would put the wrong number in front of a customer.

### `GET /api/v1/costing/skus/{id}`

One SKU with the same price rows, across every state, market and destination it
sells in. Status filters are ignored: asking for an inactive SKU by id returns
it. An id from another org returns 404.

## Response

```json
{
  "data": [{
    "sku_id": "…",
    "name": "Barramundi Fillet Skin-On 200-300g",
    "category": "Fillet",
    "customer": "Acme Foods",
    "pack_size": "1kg vac",
    "status": "active",
    "market": "export",
    "currency": "USD",
    "state": "frozen",
    "destination": { "id": "…", "name": "Dubai" },
    "cost": 8.42,
    "margin_pct": 0.22,
    "selling_price": 10.79,
    "contribution_per_kg": 2.37,
    "pricing_mode": "margin",
    "pricing_basis": "margin",
    "freight_per_kg": 0.41
  }],
  "meta": {
    "assumptions_version": 7,
    "fx_rate": 305.0,
    "size_bucket": null,
    "count": 61,
    "skipped": []
  }
}
```

**One row per SKU per state per destination.** The price genuinely differs
between glazed and unglazed, and between ports, so these are separate rows
rather than one row with variants. A glazed row appears only when the SKU
actually carries glaze — at 0% it would duplicate the unglazed row.

### Reading the fields

- `cost` — total per kg at the pricing point, **before any margin**. The floor.
- `margin_pct` — realised at `selling_price`. Negative means below cost.
- `selling_price` — rack rate (domestic) or FOB (export).
- `contribution_per_kg` — `selling_price − cost`. The negotiating headroom, which
  is what tells a salesperson how far they can discount.
- `pricing_mode` — `margin` is cost-plus. `target` means the price was named and
  the margin was derived from it.
- `pricing_basis` — `contribution` marks an absorbed by-product, where `cost` is
  a **floor**, not a base for cost-plus. Do not read its margin as a target.
- `meta.skipped` — SKUs the engine refused to cost, with the reason. Surface
  these; a SKU silently missing from a quote list is worse than one flagged.

### Building a price calculator in the CRM

The planner's pricing is two formulas, and both run on `cost` alone — so a
"what if I drop the margin" calculator needs no round trip to the planner and
writes nothing:

```js
const priceAt  = (cost, margin) => cost / (1 - margin);   // price from a margin
const marginAt = (cost, price)  => (price - cost) / price; // margin from a price
```

For export negotiated on CIF rather than FOB, add the freight:

```js
const cif = priceAt(cost, margin) + freight_per_kg;
```

`freight_per_kg` is given instead of a finished CIF number on purpose: the
calculator recomputes the price as the margin moves, and a CIF sent from here
would still reflect the original price. It is null for domestic rows.

Three rules for whoever builds it:

- **Fetch the cost once, then hold it.** If the calculator re-fetches while the
  margin slider is moving, and someone updates the FX rate in the planner
  mid-call, the quote shifts under the salesperson while they are speaking.
- **The floor is `cost`, not zero.** At margin 0 the price equals cost. Show
  below-cost in red — at speed on a phone call, a negative margin looks like any
  other number.
- **Branch on `pricing_basis`.** A `contribution` SKU is an absorbed by-product:
  its `cost` is a floor, not a base to mark up, so the margin slider is the
  wrong control. Use `contribution_per_kg` against the market price instead.

None of this can affect the planner: every route here is `GET`, API keys carry
only the `read` scope, and the arithmetic happens in the browser.

### What is deliberately not exposed

Feed cost, FCR, whole-fish cost and the ODC build-up. Those are the inputs that
reveal farm economics. `cost` alone gives a salesperson their floor without
handing the cost structure to everyone with CRM access.

## Notes

- **Read-only.** API keys carry the `read` scope and there are no write routes.
- **Org-scoped.** The routes run under the service role, which bypasses RLS, so
  every query filters on the key's `org_id`. That filter is the only boundary
  between orgs — preserve it in any new costing route.
- **Prices move when assumptions change.** `meta.assumptions_version` says which
  version priced the response; pin with `?version=` if a quote must be stable.
