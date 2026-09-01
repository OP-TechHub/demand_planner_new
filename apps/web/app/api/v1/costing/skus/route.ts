import { authenticateApiRequest, jsonError, jsonOk } from '@/lib/api-auth';
import { createServiceClient } from '@/lib/supabase/service';
import { loadApiCostingContext, priceSkus, type SkuPriceRow } from '@/lib/costing-api';
import { resolveQuery } from '@/lib/api-costing-query';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

/**
 * GET /api/v1/costing/skus — the priced SKU catalogue, for the CRM.
 *
 * Returns cost before margin, the margin, and the selling price, one row per
 * SKU per state per destination. Prices are computed on the fly by the same
 * engine the costing grid uses; nothing here is read from a stored price,
 * because there isn't one.
 *
 * Query:
 *   market=domestic|export   default: both (each SKU's market_scope applies)
 *   destination=<id|name>    export only; default: every active destination
 *   customer=<text>          case-insensitive contains
 *   q=<text>                 name contains
 *   status=active|inactive|all   default: active
 *   bucket=<id|label>        size bucket; default: the flat reference model
 *   version=<id>             assumptions version; default: current
 */
export async function GET(req: Request) {
  const auth = await authenticateApiRequest(req);
  if ('error' in auth) return auth.error;

  const url = new URL(req.url);
  const svc = createServiceClient();
  const ctx = await loadApiCostingContext(svc, auth.caller.orgId, url.searchParams.get('version'));
  if (!ctx) return jsonError(404, 'costing_not_set_up', 'The costing module has no assumptions for this organisation.');

  const q = resolveQuery(ctx, url.searchParams);
  if ('error' in q) return q.error;

  const rows: SkuPriceRow[] = [];
  const skipped: { sku_id: string; name: string; reason: string }[] = [];
  for (const market of q.markets) {
    const priced = priceSkus(ctx, q.skus, market, q.destinations, q.bucket);
    rows.push(...priced.rows);
    skipped.push(...priced.skipped);
  }

  return jsonOk(rows, {
    assumptions_version: ctx.version.version_no,
    assumptions_version_id: ctx.version.id,
    fx_rate: ctx.version.fx_rate,
    size_bucket: q.bucket ? { id: q.bucket.id, label: q.bucket.label } : null,
    count: rows.length,
    skipped,
  });
}
