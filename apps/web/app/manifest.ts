import type { MetadataRoute } from 'next';

/*
 * Web app manifest — served at /manifest.webmanifest.
 *
 * The goal here is a desktop app feel, not offline capability: an installed
 * window with our own icon and no browser chrome. Nothing in the planner works
 * without a connection (every page is a server component reading Supabase), so
 * we make no offline claims — see public/sw.js.
 *
 * theme_color and background_color are the light-theme --primary and
 * --background from app/globals.css. background_color is only painted during
 * the brief launch splash, so it stays light even for dark-theme users.
 */
export default function manifest(): MetadataRoute.Manifest {
  return {
    id: '/',
    name: 'Oceanpick Demand Planner',
    short_name: 'Demand Planner',
    description: 'Demand planning and scenario analysis',
    // Not '/', which only redirects: launching straight into the dashboard
    // saves the installed window a visible hop.
    start_url: '/home',
    scope: '/',
    display: 'standalone',
    theme_color: '#0a7aae',
    background_color: '#fbfdfe',
    orientation: 'any',
    categories: ['business', 'productivity'],
    // Re-launching from the taskbar focuses the window that's already open
    // instead of opening a second one — the single biggest thing separating
    // "installed site" from "app".
    launch_handler: { client_mode: 'navigate-existing' },
    icons: [
      { src: '/icon-192.png', sizes: '192x192', type: 'image/png', purpose: 'any' },
      { src: '/icon-512.png', sizes: '512x512', type: 'image/png', purpose: 'any' },
      // Kept separate from the 'any' icons: a maskable icon is drawn with
      // padding for Android's crop, and looks shrunken if reused as 'any'.
      { src: '/icon-512-maskable.png', sizes: '512x512', type: 'image/png', purpose: 'maskable' },
    ],
    shortcuts: [
      { name: 'Demand Plan', url: '/demand-plan' },
      { name: 'Harvest Plan', url: '/harvest-plan' },
      { name: 'Order Book', url: '/order-book' },
    ],
  };
}
