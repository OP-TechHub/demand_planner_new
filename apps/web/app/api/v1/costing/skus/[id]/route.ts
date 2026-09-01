import { authenticateApiRequest, jsonError, jsonOk } from '@/lib/api-auth';
import { createServiceClient } from '@/lib/supabase/service';
import { loadApiCostingContext, priceSkus, type SkuPriceRow } from '@/lib/costing-api';
import { resolveQuery } from '@/lib/api-costing-query';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

/**
 * GET /api/v1/costing/skus/{id} — one SKU, priced across every state, market
 * and destination it is sold in. Same row shape as the list endpoint, so the
 * CRM renders a lead's quote table and a single SKU detail with one component.
 *
 * Accepts the same market/destination/bucket/version params as the list.
 */
export async function GET(req: Request, { params }: { params: Promise<{ id: string }> }) {
  const auth = await authenticateApiRequest(req);
  if ('error' in auth) return auth.error;
  const { id } = await params;

  const url = new URL(req.url);
  const svc = createServiceClient();
  const ctx = await loadApiCostingContext(svc, auth.caller.orgId, url.searchParams.get('version'));
  if (!ctx) return jsonError(404, 'costing_not_set_up', 'The costing module has no assumptions for this organisation.');

  // Matched against the org's own SKUs, so an id from another org 404s rather
  // than leaking that it exists.
  const sku = ctx.skus.find((s) => s.id === id);
  if (!sku) return jsonError(404, 'sku_not_found', 'No such costing SKU in this organisation.');

  // Status is irrelevant when the caller named the SKU: asking for an inactive
  // SKU by id should return it, not an empty list.
  const q = resolveQuery(ctx, url.searchParams, { skus: [sku], ignoreFilters: true });
  if ('error' in q) return q.error;

  const rows: SkuPriceRow[] = [];
  const skipped: { sku_id: string; name: string; reason: string }[] = [];
  for (const market of q.markets) {
    const priced = priceSkus(ctx, q.skus, market, q.destinations, q.bucket);
    rows.push(...priced.rows);
    skipped.push(...priced.skipped);
  }

  return jsonOk(
    {
      sku: {
        id: sku.id,
        name: sku.name,
        category: sku.category,
        customer: sku.customer,
        pack_size: sku.pack_size,
        status: sku.status,
        product_form: sku.product_form,
        market_scope: sku.market_scope,
        pricing_mode: sku.pricing_mode,
      },
      prices: rows,
    },
    {
      assumptions_version: ctx.version.version_no,
      assumptions_version_id: ctx.version.id,
      fx_rate: ctx.version.fx_rate,
      size_bucket: q.bucket ? { id: q.bucket.id, label: q.bucket.label } : null,
      skipped,
    }
  );
}
