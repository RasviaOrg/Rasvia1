/**
 * Drop-in replacement for `react-native`'s `Image` for restaurant / menu
 * artwork. Backs all rendering with `expo-image`'s persistent disk cache so
 * a given URL is downloaded from Supabase at most once per 7 days per
 * device, regardless of how many screens reference it.
 *
 * Two modes, controlled by `<ImageFetchProvider>`:
 *
 *   - allowFetch = true  (home feed + restaurant detail)
 *       Fetch anything that isn't on disk yet and cache it.
 *
 *   - allowFetch = false (everywhere else)
 *       Render only what's already on disk. Missing assets show the
 *       caller-supplied `fallback` node instead of triggering a network
 *       request. This is what keeps cached-egress in check when users
 *       browse the map, favorites, search, cart, etc.
 *
 * Props roughly mirror `react-native` Image so replacement sites stay
 * small: `source={{ uri }}`, `style`, `resizeMode`. We also accept
 * `contentFit` for parity with `expo-image`.
 */

import React, { useEffect, useMemo, useRef, useState } from "react";
import { ImageStyle, StyleProp } from "react-native";
import { Image as ExpoImage, ImageContentFit } from "expo-image";

import {
  isUriCachedOnDisk,
  peekVersionedUri,
  resolveVersionedUri,
} from "@/lib/image-cache";
import { useAllowImageFetch } from "@/lib/image-fetch-context";

type ResizeModeLike = "cover" | "contain" | "stretch" | "center" | "repeat";

export interface CachedImageProps {
  source: { uri: string | null | undefined } | null | undefined;
  style?: StyleProp<ImageStyle>;
  resizeMode?: ResizeModeLike;
  contentFit?: ImageContentFit;
  /** Rendered when `allowFetch=false` and the URL isn't on disk yet. */
  fallback?: React.ReactNode;
  transition?: number;
  /** Forwarded to expo-image for accessibility. */
  accessibilityLabel?: string;
  testID?: string;
}

function mapResizeMode(mode: ResizeModeLike | undefined): ImageContentFit {
  switch (mode) {
    case "contain":
      return "contain";
    case "stretch":
      return "fill";
    case "center":
      return "none";
    case "repeat":
      // expo-image doesn't support repeat; closest is cover.
      return "cover";
    case "cover":
    default:
      return "cover";
  }
}

export function CachedImage({
  source,
  style,
  resizeMode,
  contentFit,
  fallback = null,
  transition = 0,
  accessibilityLabel,
  testID,
}: CachedImageProps) {
  const allowFetch = useAllowImageFetch();
  const rawUri = (source?.uri ?? "").trim();

  // Best-effort synchronous resolve so the first render already points at
  // the versioned URL when we've seen it before. Prevents a flicker.
  const initialUri = useMemo(() => peekVersionedUri(rawUri), [rawUri]);
  const [resolvedUri, setResolvedUri] = useState<string>(initialUri);
  const [hasOnDisk, setHasOnDisk] = useState<boolean | null>(
    // When allowFetch=true we don't gate on disk presence → treat as true.
    allowFetch ? true : null,
  );
  const cancelled = useRef(false);

  useEffect(() => {
    cancelled.current = false;
    if (!rawUri) {
      setResolvedUri("");
      setHasOnDisk(allowFetch ? true : false);
      return () => {
        cancelled.current = true;
      };
    }

    // Non-remote (file://, data:, asset:) → always render.
    if (!/^https?:\/\//i.test(rawUri)) {
      setResolvedUri(rawUri);
      setHasOnDisk(true);
      return () => {
        cancelled.current = true;
      };
    }

    (async () => {
      const versioned = await resolveVersionedUri(rawUri);
      if (cancelled.current) return;
      setResolvedUri(versioned);
      if (allowFetch) {
        setHasOnDisk(true);
        return;
      }
      const cached = await isUriCachedOnDisk(rawUri);
      if (cancelled.current) return;
      setHasOnDisk(cached);
    })();

    return () => {
      cancelled.current = true;
    };
  }, [rawUri, allowFetch]);

  if (!rawUri) return <>{fallback}</>;

  // In offline-cache mode, only render once we've confirmed the file is
  // on disk (or it's a local asset).
  if (!allowFetch && hasOnDisk === false) {
    return <>{fallback}</>;
  }

  // While we're still checking the disk cache in offline-cache mode, show
  // the fallback so we don't briefly point expo-image at a URL it might
  // try to fetch.
  if (!allowFetch && hasOnDisk === null) {
    return <>{fallback}</>;
  }

  const finalContentFit = contentFit ?? mapResizeMode(resizeMode);

  return (
    <ExpoImage
      source={{ uri: resolvedUri || rawUri }}
      style={style}
      contentFit={finalContentFit}
      // Keep both tiers of the cache populated; the disk tier is the one
      // that actually cuts egress across cold starts.
      cachePolicy="memory-disk"
      transition={transition}
      accessibilityLabel={accessibilityLabel}
      testID={testID}
      // We've opted into 7-day versioning via the URL; let the
      // underlying cache layer rely on its own LRU eviction.
      recyclingKey={resolvedUri || rawUri}
    />
  );
}
