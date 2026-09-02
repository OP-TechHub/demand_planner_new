import type { Metadata, Viewport } from 'next';
import { Inter } from 'next/font/google';
import './globals.css';

// Inter — the UI typeface. Exposed as --font-sans, which Tailwind's font-sans
// resolves to (see tailwind.config.ts).
const inter = Inter({ subsets: ['latin'], display: 'swap', variable: '--font-sans' });

export const metadata: Metadata = {
  title: 'Oceanpick Demand Planner',
  description: 'Demand planning and scenario analysis',
  applicationName: 'Demand Planner',
  // The icons live in public/ rather than under app/, so they have to be
  // declared: Next only auto-detects the app/icon.* file convention.
  // (<link rel="manifest"> is injected automatically from app/manifest.ts.)
  icons: {
    icon: [
      { url: '/favicon.ico', sizes: 'any' },
      { url: '/icon.svg', type: 'image/svg+xml' },
      { url: '/icon-192.png', type: 'image/png', sizes: '192x192' },
    ],
    apple: '/apple-touch-icon.png',
  },
  appleWebApp: {
    capable: true,
    title: 'Demand Planner',
    statusBarStyle: 'default',
  },
};

/*
 * theme-color tints the browser and OS chrome around the app. It tracks the
 * page background (--background, light and dark) so the surrounding chrome
 * blends into the page.
 *
 * The manifest's theme_color is intentionally different: it paints the
 * installed window's title bar, where the brand blue is what makes the window
 * read as our app rather than a browser tab.
 */
export const viewport: Viewport = {
  themeColor: [
    { media: '(prefers-color-scheme: light)', color: '#fbfdfe' },
    { media: '(prefers-color-scheme: dark)', color: '#0b161e' },
  ],
};

/*
 * Sets the theme class on <html> before first paint, so there's no flash of the
 * wrong theme. Reads the saved choice, falling back to the OS preference.
 * Kept inline (no dependency) and tiny on purpose.
 */
const themeInit = `(function(){try{var t=localStorage.getItem('op-theme');if(t==='dark'||(!t&&window.matchMedia('(prefers-color-scheme: dark)').matches)){document.documentElement.classList.add('dark');}}catch(e){}})();`;

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en" className={inter.variable} suppressHydrationWarning>
      <head>
        <script dangerouslySetInnerHTML={{ __html: themeInit }} />
      </head>
      <body>{children}</body>
    </html>
  );
}
