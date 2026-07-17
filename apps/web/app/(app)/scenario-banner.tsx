'use client';

import { useTransition } from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { setActivePlan } from './plan-actions';

/**
 * Why the current scenario is (or isn't) editable, mirroring can_write_section:
 * a scenario is its owner's private sandbox, any editor may read it, and a
 * snapshot is frozen for everyone.
 */
export type ScenarioAccess = 'owner' | 'foreign' | 'locked';

export function ScenarioBanner({
  name,
  masterId,
  access,
  ownerName,
}: {
  name: string;
  masterId: string;
  access: ScenarioAccess;
  ownerName?: string;
}) {
  const router = useRouter();
  const [pending, start] = useTransition();
  const owner = ownerName || 'another user';

  return (
    <div className="flex items-center justify-between border-b border-warning/30 bg-warning/10 px-6 py-1.5 text-sm text-warning">
      {access === 'locked' ? (
        <span>
          🔒 <span className="font-medium">{name}</span> is a read-only snapshot — it can&apos;t be
          edited. Switch to the master plan to make changes.
        </span>
      ) : access === 'foreign' ? (
        <span>
          👁 <span className="font-medium">{name}</span> is {owner}&apos;s scenario — you can view it,
          but only {owner} can edit it.
        </span>
      ) : (
        <span>
          📎 Viewing scenario: <span className="font-medium">{name}</span> — edits here don&apos;t
          affect the master plan.
        </span>
      )}
      <div className="flex items-center gap-2">
        {access !== 'locked' && (
          <Link href="/diff" className="rounded-md border border-warning/40 px-2 py-0.5 text-xs hover:bg-warning/15">
            Compare to master
          </Link>
        )}
        <button
          onClick={() => start(async () => { await setActivePlan(masterId); router.refresh(); })}
          disabled={pending}
          className="rounded-md border border-warning/40 px-2 py-0.5 text-xs hover:bg-warning/15 disabled:opacity-50"
        >
          Switch to Master
        </button>
      </div>
    </div>
  );
}
