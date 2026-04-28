import React from "react";
import { View, Text, ScrollView, Pressable, Platform } from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";
import { useRouter } from "expo-router";
import { ArrowLeft } from "lucide-react-native";
import * as Haptics from "expo-haptics";
import { APP_BOTTOM_NAV_HEIGHT, APP_BOTTOM_NAV_OFFSET } from "@/components/AppBottomNav";
import { useAppTheme } from "@/lib/app-theme";

export default function PrivacyPolicyScreen() {
  const router = useRouter();
  const { colors } = useAppTheme();
  const bottomPad = APP_BOTTOM_NAV_HEIGHT + APP_BOTTOM_NAV_OFFSET + 32;
  const body = { fontFamily: "Manrope_500Medium" as const, color: colors.textSecondary, fontSize: 14, lineHeight: 22 };
  const bold = { fontFamily: "Manrope_700Bold" as const, color: colors.text };

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
              Privacy Policy
            </Text>
          </View>
        </SafeAreaView>
      </View>

      <ScrollView contentContainerStyle={{ padding: 20, paddingBottom: bottomPad }}>
          <Text style={{ fontFamily: "Manrope_500Medium", color: colors.textMuted, fontSize: 13, lineHeight: 20, marginBottom: 28 }}>
            Rasvia (&quot;we,&quot; &quot;us,&quot; or &quot;our&quot;) operates the Rasvia mobile application. This policy explains how we collect, use, and protect your information. By using Rasvia, you agree to this policy.
          </Text>

          <Text style={{ fontFamily: "Manrope_700Bold", color: colors.text, fontSize: 17, marginBottom: 10 }}>
            1. Information We Collect
          </Text>
          <Text style={{ ...body, marginBottom: 8 }}>
            <Text style={bold}>Account information:</Text> Name, email address, and phone number collected when you create an account.
          </Text>
          <Text style={{ ...body, marginBottom: 8 }}>
            <Text style={bold}>Location data:</Text> Approximate device location to show nearby restaurants. Location is only used while the app is in use. We do not track your location in the background.
          </Text>
          <Text style={{ ...body, marginBottom: 8 }}>
            <Text style={bold}>Order and payment data:</Text> Items ordered, order type, and payment status. Payment card details are processed directly by Stripe and are never stored on our servers.
          </Text>
          <Text style={{ ...body, marginBottom: 24 }}>
            <Text style={bold}>Usage data:</Text> Information about how you interact with the app (screens visited, features used) to help us improve the service.
          </Text>

          <Text style={{ fontFamily: "Manrope_700Bold", color: colors.text, fontSize: 17, marginBottom: 10 }}>
            2. How We Use Your Information
          </Text>
          <Text style={{ ...body, marginBottom: 24 }}>
            We use your information to: create and manage your account; process and fulfill your orders; send push notifications about your orders, waitlist status, and group orders (you can disable these in your device settings or within the app); show you restaurants near your location; and improve the app.
          </Text>

          <Text style={{ fontFamily: "Manrope_700Bold", color: colors.text, fontSize: 17, marginBottom: 10 }}>
            3. Information Sharing
          </Text>
          <Text style={{ ...body, marginBottom: 8 }}>We share your information only as necessary to operate Rasvia:</Text>
          <Text style={{ ...body, marginBottom: 8 }}>
            • <Text style={bold}>Partner Restaurants:</Text> Your name and order details are shared with the restaurant to fulfill your order.
          </Text>
          <Text style={{ ...body, marginBottom: 8 }}>
            • <Text style={bold}>Stripe:</Text> Our payment processor. Stripe&apos;s privacy policy applies to payment data: stripe.com/privacy.
          </Text>
          <Text style={{ ...body, marginBottom: 24 }}>
            • <Text style={bold}>Supabase:</Text> Our database and authentication provider. Data is stored securely on Supabase infrastructure.{"\n"}
            We do not sell your personal data to third parties.
          </Text>

          <Text style={{ fontFamily: "Manrope_700Bold", color: colors.text, fontSize: 17, marginBottom: 10 }}>
            4. Push Notifications
          </Text>
          <Text style={{ ...body, marginBottom: 24 }}>
            With your permission, we send push notifications for events such as table readiness, order status updates, and group order activity. You can opt out at any time in your device&apos;s notification settings or within the Rasvia app under Profile → Notifications.
          </Text>

          <Text style={{ fontFamily: "Manrope_700Bold", color: colors.text, fontSize: 17, marginBottom: 10 }}>
            5. Data Retention & Account Deletion
          </Text>
          <Text style={{ ...body, marginBottom: 8 }}>
            We retain your data for as long as your account is active. You can permanently delete your Rasvia account and all associated data at any time by going to:
          </Text>
          <Text style={{ fontFamily: "Manrope_600SemiBold", color: "#FF9933", fontSize: 14, lineHeight: 22, marginBottom: 8 }}>
            Profile → Account Settings → Danger Zone → Delete My Account
          </Text>
          <Text style={{ ...body, marginBottom: 24 }}>
            Account deletion removes your profile, order history, and preferences from our systems. This action is permanent and cannot be reversed.
          </Text>

          <Text style={{ fontFamily: "Manrope_700Bold", color: colors.text, fontSize: 17, marginBottom: 10 }}>
            6. Children&apos;s Privacy
          </Text>
          <Text style={{ ...body, marginBottom: 24 }}>
            Rasvia is not directed at children under the age of 13. We do not knowingly collect personal information from children under 13. If you believe a child has provided us with personal information, please contact us and we will delete it.
          </Text>

          <Text style={{ fontFamily: "Manrope_700Bold", color: colors.text, fontSize: 17, marginBottom: 10 }}>
            7. Data Security
          </Text>
          <Text style={{ ...body, marginBottom: 24 }}>
            We take reasonable technical and organizational measures to protect your information. Passwords are hashed and never stored in plaintext. All data is transmitted over encrypted connections (HTTPS/TLS).
          </Text>

          <Text style={{ fontFamily: "Manrope_700Bold", color: colors.text, fontSize: 17, marginBottom: 10 }}>
            8. Your Rights (California Residents)
          </Text>
          <Text style={{ ...body, marginBottom: 24 }}>
            Under the California Consumer Privacy Act (CCPA), California residents have the right to request access to their personal data, request deletion of their data, and opt out of the sale of personal data (we do not sell personal data). To exercise these rights, contact us at support@rasvia.com.
          </Text>

          <Text style={{ fontFamily: "Manrope_700Bold", color: colors.text, fontSize: 17, marginBottom: 10 }}>
            9. Changes to This Policy
          </Text>
          <Text style={{ ...body, marginBottom: 24 }}>
            We may update this Privacy Policy occasionally. We will notify you of significant changes through the app. Continued use of Rasvia after changes constitutes acceptance of the updated policy.
          </Text>

          <Text style={{ fontFamily: "Manrope_700Bold", color: colors.text, fontSize: 17, marginBottom: 10 }}>
            10. Contact Us
          </Text>
          <Text style={{ ...body, marginBottom: 40 }}>
            For questions or privacy requests, contact us at:{"\n"}
            <Text style={{ color: "#FF9933" }}>support@rasvia.com</Text>
          </Text>

          <Text style={{ fontFamily: "Manrope_700Bold", color: colors.textMuted, fontSize: 12, textAlign: "center" }}>
            Effective Date: March 3, 2025{"\n"}Last Updated: March 3, 2026
          </Text>
      </ScrollView>
    </View>
  );
}
