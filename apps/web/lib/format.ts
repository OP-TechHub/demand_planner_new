export const kg = (n: number | null): string =>
  n == null ? '—' : Math.abs(n) >= 1e6 ? (n / 1e6).toFixed(2) + 'M' : Math.abs(n) >= 1e3 ? (n / 1e3).toFixed(0) + 'k' : String(Math.round(n));

export const usd = (n: number | null): string =>
  n == null ? '—' : Math.abs(n) >= 1e6 ? '$' + (n / 1e6).toFixed(1) + 'M' : '$' + Math.round(n).toLocaleString();

/** Dollars in full, never abbreviated to $1.2M — for grids read figure by figure. */
export const usd0 = (n: number | null): string => (n == null ? '—' : '$' + Math.round(n).toLocaleString());

/**
 * Dollars to the cent — for unit rates ($/kg), where rounding to the dollar
 * would throw away most of the number.
 */
export const usd2 = (n: number | null): string =>
  n == null ? '—' : '$' + n.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 });

export const pct = (n: number | null): string => (n == null ? '—' : (n * 100).toFixed(1) + '%');

export const num0 = (n: number | null): string => (n == null ? '—' : Math.round(n).toLocaleString());
