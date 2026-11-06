'use client';

import { useEffect } from 'react';
import { clearIfOtherUser } from '@/lib/offline-costing';

/**
 * Deletes the offline Cost Grid copy when it belongs to someone other than the
 * signed-in user, so a shared device never shows one person's copy to the next
 * account, even if the first person closed the window instead of signing out.
 */
export function OfflineCopyGuard({ userId }: { userId: string }) {
  useEffect(() => {
    if (userId) clearIfOtherUser(userId).catch(() => {});
  }, [userId]);
  return null;
}
