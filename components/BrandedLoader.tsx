import React from "react";
import { ActivityIndicator, Image, Text, View } from "react-native";

export function BrandedLoader({ message }: { message?: string }) {
  return (
    <View style={{ flex: 1, backgroundColor: "#0f0f0f", alignItems: "center", justifyContent: "center" }}>
      <Image
        source={require("../assets/images/rasvia-icon.png")}
        style={{ width: 72, height: 72, marginBottom: 18 }}
        resizeMode="contain"
      />
      <ActivityIndicator size="large" color="#FF9933" />
      {message ? (
        <Text style={{ marginTop: 12, color: "#888", fontFamily: "Manrope_500Medium", fontSize: 13 }}>
          {message}
        </Text>
      ) : null}
    </View>
  );
}
