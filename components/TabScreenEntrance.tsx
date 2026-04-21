import React from "react";
import Animated from "react-native-reanimated";
import { TAB_SCREEN_ENTERING } from "@/lib/tab-screen-animations";

/**
 * Wrap each main-tab screen’s content so switching tabs replays one consistent entrance.
 */
export function TabScreenEntrance({ children }: { children: React.ReactNode }) {
  return (
    <Animated.View entering={TAB_SCREEN_ENTERING} style={{ flex: 1 }}>
      {children}
    </Animated.View>
  );
}
