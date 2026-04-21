/**
 * Image disk-cache + 7-day refresh utilities.
 *
 * Background
 * ----------
 * Restaurant and menu-item images live in public Supabase Storage buckets.
 * Loading them with React Native's built-in `Image` component only caches
 * them in memory, so every cold start re-downloads every tile the user sees
 * and the Supabase cached-egress metric explodes.
 *
 * What this module does
 * ---------------------
 * 1. Wraps every restaurant/menu URL with a stable per-URL "cache version"
 *    query param so `expo-image`'s native disk cache keeps the file until
 *    the version rolls.
 * 2. Persists `{url -> {version, fetchedAt}}` in AsyncStorage so the version
 *    only bumps once the cached copy is older than 7 days. That means each
 *    URL is pulled from Supabase at most once per rolling 7-day window per
 *    device, regardless of how many app launches happen in between.
 * 3. Exposes helpers to prefetch a batch of URLs to disk (home + restaurant
 *    detail screens) and to detect whether a URL is already on disk without
 *    triggering a fetch (used by `<CachedImage>` on screens that are not
 *    allowed to hit the network — e.g. map, favorites, search, cart).
 */

import AsyncStorage from "@react-native-async-storage/async-storage";
import { Platform } from "react-native";
import { Image as ExpoImage } from "expo-image";

const INDEX_KEY = "@rasvia_image_cache_v1";
const REFRESH_MS = 7 * 24 * 60 * 60 * 1000; // 7 days

type IndexEntry = { version: number; fetchedAt: number };
type CacheIndex = Record<string, IndexEntry>;

let inMemoryIndex: CacheIndex | null = null;
let loadPromise: Promise<CacheIndex> | null = null;
let saveTimer: ReturnType<typeof setTimeout> | null = null;
let dirty = false;

/** Lazily hydrate the on-disk index into memory. */
async function ensureIndex(): Promise<CacheIndex> {
  if (inMemoryIndex) return inMemoryIndex;
  if (!loadPromise) {
    loadPromise = AsyncStorage.getItem(INDEX_KEY)
      .then((raw) => {
        if (!raw) return {} as CacheIndex;
        try {
          const parsed = JSON.parse(raw);
          if (parsed && typeof parsed === "object") return parsed as CacheIndex;
        } catch {
          // corrupt index → start fresh
        }
        return {} as CacheIndex;
      })
      .then((idx) => {
        inMemoryIndex = idx;
        return idx;
      })
      .catch(() => {
        inMemoryIndex = {};
        return inMemoryIndex;
      });
  }
  return loadPromise;
}

/** Coalesce writes so we don't hammer AsyncStorage on every image resolve. */
function scheduleSave() {
  dirty = true;
  if (saveTimer) return;
  saveTimer = setTimeout(async () => {
    saveTimer = null;
    if (!dirty || !inMemoryIndex) return;
    dirty = false;
    try {
      await AsyncStorage.setItem(INDEX_KEY, JSON.stringify(inMemoryIndex));
    } catch {
      // best effort
    }
  }, 1500);
}

function appendParam(url: string, key: string, value: string | number): string {
  const sep = url.includes("?") ? "&" : "?";
  return `${url}${sep}${key}=${value}`;
}

/**
 * Return a versioned URL suitable for display. The same URL yields the same
 * version tag for 7 days since the first time we saw it, so `expo-image`'s
 * disk cache treats it as the same entry. After 7 days we bump the tag,
 * which causes a single background refetch and then another 7 days of reuse.
 */
export async function resolveVersionedUri(url: string): Promise<string> {
  const clean = (url ?? "").trim();
  if (!clean) return "";
  // Non-remote URIs (data:, file:, asset:, local require numbers) don't need
  // versioning.
  if (!/^https?:\/\//i.test(clean)) return clean;

  const index = await ensureIndex();
  const now = Date.now();
  const existing = index[clean];

  if (!existing || now - existing.fetchedAt > REFRESH_MS) {
    const nextVersion = existing ? existing.version + 1 : 1;
    index[clean] = { version: nextVersion, fetchedAt: now };
    scheduleSave();
    return appendParam(clean, "rsvc", nextVersion);
  }

  return appendParam(clean, "rsvc", existing.version);
}

/** Synchronous best-effort: returns the versioned URL if we already know
 * about it, otherwise the raw URL. Used during the first render frame when
 * we don't want to wait on AsyncStorage. Once the async resolver finishes
 * we swap in the versioned copy. */
export function peekVersionedUri(url: string): string {
  const clean = (url ?? "").trim();
  if (!clean || !/^https?:\/\//i.test(clean)) return clean;
  const idx = inMemoryIndex;
  if (!idx) return clean;
  const entry = idx[clean];
  if (!entry) return clean;
  if (Date.now() - entry.fetchedAt > REFRESH_MS) return clean;
  return appendParam(clean, "rsvc", entry.version);
}

/** True when the image is already sitting on disk for the current version. */
export async function isUriCachedOnDisk(url: string): Promise<boolean> {
  try {
    const versioned = await resolveVersionedUri(url);
    if (!versioned || !/^https?:\/\//i.test(versioned)) return true;
    // expo-image's disk cache is native-only. On web there's no per-URL
    // cache inspection API, so fall back to "allow render" — the browser's
    // HTTP cache layer handles reuse there and web isn't the hot surface
    // driving Supabase egress anyway.
    if (Platform.OS === "web") return true;
    const path = await ExpoImage.getCachePathAsync(versioned);
    return !!path;
  } catch {
    return false;
  }
}

/**
 * Prefetch a batch of URLs to the on-disk cache. Used by home + restaurant
 * detail screens (the only two places allowed to pull fresh images from the
 * server per product requirements). Failures are swallowed.
 */
export async function prefetchImages(urls: Array<string | null | undefined>): Promise<void> {
  const unique = Array.from(
    new Set(
      urls
        .map((u) => (u ?? "").trim())
        .filter((u) => /^https?:\/\//i.test(u)),
    ),
  );
  if (unique.length === 0) return;
  try {
    const versioned = await Promise.all(unique.map((u) => resolveVersionedUri(u)));
    // expo-image's prefetch writes to both memory + disk by default; we
    // force disk-only so we don't blow up RAM on a large menu.
    await ExpoImage.prefetch(versioned, "disk");
  } catch {
    // best effort
  }
}

/** Initialise the in-memory index early so synchronous peeks work on the
 * first frame of the home screen. Safe to call multiple times. */
export async function primeImageCache(): Promise<void> {
  await ensureIndex();
}

/** Nuke everything (debug / sign-out). */
export async function clearImageCache(): Promise<void> {
  try {
    inMemoryIndex = {};
    loadPromise = Promise.resolve({});
    await AsyncStorage.removeItem(INDEX_KEY);
    await ExpoImage.clearDiskCache();
    await ExpoImage.clearMemoryCache();
  } catch {
    // best effort
  }
}
