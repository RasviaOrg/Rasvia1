import type { SupabaseClient } from '@supabase/supabase-js';
import {
  parsePartySessionIdFromInput,
  parseTablesideInputFromPastedText,
} from '@/lib/parse-party-session-input';
import { resolveTablesideSession } from '@/lib/tableside-session-resolve';

/**
 * Resolve pasted cart input to a party session id: join link UUID, tableside URL,
 * bare table code, or legacy `/t?r=&table=` link.
 */
export async function resolveJoinSessionIdFromInput(
  supabase: SupabaseClient,
  raw: string,
): Promise<string | null> {
  const trimmed = raw.trim();
  if (!trimmed) return null;

  const directSessionId = parsePartySessionIdFromInput(trimmed);
  if (directSessionId) return directSessionId;

  const tableside = parseTablesideInputFromPastedText(trimmed);
  if (!tableside) return null;

  if (tableside.kind === 'code') {
    return resolveTablesideSession(supabase, { table_code: tableside.tableCode });
  }
  return resolveTablesideSession(supabase, {
    restaurant_id: tableside.restaurantId,
    table_label: tableside.tableLabel,
  });
}
