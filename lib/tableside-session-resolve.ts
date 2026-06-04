import type { SupabaseClient } from '@supabase/supabase-js';

export type TablesideResolveInput =
  | { table_code: string }
  | { restaurant_id: number; table_label: string };

const ERROR_MESSAGES: Record<string, string> = {
  invalid_table_code: 'This table link is invalid. Please rescan the QR code.',
  table_not_found: 'This table is not set up yet. Ask your server or scan the QR on your table.',
  restaurant_not_found: 'This restaurant could not be found.',
  restaurant_inactive: 'This restaurant is not accepting orders right now.',
  invalid_restaurant_id: 'This table link is invalid. Please rescan the QR code.',
  invalid_table_label: 'This table link is invalid. Please rescan the QR code.',
  rate_limited: 'Too many attempts. Please wait a moment and try again.',
  resolve_failed: 'Could not start your table order. Please try again.',
  lookup_failed: 'Could not look up this table. Please try again in a moment.',
  server_misconfigured: 'Table ordering is temporarily unavailable. Please ask your server.',
};

function messageForErrorCode(code: string | undefined, fallback: string): string {
  if (!code) return fallback;
  return ERROR_MESSAGES[code] ?? fallback;
}

async function extractEdgeErrorMessage(err: unknown): Promise<string> {
  const fallback = err instanceof Error ? err.message : 'Could not open this table.';
  const context = (err as { context?: Response } | null)?.context;
  if (!context || typeof context.clone !== 'function') {
    return fallback.includes('non-2xx')
      ? 'Could not reach table ordering. Try again in a moment.'
      : fallback;
  }
  try {
    const body = await context.clone().json();
    if (body && typeof body === 'object' && 'error' in body && body.error) {
      return messageForErrorCode(String((body as { error: unknown }).error), fallback);
    }
  } catch {
    // not json
  }
  try {
    const text = await context.clone().text();
    if (text) {
      try {
        const parsed = JSON.parse(text) as { error?: string };
        if (parsed?.error) return messageForErrorCode(parsed.error, text);
      } catch {
        return text;
      }
    }
  } catch {
    // ignore
  }
  return fallback;
}

async function resolveViaEdge(
  supabase: SupabaseClient,
  input: TablesideResolveInput,
): Promise<string> {
  const { data, error } = await supabase.functions.invoke('tableside-session', { body: input });
  if (error) {
    throw new Error(await extractEdgeErrorMessage(error));
  }
  const sessionId = (data as { sessionId?: string; error?: string } | null)?.sessionId;
  if (sessionId) return sessionId;
  const errCode = (data as { error?: string } | null)?.error;
  throw new Error(messageForErrorCode(errCode, 'Could not open this table.'));
}

async function resolveViaRpc(supabase: SupabaseClient, tableCode: string): Promise<string> {
  const { data, error } = await supabase.rpc('tableside_resolve_by_code', { p_code: tableCode });
  if (error) {
    const msg = error.message ?? '';
    if (msg.includes('table_not_found') || msg.includes('invalid_table_code')) {
      throw new Error(ERROR_MESSAGES.table_not_found);
    }
    throw new Error(msg || 'Could not open this table.');
  }
  const sessionId = (data as { session_id?: string } | null)?.session_id;
  if (!sessionId) {
    throw new Error('Could not open this table. Please try again.');
  }
  return sessionId;
}

export async function resolveTablesideSession(
  supabase: SupabaseClient,
  input: TablesideResolveInput,
): Promise<string> {
  if ('table_code' in input) {
    try {
      return await resolveViaEdge(supabase, input);
    } catch (edgeErr) {
      try {
        return await resolveViaRpc(supabase, input.table_code);
      } catch (rpcErr) {
        throw rpcErr instanceof Error ? rpcErr : edgeErr;
      }
    }
  }
  return resolveViaEdge(supabase, input);
}
