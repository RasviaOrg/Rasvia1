// lib/party-credentials.ts
// SecureStore-backed persistence for a device's party_session credentials.
import * as SecureStore from 'expo-secure-store';
import type { PartyCreds } from './party-session';

function key(sessionId: string): string {
  return `rasvia_party_creds_${sessionId}`;
}

const LAST_NAME_KEY = 'rasvia_party_last_display_name';

export async function savePartyCreds(creds: PartyCreds): Promise<void> {
  try {
    await SecureStore.setItemAsync(key(creds.sessionId), JSON.stringify(creds));
  } catch {
    // SecureStore can fail on simulators; fall through.
  }
}

export async function loadPartyCreds(sessionId: string): Promise<PartyCreds | null> {
  try {
    const raw = await SecureStore.getItemAsync(key(sessionId));
    if (!raw) return null;
    const parsed = JSON.parse(raw) as PartyCreds;
    if (!parsed?.memberId || !parsed.memberToken || !parsed.sessionId) return null;
    return parsed;
  } catch {
    return null;
  }
}

export async function clearPartyCreds(sessionId: string): Promise<void> {
  try {
    await SecureStore.deleteItemAsync(key(sessionId));
  } catch {
    // ignore
  }
}

// Persist the display name a user last joined a party with so we can pre-fill
// it the next time they join a new group order. Key is device-wide, not
// session-scoped — that's the whole point.
export async function saveLastDisplayName(name: string): Promise<void> {
  try {
    const trimmed = name.trim();
    if (!trimmed) return;
    await SecureStore.setItemAsync(LAST_NAME_KEY, trimmed);
  } catch {
    // ignore
  }
}

export async function loadLastDisplayName(): Promise<string | null> {
  try {
    const raw = await SecureStore.getItemAsync(LAST_NAME_KEY);
    if (!raw) return null;
    const trimmed = raw.trim();
    return trimmed || null;
  } catch {
    return null;
  }
}
