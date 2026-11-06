'use client';

import { useTransition, type ReactNode } from 'react';
import { clearOfflineData } from '@/lib/offline-snapshots';
import { logout } from '@/app/login/actions';

/**
 * Signs out after deleting this device's offline copies (the business chose
 * "delete on sign-out"). The wipe is awaited first, because the sign-out
 * redirect would otherwise navigate away before it finished.
 */
export function SignOutButton({ className, children }: { className?: string; children: ReactNode }) {
  const [pending, start] = useTransition();
  return (
    <button
      type="button"
      className={className}
      disabled={pending}
      onClick={() =>
        start(async () => {
          await clearOfflineData().catch(() => {});
          await logout();
        })
      }
    >
      {children}
    </button>
  );
}
