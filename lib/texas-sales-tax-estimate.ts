/**
 * In-app estimated sales tax before checkout (flat 8.25%).
 */
export const TX_SALES_TAX_RATE = 0.0825;

/** @deprecated Use {@link TX_SALES_TAX_RATE}; kept for older imports. */
export const TX_SALES_TAX_RATE_MIN = TX_SALES_TAX_RATE;
/** @deprecated Use {@link TX_SALES_TAX_RATE}; kept for older imports. */
export const TX_SALES_TAX_RATE_MAX = TX_SALES_TAX_RATE;

/** Subtotal in whole dollars → estimated tax in cents (min/max equal at 8.25%). */
export function estimatedTaxRangeCentsFromSubtotalDollars(subtotalDollars: number): {
  minCents: number;
  maxCents: number;
} {
  const cents = Math.max(0, Math.round(subtotalDollars * 100));
  const tax = Math.round(cents * TX_SALES_TAX_RATE);
  return { minCents: tax, maxCents: tax };
}

/** Subtotal already in cents (e.g. party cart). */
export function estimatedTaxRangeCentsFromSubtotalCents(subtotalCents: number): {
  minCents: number;
  maxCents: number;
} {
  const c = Math.max(0, Math.round(subtotalCents));
  const tax = Math.round(c * TX_SALES_TAX_RATE);
  return { minCents: tax, maxCents: tax };
}

export function formatUsdRangeFromCents(minCents: number, maxCents: number): string {
  const fmt = (n: number) => `$${(Math.max(0, n) / 100).toFixed(2)}`;
  if (minCents === maxCents) return fmt(minCents);
  return `${fmt(minCents)} – ${fmt(maxCents)}`;
}
