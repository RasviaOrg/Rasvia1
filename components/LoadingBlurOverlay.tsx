import React from "react";
import { View, StyleSheet, Platform } from "react-native";
import { BlurView } from "expo-blur";
import Animated from "react-native-reanimated";
import { LOADING_BLUR_ENTERING, LOADING_BLUR_EXITING } from "@/lib/tab-screen-animations";

/**
 * Full-screen slight blur + dim; fades in/out once when mounted/unmounted.
 */
export function LoadingBlurOverlay() {
  return (
    <Animated.View
      entering={LOADING_BLUR_ENTERING}
      exiting={LOADING_BLUR_EXITING}
      style={[StyleSheet.absoluteFillObject, { zIndex: 200, elevation: 30 }]}
      pointerEvents="auto"
    >
      <BlurView
        intensity={Platform.OS === "ios" ? 38 : 28}
        tint="dark"
        style={StyleSheet.absoluteFillObject}
      />
      <View
        pointerEvents="none"
        style={[StyleSheet.absoluteFillObject, { backgroundColor: "rgba(15,15,15,0.22)" }]}
      />
    </Animated.View>
  );
}
