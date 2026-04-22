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
