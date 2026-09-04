'use client';

import { useMemo } from 'react';
import type { CostSkuRow } from '@oceanpick/shared';
import { cn } from '@/lib/utils';

/**
 * Which author's SKUs to show, shared by the Cost Grid and the Costing SKUs page.
 *
 * `all` and `mine` are fixed; anything else is a creator's user id, or the
 * literal `company` for the seeded workbook recipes, which have no creator. A
 * person picker rather than fixed buckets: the useful question here is "whose
 * is this", and the answer is a name, not a category.
 */
export type CostedBy = string;

export const COSTED_BY_ALL: CostedBy = 'all';
export const COSTED_BY_MINE: CostedBy = 'mine';
export const COSTED_BY_COMPANY: CostedBy = 'company';

/** The one place the filter is applied, so both pages agree on what it means. */
export function matchesCostedBy(
  sku: CostSkuRow,
  value: CostedBy,
  currentUserId: string | null
): boolean {
  if (value === COSTED_BY_ALL) return true;
  if (value === COSTED_BY_MINE) return currentUserId != null && sku.created_by === currentUserId;
  if (value === COSTED_BY_COMPANY) return sku.created_by == null;
  return sku.created_by === value;
}

interface Option {
  value: CostedBy;
  label: string;
  count: number;
}

/**
 * Everyone who has made a SKU, with their tallies — built from the SKUs rather
 * than the user list, so someone who has never added one is not offered as a
 * filter that would come back empty.
 */
function useOptions(
  skus: CostSkuRow[],
  currentUserId: string | null,
  authors: Record<string, string>
): Option[] {
  return useMemo(() => {
    let company = 0;
    let mine = 0;
    const byUser = new Map<string, number>();

    for (const s of skus) {
      if (s.created_by == null) company++;
      else if (s.created_by === currentUserId) mine++;
      else byUser.set(s.created_by, (byUser.get(s.created_by) ?? 0) + 1);
    }

    const others = [...byUser.entries()]
      .map(([id, count]) => ({ value: id, label: authors[id] ?? 'Unknown', count }))
      .sort((a, b) => a.label.localeCompare(b.label));

    return [
      { value: COSTED_BY_ALL, label: 'Everyone', count: skus.length },
      // Offered even at zero: seeing "Created by me (0)" answers "where are
      // mine?" outright, where a missing entry just looks like a bug.
      ...(currentUserId ? [{ value: COSTED_BY_MINE, label: 'Created by me', count: mine }] : []),
      ...(company > 0 ? [{ value: COSTED_BY_COMPANY, label: 'Company recipes', count: company }] : []),
      ...others,
    ];
  }, [skus, currentUserId, authors]);
}

export function CostedByFilter({
  skus,
  currentUserId,
  authors,
  value,
  onChange,
  className,
}: {
  /** The full list, not the filtered one — the counts must not move as you pick. */
  skus: CostSkuRow[];
  currentUserId: string | null;
  authors: Record<string, string>;
  value: CostedBy;
  onChange: (v: CostedBy) => void;
  className?: string;
}) {
  const options = useOptions(skus, currentUserId, authors);

  return (
    <label className={cn('inline-flex items-center gap-1.5 text-xs', className)}>
      <span className="text-muted-foreground">Costed by</span>
      <select
        value={value}
        onChange={(e) => onChange(e.target.value)}
        aria-label="Filter by who costed the SKU"
        className={cn(
          'rounded-md border bg-background px-2 py-1 text-xs',
          value !== COSTED_BY_ALL && 'border-primary text-primary'
        )}
      >
        {options.map((o) => (
          <option key={o.value} value={o.value}>
            {o.label} ({o.count})
          </option>
        ))}
      </select>
    </label>
  );
}
