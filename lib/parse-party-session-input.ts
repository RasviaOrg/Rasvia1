/** Parse a pasted group-order id or join URL (web or app deep link). */
export function parsePartySessionIdFromInput(raw: string): string | null {
  const trimmed = raw.trim();
  if (!trimmed) return null;
  const uuidLoose = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
  if (uuidLoose.test(trimmed)) return trimmed.toLowerCase();

  const q = trimmed.match(/[?&#]id=([0-9a-f-]{36})/i);
  if (q && uuidLoose.test(q[1])) return q[1].toLowerCase();

  const pathJoin = trimmed.match(/\/join\/([0-9a-f-]{36})/i);
  if (pathJoin && uuidLoose.test(pathJoin[1])) return pathJoin[1].toLowerCase();

  const deep = trimmed.match(/rasvia:\/\/join\/([0-9a-f-]{36})/i);
  if (deep && uuidLoose.test(deep[1])) return deep[1].toLowerCase();

  const any = trimmed.match(/[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/i);
  if (any && uuidLoose.test(any[0])) return any[0].toLowerCase();

  return null;
}

/** Cap matching the server-side `table_label` normalization (32 chars). */
const MAX_TABLE_LABEL_LEN = 32;

export type TablesideLink = { restaurantId: number; tableLabel: string };

/**
 * Parse a fixed-table QR link of the form
 * `https://rasvia.com/t?r=<restaurantId>&table=<label>` or
 * `rasvia://t?r=<restaurantId>&table=<label>`.
 *
 * Returns `null` when the link is not a `/t` link or is missing/invalid
 * `r` / `table` params, so a bad link never crashes the deep-link handler.
 * The edge function re-validates + normalizes the label server-side; we only
 * do light client-side sanitisation (trim, collapse whitespace, length cap).
 */
export function parseTablesideLinkFromInput(raw: string): TablesideLink | null {
  const trimmed = raw.trim();
  if (!trimmed) return null;

  let restaurantParam: string | null = null;
  let tableParam: string | null = null;

  // Prefer the URL/URLSearchParams parser when possible (handles encoding).
  try {
    const normalized = trimmed.replace(/^rasvia:\/\//i, 'https://rasvia.invalid/');
    const url = new URL(normalized);
    const path = url.pathname.replace(/^\/+|\/+$/g, '').toLowerCase();
    // For `rasvia://t?...` the host becomes the path segment; for
    // `https://rasvia.com/t?...` the path is `/t`. Accept either.
    const isTablesidePath = path === 't' || url.host.toLowerCase() === 't';
    if (!isTablesidePath) return null;
    restaurantParam = url.searchParams.get('r');
    tableParam = url.searchParams.get('table');
  } catch {
    // Fall back to a regex scan for malformed inputs.
    if (!/[?&#/](t)\b|rasvia:\/\/t\b|\/t\?/i.test(trimmed)) return null;
    const r = trimmed.match(/[?&#]r=([^&#]+)/i);
    const t = trimmed.match(/[?&#]table=([^&#]+)/i);
    restaurantParam = r ? decodeURIComponent(r[1]) : null;
    tableParam = t ? decodeURIComponent(t[1]) : null;
  }

  if (!restaurantParam || !tableParam) return null;

  const restaurantId = Number.parseInt(restaurantParam, 10);
  if (!Number.isInteger(restaurantId) || restaurantId <= 0) return null;

  const tableLabel = tableParam.replace(/\s+/g, ' ').trim().slice(0, MAX_TABLE_LABEL_LEN);
  if (!tableLabel) return null;

  return { restaurantId, tableLabel };
}
