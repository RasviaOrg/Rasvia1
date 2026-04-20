// lib/party-realtime.ts
// Subscribes to the three realtime channels for a party session and keeps
// a local PartySnapshot in sync via full refetches on change.
//
// MIRROR: keep in sync with RasviaWeb/src/lib/party-realtime.ts.
import type { RealtimeChannel, SupabaseClient } from '@supabase/supabase-js';
import { fetchSnapshot, type PartySnapshot } from './party-session';

export type PartyRealtimeHandle = {
  unsubscribe: () => void;
};

export function subscribeToParty(
  supabase: SupabaseClient,
  sessionId: string,
  onSnapshot: (snapshot: PartySnapshot) => void,
  onError?: (err: Error) => void,
): PartyRealtimeHandle {
  let closed = false;
  let pending: ReturnType<typeof setTimeout> | null = null;

  const refresh = () => {
    if (closed) return;
    if (pending) clearTimeout(pending);
    pending = setTimeout(async () => {
      if (closed) return;
      try {
        const snap = await fetchSnapshot(supabase, sessionId);
        if (!closed) onSnapshot(snap);
      } catch (err) {
        if (!closed) onError?.(err instanceof Error ? err : new Error(String(err)));
      }
    }, 120);
  };

  const channels: RealtimeChannel[] = [];

  // Per-subscription random suffix so each `subscribeToParty` call gets a
  // distinct channel topic. Without this, a quick unsubscribe+resubscribe on
  // the same sessionId (e.g. navigating away and back to /join/:id) can hand
  // us back the previous, still-joined channel and make `.on()` throw
  // "cannot add postgres_changes callbacks ... after subscribe()".
  const topicSuffix = Math.random().toString(36).slice(2, 8);

  channels.push(
    supabase
      .channel(`party:${sessionId}:session:${topicSuffix}`)
      .on('postgres_changes', { event: '*', schema: 'public', table: 'party_sessions', filter: `id=eq.${sessionId}` }, refresh)
      .subscribe(),
  );

  channels.push(
    supabase
      .channel(`party:${sessionId}:items:${topicSuffix}`)
      .on('postgres_changes', { event: '*', schema: 'public', table: 'party_items', filter: `session_id=eq.${sessionId}` }, refresh)
      .subscribe(),
  );

  channels.push(
    supabase
      .channel(`party:${sessionId}:ledger:${topicSuffix}`)
      .on('postgres_changes', { event: '*', schema: 'public', table: 'party_members', filter: `session_id=eq.${sessionId}` }, refresh)
      .on('postgres_changes', { event: '*', schema: 'public', table: 'party_payments', filter: `session_id=eq.${sessionId}` }, refresh)
      .subscribe(),
  );

  // Initial fetch
  refresh();

  return {
    unsubscribe: () => {
      closed = true;
      if (pending) clearTimeout(pending);
      channels.forEach((c) => {
        try { supabase.removeChannel(c); } catch { /* ignore */ }
      });
    },
  };
}
