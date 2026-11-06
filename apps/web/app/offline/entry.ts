import type { ComponentType } from 'react';

/**
 * How one page renders from its offline copy (app/offline/entries/<slug>.tsx,
 * collected in registry.tsx; the route list lives in lib/offline-routes.ts).
 */
export type OfflineEntry = {
  /** The page's top-level client component — the same one the online page renders. */
  Component: ComponentType<any>; // eslint-disable-line @typescript-eslint/no-explicit-any
  /**
   * Strips every ability to write before the copy is rendered: edit/approve
   * flags off, action buttons hidden. Offline copies are view-only — anything
   * in the browser (filters, view toggles, tooltips, CSV/print export) keeps
   * working, anything that would call the server must not render.
   */
  readOnly: (props: any) => any; // eslint-disable-line @typescript-eslint/no-explicit-any
};
