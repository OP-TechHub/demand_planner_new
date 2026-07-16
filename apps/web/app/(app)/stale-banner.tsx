import { AlertTriangle } from 'lucide-react';
import { getPlanFreshness } from '@/lib/plan-freshness';
import { RecalculateButton } from './recalculate-button';

/**
 * Server component that self-checks freshness and, when the outputs exist but
 * are out of date vs the latest input edit, renders a recalculate prompt.
 * Renders nothing when results are fresh — or when never computed (each output
 * page already shows its own NotComputed empty state for that case).
 */
export async function StalePlanNotice({
  planId,
  lastComputedAt,
}: {
  planId: string;
  lastComputedAt: string | null;
}) {
  const fresh = await getPlanFreshness(planId, lastComputedAt);
  if (!fresh.stale || !fresh.computed) return null;

  return (
    <div className="flex flex-wrap items-center justify-between gap-3 rounded-lg border border-warning/30 bg-warning/10 px-4 py-3 text-sm">
      <div className="flex items-center gap-2 text-warning">
        <AlertTriangle className="h-4 w-4 shrink-0" />
        <span>Inputs changed since the last calculation — the results below are out of date.</span>
      </div>
      <RecalculateButton planId={planId} label="Recalculate" />
    </div>
  );
}
