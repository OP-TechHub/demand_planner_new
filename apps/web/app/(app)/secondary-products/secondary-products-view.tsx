'use client';

import type { ReactNode } from 'react';
import { SecondaryProductsClient, type SecondaryDef, type SourceOption } from './secondary-products-client';
import { OtherProductsClient, type OtherProduct } from './other-products-client';

/** Everything the page shows, as one serializable object — what the offline copy stores. */
export type SecondaryProductsViewProps = {
  orgId: string;
  planId: string;
  planStartDate: string;
  horizon: number;
  definitions: SecondaryDef[];
  /** Whole round consumed by each source product, per month, keyed by item_code. */
  feedstock: Record<string, number[]>;
  /** The plan's total allocated whole round per month — group 2's feedstock. */
  totalWr: number[];
  sources: SourceOption[];
  canEdit: boolean;
  products: OtherProduct[];
  /** Monthly quantity per other-product id, length === horizon. */
  quantities: Record<string, number[]>;
};

/**
 * The whole Secondary products page drawn from plain props — header, the
 * by-products grid and the Other products section — so the online page and the
 * offline copy render the same thing. `notice` is the server-rendered
 * StalePlanNotice slot; the offline entry passes nothing there.
 */
export function SecondaryProductsView({
  notice,
  orgId,
  planId,
  planStartDate,
  horizon,
  definitions,
  feedstock,
  totalWr,
  sources,
  canEdit,
  products,
  quantities,
}: SecondaryProductsViewProps & { notice?: ReactNode }) {
  return (
    <div className="space-y-4">
      <div>
        <h1 className="text-2xl font-semibold tracking-tight">Secondary products</h1>
        <p className="mt-1 text-sm text-muted-foreground">
          By-products recovered while processing a main product — quantity and the revenue they generate.
        </p>
      </div>

      {notice}

      <SecondaryProductsClient
        orgId={orgId}
        planId={planId}
        planStartDate={planStartDate}
        horizon={horizon}
        definitions={definitions}
        feedstock={feedstock}
        totalWr={totalWr}
        sources={sources}
        canEdit={canEdit}
      />

      <div className="border-t pt-6">
        <OtherProductsClient
          orgId={orgId}
          planId={planId}
          planStartDate={planStartDate}
          horizon={horizon}
          products={products}
          quantities={quantities}
          canEdit={canEdit}
        />
      </div>
    </div>
  );
}
