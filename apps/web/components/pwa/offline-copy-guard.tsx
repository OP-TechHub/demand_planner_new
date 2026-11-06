'use client';

import { useEffect } from 'react';
import { clearIfOtherUser } from '@/lib/offline-snapshots';

/**
 * Deletes the offline copies when they belong to someone other than the
 * signed-in user, so a shared device never shows one person's copies to the
 * next account, even if the first person closed the window instead of
 * signing out.
 */
export function OfflineCopyGuard({ userId }: { userId: string }) {
  useEffect(() => {
    if (userId) clearIfOtherUser(userId).catch(() => {});
  }, [userId]);
  return null;
}
