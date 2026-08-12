'use client';

import { useTransition } from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { Radio, Lock, FileText } from 'lucide-react';
import { setActivePlan } from './plan-actions';

/**
 * Why the current scenario is (or isn't) editable, mirroring can_write_section:
 * a scenario is its owner's private sandbox, any editor may read it, and a
 * snapshot is frozen for everyone.
 *
 * Only ever applies to a SANDBOX (`is_sandbox`). An official plan carries
 * `type = 'scenario'` too — it just isn't a sandbox — and its edit rights come
 * from per-plan grants, not ownership. See OfficialPlanBanner below.
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

/**
 * An official (non-sandbox, non-master) plan — an admin-created copy such as a
 * financial-year plan. These are legitimate working plans, not someone's private
 * scenario, so the bar states what the plan IS rather than warning about it. The
 * Live plan is called out because the dashboard and the external API follow it.
 */
export function OfficialPlanBanner({
  name,
  isLive,
  isLocked,
  masterId,
}: {
  name: string;
  isLive: boolean;
  isLocked: boolean;
  masterId?: string;
}) {
  const router = useRouter();
  const [pending, start] = useTransition();

  return (
    <div
      className={
        isLive
          ? 'flex items-center justify-between border-b border-success/30 bg-success/10 px-6 py-1.5 text-sm text-success'
          : 'flex items-center justify-between border-b border-border bg-muted/40 px-6 py-1.5 text-sm text-muted-foreground'
      }
    >
      <span className="flex items-center gap-1.5">
        {isLive ? <Radio className="h-3.5 w-3.5" /> : <FileText className="h-3.5 w-3.5" />}
        <span className="font-medium">{name}</span>
        {isLive ? (
          <>is the <span className="font-medium">Live plan</span> — the dashboard and the API follow it.</>
        ) : (
          <>is an official plan.</>
        )}
        {isLocked && (
          <span className="ml-1 inline-flex items-center gap-1">
            <Lock className="h-3.5 w-3.5" /> Locked (read-only).
          </span>
        )}
      </span>
      <div className="flex items-center gap-2">
        <Link href="/diff" className="rounded-md border border-current/30 px-2 py-0.5 text-xs opacity-80 hover:opacity-100">
          Compare to master
        </Link>
        {masterId && (
          <button
            onClick={() => start(async () => { await setActivePlan(masterId); router.refresh(); })}
            disabled={pending}
            className="rounded-md border border-current/30 px-2 py-0.5 text-xs opacity-80 hover:opacity-100 disabled:opacity-50"
          >
            Switch to Master
          </button>
        )}
      </div>
    </div>
  );
}
