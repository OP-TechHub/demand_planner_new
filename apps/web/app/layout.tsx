import type { Metadata } from 'next';
import './globals.css';

export const metadata: Metadata = {
  title: 'Oceanpick Demand Planner',
  description: 'Demand planning and scenario analysis',
};

/*
 * Sets the theme class on <html> before first paint, so there's no flash of the
 * wrong theme. Reads the saved choice, falling back to the OS preference.
 * Kept inline (no dependency) and tiny on purpose.
 */
const themeInit = `(function(){try{var t=localStorage.getItem('op-theme');if(t==='dark'||(!t&&window.matchMedia('(prefers-color-scheme: dark)').matches)){document.documentElement.classList.add('dark');}}catch(e){}})();`;

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en" suppressHydrationWarning>
      <head>
        <script dangerouslySetInnerHTML={{ __html: themeInit }} />
      </head>
      <body>{children}</body>
    </html>
  );
}
