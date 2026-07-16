import { createClient } from '@/lib/supabase/server';

/* eslint-disable @typescript-eslint/no-explicit-any */

export default async function AuditPage() {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  const { data: me } = await supabase.from('users').select('role').eq('id', user!.id).maybeSingle();
  if (me?.role !== 'admin') {
    return (
      <div className="mx-auto max-w-3xl space-y-4">
        <h1 className="text-2xl font-semibold tracking-tight">Audit Log</h1>
        <div className="rounded-lg border border-destructive/30 bg-destructive/10 p-6 text-sm text-destructive">Admins only.</div>
      </div>
    );
  }

  const [{ data: entries }, { data: users }] = await Promise.all([
    supabase.from('audit_log').select('*').order('at', { ascending: false }).limit(100),
    supabase.from('users').select('id, full_name, email'),
  ]);
  const nameById = new Map((users ?? []).map((u: any) => [u.id, u.full_name || u.email]));

  return (
    <div className="mx-auto max-w-3xl space-y-4">
      <h1 className="text-2xl font-semibold tracking-tight">Audit Log</h1>
      <p className="text-xs text-muted-foreground">Append-only record of changes across users, programs, demand, and harvest.</p>

      {!entries || entries.length === 0 ? (
        <div className="rounded-lg border border-dashed bg-muted/30 p-8 text-sm text-muted-foreground">No audit entries yet.</div>
      ) : (
        <div className="overflow-x-auto rounded-lg border">
          <table className="w-full text-sm">
            <thead className="border-b bg-muted/50 text-left text-xs uppercase tracking-wide text-muted-foreground">
              <tr>
                <th className="px-3 py-2">When</th>
                <th className="px-3 py-2">Who</th>
                <th className="px-3 py-2">Action</th>
                <th className="px-3 py-2">Change</th>
              </tr>
            </thead>
            <tbody>
              {(entries as any[]).map((e) => (
                <tr key={e.id} className="border-b last:border-0 align-top">
                  <td className="whitespace-nowrap px-3 py-2 text-muted-foreground">{new Date(e.at).toLocaleString()}</td>
                  <td className="px-3 py-2">{nameById.get(e.user_id) ?? '—'}</td>
                  <td className="px-3 py-2">{e.action} <span className="text-muted-foreground">{e.entity_type} {nameById.get(e.entity_id) ? `(${nameById.get(e.entity_id)})` : ''}</span></td>
                  <td className="px-3 py-2">
                    {e.changes && Object.entries(e.changes as Record<string, any>).map(([k, v]) => (
                      <div key={k} className="text-xs">
                        <span className="text-muted-foreground">{k}:</span> {String(v.old)} <span className="text-muted-foreground">→</span> {String(v.new)}
                      </div>
                    ))}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}
