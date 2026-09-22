// The assistant's spending cap — SERVER ONLY.
//
// Every answered question is priced at the model's list rate and written to
// chat_usage. Before answering, the route adds up the organisation's month and
// refuses once the budget is spent. The cap is per organisation, not per user:
// one bill, one limit.
import { createServiceClient } from '@/lib/supabase/service';
import { fetchAllPaged } from '@/lib/fetch-all';

/** US dollars per calendar month, for the whole organisation. */
export const MONTHLY_BUDGET_USD = Number(process.env.CHAT_MONTHLY_BUDGET_USD) || 10;

export type TokenUsage = { input: number; output: number; cache_read: number; cache_write: number };

/**
 * List prices in USD per million tokens. Cache reads are 10% of input, cache
 * writes 125%. Matched by prefix so a dated model id still prices; an unknown
 * model prices at the Opus rate, so a misconfigured CHAT_MODEL can only
 * over-count, never under-count.
 */
const PRICES: { prefix: string; input: number; output: number }[] = [
  { prefix: 'claude-opus-5', input: 5, output: 25 },
  { prefix: 'claude-opus-4', input: 5, output: 25 },
  { prefix: 'claude-sonnet-5', input: 2, output: 10 },
  { prefix: 'claude-sonnet-4', input: 3, output: 15 },
  { prefix: 'claude-haiku-4', input: 1, output: 5 },
];

export function costUsd(model: string, u: TokenUsage): number {
  const p = PRICES.find((x) => model.startsWith(x.prefix)) ?? PRICES[0]!;
  const perTok = 1 / 1_000_000;
  return (
    u.input * p.input * perTok +
    u.cache_read * p.input * 0.1 * perTok +
    u.cache_write * p.input * 1.25 * perTok +
    u.output * p.output * perTok
  );
}

/** The first instant of the current calendar month, UTC. */
export function monthStart(now = new Date()): Date {
  return new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), 1));
}

/** When the budget next resets: the first of next month, UTC. */
export function monthEnd(now = new Date()): Date {
  return new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth() + 1, 1));
}

export type BudgetStatus = { spent_usd: number; budget_usd: number; resets_at: string; exhausted: boolean };

/** What the organisation has spent this month, against its budget. */
export async function budgetStatus(orgId: string): Promise<BudgetStatus> {
  const svc = createServiceClient();
  // Rows, not a SQL sum: at a $10 cap a month is a few hundred rows, and
  // PostgREST aggregates are off by default on this project.
  const rows = await fetchAllPaged(
    (f, t) => svc
      .from('chat_usage')
      .select('cost_usd')
      .eq('org_id', orgId)
      .gte('created_at', monthStart().toISOString())
      .range(f, t),
    'chat_usage'
  );
  const spent = rows.reduce((s: number, r: { cost_usd: number | string }) => s + Number(r.cost_usd), 0);
  return {
    spent_usd: spent,
    budget_usd: MONTHLY_BUDGET_USD,
    resets_at: monthEnd().toISOString(),
    exhausted: spent >= MONTHLY_BUDGET_USD,
  };
}

/** Record one answered question. Best-effort: a failed write must not fail the answer. */
export async function recordUsage(entry: {
  orgId: string;
  userId: string;
  model: string;
  usage: TokenUsage;
  tools: string[];
}): Promise<number> {
  const cost = costUsd(entry.model, entry.usage);
  try {
    const svc = createServiceClient();
    const { error } = await svc.from('chat_usage').insert({
      org_id: entry.orgId,
      user_id: entry.userId,
      model: entry.model,
      input_tokens: entry.usage.input,
      output_tokens: entry.usage.output,
      cache_read_tokens: entry.usage.cache_read,
      cache_write_tokens: entry.usage.cache_write,
      cost_usd: cost,
      tools: entry.tools,
    });
    if (error) console.error('[chat] usage not recorded:', error.message);
  } catch (err) {
    console.error('[chat] usage not recorded', err);
  }
  return cost;
}
