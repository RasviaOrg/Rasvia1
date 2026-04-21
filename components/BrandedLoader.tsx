import React from "react";
import { ActivityIndicator, Image, Text, View } from "react-native";
import { useAppTheme } from "@/lib/app-theme";

export function BrandedLoader({ message }: { message?: string }) {
  const { colors } = useAppTheme();
  return (
    <View style={{ flex: 1, backgroundColor: colors.background, alignItems: "center", justifyContent: "center" }}>
      <Image
        source={require("../assets/images/rasvia-icon.png")}
        style={{ width: 72, height: 72, marginBottom: 18 }}
        resizeMode="contain"
      />
      <ActivityIndicator size="large" color={colors.saffron} />
      {message ? (
        <Text style={{ marginTop: 12, color: colors.textMuted, fontFamily: "Manrope_500Medium", fontSize: 13 }}>
          {message}
        </Text>
      ) : null}
    </View>
  );
}
