import React from "react";
import { View, Text, Pressable } from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";
import { useRouter } from "expo-router";
import { ArrowLeft } from "lucide-react-native";
import * as Haptics from "expo-haptics";
import { Platform } from "react-native";
import { OwnerMediaCarouselPanel } from "@/components/OwnerMediaCarouselPanel";
import { useAppTheme } from "@/lib/app-theme";

export default function OwnerMediaCarouselScreen() {
  const router = useRouter();
  const { colors } = useAppTheme();

  return (
    <SafeAreaView style={{ flex: 1, backgroundColor: colors.background }} edges={["top"]}>
      <OwnerMediaCarouselPanel
        variant="screen"
        screenHeader={
          <View style={{ flexDirection: "row", alignItems: "center", paddingHorizontal: 16, paddingBottom: 10, paddingTop: 6 }}>
            <Pressable
              onPress={() => {
                if (Platform.OS !== "web") Haptics.selectionAsync();
                router.back();
              }}
              style={{
                width: 40,
                height: 40,
                borderRadius: 20,
                alignItems: "center",
                justifyContent: "center",
                backgroundColor: colors.card,
                borderWidth: 1,
                borderColor: colors.cardBorder,
              }}
            >
              <ArrowLeft size={20} color={colors.text} />
            </Pressable>
            <Text
              style={{
                marginLeft: 12,
                color: colors.text,
                fontFamily: "BricolageGrotesque_800ExtraBold",
                fontSize: 24,
              }}
            >
              Media Carousel
            </Text>
          </View>
        }
      />
    </SafeAreaView>
  );
}
