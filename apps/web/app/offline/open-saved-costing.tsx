'use client';

import { useEffect, useState } from 'react';
import { Calculator } from 'lucide-react';
import { formatSavedAt, peekCostGridSnapshot } from '@/lib/offline-costing';

/** On the offline screen: a way into the saved Cost Grid, when this device has one. */
export function OpenSavedCosting() {
  const [saved, setSaved] = useState<{ savedAt: string } | null>(null);
  useEffect(() => {
    peekCostGridSnapshot().then(setSaved).catch(() => {});
  }, []);
  if (!saved) return null;
  return (
    <div className="mt-6">
      {/* A plain link, not next/link: a full navigation is what the service worker answers offline. */}
      <a
        href="/offline/costing"
        className="inline-flex items-center gap-2 rounded-md bg-primary px-4 py-2 text-sm font-medium text-primary-foreground transition-colors hover:bg-primary/90"
      >
        <Calculator className="h-4 w-4" />
        Open saved costing
      </a>
      <p className="mt-2 text-xs text-muted-foreground">Cost Grid saved {formatSavedAt(saved.savedAt)}</p>
    </div>
  );
}
