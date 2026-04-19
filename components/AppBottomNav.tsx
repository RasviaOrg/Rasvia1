import React from "react";
import { View, Text, Pressable, Platform } from "react-native";
import { useRouter } from "expo-router";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { Bell, House, Map as MapIcon, ShoppingCart, User } from "lucide-react-native";
import * as Haptics from "expo-haptics";
import { useNotifications } from "@/lib/notifications-context";

export type TabKey = "home" | "map" | "cart" | "notifications" | "profile";
export const APP_BOTTOM_NAV_HEIGHT = 52;
export const APP_BOTTOM_NAV_OFFSET = 10;

export function AppBottomNav({ activeTab, hidden = false }: { activeTab: TabKey; hidden?: boolean }) {
  const router = useRouter();
  const insets = useSafeAreaInsets();
  const { notificationBadgeCount } = useNotifications();

  const tabs: Array<{
    key: TabKey;
    label: string;
    icon: React.ComponentType<{ size: number; color: string }>;
    route: string;
  }> = [
    { key: "home", label: "Home", icon: House, route: "/" },
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
        backgroundColor: "#0f0f0f",
        borderTopWidth: 1,
        borderTopColor: "#202020",
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
          return (
            <Pressable
              key={tab.key}
              onPress={() => {
                if (Platform.OS !== "web") Haptics.selectionAsync();
                if (!active) router.replace(tab.route as any);
              }}
              style={{
                flex: 1,
                alignItems: "center",
                justifyContent: "center",
                paddingVertical: 4,
                borderRadius: 12,
                backgroundColor: "transparent",
                position: "relative",
              }}
            >
              <Icon size={17} color={active ? "#FF9933" : "#8a8a8a"} />
              <Text
                style={{
                  fontFamily: active ? "Manrope_700Bold" : "Manrope_600SemiBold",
                  color: active ? "#FF9933" : "#8a8a8a",
                  fontSize: 11,
                  marginTop: 4,
                }}
              >
                {tab.label}
              </Text>
              {tab.key === "notifications" && notificationBadgeCount > 0 && (
                <View
                  style={{
                    position: "absolute",
                    top: 2,
                    right: "26%",
                    minWidth: 15,
                    height: 15,
                    borderRadius: 8,
                    backgroundColor: "#EF4444",
                    alignItems: "center",
                    justifyContent: "center",
                    paddingHorizontal: 3,
                  }}
                >
                  <Text style={{ color: "#fff", fontFamily: "JetBrainsMono_700Bold", fontSize: 8 }}>
                    {notificationBadgeCount > 9 ? "9+" : notificationBadgeCount}
                  </Text>
                </View>
              )}
            </Pressable>
          );
        })}
      </View>
    </View>
  );
}
