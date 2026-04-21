import React from "react";
import { View, Text, Pressable, Platform } from "react-native";
import { useRouter } from "expo-router";
import type { Href } from "expo-router";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { Bell, MapPin, Map as MapIcon, ShoppingCart, User } from "lucide-react-native";
import * as Haptics from "expo-haptics";
import { useNotifications } from "@/lib/notifications-context";
import { useAppTheme } from "@/lib/app-theme";

export type TabKey = "home" | "map" | "cart" | "notifications" | "profile";
export const APP_BOTTOM_NAV_HEIGHT = 52;
export const APP_BOTTOM_NAV_OFFSET = 10;

/** Pixels from the screen bottom to the top edge of the tab bar — use to anchor bottom sheets flush above the nav. */
export function getBottomNavTopInset(insetsBottom: number): number {
  return (
    APP_BOTTOM_NAV_HEIGHT +
    8 +
    Math.max(insetsBottom, 8) -
    APP_BOTTOM_NAV_OFFSET -
    1
  );
}

export function AppBottomNav({ activeTab, hidden = false }: { activeTab: TabKey; hidden?: boolean }) {
  const router = useRouter();
  const insets = useSafeAreaInsets();
  const { notificationBadgeCount } = useNotifications();
  const { colors } = useAppTheme();

  const tabs: Array<{
    key: TabKey;
    label: string;
    icon: React.ComponentType<{ size: number; color: string }>;
    route: string;
  }> = [
    { key: "home", label: "Home", icon: MapPin, route: "/" },
    { key: "map", label: "Map", icon: MapIcon, route: "/map" },
    { key: "cart", label: "Cart", icon: ShoppingCart, route: "/cart" },
    { key: "notifications", label: "Alerts", icon: Bell, route: "/notifications" },
    { key: "profile", label: "Profile", icon: User, route: "/profile" },
  ];

  return (
    <View
      // When hidden, keep the view mounted but fully removed from layout &
      // input. `display: 'none'` avoids a mount/unmount on route change (so
      // returning to a tab page shows the bar instantly).
      pointerEvents={hidden ? "none" : "auto"}
      style={{
        position: "absolute",
        left: 0,
        right: 0,
        bottom: -APP_BOTTOM_NAV_OFFSET,
        backgroundColor: colors.navBar,
        borderTopWidth: 1,
        borderTopColor: colors.navBarBorder,
        paddingTop: 8,
        paddingBottom: Math.max(insets.bottom, 8),
        zIndex: 9999,
        elevation: 999,
        display: hidden ? "none" : "flex",
      }}
    >
      <View
        style={{
          flexDirection: "row",
          alignItems: "center",
          paddingHorizontal: 8,
          minHeight: APP_BOTTOM_NAV_HEIGHT,
        }}
      >
        {tabs.map((tab) => {
          const Icon = tab.icon;
          const active = tab.key === activeTab;
          const showBadge = tab.key === "notifications" && notificationBadgeCount > 0;
          return (
            <Pressable
              key={tab.key}
              onPress={() => {
                if (Platform.OS !== "web") Haptics.selectionAsync();
                // Inside `(tabs)`, `navigate` switches tabs without unmounting. When a screen
                // is stacked above the tab shell (e.g. /favorites), `dismissTo` pops back
                // to that tab instead of pushing another copy.
                if (!active) {
                  const href = tab.route as Href;
                  if (router.canDismiss()) router.dismissTo(href);
                  else router.navigate(href);
                }
              }}
              style={{
                flex: 1,
                alignItems: "center",
                justifyContent: "center",
                paddingVertical: 4,
                borderRadius: 12,
                backgroundColor: "transparent",
              }}
            >
              <View style={{ alignItems: "center" }}>
                <View
                  style={{
                    position: "relative",
                    alignItems: "center",
                    justifyContent: "center",
                    minHeight: 22,
                    minWidth: 28,
                  }}
                >
                  <Icon size={17} color={active ? colors.saffron : colors.textMuted} />
                  {showBadge ? (
                    <View
                      style={{
                        position: "absolute",
                        top: -5,
                        right: -10,
                        minWidth: 18,
                        height: 18,
                        borderRadius: 9,
                        backgroundColor: colors.saffron,
                        alignItems: "center",
                        justifyContent: "center",
                        paddingHorizontal: 4,
                        borderWidth: 2,
                        borderColor: colors.navBar,
                      }}
                    >
                      <Text
                        style={{
                          color: "#0f0f0f",
                          fontFamily: "Manrope_700Bold",
                          fontSize: 10,
                          lineHeight: 12,
                          textAlign: "center",
                          includeFontPadding: false,
                        }}
                      >
                        {notificationBadgeCount > 9 ? "9+" : String(notificationBadgeCount)}
                      </Text>
                    </View>
                  ) : null}
                </View>
                <Text
                  style={{
                    fontFamily: active ? "Manrope_700Bold" : "Manrope_600SemiBold",
                    color: active ? colors.saffron : colors.textMuted,
                    fontSize: 11,
                    marginTop: 4,
                  }}
                >
                  {tab.label}
                </Text>
              </View>
            </Pressable>
          );
        })}
      </View>
    </View>
  );
}
