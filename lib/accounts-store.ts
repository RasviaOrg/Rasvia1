/**
 * Account-switching storage layer.
 *
 * We split saved-account metadata into two stores so we stay inside
 * expo-secure-store's recommended <2 KB envelope (large blobs get slow on
 * Android EncryptedSharedPreferences and can be truncated silently on some
 * OEMs):
 *
 *   - AsyncStorage (fast, unencrypted):
 *       * Per-user list of account "profiles" (email, fullName, role, id).
 *       * `switched_in_from` marker (just a user id, no secrets).
 *
 *   - SecureStore (OS keychain / EncryptedSharedPreferences):
 *       * One entry per account id, holding only the password. Keys are
 *         short and values are tiny, so we stay well under 2 KB each.
 *
 * Callers interact with `SavedAccount` objects that stitch both halves
 * back together. When a password can't be recovered from SecureStore we
 * fall back to an empty string and surface the issue at call time.
 *
 * A one-shot migration copies the legacy "one big JSON blob per user"
 * payload from SecureStore (prior storage shape) into the split layout
 * and deletes the original blob so the warning stops firing.
 */
import AsyncStorage from "@react-native-async-storage/async-storage";
import * as SecureStore from "expo-secure-store";

export type SavedAccount = {
  email: string;
  passwordPlain: string;
  fullName: string;
  role: string | null;
  id: string;
};

type StoredAccountProfile = Omit<SavedAccount, "passwordPlain">;

const LEGACY_SAVED_ACCOUNTS_KEY = "rasvia.saved_accounts";

function savedProfilesKey(userId: string) {
  return `rasvia.account_profiles.${userId}`;
}
function selfProfileKey(userId: string) {
  return `rasvia.self_account_profile.${userId}`;
}
function switchedInFromKey(userId: string) {
  return `rasvia.switched_in_from.${userId}`;
}
function accountPasswordKey(accountId: string) {
  /**
   * SecureStore keys can't contain dashes on some Android builds and the
   * Supabase user id format uses them. Normalize by replacing with
   * underscores; collisions are impossible because UUIDs are fully
   * disambiguated by the other characters.
   */
  return `rasvia.account_pw.${accountId.replace(/-/g, "_")}`;
}

async function getPassword(accountId: string): Promise<string> {
  try {
    const raw = await SecureStore.getItemAsync(accountPasswordKey(accountId));
    return raw ?? "";
  } catch {
    return "";
  }
}

async function setPassword(accountId: string, password: string): Promise<void> {
  await SecureStore.setItemAsync(accountPasswordKey(accountId), password);
}

async function deletePassword(accountId: string): Promise<void> {
  try {
    await SecureStore.deleteItemAsync(accountPasswordKey(accountId));
  } catch {
    // Non-fatal: the password entry may already be gone.
  }
}

/**
 * Best-effort migration from the old single-blob layout. Safe to call on
 * every profile load; it no-ops once the legacy keys have been cleared.
 */
async function migrateLegacyLayout(userId: string): Promise<SavedAccount[] | null> {
  const legacySavedAccountsPerUser = `rasvia.saved_accounts.${userId}`;
  const legacySelfAccountPerUser = `rasvia.self_account.${userId}`;

  const profilesRaw = await AsyncStorage.getItem(savedProfilesKey(userId));
  if (profilesRaw) return null;

  let migratedList: SavedAccount[] | null = null;

  try {
    const legacyRaw =
      (await SecureStore.getItemAsync(legacySavedAccountsPerUser)) ||
      (await SecureStore.getItemAsync(LEGACY_SAVED_ACCOUNTS_KEY));
    if (legacyRaw) {
      const parsed = JSON.parse(legacyRaw) as SavedAccount[];
      if (Array.isArray(parsed)) {
        await Promise.all(
          parsed.map(async (acc) => {
            if (acc?.id && typeof acc.passwordPlain === "string") {
              await setPassword(acc.id, acc.passwordPlain);
            }
          })
        );
        const profiles: StoredAccountProfile[] = parsed.map(({ passwordPlain, ...rest }) => rest);
        await AsyncStorage.setItem(savedProfilesKey(userId), JSON.stringify(profiles));
        migratedList = parsed;
      }
      await SecureStore.deleteItemAsync(legacySavedAccountsPerUser).catch(() => {});
      await SecureStore.deleteItemAsync(LEGACY_SAVED_ACCOUNTS_KEY).catch(() => {});
    }
  } catch (err) {
    console.warn("accounts-store: legacy saved-accounts migration failed", err);
  }

  try {
    const selfRaw = await SecureStore.getItemAsync(legacySelfAccountPerUser);
    if (selfRaw) {
      const parsed = JSON.parse(selfRaw) as SavedAccount;
      if (parsed?.id && parsed.email) {
        if (typeof parsed.passwordPlain === "string") {
          await setPassword(parsed.id, parsed.passwordPlain);
        }
        const { passwordPlain, ...rest } = parsed;
        await AsyncStorage.setItem(selfProfileKey(userId), JSON.stringify(rest));
      }
      await SecureStore.deleteItemAsync(legacySelfAccountPerUser).catch(() => {});
    }
  } catch (err) {
    console.warn("accounts-store: legacy self-account migration failed", err);
  }

  return migratedList;
}

export async function getSavedAccounts(userId: string): Promise<SavedAccount[]> {
  const migrated = await migrateLegacyLayout(userId);
  if (migrated) return migrated;

  try {
    const raw = await AsyncStorage.getItem(savedProfilesKey(userId));
    if (!raw) return [];
    const profiles = JSON.parse(raw) as StoredAccountProfile[];
    if (!Array.isArray(profiles)) return [];
    const hydrated = await Promise.all(
      profiles.map(async (p) => ({
        ...p,
        passwordPlain: await getPassword(p.id),
      }))
    );
    return hydrated;
  } catch (err) {
    console.warn("accounts-store: getSavedAccounts failed", err);
    return [];
  }
}

export async function upsertSavedAccount(userId: string, account: SavedAccount): Promise<SavedAccount[]> {
  const existing = await getSavedAccounts(userId);
  const next = existing.filter((a) => a.id !== account.id);
  next.push(account);
  await persistSavedAccounts(userId, next);
  return next;
}

export async function removeSavedAccount(userId: string, accountId: string): Promise<SavedAccount[]> {
  const existing = await getSavedAccounts(userId);
  const next = existing.filter((a) => a.id !== accountId);
  await persistSavedAccounts(userId, next);
  await deletePassword(accountId);
  return next;
}

export async function persistSavedAccounts(userId: string, accounts: SavedAccount[]): Promise<void> {
  const profiles: StoredAccountProfile[] = accounts.map(({ passwordPlain, ...rest }) => rest);
  await AsyncStorage.setItem(savedProfilesKey(userId), JSON.stringify(profiles));
  await Promise.all(
    accounts.map(async (acc) => {
      if (acc.passwordPlain) await setPassword(acc.id, acc.passwordPlain);
    })
  );
}

export async function getSelfAccount(userId: string): Promise<SavedAccount | null> {
  await migrateLegacyLayout(userId);
  try {
    const raw = await AsyncStorage.getItem(selfProfileKey(userId));
    if (!raw) return null;
    const profile = JSON.parse(raw) as StoredAccountProfile;
    const passwordPlain = await getPassword(profile.id);
    return { ...profile, passwordPlain };
  } catch (err) {
    console.warn("accounts-store: getSelfAccount failed", err);
    return null;
  }
}

export async function setSelfAccount(userId: string, account: SavedAccount): Promise<void> {
  const { passwordPlain, ...rest } = account;
  await AsyncStorage.setItem(selfProfileKey(userId), JSON.stringify(rest));
  if (passwordPlain) await setPassword(account.id, passwordPlain);
}

export async function clearSelfAccount(userId: string): Promise<void> {
  const current = await getSelfAccount(userId);
  await AsyncStorage.removeItem(selfProfileKey(userId));
  if (current?.id) await deletePassword(current.id);
}

export async function getSwitchedInFrom(userId: string): Promise<string | null> {
  try {
    const fromAsync = await AsyncStorage.getItem(switchedInFromKey(userId));
    if (fromAsync && fromAsync.trim().length > 0) return fromAsync;
    const legacy = await SecureStore.getItemAsync(switchedInFromKey(userId));
    if (legacy && legacy.trim().length > 0) {
      await AsyncStorage.setItem(switchedInFromKey(userId), legacy);
      await SecureStore.deleteItemAsync(switchedInFromKey(userId)).catch(() => {});
      return legacy;
    }
    return null;
  } catch (err) {
    console.warn("accounts-store: getSwitchedInFrom failed", err);
    return null;
  }
}

export async function setSwitchedInFrom(targetUserId: string, originUserId: string): Promise<void> {
  await AsyncStorage.setItem(switchedInFromKey(targetUserId), originUserId);
}

export async function clearSwitchedInFrom(userId: string): Promise<void> {
  await AsyncStorage.removeItem(switchedInFromKey(userId));
  await SecureStore.deleteItemAsync(switchedInFromKey(userId)).catch(() => {});
}

/**
 * Appends `origin` to `targetUserId`'s saved-accounts list (deduped by id
 * and email), so the target session lands with a ready-to-tap switch-back
 * entry. Invoked by the origin *before* signing out.
 */
export async function seedTargetWithOrigin(
  targetUserId: string,
  origin: SavedAccount
): Promise<void> {
  const existing = await getSavedAccounts(targetUserId);
  const deduped = existing.filter(
    (a) => a.id !== origin.id && a.email.toLowerCase() !== origin.email.toLowerCase()
  );
  deduped.push(origin);
  await persistSavedAccounts(targetUserId, deduped);
}
