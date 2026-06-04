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
const TABLE_CODE_RE = /^[A-Za-z0-9]{6,8}$/;

export type TablesideLink = { restaurantId: number; tableLabel: string };
export type TablesideCodeLink = { tableCode: string };

export type ParsedTablesideInput =
  | { kind: 'code'; tableCode: string }
  | { kind: 'legacy'; restaurantId: number; tableLabel: string };

/**
 * Parse tableside input from cart paste: full URL, path `/t/{code}`, or bare code.
 */
export function parseTablesideInputFromPastedText(raw: string): ParsedTablesideInput | null {
  const codeLink = parseTablesideCodeFromInput(raw);
  if (codeLink) return { kind: 'code', tableCode: codeLink.tableCode };
  const legacy = parseTablesideLinkFromInput(raw);
  if (legacy) return { kind: 'legacy', ...legacy };
  return null;
}

/**
 * Parse a short fixed-table link: `https://rasvia.com/t/{code}`, `rasvia://t/{code}`,
 * `/t/{code}`, or a bare 6–8 character code.
 */
export function parseTablesideCodeFromInput(raw: string): TablesideCodeLink | null {
  const trimmed = raw.trim();
  if (!trimmed) return null;

  if (TABLE_CODE_RE.test(trimmed)) {
    return { tableCode: trimmed };
  }

  const pathOnly = trimmed.match(/^(?:\/)?t\/([A-Za-z0-9]{6,8})\/?$/i);
  if (pathOnly?.[1] && TABLE_CODE_RE.test(pathOnly[1])) {
    return { tableCode: pathOnly[1] };
  }

  try {
    const normalized = trimmed.replace(/^rasvia:\/\//i, 'https://rasvia.invalid/');
    const url = new URL(normalized);
    const segments = url.pathname.replace(/^\/+|\/+$/g, '').split('/').filter(Boolean);
    const hostIsT = url.host.toLowerCase() === 't';

    let code: string | null = null;
    if (segments.length === 2 && segments[0].toLowerCase() === 't') {
      try {
        code = decodeURIComponent(segments[1]);
      } catch {
        code = segments[1];
      }
    } else if (hostIsT && segments.length === 1) {
      try {
        code = decodeURIComponent(segments[0]);
      } catch {
        code = segments[0];
      }
    } else if (segments.length === 1 && segments[0].toLowerCase() === 't' && url.search) {
      return null;
    }

    if (code && TABLE_CODE_RE.test(code)) {
      return { tableCode: code };
    }
  } catch {
    const m = trimmed.match(/(?:rasvia:\/\/|https?:\/\/[^/]+\/)t\/([A-Za-z0-9]{6,8})\b/i);
    if (m && TABLE_CODE_RE.test(m[1])) {
      return { tableCode: m[1] };
    }
  }

  return null;
}

/**
 * Parse a legacy fixed-table QR link of the form
 * `https://rasvia.com/t?r=<restaurantId>&table=<label>` or
 * `rasvia://t?r=<restaurantId>&table=<label>`.
 */
export function parseTablesideLinkFromInput(raw: string): TablesideLink | null {
  if (parseTablesideCodeFromInput(raw)) return null;

  const trimmed = raw.trim();
  if (!trimmed) return null;

  let restaurantParam: string | null = null;
  let tableParam: string | null = null;

  try {
    const normalized = trimmed.replace(/^rasvia:\/\//i, 'https://rasvia.invalid/');
    const url = new URL(normalized);
    const path = url.pathname.replace(/^\/+|\/+$/g, '').toLowerCase();
    const isTablesidePath = path === 't' || url.host.toLowerCase() === 't';
    if (!isTablesidePath) return null;
    restaurantParam = url.searchParams.get('r');
    tableParam = url.searchParams.get('table');
  } catch {
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
