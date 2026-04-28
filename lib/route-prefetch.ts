import { useEffect, useRef } from "react";
import { router, useRootNavigationState, type Href } from "expo-router";

/** Other main tabs (cart is prefetched immediately — see hook below). */
const PRIMARY_PRELOAD: readonly Href[] = ["/map", "/notifications", "/profile"];

/** Common stack screens opened from home or profile. */
const SECONDARY_PRELOAD: readonly Href[] = [
  "/favorites",
  "/my-orders",
  "/dining-preferences",
  "/roles",
  "/my-accounts",
  "/owner-media-carousel",
  "/discover/trending",
  "/order-confirmation",
  "/terms",
  "/privacy",
  "/host_party",
];

function safePrefetch(href: Href) {
  try {
    router.prefetch(href);
  } catch {
    // Path may be unavailable in some builds — ignore
  }
}

/**
 * Loads route JS bundles in the background via Expo Router's preload path.
 * Does not mount screens; reduces first-open delay when the user navigates.
 */
export function useBackgroundRoutePrefetch(enabled: boolean) {
  const navState = useRootNavigationState();
  const ranRef = useRef(false);

  useEffect(() => {
    if (!enabled) {
      ranRef.current = false;
      return;
    }
    if (!navState?.key) return;
    if (ranRef.current) return;
    ranRef.current = true;

    // Warm home first so any early navigation resolution favors `/`, then other tabs.
    safePrefetch("/");
    safePrefetch("/cart");

    const idleHandle = requestIdleCallback(() => {
      for (const href of PRIMARY_PRELOAD) {
        safePrefetch(href);
      }
      setTimeout(() => {
        for (const href of SECONDARY_PRELOAD) {
          safePrefetch(href);
        }
      }, 500);
    });

    return () => cancelIdleCallback(idleHandle);
  }, [enabled, navState?.key]);
}
