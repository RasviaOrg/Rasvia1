// lib/party-credentials.ts
// SecureStore-backed persistence for a device's party_session credentials.
import * as SecureStore from 'expo-secure-store';
import type { PartyCreds } from './party-session';

function key(sessionId: string): string {
  return `rasvia_party_creds_${sessionId}`;
}

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
