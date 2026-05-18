/**
 * AppAdaptiveNav — renders the appropriate navigation chrome for the current
 * size class.
 *
 *  compact (< 600pt):  existing AppBottomNav (unchanged phone experience)
 *  medium / expanded:  left navigation rail (72pt wide)
 *
 * Screens must NOT import AppBottomNav directly; use this component instead so
 * the nav chrome adapts automatically without per-screen changes.
 */
import React from "react";
import { View, Text, Pressable, Platform } from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { Bell, MapPin, Map as MapIcon, ShoppingCart, User } from "lucide-react-native";
import * as Haptics from "expo-haptics";
import { useRouter } from "expo-router";
import type { Href } from "expo-router";
import { useNotifications } from "@/lib/notifications-context";
import { useAppTheme } from "@/lib/app-theme";
import { AppBottomNav, type TabKey } from "@/components/AppBottomNav";
import { useLayout, NAV_RAIL_WIDTH } from "@/lib/use-layout";

type Props = {
  activeTab: TabKey;
  hidden?: boolean;
};

const TABS: Array<{
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

function NavRail({ activeTab, hidden }: Props) {
  const router = useRouter();
  const insets = useSafeAreaInsets();
  const { notificationBadgeCount } = useNotifications();
  const { colors } = useAppTheme();

  return (
    <View
      pointerEvents={hidden ? "none" : "auto"}
      style={{
        position: "absolute",
        left: 0,
        top: 0,
        bottom: 0,
        width: NAV_RAIL_WIDTH,
        backgroundColor: colors.navBar,
        borderRightWidth: 1,
        borderRightColor: colors.navBarBorder,
        paddingTop: Math.max(insets.top, 16),
        paddingBottom: Math.max(insets.bottom, 16),
        zIndex: 9999,
        elevation: 999,
        display: hidden ? "none" : "flex",
        alignItems: "center",
        gap: 4,
      }}
    >
      {TABS.map((tab) => {
        const Icon = tab.icon;
        const active = tab.key === activeTab;
        const showBadge =
          tab.key === "notifications" && notificationBadgeCount > 0;

        return (
          <Pressable
            key={tab.key}
            onPress={() => {
              if (Platform.OS !== "web") Haptics.selectionAsync();
              if (!active) router.navigate(tab.route as Href);
            }}
            style={{
              width: 56,
              alignItems: "center",
              justifyContent: "center",
              paddingVertical: 10,
              borderRadius: 14,
              backgroundColor: active
                ? `${colors.saffron}18`
                : "transparent",
            }}
          >
            <View style={{ position: "relative", alignItems: "center" }}>
              <Icon
                size={22}
                color={active ? colors.saffron : colors.textMuted}
              />
              {showBadge ? (
                <View
                  style={{
                    position: "absolute",
                    top: -4,
                    right: -8,
                    minWidth: 16,
                    height: 16,
                    borderRadius: 8,
                    backgroundColor: colors.saffron,
                    alignItems: "center",
                    justifyContent: "center",
                    paddingHorizontal: 3,
                    borderWidth: 1.5,
                    borderColor: colors.navBar,
                  }}
                >
                  <Text
                    style={{
                      color: "#0f0f0f",
                      fontFamily: "Manrope_700Bold",
                      fontSize: 9,
                      lineHeight: 11,
                      textAlign: "center",
                      includeFontPadding: false,
                    }}
                  >
                    {notificationBadgeCount > 9
                      ? "9+"
                      : String(notificationBadgeCount)}
                  </Text>
                </View>
              ) : null}
            </View>
            <Text
              style={{
                fontFamily: active ? "Manrope_700Bold" : "Manrope_600SemiBold",
                color: active ? colors.saffron : colors.textMuted,
                fontSize: 10,
                marginTop: 4,
              }}
            >
              {tab.label}
            </Text>
          </Pressable>
        );
      })}
    </View>
  );
}

export function AppAdaptiveNav({ activeTab, hidden = false }: Props) {
  const { navMode } = useLayout();

  if (navMode === "rail") {
    return <NavRail activeTab={activeTab} hidden={hidden} />;
  }

  return <AppBottomNav activeTab={activeTab} hidden={hidden} />;
}
