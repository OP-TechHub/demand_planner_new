'use client';

import { useEffect, useState } from 'react';
import { monthLabel } from '@oceanpick/shared';

export type OfferBasis = 'free' | 'total';

/**
 * A customer-facing availability sheet, laid out for paper: one row per month,
 * one figure — the total we can supply. Hidden on screen and revealed by the
 * print rules in globals.css, so "Save as PDF" produces the document alone.
 *
 * Deliberately free of internal vocabulary — no OTB, whole round, pipeline,
 * ranks, yields or size ranges. The customer sees finished-goods kilos they
 * could order; how we grade and source it is ours.
 */
export function OfferSheet({
  customer,
  productLabel,
  planStartDate,
  months,
  /** Finished goods available, keyed by month index — summed across size ranges. */
  fgByMonth: fg,
  basis,
  reference,
}: {
  customer: string;
  productLabel: string;
  planStartDate: string;
  months: number[];
  fgByMonth: Record<number, number>;
  basis: OfferBasis;
  reference: string;
}) {
  // Set after mount: rendering a date during SSR and again on the client would
  // hydrate mismatched.
  const [prepared, setPrepared] = useState('');
  useEffect(() => {
    setPrepared(new Date().toLocaleDateString(undefined, { year: 'numeric', month: 'long', day: 'numeric' }));
  }, []);

  const n0 = (v: number) => Math.round(v).toLocaleString();
  // Only months we can actually offer something in — a page of zeroes helps nobody.
  const live = months.filter((m) => (fg[m] ?? 0) >= 1);
  const grand = live.reduce((s, m) => s + (fg[m] ?? 0), 0);

  return (
    <div id="offer-sheet" className="hidden bg-white p-8 text-[11pt] text-black print:block">
      <div className="flex items-start justify-between border-b-2 border-black pb-3">
        <div>
          <h1 className="text-[18pt] font-bold leading-tight">Product Availability</h1>
          <p className="mt-0.5 text-[10pt]">Indicative supply schedule</p>
        </div>
        <div className="text-right text-[9pt] leading-snug">
          <div>Reference: <span className="font-semibold">{reference}</span></div>
          {prepared && <div>Prepared: {prepared}</div>}
        </div>
      </div>

      <table className="mt-4 w-full text-[10pt]">
        <tbody>
          <tr>
            <td className="w-28 py-0.5 align-top font-semibold">Customer</td>
            <td className="py-0.5">{customer}</td>
          </tr>
          <tr>
            <td className="py-0.5 align-top font-semibold">Product</td>
            <td className="py-0.5">{productLabel}</td>
          </tr>
          <tr>
            <td className="py-0.5 align-top font-semibold">Basis</td>
            <td className="py-0.5">
              {basis === 'free'
                ? 'Uncommitted capacity available for immediate order'
                : 'Uncommitted capacity, plus volume currently reserved against other enquiries'}
            </td>
          </tr>
          <tr>
            <td className="py-0.5 align-top font-semibold">Units</td>
            <td className="py-0.5">Kilograms, finished product</td>
          </tr>
        </tbody>
      </table>

      {live.length === 0 ? (
        <p className="mt-6 text-[10pt] italic">
          No availability in the current schedule for this product. Please contact us to discuss alternatives.
        </p>
      ) : (
        <table className="mt-5 w-full max-w-md border-collapse text-[10pt]">
          <thead>
            <tr className="border-y border-black">
              <th className="py-1.5 pr-3 text-left font-semibold">Month</th>
              <th className="py-1.5 pl-3 text-right font-semibold">Available (kg)</th>
            </tr>
          </thead>
          <tbody>
            {live.map((m) => (
              <tr key={m} className="border-b border-neutral-300">
                <td className="py-1 pr-3">{monthLabel(planStartDate, m)}</td>
                <td className="py-1 pl-3 text-right tabular-nums">{n0(fg[m] ?? 0)}</td>
              </tr>
            ))}
            <tr className="border-y-2 border-black font-bold">
              <td className="py-1.5 pr-3">Total</td>
              <td className="py-1.5 pl-3 text-right tabular-nums">{n0(grand)}</td>
            </tr>
          </tbody>
        </table>
      )}

      <div className="mt-6 border-t border-neutral-400 pt-3 text-[8.5pt] leading-relaxed">
        <p className="font-semibold">Terms</p>
        <p className="mt-1">
          Quantities shown are indicative availability from the current harvest schedule and are not a reservation.
          Availability is offered subject to prior sale and to written confirmation of order. Volumes may vary with
          harvest performance and grading outturn. Pricing, packaging, and delivery terms are quoted separately.
          {basis === 'total' && ' Some volume shown is currently reserved against other enquiries and may not be released.'}
        </p>
      </div>
    </div>
  );
}
