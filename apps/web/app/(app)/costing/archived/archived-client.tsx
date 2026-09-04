'use client';

import { useRouter } from 'next/navigation';
import { useState, useTransition } from 'react';
import { AlertTriangle, RotateCcw } from 'lucide-react';
import { restoreCosting, restoreCostSku } from './actions';

export interface ArchivedCosting {
  id: string;
  name: string;
  market: string;
  lineCount: number;
  authorName: string;
  deletedAt: string;
  versionLabel: string;
  hasOverrides: boolean;
}

export interface ArchivedSku {
  id: string;
  name: string;
  category: string;
  status: string;
  deletedAt: string;
}

export function ArchivedList({ costings, skus }: { costings: ArchivedCosting[]; skus: ArchivedSku[] }) {
  return (
    <div className="mx-auto max-w-5xl space-y-6">
      <header>
        <h1 className="text-2xl font-semibold tracking-tight">Deleted costings</h1>
        <p className="mt-0.5 text-sm text-muted-foreground">
          Deleting a costing and archiving a SKU only hide the row — the lines, ports and yields are
          still there. Restoring puts one back exactly as it was, on the assumptions version it was
          pinned to.
        </p>
      </header>

      <section className="space-y-2">
        <h2 className="text-sm font-medium">Costings ({costings.length})</h2>
        {costings.length === 0 ? (
          <Empty>Nothing deleted.</Empty>
        ) : (
          <div className="divide-y rounded-lg border bg-card">
            {costings.map((c) => (
              <Row
                key={c.id}
                title={c.name}
                meta={[
                  c.market,
                  `${c.lineCount} lines`,
                  c.versionLabel,
                  c.authorName,
                  `deleted ${new Date(c.deletedAt).toLocaleDateString()}`,
                ]}
                flag={c.hasOverrides ? 'custom assumptions' : null}
                confirm={`Restore “${c.name}” to Saved costings?`}
                onRestore={() => restoreCosting(c.id)}
              />
            ))}
          </div>
        )}
      </section>

      <section className="space-y-2">
        <h2 className="text-sm font-medium">SKUs ({skus.length})</h2>
        <p className="text-xs text-muted-foreground">
          A restored costing keeps its own snapshot either way. Bring the SKU back when you also want
          the &ldquo;what this would cost today&rdquo; column to fill in again.
        </p>
        {skus.length === 0 ? (
          <Empty>Nothing archived.</Empty>
        ) : (
          <div className="divide-y rounded-lg border bg-card">
            {skus.map((s) => (
              <Row
                key={s.id}
                title={s.name}
                meta={[
                  s.category || 'uncategorised',
                  s.status,
                  `archived ${new Date(s.deletedAt).toLocaleDateString()}`,
                ]}
                flag={null}
                confirm={`Restore “${s.name}” to the SKU list?`}
                onRestore={() => restoreCostSku(s.id)}
              />
            ))}
          </div>
        )}
      </section>
    </div>
  );
}

function Empty({ children }: { children: React.ReactNode }) {
  return (
    <div className="rounded-lg border bg-card p-6 text-center text-sm text-muted-foreground">{children}</div>
  );
}

function Row({
  title,
  meta,
  flag,
  confirm: confirmText,
  onRestore,
}: {
  title: string;
  meta: string[];
  flag: string | null;
  confirm: string;
  onRestore: () => Promise<{ error: string | null }>;
}) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const [error, setError] = useState<string | null>(null);

  return (
    <div className="flex flex-wrap items-center gap-x-4 gap-y-2 p-3">
      <div className="min-w-0 flex-1">
        <span className="font-medium">{title}</span>
        <div className="mt-0.5 flex flex-wrap items-center gap-x-2 gap-y-1 text-xs text-muted-foreground">
          {meta.map((m, i) => (
            <span key={m + i} className="flex items-center gap-2">
              {i > 0 && <span aria-hidden>·</span>}
              <span className="capitalize">{m}</span>
            </span>
          ))}
        </div>
        {/* Inline, not an alert(): the failure an admin actually hits here is a
            name collision on a SKU, which needs reading, not dismissing. */}
        {error && <p className="mt-1 text-xs text-destructive">{error}</p>}
      </div>

      <div className="flex items-center gap-2">
        {flag && (
          <span className="inline-flex items-center gap-1 rounded-full border border-primary/40 bg-primary/10 px-2 py-0.5 text-[11px] text-primary">
            <AlertTriangle className="h-3 w-3" />
            {flag}
          </span>
        )}
        <button
          disabled={pending}
          onClick={() => {
            if (!confirm(confirmText)) return;
            setError(null);
            startTransition(async () => {
              const res = await onRestore();
              if (res.error) setError(res.error);
              else router.refresh();
            });
          }}
          className="inline-flex items-center gap-1.5 rounded-md border px-2.5 py-1 text-xs font-medium hover:bg-muted disabled:opacity-50"
        >
          <RotateCcw className="h-3.5 w-3.5" />
          {pending ? 'Restoring…' : 'Restore'}
        </button>
      </div>
    </div>
  );
}
