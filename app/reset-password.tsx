import React, { useState, useEffect } from "react";
import {
  View,
  Text,
  TextInput,
  Pressable,
  ActivityIndicator,
  Platform,
  ScrollView,
} from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";
import { LinearGradient } from "expo-linear-gradient";
import { Lock, Eye, EyeOff, CheckCircle, ShieldCheck } from "lucide-react-native";
import { useRouter } from "expo-router";
import Animated, { FadeIn, FadeInUp } from "react-native-reanimated";
import * as Haptics from "expo-haptics";
import { supabase } from "@/lib/supabase";
import { InAppNotification } from "@/components/InAppNotification";

export default function ResetPasswordScreen() {
  const router = useRouter();
  const [newPassword, setNewPassword] = useState("");
  const [confirmPassword, setConfirmPassword] = useState("");
  const [showPassword, setShowPassword] = useState(false);
  const [showConfirm, setShowConfirm] = useState(false);
  const [loading, setLoading] = useState(false);
  const [success, setSuccess] = useState(false);
  const [notification, setNotification] = useState<{
    visible: boolean;
    message: string;
    type: "error" | "success" | "info";
  }>({ visible: false, message: "", type: "error" });

  // Validate password has at least 6 characters
  const isPasswordValid = newPassword.length >= 6;
  const doPasswordsMatch = newPassword === confirmPassword && confirmPassword.length > 0;
  const canSubmit = isPasswordValid && doPasswordsMatch && !loading;

  async function handleResetPassword() {
    if (!canSubmit) return;

    setLoading(true);
    try {
      if (Platform.OS !== "web") {
        Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Medium);
      }

      const { error } = await supabase.auth.updateUser({
        password: newPassword,
      });

      if (error) throw error;

      setSuccess(true);
      if (Platform.OS !== "web") {
        Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
      }

      // Navigate to auth after a brief pause
      setTimeout(() => {
        router.replace("/auth");
      }, 2000);
    } catch (e: any) {
      setNotification({
        visible: true,
        message: e.message || "Failed to reset password. Please try again.",
        type: "error",
      });
      if (Platform.OS !== "web") {
        Haptics.notificationAsync(Haptics.NotificationFeedbackType.Error);
      }
    } finally {
      setLoading(false);
    }
  }

  if (success) {
    return (
      <View style={{ flex: 1, backgroundColor: "#0f0f0f" }}>
        <LinearGradient
          colors={["#1a0a00", "#0f0f0f", "#0f0f0f"]}
          locations={[0, 0.4, 1]}
          style={{ position: "absolute", top: 0, left: 0, right: 0, bottom: 0 }}
        />
        <SafeAreaView style={{ flex: 1, alignItems: "center", justifyContent: "center", paddingHorizontal: 32 }}>
          <Animated.View entering={FadeIn.duration(600)} style={{ alignItems: "center" }}>
            <View
              style={{
                width: 80,
                height: 80,
                borderRadius: 40,
                backgroundColor: "rgba(34,197,94,0.15)",
                borderWidth: 1.5,
                borderColor: "rgba(34,197,94,0.35)",
                alignItems: "center",
                justifyContent: "center",
                marginBottom: 24,
              }}
            >
              <CheckCircle size={40} color="#22C55E" />
            </View>
            <Text
              style={{
                fontFamily: "BricolageGrotesque_700Bold",
                color: "#22C55E",
                fontSize: 26,
                textAlign: "center",
                marginBottom: 12,
              }}
            >
              Password Updated!
            </Text>
            <Text
              style={{
                fontFamily: "Manrope_500Medium",
                color: "#999",
                fontSize: 15,
                textAlign: "center",
                lineHeight: 22,
              }}
            >
              Your password has been successfully changed. Redirecting to sign in...
            </Text>
          </Animated.View>
        </SafeAreaView>
      </View>
    );
  }

  return (
    <View style={{ flex: 1, backgroundColor: "#0f0f0f" }}>
      <InAppNotification
        visible={notification.visible}
        message={notification.message}
        type={notification.type}
        onDismiss={() => setNotification({ ...notification, visible: false })}
      />

      <LinearGradient
        colors={["#1a0a00", "#0f0f0f", "#0f0f0f"]}
        locations={[0, 0.4, 1]}
        style={{ position: "absolute", top: 0, left: 0, right: 0, bottom: 0 }}
      />

      <SafeAreaView style={{ flex: 1 }}>
        <ScrollView
          contentContainerStyle={{ flexGrow: 1, justifyContent: "center", paddingHorizontal: 24 }}
          keyboardShouldPersistTaps="handled"
          showsVerticalScrollIndicator={false}
          bounces={false}
        >
          {/* Logo */}
          <Animated.Text
            entering={FadeIn.duration(600)}
            style={{
              fontFamily: "BricolageGrotesque_800ExtraBold",
              color: "#FF9933",
              fontSize: 42,
              letterSpacing: -1,
              textAlign: "center",
              marginBottom: 40,
            }}
          >
            rasvia
          </Animated.Text>

          {/* Icon */}
          <Animated.View
            entering={FadeInUp.delay(150).duration(600)}
            style={{ alignItems: "center", marginBottom: 24 }}
          >
            <View
              style={{
                width: 72,
                height: 72,
                borderRadius: 36,
                backgroundColor: "rgba(255,153,51,0.12)",
                borderWidth: 1,
                borderColor: "rgba(255,153,51,0.25)",
                alignItems: "center",
                justifyContent: "center",
              }}
            >
              <ShieldCheck size={32} color="#FF9933" />
            </View>
          </Animated.View>

          {/* Title */}
          <Animated.Text
            entering={FadeInUp.delay(250).duration(600)}
            style={{
              fontFamily: "BricolageGrotesque_700Bold",
              color: "#f5f5f5",
              fontSize: 26,
              textAlign: "center",
              marginBottom: 8,
            }}
          >
            Set New Password
          </Animated.Text>

          <Animated.Text
            entering={FadeInUp.delay(300).duration(600)}
            style={{
              fontFamily: "Manrope_500Medium",
              color: "#999",
              fontSize: 14,
              textAlign: "center",
              lineHeight: 20,
              marginBottom: 32,
            }}
          >
            Choose a strong password for your account.
          </Animated.Text>

          {/* Form Card */}
          <Animated.View
            entering={FadeInUp.delay(400).duration(600)}
            style={{
              backgroundColor: "rgba(26,26,26,0.92)",
              borderRadius: 24,
              borderWidth: 1,
              borderColor: "rgba(255,255,255,0.06)",
              padding: 24,
            }}
          >
            {/* New Password */}
            <Text style={{ fontFamily: "Manrope_600SemiBold", color: "#999", fontSize: 12, letterSpacing: 1, textTransform: "uppercase", marginBottom: 8 }}>
              New Password
            </Text>
            <View
              style={{
                flexDirection: "row",
                alignItems: "center",
                backgroundColor: "#262626",
                borderRadius: 16,
                borderWidth: 1,
                borderColor: newPassword.length > 0 && !isPasswordValid ? "#EF4444" : "#333",
                paddingHorizontal: 16,
                height: 56,
                marginBottom: 4,
              }}
            >
              <Lock size={18} color="#999" />
              <TextInput
                style={{
                  flex: 1,
                  color: "#f5f5f5",
                  fontFamily: "Manrope_500Medium",
                  fontSize: 15,
                  marginLeft: 12,
                }}
                placeholder="At least 6 characters"
                placeholderTextColor="#666"
                value={newPassword}
                onChangeText={setNewPassword}
                secureTextEntry={!showPassword && newPassword.length > 0}
                autoCapitalize="none"
                keyboardAppearance="dark"
              />
              <Pressable onPress={() => setShowPassword(!showPassword)} hitSlop={10}>
                {showPassword ? <EyeOff size={18} color="#999" /> : <Eye size={18} color="#999" />}
              </Pressable>
            </View>
            {newPassword.length > 0 && !isPasswordValid && (
              <Text style={{ fontFamily: "Manrope_500Medium", color: "#EF4444", fontSize: 11, marginLeft: 4, marginBottom: 12 }}>
                Password must be at least 6 characters
              </Text>
            )}
            {(newPassword.length === 0 || isPasswordValid) && <View style={{ height: 16 }} />}

            {/* Confirm Password */}
            <Text style={{ fontFamily: "Manrope_600SemiBold", color: "#999", fontSize: 12, letterSpacing: 1, textTransform: "uppercase", marginBottom: 8 }}>
              Confirm Password
            </Text>
            <View
              style={{
                flexDirection: "row",
                alignItems: "center",
                backgroundColor: "#262626",
                borderRadius: 16,
                borderWidth: 1,
                borderColor: confirmPassword.length > 0 && !doPasswordsMatch ? "#EF4444" : "#333",
                paddingHorizontal: 16,
                height: 56,
                marginBottom: 4,
              }}
            >
              <Lock size={18} color="#999" />
              <TextInput
                style={{
                  flex: 1,
                  color: "#f5f5f5",
                  fontFamily: "Manrope_500Medium",
                  fontSize: 15,
                  marginLeft: 12,
                }}
                placeholder="Re-enter password"
                placeholderTextColor="#666"
                value={confirmPassword}
                onChangeText={setConfirmPassword}
                secureTextEntry={!showConfirm && confirmPassword.length > 0}
                autoCapitalize="none"
                keyboardAppearance="dark"
                onSubmitEditing={handleResetPassword}
              />
              <Pressable onPress={() => setShowConfirm(!showConfirm)} hitSlop={10}>
                {showConfirm ? <EyeOff size={18} color="#999" /> : <Eye size={18} color="#999" />}
              </Pressable>
            </View>
            {confirmPassword.length > 0 && !doPasswordsMatch && (
              <Text style={{ fontFamily: "Manrope_500Medium", color: "#EF4444", fontSize: 11, marginLeft: 4, marginBottom: 12 }}>
                Passwords do not match
              </Text>
            )}
            {(confirmPassword.length === 0 || doPasswordsMatch) && <View style={{ height: 20 }} />}

            {/* Submit Button */}
            <Pressable
              onPress={handleResetPassword}
              disabled={!canSubmit}
              style={{
                backgroundColor: canSubmit ? "#FF9933" : "#333",
                borderRadius: 16,
                height: 56,
                alignItems: "center",
                justifyContent: "center",
                shadowColor: canSubmit ? "#FF9933" : "transparent",
                shadowOffset: { width: 0, height: 4 },
                shadowOpacity: canSubmit ? 0.35 : 0,
                shadowRadius: 16,
                elevation: canSubmit ? 10 : 0,
              }}
            >
              {loading ? (
                <ActivityIndicator color="#0f0f0f" />
              ) : (
                <Text
                  style={{
                    fontFamily: "BricolageGrotesque_700Bold",
                    color: canSubmit ? "#0f0f0f" : "#888",
                    fontSize: 17,
                  }}
                >
                  Update Password
                </Text>
              )}
            </Pressable>
          </Animated.View>

          {/* Back to sign in */}
          <Animated.View entering={FadeInUp.delay(500).duration(600)} style={{ alignItems: "center", marginTop: 24 }}>
            <Pressable
              onPress={() => router.replace("/auth")}
              style={{ paddingVertical: 8 }}
            >
              <Text style={{ fontFamily: "Manrope_600SemiBold", color: "#FF9933", fontSize: 14 }}>
                Back to Sign In
              </Text>
            </Pressable>
          </Animated.View>
        </ScrollView>
      </SafeAreaView>
    </View>
  );
}
