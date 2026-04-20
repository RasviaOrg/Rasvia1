// lib/party-active.ts
//
// Device-local index of party session ids the current user is actively
// participating in (either as host or guest). `lib/party-credentials.ts`
// stores creds *keyed* by sessionId but has no way to list them, so the home
// screen couldn't tell you "you're in a group order at restaurant X right now"
// without first having the session id. This module fills that gap.
//
// Storage: a single SecureStore entry holding a JSON array of session ids.
// Callers can also subscribe() for in-memory change notifications so the home
// banner can refresh without polling.
import * as SecureStore from "expo-secure-store";

const STORAGE_KEY = "rasvia_party_active_sessions";

type Listener = () => void;
const listeners = new Set<Listener>();

function notify() {
  // Notify on next tick so callers that trigger notify() during render don't
  // end up in a setState-during-render loop.
  setTimeout(() => {
    listeners.forEach((l) => {
      try { l(); } catch { /* ignore */ }
    });
  }, 0);
}

async function readRaw(): Promise<string[]> {
  try {
    const raw = await SecureStore.getItemAsync(STORAGE_KEY);
    if (!raw) return [];
    const parsed = JSON.parse(raw);
    if (!Array.isArray(parsed)) return [];
    return parsed
      .map((v) => (typeof v === "string" ? v.trim() : ""))
      .filter((v) => v.length > 0);
  } catch {
    return [];
  }
}

async function writeRaw(ids: string[]): Promise<void> {
  try {
    const unique = Array.from(new Set(ids.filter((id) => !!id)));
    await SecureStore.setItemAsync(STORAGE_KEY, JSON.stringify(unique));
  } catch {
    // SecureStore can fail on simulators; surface silently.
  }
}

export async function loadActiveParties(): Promise<string[]> {
  return readRaw();
}

export async function addActiveParty(sessionId: string): Promise<void> {
  if (!sessionId) return;
  const current = await readRaw();
  if (current.includes(sessionId)) return;
  await writeRaw([...current, sessionId]);
  notify();
}

export async function removeActiveParty(sessionId: string): Promise<void> {
  if (!sessionId) return;
  const current = await readRaw();
  const next = current.filter((id) => id !== sessionId);
  if (next.length === current.length) return;
  await writeRaw(next);
  notify();
}

export async function clearActiveParties(): Promise<void> {
  await writeRaw([]);
  notify();
}

/**
 * Subscribe to changes in the active-party list. Returns an unsubscribe
 * function. Listeners are called *after* writes have been persisted.
 */
export function subscribeActiveParties(cb: Listener): () => void {
  listeners.add(cb);
  return () => {
    listeners.delete(cb);
  };
}
