import React, { useState } from "react";
import { View, Text, Pressable, ScrollView, Platform, ActivityIndicator } from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";
import { useRouter } from "expo-router";
import { ArrowLeft } from "lucide-react-native";
import Animated, { FadeIn } from "react-native-reanimated";
import * as Haptics from "expo-haptics";
import { AccountsManagementSection } from "@/components/AccountsManagementSection";
import { APP_BOTTOM_NAV_HEIGHT, APP_BOTTOM_NAV_OFFSET } from "@/components/AppBottomNav";

/**
 * Standalone account-switching screen for non-admin personas (restaurant
 * owners + switched-in users). Admin still accesses the same panel from
 * the inline tab strip on the profile page.
 */
export default function MyAccountsScreen() {
  const router = useRouter();
  const [loggingOut, setLoggingOut] = useState(false);

  return (
    <View className="flex-1 bg-rasvia-black">
      <SafeAreaView className="flex-1" edges={["top"]}>
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
              backgroundColor: "#1a1a1a",
              width: 44,
              height: 44,
              borderRadius: 22,
              alignItems: "center",
              justifyContent: "center",
              borderWidth: 1,
              borderColor: "#2a2a2a",
              marginRight: 16,
            }}
          >
            <ArrowLeft size={22} color="#f5f5f5" />
          </Pressable>
          <Text
            style={{
              fontFamily: "BricolageGrotesque_800ExtraBold",
              color: "#f5f5f5",
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
            backgroundColor: "rgba(0,0,0,0.55)",
          }}
        >
          <ActivityIndicator color="#FF9933" size="large" />
        </View>
      )}
    </View>
  );
}
