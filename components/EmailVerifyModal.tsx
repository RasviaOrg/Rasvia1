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
import { Mail, ShieldCheck, CheckCircle, RefreshCw, X } from "lucide-react-native";
import * as Haptics from "expo-haptics";
import { supabase } from "@/lib/supabase";

interface EmailVerifyModalProps {
  visible: boolean;
  email: string;
  onClose: () => void;
  onVerified: () => void;
}

type VerifyStep = "code-sent" | "verifying" | "success";

export function EmailVerifyModal({ visible, email, onClose, onVerified }: EmailVerifyModalProps) {
  const [step, setStep] = useState<VerifyStep>("code-sent");
  const [code, setCode] = useState("");
  const [error, setError] = useState("");
  const [resending, setResending] = useState(false);
  const [resendCooldown, setResendCooldown] = useState(60);
  const codeInputRef = useRef<TextInput>(null);
  const cooldownInterval = useRef<ReturnType<typeof setInterval> | null>(null);

  // Reset state when modal opens
  useEffect(() => {
    if (visible) {
      setStep("code-sent");
      setCode("");
      setError("");
      setResendCooldown(60);
      startCooldown();
      setTimeout(() => codeInputRef.current?.focus(), 300);
    }
    return () => {
      if (cooldownInterval.current) clearInterval(cooldownInterval.current);
    };
  }, [visible]);

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

  async function handleResend() {
    setResending(true);
    setError("");
    try {
      const { error: resendError } = await supabase.auth.resend({
        type: "signup",
        email,
      });
      if (resendError) throw resendError;
      startCooldown();
      if (Platform.OS !== "web") Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
    } catch (e: any) {
      setError(e.message || "Failed to resend code");
    } finally {
      setResending(false);
    }
  }

  async function handleVerify() {
    if (code.length < 6) {
      setError("Please enter the full 6-digit code");
      return;
    }
    setStep("verifying");
    setError("");
    try {
      const { data, error: verifyError } = await supabase.auth.verifyOtp({
        email,
        token: code,
        type: "signup",
      });

      if (verifyError) throw verifyError;

      setStep("success");
      if (Platform.OS !== "web") Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
      setTimeout(() => {
        onVerified();
      }, 1200);
    } catch (e: any) {
      setStep("code-sent");
      setError(e.message || "Invalid code. Please try again.");
      setCode("");
      if (Platform.OS !== "web") Haptics.notificationAsync(Haptics.NotificationFeedbackType.Error);
    }
  }

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
            {/* Close button */}
            <View
              style={{
                flexDirection: "row",
                justifyContent: "flex-end",
                paddingHorizontal: 20,
                paddingTop: 20,
                paddingBottom: 4,
              }}
            >
              <Pressable onPress={onClose} hitSlop={10}>
                <X size={20} color="#888" />
              </Pressable>
            </View>

            <View style={{ paddingHorizontal: 24, paddingBottom: 28, paddingTop: 4 }}>
              {/* ─── Enter Code ─── */}
              {(step === "code-sent" || step === "verifying") && (
                <Animated.View entering={FadeInDown.duration(400)}>
                  <View style={{ alignItems: "center", marginBottom: 20 }}>
                    <View
                      style={{
                        width: 64,
                        height: 64,
                        borderRadius: 32,
                        backgroundColor: "rgba(255,153,51,0.12)",
                        borderWidth: 1,
                        borderColor: "rgba(255,153,51,0.25)",
                        alignItems: "center",
                        justifyContent: "center",
                        marginBottom: 16,
                      }}
                    >
                      <Mail size={28} color="#FF9933" />
                    </View>
                    <Text style={{ fontFamily: "BricolageGrotesque_700Bold", color: "#f5f5f5", fontSize: 22, textAlign: "center", marginBottom: 8 }}>
                      Verify Your Email
                    </Text>
                    <Text style={{ fontFamily: "Manrope_500Medium", color: "#999", fontSize: 14, textAlign: "center", lineHeight: 20 }}>
                      Enter the 6-digit code sent to
                    </Text>
                    <Text style={{ fontFamily: "Manrope_700Bold", color: "#FF9933", fontSize: 15, marginTop: 4 }}>
                      {email}
                    </Text>
                  </View>

                  {/* Code input */}
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
                      onSubmitEditing={handleVerify}
                    />
                  </View>

                  {!!error && (
                    <Text style={{ fontFamily: "Manrope_500Medium", color: "#EF4444", fontSize: 13, textAlign: "center", marginBottom: 8 }}>
                      {error}
                    </Text>
                  )}

                  {/* Resend */}
                  <View style={{ alignItems: "center", marginBottom: 16 }}>
                    {resendCooldown > 0 ? (
                      <Text style={{ fontFamily: "Manrope_500Medium", color: "#666", fontSize: 13 }}>
                        Resend code in {resendCooldown}s
                      </Text>
                    ) : (
                      <Pressable
                        onPress={handleResend}
                        disabled={resending}
                        style={{ flexDirection: "row", alignItems: "center", gap: 6 }}
                      >
                        <RefreshCw size={14} color="#FF9933" />
                        <Text style={{ fontFamily: "Manrope_600SemiBold", color: "#FF9933", fontSize: 13 }}>
                          {resending ? "Sending..." : "Resend Code"}
                        </Text>
                      </Pressable>
                    )}
                  </View>

                  <Pressable
                    onPress={handleVerify}
                    disabled={step === "verifying" || code.length < 6}
                    style={{
                      backgroundColor: code.length >= 6 ? "#FF9933" : "#333",
                      borderRadius: 16,
                      height: 52,
                      alignItems: "center",
                      justifyContent: "center",
                      opacity: step === "verifying" ? 0.7 : 1,
                    }}
                  >
                    {step === "verifying" ? (
                      <ActivityIndicator color="#0f0f0f" />
                    ) : (
                      <Text
                        style={{
                          fontFamily: "BricolageGrotesque_700Bold",
                          color: code.length >= 6 ? "#0f0f0f" : "#888",
                          fontSize: 16,
                        }}
                      >
                        Verify Email
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
                      width: 80,
                      height: 80,
                      borderRadius: 40,
                      backgroundColor: "rgba(34,197,94,0.15)",
                      borderWidth: 1.5,
                      borderColor: "rgba(34,197,94,0.35)",
                      alignItems: "center",
                      justifyContent: "center",
                      marginBottom: 20,
                    }}
                  >
                    <CheckCircle size={40} color="#22C55E" />
                  </View>
                  <Text style={{ fontFamily: "BricolageGrotesque_700Bold", color: "#22C55E", fontSize: 22, marginBottom: 8 }}>
                    Email Verified!
                  </Text>
                  <Text style={{ fontFamily: "Manrope_500Medium", color: "#999", fontSize: 14, textAlign: "center" }}>
                    Your email has been confirmed. Welcome to Rasvia!
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
