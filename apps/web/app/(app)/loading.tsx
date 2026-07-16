/**
 * Route-level loading skeleton shown while a page's server data resolves.
 * Generic on purpose — a title bar, KPI row, and a large panel — so it reads as
 * "content is coming" across every app page.
 */
export default function Loading() {
  return (
    <div className="mx-auto max-w-5xl space-y-6">
      <div className="space-y-2">
        <div className="h-7 w-48 animate-pulse rounded-md bg-muted" />
        <div className="h-4 w-64 animate-pulse rounded bg-muted/70" />
      </div>
      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
        {Array.from({ length: 4 }).map((_, i) => (
          <div key={i} className="h-24 animate-pulse rounded-lg border border-border bg-card" />
        ))}
      </div>
      <div className="h-72 animate-pulse rounded-lg border border-border bg-card" />
    </div>
  );
}
