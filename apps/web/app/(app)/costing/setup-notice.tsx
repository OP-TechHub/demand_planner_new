/**
 * Shown when the costing tables exist but hold no assumption version — i.e. the
 * seed migration hasn't been applied. An empty grid reads as a bug; a missing
 * seed is not one, so say which it is.
 */
export function CostingSetupNotice() {
  return (
    <div className="mx-auto max-w-2xl rounded-lg border border-warning/30 bg-warning/10 p-5 text-sm">
      <p className="font-semibold text-warning">Costing isn&apos;t set up yet</p>
      <p className="mt-1 text-warning">
        No assumption version exists, so there is nothing to cost against. Apply the costing
        migrations, which create the tables and load the 34 SKUs, 7 size buckets, 15 destinations and
        the v11 assumptions:
      </p>
      <pre className="mt-3 overflow-x-auto rounded bg-warning/15 px-3 py-2 text-xs">npm run db:push</pre>
      <p className="mt-3 text-xs text-warning/90">
        Nothing in the demand plan changes when you do — costing has its own tables and no foreign
        keys into plans or programs.
      </p>
    </div>
  );
}
