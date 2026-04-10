import React, { useState, useRef, useEffect } from "react";
import {
  View,
  Text,
  TextInput,
  Pressable,
  Modal,
  ActivityIndicator,
  Platform,
  KeyboardAvoidingView,
  TouchableWithoutFeedback,
  Keyboard,
} from "react-native";
import Animated, { FadeIn, FadeInDown } from "react-native-reanimated";
import { Lock, Eye, EyeOff, Mail, ShieldCheck, ArrowLeft, CheckCircle, RefreshCw, X } from "lucide-react-native";
import * as Haptics from "expo-haptics";
import { supabase } from "@/lib/supabase";

interface ResetPasswordModalProps {
  visible: boolean;
  initialEmail?: string;
  onClose: () => void;
  onSuccess: () => void;
}

type ResetStep = "enter-email" | "sending" | "enter-code" | "new-password" | "updating" | "success";

export function ResetPasswordModal({ visible, initialEmail = "", onClose, onSuccess }: ResetPasswordModalProps) {
  const [step, setStep] = useState<ResetStep>("enter-email");
  const [email, setEmail] = useState(initialEmail);
  const [code, setCode] = useState("");
  const [newPassword, setNewPassword] = useState("");
  const [confirmPassword, setConfirmPassword] = useState("");
  const [showPassword, setShowPassword] = useState(false);
  const [error, setError] = useState("");
  const [resendCooldown, setResendCooldown] = useState(0);
  const codeInputRef = useRef<TextInput>(null);
  const cooldownInterval = useRef<ReturnType<typeof setInterval> | null>(null);

  // Reset state when modal opens
  useEffect(() => {
    if (visible) {
      setStep(initialEmail ? "enter-email" : "enter-email");
      setEmail(initialEmail || "");
      setCode("");
      setNewPassword("");
      setConfirmPassword("");
      setShowPassword(false);
      setError("");
      setResendCooldown(0);
    }
    return () => {
      if (cooldownInterval.current) clearInterval(cooldownInterval.current);
    };
  }, [visible, initialEmail]);

  useEffect(() => {
    if (step === "enter-code") {
      setTimeout(() => codeInputRef.current?.focus(), 300);
    }
  }, [step]);

  function startCooldown() {
    setResendCooldown(60);
    if (cooldownInterval.current) clearInterval(cooldownInterval.current);
    cooldownInterval.current = setInterval(() => {
      setResendCooldown((prev) => {
        if (prev <= 1) {
          if (cooldownInterval.current) clearInterval(cooldownInterval.current);
          return 0;
        }
        return prev - 1;
      });
    }, 1000);
  }

  async function handleSendCode() {
    if (!email.trim() || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email.trim())) {
      setError("Please enter a valid email address");
      return;
    }
    setStep("sending");
    setError("");
    try {
      const { error: resetError } = await supabase.auth.resetPasswordForEmail(email.trim());
      if (resetError) throw resetError;

      setStep("enter-code");
      startCooldown();
      if (Platform.OS !== "web") Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
    } catch (e: any) {
      setStep("enter-email");
      setError(e.message || "Failed to send reset code");
      if (Platform.OS !== "web") Haptics.notificationAsync(Haptics.NotificationFeedbackType.Error);
    }
  }

  async function handleVerifyCode() {
    if (code.length < 6) {
      setError("Please enter the full 6-digit code");
      return;
    }
    setError("");
    try {
      const { data, error: verifyError } = await supabase.auth.verifyOtp({
        email: email.trim(),
        token: code,
        type: "recovery",
      });

      if (verifyError) throw verifyError;

      setStep("new-password");
      if (Platform.OS !== "web") Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
    } catch (e: any) {
      setError(e.message || "Invalid code. Please try again.");
      setCode("");
      if (Platform.OS !== "web") Haptics.notificationAsync(Haptics.NotificationFeedbackType.Error);
    }
  }

  async function handleUpdatePassword() {
    if (newPassword.length < 6) {
      setError("Password must be at least 6 characters");
      return;
    }
    if (newPassword !== confirmPassword) {
      setError("Passwords do not match");
      return;
    }
    setStep("updating");
    setError("");
    try {
      const { error: updateError } = await supabase.auth.updateUser({
        password: newPassword,
      });
      if (updateError) throw updateError;

      setStep("success");
      if (Platform.OS !== "web") Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
      setTimeout(() => {
        onSuccess();
        onClose();
      }, 1500);
    } catch (e: any) {
      setStep("new-password");
      setError(e.message || "Failed to update password");
      if (Platform.OS !== "web") Haptics.notificationAsync(Haptics.NotificationFeedbackType.Error);
    }
  }

  const isPasswordValid = newPassword.length >= 6;
  const doPasswordsMatch = newPassword === confirmPassword && confirmPassword.length > 0;

  return (
    <Modal visible={visible} transparent animationType="fade" onRequestClose={onClose}>
      <KeyboardAvoidingView
        behavior={Platform.OS === "ios" ? "padding" : "height"}
        style={{ flex: 1, backgroundColor: "rgba(0,0,0,0.7)", justifyContent: "center", padding: 20 }}
      >
        <TouchableWithoutFeedback onPress={Keyboard.dismiss}>
          <Animated.View
            entering={FadeIn.duration(300)}
            style={{
              backgroundColor: "#141414",
              borderRadius: 24,
              borderWidth: 1,
              borderColor: "#2a2a2a",
              overflow: "hidden",
            }}
          >
            {/* Header */}
            <View
              style={{
                flexDirection: "row",
                alignItems: "center",
                justifyContent: "space-between",
                paddingHorizontal: 20,
                paddingTop: 20,
                paddingBottom: 4,
              }}
            >
              {(step === "enter-code" || step === "new-password") ? (
                <Pressable
                  onPress={() => {
                    if (step === "new-password") {
                      setStep("enter-code");
                    } else {
                      setStep("enter-email");
                    }
                    setError("");
                  }}
                  hitSlop={10}
                  style={{ flexDirection: "row", alignItems: "center", gap: 6 }}
                >
                  <ArrowLeft size={18} color="#FF9933" />
                  <Text style={{ fontFamily: "Manrope_600SemiBold", color: "#FF9933", fontSize: 14 }}>Back</Text>
                </Pressable>
              ) : (
                <View />
              )}
              <Pressable onPress={onClose} hitSlop={10}>
                <X size={20} color="#888" />
              </Pressable>
            </View>

            <View style={{ paddingHorizontal: 24, paddingBottom: 28, paddingTop: 8 }}>

              {/* ─── Step: Enter Email ─── */}
              {(step === "enter-email" || step === "sending") && (
                <Animated.View entering={FadeInDown.duration(400)}>
                  <View style={{ alignItems: "center", marginBottom: 20 }}>
                    <View
                      style={{
                        width: 64, height: 64, borderRadius: 32,
                        backgroundColor: "rgba(255,153,51,0.12)",
                        borderWidth: 1, borderColor: "rgba(255,153,51,0.25)",
                        alignItems: "center", justifyContent: "center",
                        marginBottom: 16,
                      }}
                    >
                      <Lock size={28} color="#FF9933" />
                    </View>
                    <Text style={{ fontFamily: "BricolageGrotesque_700Bold", color: "#f5f5f5", fontSize: 22, textAlign: "center", marginBottom: 8 }}>
                      Reset Password
                    </Text>
                    <Text style={{ fontFamily: "Manrope_500Medium", color: "#999", fontSize: 14, textAlign: "center", lineHeight: 20 }}>
                      Enter your email and we'll send you a 6-digit code
                    </Text>
                  </View>

                  {/* Email input */}
                  <View
                    style={{
                      flexDirection: "row",
                      alignItems: "center",
                      backgroundColor: "#1a1a1a",
                      borderRadius: 16,
                      borderWidth: 1.5,
                      borderColor: error ? "#EF4444" : "#333",
                      paddingHorizontal: 16,
                      height: 56,
                      marginBottom: 12,
                    }}
                  >
                    <Mail size={18} color="#999" />
                    <TextInput
                      style={{
                        flex: 1, color: "#f5f5f5",
                        fontFamily: "Manrope_500Medium", fontSize: 15,
                        marginLeft: 12,
                      }}
                      placeholder="Email address"
                      placeholderTextColor="#666"
                      value={email}
                      onChangeText={(t) => { setEmail(t); setError(""); }}
                      autoCapitalize="none"
                      keyboardType="email-address"
                      keyboardAppearance="dark"
                      autoFocus={!initialEmail}
                      onSubmitEditing={handleSendCode}
                    />
                  </View>

                  {!!error && (
                    <Text style={{ fontFamily: "Manrope_500Medium", color: "#EF4444", fontSize: 13, textAlign: "center", marginBottom: 8 }}>
                      {error}
                    </Text>
                  )}

                  <Pressable
                    onPress={handleSendCode}
                    disabled={step === "sending"}
                    style={{
                      backgroundColor: "#FF9933",
                      borderRadius: 16,
                      height: 52,
                      alignItems: "center",
                      justifyContent: "center",
                      opacity: step === "sending" ? 0.7 : 1,
                      shadowColor: "#FF9933",
                      shadowOffset: { width: 0, height: 4 },
                      shadowOpacity: 0.3,
                      shadowRadius: 12,
                    }}
                  >
                    {step === "sending" ? (
                      <ActivityIndicator color="#0f0f0f" />
                    ) : (
                      <Text style={{ fontFamily: "BricolageGrotesque_700Bold", color: "#0f0f0f", fontSize: 16 }}>
                        Send Reset Code
                      </Text>
                    )}
                  </Pressable>
                </Animated.View>
              )}

              {/* ─── Step: Enter Code ─── */}
              {step === "enter-code" && (
                <Animated.View entering={FadeInDown.duration(400)}>
                  <View style={{ alignItems: "center", marginBottom: 20 }}>
                    <View
                      style={{
                        width: 64, height: 64, borderRadius: 32,
                        backgroundColor: "rgba(96,165,250,0.12)",
                        borderWidth: 1, borderColor: "rgba(96,165,250,0.25)",
                        alignItems: "center", justifyContent: "center",
                        marginBottom: 16,
                      }}
                    >
                      <ShieldCheck size={28} color="#60A5FA" />
                    </View>
                    <Text style={{ fontFamily: "BricolageGrotesque_700Bold", color: "#f5f5f5", fontSize: 22, textAlign: "center", marginBottom: 8 }}>
                      Enter Code
                    </Text>
                    <Text style={{ fontFamily: "Manrope_500Medium", color: "#999", fontSize: 14, textAlign: "center", lineHeight: 20 }}>
                      We sent a 6-digit code to
                    </Text>
                    <Text style={{ fontFamily: "Manrope_700Bold", color: "#60A5FA", fontSize: 15, marginTop: 4 }}>
                      {email}
                    </Text>
                  </View>

                  <View
                    style={{
                      backgroundColor: "#1a1a1a",
                      borderRadius: 16,
                      borderWidth: 1.5,
                      borderColor: error ? "#EF4444" : "#333",
                      height: 60,
                      alignItems: "center",
                      justifyContent: "center",
                      marginBottom: 12,
                    }}
                  >
                    <TextInput
                      ref={codeInputRef}
                      value={code}
                      onChangeText={(text) => {
                        setCode(text.replace(/\D/g, "").slice(0, 6));
                        setError("");
                      }}
                      style={{
                        color: "#f5f5f5",
                        fontFamily: "JetBrainsMono_600SemiBold",
                        fontSize: 28,
                        letterSpacing: 12,
                        textAlign: "center",
                        width: "100%",
                        height: "100%",
                      }}
                      placeholder="------"
                      placeholderTextColor="#444"
                      keyboardType="number-pad"
                      maxLength={6}
                      autoFocus
                      keyboardAppearance="dark"
                      onSubmitEditing={handleVerifyCode}
                    />
                  </View>

                  {!!error && (
                    <Text style={{ fontFamily: "Manrope_500Medium", color: "#EF4444", fontSize: 13, textAlign: "center", marginBottom: 8 }}>
                      {error}
                    </Text>
                  )}

                  <View style={{ alignItems: "center", marginBottom: 16 }}>
                    {resendCooldown > 0 ? (
                      <Text style={{ fontFamily: "Manrope_500Medium", color: "#666", fontSize: 13 }}>
                        Resend in {resendCooldown}s
                      </Text>
                    ) : (
                      <Pressable onPress={handleSendCode} style={{ flexDirection: "row", alignItems: "center", gap: 6 }}>
                        <RefreshCw size={14} color="#FF9933" />
                        <Text style={{ fontFamily: "Manrope_600SemiBold", color: "#FF9933", fontSize: 13 }}>Resend Code</Text>
                      </Pressable>
                    )}
                  </View>

                  <Pressable
                    onPress={handleVerifyCode}
                    disabled={code.length < 6}
                    style={{
                      backgroundColor: code.length >= 6 ? "#FF9933" : "#333",
                      borderRadius: 16, height: 52,
                      alignItems: "center", justifyContent: "center",
                    }}
                  >
                    <Text style={{ fontFamily: "BricolageGrotesque_700Bold", color: code.length >= 6 ? "#0f0f0f" : "#888", fontSize: 16 }}>
                      Verify Code
                    </Text>
                  </Pressable>
                </Animated.View>
              )}

              {/* ─── Step: New Password ─── */}
              {(step === "new-password" || step === "updating") && (
                <Animated.View entering={FadeInDown.duration(400)}>
                  <View style={{ alignItems: "center", marginBottom: 20 }}>
                    <View
                      style={{
                        width: 64, height: 64, borderRadius: 32,
                        backgroundColor: "rgba(34,197,94,0.12)",
                        borderWidth: 1, borderColor: "rgba(34,197,94,0.25)",
                        alignItems: "center", justifyContent: "center",
                        marginBottom: 16,
                      }}
                    >
                      <Lock size={28} color="#22C55E" />
                    </View>
                    <Text style={{ fontFamily: "BricolageGrotesque_700Bold", color: "#f5f5f5", fontSize: 22, textAlign: "center", marginBottom: 8 }}>
                      New Password
                    </Text>
                    <Text style={{ fontFamily: "Manrope_500Medium", color: "#999", fontSize: 14, textAlign: "center", lineHeight: 20 }}>
                      Choose a strong password for your account
                    </Text>
                  </View>

                  {/* New Password */}
                  <View
                    style={{
                      flexDirection: "row", alignItems: "center",
                      backgroundColor: "#1a1a1a",
                      borderRadius: 16, borderWidth: 1.5,
                      borderColor: newPassword.length > 0 && !isPasswordValid ? "#EF4444" : "#333",
                      paddingHorizontal: 16, height: 56,
                      marginBottom: 12,
                    }}
                  >
                    <Lock size={18} color="#999" />
                    <TextInput
                      style={{
                        flex: 1, color: "#f5f5f5",
                        fontFamily: "Manrope_500Medium", fontSize: 15,
                        marginLeft: 12,
                      }}
                      placeholder="New password (min 6 chars)"
                      placeholderTextColor="#666"
                      value={newPassword}
                      onChangeText={(t) => { setNewPassword(t); setError(""); }}
                      secureTextEntry={!showPassword}
                      autoCapitalize="none"
                      keyboardAppearance="dark"
                    />
                    <Pressable onPress={() => setShowPassword(!showPassword)} hitSlop={10}>
                      {showPassword ? <EyeOff size={18} color="#999" /> : <Eye size={18} color="#999" />}
                    </Pressable>
                  </View>

                  {/* Confirm Password */}
                  <View
                    style={{
                      flexDirection: "row", alignItems: "center",
                      backgroundColor: "#1a1a1a",
                      borderRadius: 16, borderWidth: 1.5,
                      borderColor: confirmPassword.length > 0 && !doPasswordsMatch ? "#EF4444" : "#333",
                      paddingHorizontal: 16, height: 56,
                      marginBottom: 12,
                    }}
                  >
                    <Lock size={18} color="#999" />
                    <TextInput
                      style={{
                        flex: 1, color: "#f5f5f5",
                        fontFamily: "Manrope_500Medium", fontSize: 15,
                        marginLeft: 12,
                      }}
                      placeholder="Confirm password"
                      placeholderTextColor="#666"
                      value={confirmPassword}
                      onChangeText={(t) => { setConfirmPassword(t); setError(""); }}
                      secureTextEntry={!showPassword}
                      autoCapitalize="none"
                      keyboardAppearance="dark"
                      onSubmitEditing={handleUpdatePassword}
                    />
                  </View>

                  {!!error && (
                    <Text style={{ fontFamily: "Manrope_500Medium", color: "#EF4444", fontSize: 13, textAlign: "center", marginBottom: 8 }}>
                      {error}
                    </Text>
                  )}

                  <Pressable
                    onPress={handleUpdatePassword}
                    disabled={step === "updating" || !isPasswordValid || !doPasswordsMatch}
                    style={{
                      backgroundColor: isPasswordValid && doPasswordsMatch ? "#FF9933" : "#333",
                      borderRadius: 16, height: 52,
                      alignItems: "center", justifyContent: "center",
                      opacity: step === "updating" ? 0.7 : 1,
                    }}
                  >
                    {step === "updating" ? (
                      <ActivityIndicator color="#0f0f0f" />
                    ) : (
                      <Text style={{
                        fontFamily: "BricolageGrotesque_700Bold",
                        color: isPasswordValid && doPasswordsMatch ? "#0f0f0f" : "#888",
                        fontSize: 16,
                      }}>
                        Update Password
                      </Text>
                    )}
                  </Pressable>
                </Animated.View>
              )}

              {/* ─── Success ─── */}
              {step === "success" && (
                <Animated.View entering={FadeIn.duration(600)} style={{ alignItems: "center", paddingVertical: 20 }}>
                  <View
                    style={{
                      width: 80, height: 80, borderRadius: 40,
                      backgroundColor: "rgba(34,197,94,0.15)",
                      borderWidth: 1.5, borderColor: "rgba(34,197,94,0.35)",
                      alignItems: "center", justifyContent: "center",
                      marginBottom: 20,
                    }}
                  >
                    <CheckCircle size={40} color="#22C55E" />
                  </View>
                  <Text style={{ fontFamily: "BricolageGrotesque_700Bold", color: "#22C55E", fontSize: 22, marginBottom: 8 }}>
                    Password Updated!
                  </Text>
                  <Text style={{ fontFamily: "Manrope_500Medium", color: "#999", fontSize: 14, textAlign: "center" }}>
                    You can now sign in with your new password.
                  </Text>
                </Animated.View>
              )}
            </View>
          </Animated.View>
        </TouchableWithoutFeedback>
      </KeyboardAvoidingView>
    </Modal>
  );
}
