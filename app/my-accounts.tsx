import React, { useState } from "react";
import { View, Text, Pressable, ScrollView, Platform, ActivityIndicator } from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";
import { useRouter } from "expo-router";
import { ArrowLeft } from "lucide-react-native";
import Animated, { FadeIn } from "react-native-reanimated";
import * as Haptics from "expo-haptics";
import { AccountsManagementSection } from "@/components/AccountsManagementSection";
import { APP_BOTTOM_NAV_HEIGHT, APP_BOTTOM_NAV_OFFSET } from "@/components/AppBottomNav";
import { useAppTheme } from "@/lib/app-theme";

/**
 * Standalone account-switching screen for non-admin personas (restaurant
 * owners + switched-in users). Admin still accesses the same panel from
 * the inline tab strip on the profile page.
 */
export default function MyAccountsScreen() {
  const router = useRouter();
  const { colors, isDark } = useAppTheme();
  const [loggingOut, setLoggingOut] = useState(false);

  return (
    <View style={{ flex: 1, backgroundColor: colors.homeBg }}>
      <SafeAreaView style={{ flex: 1 }} edges={["top"]}>
        <Animated.View
          entering={FadeIn.duration(400)}
          className="flex-row items-center px-5 pt-2 pb-4"
        >
          <Pressable
            onPress={() => {
              if (Platform.OS !== "web") {
                Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
              }
              router.back();
            }}
            style={{
              backgroundColor: colors.card,
              width: 44,
              height: 44,
              borderRadius: 22,
              alignItems: "center",
              justifyContent: "center",
              borderWidth: 1,
              borderColor: colors.cardBorder,
              marginRight: 16,
            }}
          >
            <ArrowLeft size={22} color={colors.text} />
          </Pressable>
          <Text
            style={{
              fontFamily: "BricolageGrotesque_800ExtraBold",
              color: colors.text,
              fontSize: 28,
              letterSpacing: -0.5,
            }}
          >
            My Accounts
          </Text>
        </Animated.View>

        <ScrollView
          showsVerticalScrollIndicator={false}
          contentContainerStyle={{
            paddingBottom: APP_BOTTOM_NAV_HEIGHT + APP_BOTTOM_NAV_OFFSET + 32,
          }}
        >
          <AccountsManagementSection onLoggingOutChange={setLoggingOut} />
        </ScrollView>
      </SafeAreaView>

      {loggingOut && (
        <View
          pointerEvents="none"
          style={{
            position: "absolute",
            top: 0,
            left: 0,
            right: 0,
            bottom: 0,
            alignItems: "center",
            justifyContent: "center",
            backgroundColor: isDark ? "rgba(0,0,0,0.55)" : "rgba(0,0,0,0.35)",
          }}
        >
          <ActivityIndicator color={colors.saffron} size="large" />
        </View>
      )}
    </View>
  );
}
