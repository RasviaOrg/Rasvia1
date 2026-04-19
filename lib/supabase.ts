import 'react-native-url-polyfill/auto';
import { Platform } from 'react-native';
import * as SecureStore from 'expo-secure-store';
import { createClient } from '@supabase/supabase-js';

// SecureStore is only available on native. For web / SSR (Expo Router static
// export) fall back to an in-memory (or localStorage) adapter so Supabase auth
// can still initialize without throwing.
type StorageAdapter = {
  getItem: (key: string) => Promise<string | null>;
  setItem: (key: string, value: string) => Promise<void>;
  removeItem: (key: string) => Promise<void>;
};

const ExpoSecureStoreAdapter: StorageAdapter = {
  getItem: (key) => SecureStore.getItemAsync(key),
  setItem: (key, value) => SecureStore.setItemAsync(key, value),
  removeItem: (key) => SecureStore.deleteItemAsync(key),
};

const createWebStorageAdapter = (): StorageAdapter => {
  const memory = new Map<string, string>();
  const hasLocalStorage =
    typeof globalThis !== 'undefined' &&
    typeof (globalThis as { localStorage?: Storage }).localStorage !== 'undefined';
  const ls: Storage | null = hasLocalStorage
    ? (globalThis as { localStorage: Storage }).localStorage
    : null;
  return {
    getItem: async (key) =>
      ls ? ls.getItem(key) : memory.has(key) ? (memory.get(key) ?? null) : null,
    setItem: async (key, value) => {
      if (ls) ls.setItem(key, value);
      else memory.set(key, value);
    },
    removeItem: async (key) => {
      if (ls) ls.removeItem(key);
      else memory.delete(key);
    },
  };
};

const storage: StorageAdapter =
  Platform.OS === 'web' ? createWebStorageAdapter() : ExpoSecureStoreAdapter;

const supabaseUrl = process.env.EXPO_PUBLIC_SUPABASE_URL;
const supabaseAnonKey = process.env.EXPO_PUBLIC_SUPABASE_ANON_KEY;

if (!supabaseUrl || !supabaseAnonKey) {
  throw new Error('Missing Supabase environment variables. Please check your .env file.');
}

// Supabase storage key — see https://supabase.com/docs/reference/javascript/auth-api
// Stored under `sb-<project-ref>-auth-token` in the configured storage adapter.
const projectRef = (() => {
  try {
    return new URL(supabaseUrl).hostname.split('.')[0];
  } catch {
    return '';
  }
})();

const AUTH_STORAGE_KEY = projectRef ? `sb-${projectRef}-auth-token` : null;

/**
 * Best-effort removal of the persisted Supabase auth session. Used as a
 * belt-and-suspenders cleanup when `supabase.auth.signOut({ scope: 'local' })`
 * can't run (e.g. the internal refresh promise already rejected).
 */
export async function purgeStoredSupabaseSession(): Promise<void> {
  if (!AUTH_STORAGE_KEY) return;
  try {
    await storage.removeItem(AUTH_STORAGE_KEY);
  } catch {
    // no-op: storage is best-effort
  }
}

export const supabase = createClient(supabaseUrl, supabaseAnonKey, {
  auth: {
    storage,
    autoRefreshToken: true,
    persistSession: true,
    detectSessionInUrl: false,
  },
});
