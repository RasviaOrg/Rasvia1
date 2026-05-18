/**
 * useNavInsets — returns layout insets that account for whatever nav chrome
 * is currently visible (bottom tab bar vs. left rail).
 *
 * Sheets, FABs, and sticky footers must read these values instead of
 * hard-coding bottom padding for AppBottomNav.
 */
import { useMemo } from "react";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { useLayout } from "@/lib/use-layout";
import { APP_BOTTOM_NAV_HEIGHT, APP_BOTTOM_NAV_OFFSET } from "@/components/AppBottomNav";

export type NavInsets = {
  /** Extra bottom padding needed above the nav bar (0 when navMode="rail"). */
  bottomInset: number;
  /** Extra left padding needed beside the rail (0 when navMode="bottom"). */
  leftInset: number;
};

export function useNavInsets(): NavInsets {
  const safeArea = useSafeAreaInsets();
  const { navMode, navRailWidth } = useLayout();

  return useMemo<NavInsets>(() => {
    if (navMode === "rail") {
      return { bottomInset: 0, leftInset: navRailWidth };
    }
    // bottom nav: replicate getBottomNavTopInset arithmetic
    const bottomInset =
      APP_BOTTOM_NAV_HEIGHT +
      8 +
      Math.max(safeArea.bottom, 8) -
      APP_BOTTOM_NAV_OFFSET -
      1;
    return { bottomInset, leftInset: 0 };
  }, [navMode, navRailWidth, safeArea.bottom]);
}
