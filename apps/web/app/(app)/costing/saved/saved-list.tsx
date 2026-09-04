'use client';

import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { useMemo, useState, useTransition } from 'react';
import { AlertTriangle, Copy, Globe, Lock, Trash2 } from 'lucide-react';
import type { CostCosting } from '@oceanpick/shared';
import { cn } from '@/lib/utils';
import { deleteCosting, duplicateCosting, setCostingVisibility } from '../actions';

export interface SavedRow {
  costing: CostCosting;
  versionLabel: string;
  versionIsCurrent: boolean;
  lineCount: number;
  authorName: string;
  canEdit: boolean;
  /** Made by the signed-in user — what the Mine tab filters on. */
  isMine: boolean;
}

type Tab = 'mine' | 'all';

export function SavedList({ rows }: { rows: SavedRow[] }) {
  const mine = useMemo(() => rows.filter((r) => r.isMine), [rows]);
  // Mine is the point of the split, but opening on an empty list reads as a
  // broken page to someone who has never saved one — so a user with none starts
  // on the shared list instead.
  const [tab, setTab] = useState<Tab>(mine.length > 0 ? 'mine' : 'all');
  const shown = tab === 'mine' ? mine : rows;

  return (
    <div className="mx-auto max-w-5xl space-y-4">
      <header>
        <h1 className="text-2xl font-semibold tracking-tight">Saved costings</h1>
        <p className="mt-0.5 text-sm text-muted-foreground">
          Yours are on the first tab. Everything shared with the org is on the second, where only its
          owner can change it — copy one to work from someone else&apos;s numbers.
        </p>
      </header>

      <div className="flex gap-1 border-b">
        <TabButton active={tab === 'mine'} onClick={() => setTab('mine')}>
          Mine ({mine.length})
        </TabButton>
        <TabButton active={tab === 'all'} onClick={() => setTab('all')}>
          Everyone ({rows.length})
        </TabButton>
      </div>

      {shown.length === 0 ? (
        <div className="rounded-lg border bg-card p-8 text-center text-sm text-muted-foreground">
          You haven&apos;t saved a costing yet.
        </div>
      ) : (
        <div className="divide-y rounded-lg border bg-card">
          {shown.map((row) => (
            <Row key={row.costing.id} row={row} />
          ))}
        </div>
      )}
    </div>
  );
}

function TabButton({
  active,
  onClick,
  children,
}: {
  active: boolean;
  onClick: () => void;
  children: React.ReactNode;
}) {
  return (
    <button
      onClick={onClick}
      className={cn(
        '-mb-px border-b-2 px-3 py-1.5 text-sm',
        active
          ? 'border-primary font-medium text-foreground'
          : 'border-transparent text-muted-foreground hover:text-foreground'
      )}
    >
      {children}
    </button>
  );
}

function Row({ row }: { row: SavedRow }) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const c = row.costing;
  const overridden = Object.keys(c.assumption_overrides ?? {}).length > 0;
  const isPrivate = c.visibility === 'private';

  return (
    <div className="flex flex-wrap items-center gap-x-4 gap-y-2 p-3">
      <div className="min-w-0 flex-1">
        <Link href={`/costing/saved/${c.id}`} className="font-medium hover:underline">
          {c.name}
        </Link>
        <div className="mt-0.5 flex flex-wrap items-center gap-x-2 gap-y-1 text-xs text-muted-foreground">
          <span className="capitalize">{c.market}</span>
          <span>·</span>
          <span>{row.lineCount} lines</span>
          <span>·</span>
          <span>{row.authorName}</span>
          <span>·</span>
          <span>{new Date(c.created_at).toLocaleDateString()}</span>
        </div>
      </div>

      <div className="flex items-center gap-2">
        {/* On the badge, not only behind the toggle: an admin reading the
            Everyone tab is looking at work its author has not published, and
            that has to be obvious before they quote from it. */}
        {isPrivate && (
          <span
            className="inline-flex items-center gap-1 rounded-full border px-2 py-0.5 text-[11px] text-muted-foreground"
            title={row.isMine ? 'Only you can see this' : `Private to ${row.authorName}`}
          >
            <Lock className="h-3 w-3" />
            private
          </span>
        )}

        <span
          className={cn(
            'rounded-full border px-2 py-0.5 text-[11px]',
            row.versionIsCurrent ? 'text-muted-foreground' : 'border-warning/40 bg-warning/10 text-warning'
          )}
          title={
            row.versionIsCurrent
              ? 'Built on the assumptions that are current today'
              : 'Built on an older assumptions version — reprice to see it at today’s numbers'
          }
        >
          {row.versionLabel}
        </span>

        {/* A costing built on non-standard numbers must never be mistaken for
            one built on the company's agreed rates (Decisions §4). */}
        {overridden && (
          <span
            className="inline-flex items-center gap-1 rounded-full border border-primary/40 bg-primary/10 px-2 py-0.5 text-[11px] text-primary"
            title={Object.keys(c.assumption_overrides).join(', ')}
          >
            <AlertTriangle className="h-3 w-3" />
            custom assumptions
          </span>
        )}

        {/* Available on everyone's costings, not just your own: copying is how
            you work from someone else's numbers without overwriting a record
            they may already have sent to a customer. */}
        <button
          disabled={pending}
          onClick={() =>
            startTransition(async () => {
              const res = await duplicateCosting(c.id);
              if (res.error) alert(res.error);
              else if (res.id) router.push(`/costing/saved/${res.id}`);
            })
          }
          className="rounded p-1 text-muted-foreground hover:bg-muted hover:text-foreground"
          aria-label={`Duplicate ${c.name}`}
          title="Make my own copy of this costing"
        >
          <Copy className="h-3.5 w-3.5" />
        </button>

        {row.canEdit && (
          <button
            disabled={pending}
            onClick={() =>
              startTransition(async () => {
                const res = await setCostingVisibility(c.id, isPrivate ? 'public' : 'private');
                if (res.error) alert(res.error);
                router.refresh();
              })
            }
            className="rounded p-1 text-muted-foreground hover:bg-muted hover:text-foreground"
            aria-label={isPrivate ? `Share ${c.name} with everyone` : `Make ${c.name} private`}
            title={isPrivate ? 'Share with everyone' : 'Make private — only you will see it'}
          >
            {isPrivate ? <Globe className="h-3.5 w-3.5" /> : <Lock className="h-3.5 w-3.5" />}
          </button>
        )}

        {row.canEdit && (
          <button
            disabled={pending}
            onClick={() => {
              if (!confirm(`Delete “${c.name}”?`)) return;
              startTransition(async () => {
                const res = await deleteCosting(c.id);
                if (res.error) alert(res.error);
                router.refresh();
              });
            }}
            className="rounded p-1 text-muted-foreground hover:bg-muted hover:text-destructive"
            aria-label={`Delete ${c.name}`}
          >
            <Trash2 className="h-3.5 w-3.5" />
          </button>
        )}
      </div>
    </div>
  );
}
