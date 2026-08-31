'use client';

import { useEffect, useState } from 'react';
import type { CSSProperties } from 'react';

/**
 * Shared furniture for the printable / Word-exportable costing documents:
 * the saved-line breakdown and the SKU editor's live sheet.
 *
 * Styling is INLINE rather than Tailwind on purpose. The Word export is the
 * sheet element's own outerHTML, and a class name means nothing once the
 * document leaves the app — inline styles travel with it.
 */

/** The id the print rules in globals.css reveal, and the Word export reads. */
export const COST_SHEET_ID = 'cost-sheet';

/** Number out of an unknown, without turning a missing value into a zero. */
export const num = (v: unknown): number | null =>
  typeof v === 'number' && Number.isFinite(v) ? v : null;

export const rec = (v: unknown): Record<string, unknown> =>
  v && typeof v === 'object' ? (v as Record<string, unknown>) : {};

/** LKR reads as whole rupees; USD needs its cents. */
export const moneyFor = (domestic: boolean) =>
  domestic ? (n: number) => Math.round(n).toLocaleString() : (n: number) => n.toFixed(2);

export const asPct = (v: number | null): string =>
  v == null ? '—' : `${(v * 100).toFixed(v * 100 < 10 ? 1 : 0)}%`;

/** Today, formatted after mount — SSR and client would otherwise disagree. */
export function usePreparedDate(): string {
  const [prepared, setPrepared] = useState('');
  useEffect(() => {
    setPrepared(new Date().toLocaleDateString(undefined, { year: 'numeric', month: 'long', day: 'numeric' }));
  }, []);
  return prepared;
}

export function SheetHeader({
  title,
  subtitle,
  reference,
  authorName,
}: {
  title: string;
  subtitle: string;
  reference: string;
  authorName?: string | null;
}) {
  const prepared = usePreparedDate();
  return (
    <div style={S.head}>
      <div>
        <h1 style={S.h1}>{title}</h1>
        <p style={S.sub}>{subtitle}</p>
      </div>
      <div style={S.headRight}>
        <div>
          Reference: <strong>{reference}</strong>
        </div>
        {prepared && <div>Prepared: {prepared}</div>}
        {authorName && <div>By: {authorName}</div>}
      </div>
    </div>
  );
}

export function Meta({ label, value }: { label: string; value: string }) {
  return (
    <tr>
      <td style={S.metaLabel}>{label}</td>
      <td style={S.metaValue}>{value}</td>
    </tr>
  );
}

/** One line of a money table. A null value prints an em dash, never a zero. */
export function Row({
  label,
  value,
  fmt,
  subtotal,
  total,
  emphasis,
}: {
  label: string;
  value: number | null;
  fmt: (n: number) => string;
  subtotal?: boolean;
  total?: boolean;
  emphasis?: boolean;
}) {
  const cell = total ? S.tdTotal : subtotal ? S.tdSubtotal : S.td;
  const strong = total || subtotal || emphasis;
  return (
    <tr>
      <td style={{ ...cell, ...(strong ? S.strong : null) }}>{label}</td>
      <td style={{ ...cell, ...S.tdNum, ...(strong ? S.strong : null) }}>{value == null ? '—' : fmt(value)}</td>
    </tr>
  );
}

export function SheetFooter({ children }: { children: React.ReactNode }) {
  return (
    <div style={S.footer}>
      <p style={S.footerStrong}>Internal — commercially confidential</p>
      <p style={S.footerText}>{children}</p>
    </div>
  );
}

export const S: Record<string, CSSProperties> = {
  sheet: {
    background: '#ffffff',
    color: '#000000',
    padding: '28px 32px',
    fontFamily: 'Calibri, Arial, Helvetica, sans-serif',
    fontSize: '11pt',
    lineHeight: 1.35,
  },
  head: {
    display: 'flex',
    alignItems: 'flex-start',
    justifyContent: 'space-between',
    borderBottom: '2px solid #000000',
    paddingBottom: '10px',
  },
  h1: { fontSize: '18pt', fontWeight: 700, margin: 0, lineHeight: 1.1 },
  sub: { fontSize: '10pt', margin: '2px 0 0' },
  headRight: { fontSize: '9pt', textAlign: 'right', lineHeight: 1.5 },
  h2: {
    fontSize: '11pt',
    fontWeight: 700,
    textTransform: 'uppercase',
    letterSpacing: '0.04em',
    margin: '20px 0 6px',
  },
  h3: { fontSize: '10pt', fontWeight: 700, margin: '14px 0 4px' },
  metaTable: { width: '100%', borderCollapse: 'collapse', marginTop: '14px', fontSize: '10pt' },
  metaLabel: { width: '150px', padding: '2px 0', verticalAlign: 'top', fontWeight: 600 },
  metaValue: { padding: '2px 0', verticalAlign: 'top' },
  table: { width: '100%', borderCollapse: 'collapse', fontSize: '10pt' },
  td: { padding: '4px 0', borderBottom: '1px solid #d4d4d4' },
  tdSubtotal: { padding: '4px 0', borderTop: '1px solid #000000', borderBottom: '1px solid #d4d4d4' },
  tdTotal: { padding: '6px 0', borderTop: '2px solid #000000', borderBottom: '2px solid #000000' },
  tdNum: { textAlign: 'right', whiteSpace: 'nowrap', width: '120px' },
  th: { padding: '4px 0', borderBottom: '1px solid #000000', textAlign: 'left', fontWeight: 700 },
  thNum: { padding: '4px 0', borderBottom: '1px solid #000000', textAlign: 'right', fontWeight: 700, whiteSpace: 'nowrap' },
  strong: { fontWeight: 700 },
  note: {
    fontSize: '9pt',
    marginTop: '14px',
    padding: '8px 10px',
    border: '1px solid #a3a3a3',
    background: '#f5f5f5',
  },
  footer: { marginTop: '22px', borderTop: '1px solid #a3a3a3', paddingTop: '8px' },
  footerStrong: { fontSize: '8.5pt', fontWeight: 700, margin: 0 },
  footerText: { fontSize: '8.5pt', margin: '3px 0 0', lineHeight: 1.5 },
};
