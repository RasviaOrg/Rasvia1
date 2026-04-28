import React from "react";
import { View, Text, ScrollView, Pressable, Platform } from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";
import { useRouter } from "expo-router";
import { ArrowLeft } from "lucide-react-native";
import * as Haptics from "expo-haptics";
import { APP_BOTTOM_NAV_HEIGHT, APP_BOTTOM_NAV_OFFSET } from "@/components/AppBottomNav";
import { useAppTheme } from "@/lib/app-theme";

export default function TermsOfServiceScreen() {
  const router = useRouter();
  const { colors } = useAppTheme();
  const bottomPad = APP_BOTTOM_NAV_HEIGHT + APP_BOTTOM_NAV_OFFSET + 32;

  return (
    <View style={{ flex: 1, backgroundColor: colors.background }}>
      <View style={{ backgroundColor: colors.homeHeaderBg }}>
        <SafeAreaView edges={["top"]}>
          <View
            style={{
              flexDirection: "row",
              alignItems: "center",
              paddingHorizontal: 20,
              paddingTop: 12,
              paddingBottom: 16,
              borderBottomWidth: 1,
              borderBottomColor: colors.cardBorder,
            }}
          >
            <Pressable
              onPress={() => {
                if (Platform.OS !== "web") Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
                router.back();
              }}
              style={{
                width: 44,
                height: 44,
                borderRadius: 22,
                backgroundColor: colors.pressableBg,
                alignItems: "center",
                justifyContent: "center",
                marginRight: 16,
                borderWidth: 1,
                borderColor: colors.cardBorder,
              }}
            >
              <ArrowLeft size={22} color={colors.text} />
            </Pressable>
            <Text
              style={{
                fontFamily: "BricolageGrotesque_800ExtraBold",
                color: colors.text,
                fontSize: 24,
                letterSpacing: -0.5,
              }}
            >
              Terms of Service
            </Text>
          </View>
        </SafeAreaView>
      </View>

      <ScrollView contentContainerStyle={{ padding: 20, paddingBottom: bottomPad }}>
          <Text style={{ fontFamily: "Manrope_700Bold", color: colors.text, fontSize: 18, marginBottom: 12 }}>
            1. Acceptance of Terms
          </Text>
          <Text style={{ fontFamily: "Manrope_500Medium", color: colors.textSecondary, fontSize: 14, lineHeight: 22, marginBottom: 24 }}>
            By accessing or using the Rasvia application, you agree to comply with and be bound by these Terms of Service. If you do not agree, please do not use our services.
          </Text>

          <Text style={{ fontFamily: "Manrope_700Bold", color: colors.text, fontSize: 18, marginBottom: 12 }}>
            2. User Accounts
          </Text>
          <Text style={{ fontFamily: "Manrope_500Medium", color: colors.textSecondary, fontSize: 14, lineHeight: 22, marginBottom: 24 }}>
            You must create an account to use most features of Rasvia. You are responsible for maintaining the confidentiality of your account credentials and for all activities that occur under your account.
          </Text>

          <Text style={{ fontFamily: "Manrope_700Bold", color: colors.text, fontSize: 18, marginBottom: 12 }}>
            3. Ordering and Payments
          </Text>
          <Text style={{ fontFamily: "Manrope_500Medium", color: colors.textSecondary, fontSize: 14, lineHeight: 22, marginBottom: 24 }}>
            Rasvia facilitates ordering from partner restaurants. Prices and availability are set by the restaurants and may change. All payments are processed securely via Stripe. Refunds are handled on a case-by-case basis by the respective restaurant.
          </Text>

          <Text style={{ fontFamily: "Manrope_700Bold", color: colors.text, fontSize: 18, marginBottom: 12 }}>
            4. Acceptable Use
          </Text>
          <Text style={{ fontFamily: "Manrope_500Medium", color: colors.textSecondary, fontSize: 14, lineHeight: 22, marginBottom: 24 }}>
            You agree not to use the app for any unlawful purpose or in any way that interrupts, damages, or impairs the service. We reserve the right to suspend or terminate accounts that violate these terms.
          </Text>

          <Text style={{ fontFamily: "Manrope_700Bold", color: colors.text, fontSize: 18, marginBottom: 12 }}>
            5. Changes to Terms
          </Text>
          <Text style={{ fontFamily: "Manrope_500Medium", color: colors.textSecondary, fontSize: 14, lineHeight: 22, marginBottom: 24 }}>
            We may update these Terms of Service occasionally. Continued use of the app after changes constitutes acceptance of the new terms.
          </Text>

          <Text style={{ fontFamily: "Manrope_700Bold", color: colors.textMuted, fontSize: 12, marginTop: 40, textAlign: "center" }}>
            Last Updated: March 16, 2026
          </Text>
      </ScrollView>
    </View>
  );
}
