/**
 * route → offline entry, one entry file per page under ./entries (slug =
 * route with '/' → '-'). The route list itself — titles, schema versions —
 * lives in lib/offline-routes.ts; this file only binds each route to the
 * component that renders its copy and the transform that makes it read-only.
 *
 * Imported solely by the offline viewer, so the whole planner's client code
 * ends up in the /offline/[...route] bundle — intentional: that one page is
 * cached by the service worker and must be able to render any saved copy.
 * Never import this from an online page.
 */
import type { OfflineEntry } from './entry';

import programs from './entries/programs';
import inquiry from './entries/inquiry';
import demandPlan from './entries/demand-plan';
import poUpdate from './entries/po-update';
import harvestPlan from './entries/harvest-plan';
import buckets from './entries/buckets';
import settings from './entries/settings';
import home from './entries/home';
import annualSummary from './entries/annual-summary';
import orderBook from './entries/order-book';
import fulfilment from './entries/fulfilment';
import openToBuy from './entries/open-to-buy';
import sixtyMonth from './entries/sixty-month';
import revenueCost from './entries/revenue-cost';
import secondaryProducts from './entries/secondary-products';
import optimizer from './entries/optimizer';
import ranking from './entries/ranking';
import inquiryManagement from './entries/inquiry-management';
import inquiries from './entries/inquiries';
import scenarios from './entries/scenarios';
import diff from './entries/diff';
import costing from './entries/costing';
import costingSaved from './entries/costing-saved';
import costingSkus from './entries/costing-skus';
import costingAssumptions from './entries/costing-assumptions';
import costingArchived from './entries/costing-archived';

export const OFFLINE_ENTRIES: Record<string, OfflineEntry> = {
  programs,
  inquiry,
  'demand-plan': demandPlan,
  'po-update': poUpdate,
  'harvest-plan': harvestPlan,
  buckets,
  settings,
  home,
  'annual-summary': annualSummary,
  'order-book': orderBook,
  fulfilment,
  'open-to-buy': openToBuy,
  'sixty-month': sixtyMonth,
  'revenue-cost': revenueCost,
  'secondary-products': secondaryProducts,
  optimizer,
  ranking,
  'inquiry-management': inquiryManagement,
  inquiries,
  scenarios,
  diff,
  costing,
  'costing/saved': costingSaved,
  'costing/skus': costingSkus,
  'costing/assumptions': costingAssumptions,
  'costing/archived': costingArchived,
};
