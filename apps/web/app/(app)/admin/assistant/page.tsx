import { createClient } from '@/lib/supabase/server';
import { fetchAllPaged } from '@/lib/fetch-all';
import { MONTHLY_BUDGET_USD, monthEnd, monthStart } from '@/lib/chat/budget';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';

/**
 * Admin: what the assistant has cost this month, and who asked. Reads under
 * the admin's own session — the chat_usage read policy is admins-only, so a
 * non-admin sees nothing rather than a guard we have to remember to keep.
 */
export default async function AssistantUsagePage() {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  const { data: me } = await supabase.from('users').select('role').eq('id', user!.id).maybeSingle();

  if (me?.role !== 'admin') {
    return (
      <div className="mx-auto max-w-3xl space-y-4">
        <h1 className="text-2xl font-semibold tracking-tight">Assistant usage</h1>
        <div className="rounded-lg border border-destructive/30 bg-destructive/10 p-6 text-sm text-destructive">Admins only.</div>
      </div>
    );
  }

  type Row = { user_id: string | null; cost_usd: number | string; input_tokens: number; output_tokens: number; created_at: string };
  const [rows, { data: users }] = await Promise.all([
    fetchAllPaged(
      (f, t) => supabase
        .from('chat_usage')
        .select('user_id, cost_usd, input_tokens, output_tokens, created_at')
        .gte('created_at', monthStart().toISOString())
        .order('created_at', { ascending: false })
        .range(f, t),
      'chat_usage'
    ) as Promise<Row[]>,
    supabase.from('users').select('id, full_name, email'),
  ]);
  const nameOf = new Map((users ?? []).map((u: { id: string; full_name: string | null; email: string }) => [u.id, u.full_name || u.email]));

  const byUser = new Map<string, { name: string; questions: number; cost: number; last: string }>();
  let spent = 0;
  for (const r of rows) {
    const cost = Number(r.cost_usd);
    spent += cost;
    const key = r.user_id ?? '';
    const cur = byUser.get(key) ?? { name: nameOf.get(key) ?? 'Removed user', questions: 0, cost: 0, last: r.created_at };
    cur.questions += 1;
    cur.cost += cost;
    if (r.created_at > cur.last) cur.last = r.created_at;
    byUser.set(key, cur);
  }
  const people = [...byUser.values()].sort((a, b) => b.cost - a.cost);
  const pctUsed = Math.min(100, (spent / MONTHLY_BUDGET_USD) * 100);
  const usd = (n: number) => `US$${n.toFixed(2)}`;
  const day = (iso: string) => new Date(iso).toLocaleDateString('en-GB', { day: 'numeric', month: 'short' });

  return (
    <div className="mx-auto max-w-3xl space-y-4">
      <div>
        <h1 className="text-2xl font-semibold tracking-tight">Assistant usage</h1>
        <p className="mt-1 text-sm text-muted-foreground">
          What the Ask assistant has cost this month, at the model&apos;s list price. The whole company shares one
          allowance; once it is spent, the assistant refuses questions until the 1st of next month.
        </p>
      </div>

      <Card>
        <CardHeader>
          <CardTitle>This month</CardTitle>
        </CardHeader>
        <CardContent className="space-y-3">
          <div className="flex items-baseline justify-between">
            <span className="text-2xl font-semibold tabular-nums">{usd(spent)}</span>
            <span className="text-sm text-muted-foreground">of {usd(MONTHLY_BUDGET_USD)} · resets {day(monthEnd().toISOString())}</span>
          </div>
          <div className="h-2 overflow-hidden rounded-full bg-muted">
            <div
              className={pctUsed >= 100 ? 'h-full bg-destructive' : pctUsed >= 80 ? 'h-full bg-amber-500' : 'h-full bg-primary'}
              style={{ width: `${pctUsed}%` }}
            />
          </div>
          <p className="text-xs text-muted-foreground">
            {rows.length} question{rows.length === 1 ? '' : 's'} so far
            {rows.length > 0 && <> · about {usd(spent / rows.length)} each</>}. The allowance is set by{' '}
            <code className="rounded bg-muted px-1">CHAT_MONTHLY_BUDGET_USD</code> in the server environment.
          </p>
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>By person</CardTitle>
        </CardHeader>
        <CardContent>
          {people.length === 0 ? (
            <p className="text-sm text-muted-foreground">No questions yet this month.</p>
          ) : (
            <table className="w-full text-sm">
              <thead className="text-left text-xs text-muted-foreground">
                <tr>
                  <th className="pb-2 font-medium">Person</th>
                  <th className="pb-2 text-right font-medium">Questions</th>
                  <th className="pb-2 text-right font-medium">Cost</th>
                  <th className="pb-2 text-right font-medium">Last asked</th>
                </tr>
              </thead>
              <tbody>
                {people.map((p) => (
                  <tr key={p.name} className="border-t border-border">
                    <td className="py-2">{p.name}</td>
                    <td className="py-2 text-right tabular-nums">{p.questions}</td>
                    <td className="py-2 text-right tabular-nums">{usd(p.cost)}</td>
                    <td className="py-2 text-right text-muted-foreground">{day(p.last)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
