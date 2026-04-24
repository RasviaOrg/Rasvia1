/**
 * In-app estimated sales tax before checkout.
 *
 * Used purely for **display** in native cart / checkout UI so the customer
 * sees an estimated tax line BEFORE being redirected to Stripe.
 * The authoritative tax is still computed server-side by `create-checkout`
 * using the restaurant's Stripe Tax Rate.
 *
 * Texas-compliant rounding:
 *  – Compute to the third decimal place
 *  – If the third decimal is ≥ 5, round up; otherwise round down
 */

/** Default Texas combined rate (state 6.25% + local cap 2.00% = 8.25%). */
export const TX_DEFAULT_TAX_RATE_BPS = 825;

/** Convert basis points to a decimal multiplier (e.g. 825 → 0.0825). */
export function bpsToDecimal(bps: number): number {
  return Math.max(0, bps) / 10000;
}

/** Format basis points as a human-readable percentage string (e.g. 825 → "8.25%"). */
export function bpsToPercentLabel(bps: number): string {
  return `${(Math.max(0, bps) / 100).toFixed(2)}%`;
}

/**
 * Resolve the effective tax rate in basis points for display purposes.
 * Falls back to TX_DEFAULT_TAX_RATE_BPS when the restaurant's configured
 * rate is 0, null, or undefined (not yet set up).
 */
export function resolveDisplayTaxRateBps(
  restaurantSalesTaxRateBps: number | null | undefined,
): number {
  const raw = Number(restaurantSalesTaxRateBps ?? 0);
  if (!Number.isFinite(raw) || raw <= 0) return TX_DEFAULT_TAX_RATE_BPS;
  return Math.round(raw);
}

/**
 * Texas-compliant rounding to the nearest cent.
 * Calculates to the third decimal (tenths of a cent):
 *  – if the third decimal is ≥ 5, round **up**
 *  – if the third decimal is ≤ 4, round **down**
 *
 * This matches standard `Math.round` behaviour on non-negative values.
 */
function texasRoundCents(cents: number): number {
  // Math.round already rounds 0.5 up for positive numbers
  return Math.round(Math.max(0, cents));
}

/**
 * Compute estimated tax in cents from a subtotal in **dollars**.
 *
 * @param subtotalDollars  Pre-tax subtotal in dollars (e.g. 16.44)
 * @param taxRateBps       Tax rate in basis points (e.g. 825 for 8.25%).
 *                         Pass 0/null/undefined to use the Texas default.
 */
export function estimatedTaxCents(
  subtotalDollars: number,
  taxRateBps?: number | null,
): number {
  const bps = resolveDisplayTaxRateBps(taxRateBps);
  const subtotalCents = Math.max(0, Math.round(subtotalDollars * 100));
  return texasRoundCents(subtotalCents * bpsToDecimal(bps));
}

/**
 * Compute estimated tax in cents from a subtotal already in **cents**.
 *
 * @param subtotalCents  Pre-tax subtotal in cents (e.g. 1644)
 * @param taxRateBps     Tax rate in basis points (e.g. 825 for 8.25%).
 */
export function estimatedTaxCentsFromCents(
  subtotalCents: number,
  taxRateBps?: number | null,
): number {
  const bps = resolveDisplayTaxRateBps(taxRateBps);
  return texasRoundCents(Math.max(0, Math.round(subtotalCents)) * bpsToDecimal(bps));
}

/** Format a cent value as a USD string (e.g. 136 → "$1.36"). */
export function formatCentsUsd(cents: number): string {
  return `$${(Math.max(0, cents) / 100).toFixed(2)}`;
}

/** Format a dollar value as a USD string (e.g. 17.80 → "$17.80"). */
export function formatDollarsUsd(dollars: number): string {
  return `$${Math.max(0, dollars).toFixed(2)}`;
}

// ──────────────────────────────────────────────────────────────
// Legacy exports — kept for backwards compatibility
// ──────────────────────────────────────────────────────────────

/** @deprecated Use {@link TX_DEFAULT_TAX_RATE_BPS}; kept for older imports. */
export const TX_SALES_TAX_RATE = 0.0825;
/** @deprecated */
export const TX_SALES_TAX_RATE_MIN = TX_SALES_TAX_RATE;
/** @deprecated */
export const TX_SALES_TAX_RATE_MAX = TX_SALES_TAX_RATE;

/** @deprecated Use {@link estimatedTaxCents} instead. */
export function estimatedTaxRangeCentsFromSubtotalDollars(subtotalDollars: number): {
  minCents: number;
  maxCents: number;
} {
  const tax = estimatedTaxCents(subtotalDollars);
  return { minCents: tax, maxCents: tax };
}

/** @deprecated Use {@link estimatedTaxCentsFromCents} instead. */
export function estimatedTaxRangeCentsFromSubtotalCents(subtotalCents: number): {
  minCents: number;
  maxCents: number;
} {
  const tax = estimatedTaxCentsFromCents(subtotalCents);
  return { minCents: tax, maxCents: tax };
}

/** @deprecated Use {@link formatCentsUsd} instead. */
export function formatUsdRangeFromCents(minCents: number, maxCents: number): string {
  const fmt = (n: number) => `$${(Math.max(0, n) / 100).toFixed(2)}`;
  if (minCents === maxCents) return fmt(minCents);
  return `${fmt(minCents)} – ${fmt(maxCents)}`;
}
