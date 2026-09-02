'use client';

import { useEffect } from 'react';

/*
 * Registers public/sw.js, which is what makes the app installable.
 *
 * Mounted inside the authenticated layout rather than the root one, so the
 * login and password-reset pages stay plain server-rendered HTML.
 *
 * Development deliberately does the opposite and tears any worker down: dev
 * builds serve unhashed, frequently-changing chunks under /_next/static, and a
 * worker caching those (installed by a local production build, say) breaks hot
 * reload in ways that are very hard to recognise as caching.
 */
export function RegisterServiceWorker() {
  useEffect(() => {
    if (!('serviceWorker' in navigator)) return;

    if (process.env.NODE_ENV !== 'production') {
      navigator.serviceWorker.getRegistrations().then((rs) => rs.forEach((r) => r.unregister()));
      return;
    }

    // After load, so registration never competes with the first paint.
    const register = () => {
      navigator.serviceWorker.register('/sw.js', { scope: '/' }).catch(() => {
        // Installability is an enhancement; a failed registration is not worth
        // surfacing to a planner in the middle of their work.
      });
    };

    if (document.readyState === 'complete') {
      register();
      return;
    }
    window.addEventListener('load', register);
    return () => window.removeEventListener('load', register);
  }, []);

  return null;
}
