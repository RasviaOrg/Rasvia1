import React from "react";
import { View, Text, Pressable, Platform } from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";
import { useRouter } from "expo-router";
import * as Haptics from "expo-haptics";
import { ShoppingCart } from "lucide-react-native";
import { APP_BOTTOM_NAV_HEIGHT, APP_BOTTOM_NAV_OFFSET } from "@/components/AppBottomNav";
import Animated, { FadeIn, FadeInDown } from "react-native-reanimated";

export default function CartScreen() {
  const router = useRouter();

  const goHome = () => {
    if (Platform.OS !== "web") Haptics.selectionAsync();
    router.replace("/" as any);
  };

  return (
    <View className="flex-1 bg-rasvia-black">
      <SafeAreaView className="flex-1 px-5" edges={["top"]}>
        <Animated.View
          entering={FadeIn.duration(260)}
          style={{ flexDirection: "row", alignItems: "center", marginTop: 6, marginBottom: 14 }}
        >
          <Text style={{ fontFamily: "BricolageGrotesque_800ExtraBold", color: "#f5f5f5", fontSize: 30 }}>
            Cart
          </Text>
        </Animated.View>

        <Animated.View
          entering={FadeInDown.duration(320)}
          style={{
            flex: 1,
            alignItems: "center",
            justifyContent: "center",
            paddingBottom: APP_BOTTOM_NAV_HEIGHT + 54 + APP_BOTTOM_NAV_OFFSET,
          }}
        >
          <View
            style={{
              width: 120,
              height: 120,
              borderRadius: 60,
              alignItems: "center",
              justifyContent: "center",
              backgroundColor: "#1a1a1a",
              borderWidth: 1,
              borderColor: "#2a2a2a",
              marginBottom: 24,
            }}
          >
            <ShoppingCart size={48} color="#666666" />
          </View>

          <Text
            style={{
              fontFamily: "BricolageGrotesque_800ExtraBold",
              color: "#f5f5f5",
              fontSize: 26,
              textAlign: "center",
              marginBottom: 8,
            }}
          >
            Your cart is empty
          </Text>
          <Text
            style={{
              fontFamily: "Manrope_500Medium",
              color: "#9a9a9a",
              fontSize: 14,
              textAlign: "center",
              maxWidth: 280,
              lineHeight: 21,
              marginBottom: 22,
            }}
          >
            Add items to get started.
          </Text>

          <Pressable
            onPress={goHome}
            style={{
              backgroundColor: "#FF9933",
              borderRadius: 14,
              paddingHorizontal: 22,
              paddingVertical: 12,
            }}
          >
            <Text style={{ color: "#0f0f0f", fontFamily: "Manrope_700Bold", fontSize: 14 }}>
              Go To Main Menu
            </Text>
          </Pressable>
        </Animated.View>
      </SafeAreaView>
    </View>
  );
}
