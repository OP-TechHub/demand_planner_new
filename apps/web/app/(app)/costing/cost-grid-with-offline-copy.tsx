'use client';

import { useEffect } from 'react';
import { saveCostGridSnapshot, requestOfflinePagesCache } from '@/lib/offline-costing';
import { CostGridClient, type CostGridProps } from './cost-grid-client';

/**
 * The online Cost Grid, which also refreshes this device's offline copy every
 * time it is opened (the business chose automatic over a manual button).
 *
 * The copy is the very props the grid renders from, so it holds nothing the
 * user could not already see: the server masked the base cost before sending
 * them. Saving runs after paint and never blocks or breaks the page.
 */
export function CostGridWithOfflineCopy({ userName, ...props }: CostGridProps & { userName: string }) {
  useEffect(() => {
    if (!props.currentUserId) return;
    saveCostGridSnapshot<CostGridProps>(props, { id: props.currentUserId, name: userName })
      .then(requestOfflinePagesCache)
      .catch(() => {});
    // Props come from the server render; a refresh re-runs this with the new set.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [props.skus, props.byVersion, props.version, props.currentUserId]);

  return <CostGridClient {...props} />;
}
