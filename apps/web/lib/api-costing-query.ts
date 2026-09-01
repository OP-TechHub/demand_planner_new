// Shared query-string handling for the /api/v1/costing routes.
//
// The list endpoint and the single-SKU endpoint accept the same market,
// destination, bucket and version params and must interpret them identically —
// a price that changes depending on which endpoint you asked is a bug the CRM
// would surface as two different quotes for one product.
import type { NextResponse } from 'next/server';
import { jsonError } from '@/lib/api-auth';
import type { ApiCostingContext } from '@/lib/costing-api';
import type { CostDestinationRow, CostMarket, CostSizeBucket, CostSkuRow } from '@oceanpick/shared';

export interface ResolvedQuery {
  markets: CostMarket[];
  skus: CostSkuRow[];
  destinations: CostDestinationRow[];
  bucket: CostSizeBucket | null;
}

const MARKETS: CostMarket[] = ['domestic', 'export'];

/**
 * Turn the query string into engine inputs, or a 400 explaining what was wrong.
 *
 * Unknown values fail loudly rather than falling back to a default: a typo in
 * `destination=Dubai` silently priced for every port would put the wrong number
 * in front of a customer.
 */
export function resolveQuery(
  ctx: ApiCostingContext,
  sp: URLSearchParams,
  opts: { skus?: CostSkuRow[]; ignoreFilters?: boolean } = {}
): ResolvedQuery | { error: NextResponse } {
  // --- market
  const marketParam = sp.get('market');
  let markets: CostMarket[] = MARKETS;
  if (marketParam) {
    if (!MARKETS.includes(marketParam as CostMarket)) {
      return { error: jsonError(400, 'bad_market', `market must be one of: ${MARKETS.join(', ')}.`) };
    }
    markets = [marketParam as CostMarket];
  }

  // --- destination (export only; id or exact name, case-insensitive)
  const destParam = sp.get('destination');
  let destinations = ctx.destinations;
  if (destParam) {
    const needle = destParam.trim().toLowerCase();
    const match = ctx.destinations.find((d) => d.id === destParam || d.name.toLowerCase() === needle);
    if (!match) {
      return {
        error: jsonError(
          400,
          'bad_destination',
          `Unknown destination "${destParam}". Active: ${ctx.destinations.map((d) => d.name).join(', ') || 'none'}.`
        ),
      };
    }
    destinations = [match];
  }

  // --- size bucket (id or label). Absent means the flat reference model, which
  // is what the grid shows with buckets switched off.
  const bucketParam = sp.get('bucket');
  let bucket: CostSizeBucket | null = null;
  if (bucketParam) {
    const needle = bucketParam.trim().toLowerCase();
    const match = ctx.buckets.find((b) => b.id === bucketParam || b.label.toLowerCase() === needle);
    if (!match) {
      return {
        error: jsonError(
          400,
          'bad_bucket',
          `Unknown size bucket "${bucketParam}". Available: ${ctx.buckets.map((b) => b.label).join(', ') || 'none'}.`
        ),
      };
    }
    bucket = match;
  }

  if (opts.ignoreFilters) {
    return { markets, skus: opts.skus ?? ctx.skus, destinations, bucket };
  }

  // --- SKU filters
  let skus = opts.skus ?? ctx.skus;

  const status = (sp.get('status') ?? 'active').toLowerCase();
  if (status !== 'all') {
    if (status !== 'active' && status !== 'inactive') {
      return { error: jsonError(400, 'bad_status', 'status must be one of: active, inactive, all.') };
    }
    skus = skus.filter((s) => s.status === status);
  }

  const customer = sp.get('customer')?.trim().toLowerCase();
  if (customer) skus = skus.filter((s) => s.customer.toLowerCase().includes(customer));

  const q = sp.get('q')?.trim().toLowerCase();
  if (q) skus = skus.filter((s) => s.name.toLowerCase().includes(q) || s.category.toLowerCase().includes(q));

  return { markets, skus, destinations, bucket };
}
