import type { Metadata } from 'next';
import './globals.css';

export const metadata: Metadata = {
  title: 'Oceanpick Demand Planner',
  description: 'Demand planning and scenario analysis',
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en">
      <body>{children}</body>
    </html>
  );
}
