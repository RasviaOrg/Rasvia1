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
import Animated, { FadeIn, FadeInDown, FadeInUp } from "react-native-reanimated";
import { Phone, ShieldCheck, ArrowLeft, CheckCircle, RefreshCw, X } from "lucide-react-native";
import * as Haptics from "expo-haptics";
import { supabase } from "@/lib/supabase";
import { parseEdgeFunctionError } from "@/lib/edge-function-error";
import { withTimeout } from "@/lib/with-timeout";

interface PhoneVerifyModalProps {
  visible: boolean;
  phone: string; // raw digits or formatted
  onClose: () => void;
  onVerified: () => void;
  /** If true, show a "Skip" button to dismiss without verifying */
  allowSkip?: boolean;
}

type VerifyStep = "ready" | "code-sent" | "verifying" | "success";
const SMS_REQUEST_TIMEOUT_MS = 12000;

export function PhoneVerifyModal({ visible, phone, onClose, onVerified, allowSkip = false }: PhoneVerifyModalProps) {
  const [step, setStep] = useState<VerifyStep>("ready");
  const [code, setCode] = useState("");
  const [error, setError] = useState("");
  const [sending, setSending] = useState(false);
  const [resendCooldown, setResendCooldown] = useState(0);
  const codeInputRef = useRef<TextInput>(null);
  const cooldownInterval = useRef<ReturnType<typeof setInterval> | null>(null);

  const rawDigits = phone.replace(/\D/g, "");
  const formattedPhone = formatPhoneDisplay(rawDigits);

  // Reset state when modal opens
  useEffect(() => {
    if (visible) {
      setStep("ready");
      setCode("");
      setError("");
      setSending(false);
      setResendCooldown(0);
    }
    return () => {
      if (cooldownInterval.current) clearInterval(cooldownInterval.current);
    };
  }, [visible]);

  // Auto-focus code input when code-sent step is reached
  useEffect(() => {
    if (step === "code-sent") {
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
    if (rawDigits.length !== 10) {
      setError("Please enter a valid 10-digit phone number.");
      return;
    }
    setSending(true);
    setError("");
    try {
      const { data: authData, error: authError } = await withTimeout(
        supabase.auth.getSession(),
        SMS_REQUEST_TIMEOUT_MS,
        "Timed out while validating your session. Please reopen the app and try again."
      );
      if (authError) throw authError;
      const accessToken = authData?.session?.access_token;
      if (!accessToken) {
        throw new Error("Your session expired. Please sign in again.");
      }

      const { data, error: fnError } = await withTimeout(
        supabase.functions.invoke("sms-verify", {
          body: { action: "send-code", phone: rawDigits },
          headers: { Authorization: `Bearer ${accessToken}` },
        }),
        SMS_REQUEST_TIMEOUT_MS,
        "Timed out while sending your verification code. Please try again."
      );

      if (fnError) {
        const parsed = await parseEdgeFunctionError(fnError, "Failed to send verification code.");
        throw new Error(parsed.message);
      }
      if (data?.error) throw new Error(data.error);

      setStep("code-sent");
      startCooldown();
      if (Platform.OS !== "web") Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
    } catch (e: any) {
      setError(e.message || "Failed to send verification code");
      if (Platform.OS !== "web") Haptics.notificationAsync(Haptics.NotificationFeedbackType.Error);
    } finally {
      setSending(false);
    }
  }

  async function handleVerifyCode() {
    if (code.length < 4) {
      setError("Please enter the full verification code");
      return;
    }
    setStep("verifying");
    setError("");
    try {
      const { data: authData, error: authError } = await withTimeout(
        supabase.auth.getSession(),
        SMS_REQUEST_TIMEOUT_MS,
        "Timed out while validating your session. Please reopen the app and try again."
      );
      if (authError) throw authError;
      const accessToken = authData?.session?.access_token;
      if (!accessToken) {
        throw new Error("Your session expired. Please sign in again.");
      }

      const { data, error: fnError } = await withTimeout(
        supabase.functions.invoke("sms-verify", {
          body: { action: "check-code", phone: rawDigits, code },
          headers: { Authorization: `Bearer ${accessToken}` },
        }),
        SMS_REQUEST_TIMEOUT_MS,
        "Timed out while checking the verification code. Please try again."
      );

      if (fnError) {
        const parsed = await parseEdgeFunctionError(fnError, "Verification failed.");
        throw new Error(parsed.message);
      }
      if (data?.error) throw new Error(data.error);

      if (data?.status === "approved" && data?.valid) {
        setStep("success");
        if (Platform.OS !== "web") Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
        setTimeout(() => {
          onVerified();
          onClose();
        }, 1500);
      } else {
        setStep("code-sent");
        setError("Incorrect code. Please try again.");
        setCode("");
        if (Platform.OS !== "web") Haptics.notificationAsync(Haptics.NotificationFeedbackType.Error);
      }
    } catch (e: any) {
      setStep("code-sent");
      setError(e.message || "Verification failed");
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
              {step === "code-sent" ? (
                <Pressable
                  onPress={() => { setStep("ready"); setCode(""); setError(""); }}
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

            <View style={{ paddingHorizontal: 24, paddingBottom: 28, paddingTop: 12 }}>
              {/* ─── Step: Ready to send ─── */}
              {step === "ready" && (
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
                      <Phone size={28} color="#FF9933" />
                    </View>
                    <Text style={{ fontFamily: "BricolageGrotesque_700Bold", color: "#f5f5f5", fontSize: 22, textAlign: "center", marginBottom: 8 }}>
                      Verify Your Phone
                    </Text>
                    <Text style={{ fontFamily: "Manrope_500Medium", color: "#999", fontSize: 14, textAlign: "center", lineHeight: 20 }}>
                      We'll send a verification code to
                    </Text>
                    <Text style={{ fontFamily: "Manrope_700Bold", color: "#FF9933", fontSize: 16, marginTop: 4 }}>
                      {formattedPhone}
                    </Text>
                  </View>

                  {!!error && (
                    <Text style={{ fontFamily: "Manrope_500Medium", color: "#EF4444", fontSize: 13, textAlign: "center", marginBottom: 12 }}>
                      {error}
                    </Text>
                  )}

                  <Pressable
                    onPress={handleSendCode}
                    disabled={sending}
                    style={{
                      backgroundColor: "#FF9933",
                      borderRadius: 16,
                      height: 52,
                      alignItems: "center",
                      justifyContent: "center",
                      shadowColor: "#FF9933",
                      shadowOffset: { width: 0, height: 4 },
                      shadowOpacity: 0.3,
                      shadowRadius: 12,
                      elevation: 8,
                      opacity: sending ? 0.7 : 1,
                    }}
                  >
                    {sending ? (
                      <ActivityIndicator color="#0f0f0f" />
                    ) : (
                      <Text style={{ fontFamily: "BricolageGrotesque_700Bold", color: "#0f0f0f", fontSize: 16 }}>
                        Send Verification Code
                      </Text>
                    )}
                  </Pressable>

                  {allowSkip && (
                    <Pressable onPress={onClose} style={{ alignItems: "center", marginTop: 14 }}>
                      <Text style={{ fontFamily: "Manrope_600SemiBold", color: "#888", fontSize: 14 }}>
                        Skip for now
                      </Text>
                    </Pressable>
                  )}
                </Animated.View>
              )}

              {/* ─── Step: Enter code ─── */}
              {(step === "code-sent" || step === "verifying") && (
                <Animated.View entering={FadeInDown.duration(400)}>
                  <View style={{ alignItems: "center", marginBottom: 20 }}>
                    <View
                      style={{
                        width: 64,
                        height: 64,
                        borderRadius: 32,
                        backgroundColor: "rgba(96,165,250,0.12)",
                        borderWidth: 1,
                        borderColor: "rgba(96,165,250,0.25)",
                        alignItems: "center",
                        justifyContent: "center",
                        marginBottom: 16,
                      }}
                    >
                      <ShieldCheck size={28} color="#60A5FA" />
                    </View>
                    <Text style={{ fontFamily: "BricolageGrotesque_700Bold", color: "#f5f5f5", fontSize: 22, textAlign: "center", marginBottom: 8 }}>
                      Enter Code
                    </Text>
                    <Text style={{ fontFamily: "Manrope_500Medium", color: "#999", fontSize: 14, textAlign: "center", lineHeight: 20 }}>
                      We sent a code to {formattedPhone}
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
                      onSubmitEditing={handleVerifyCode}
                    />
                  </View>

                  {!!error && (
                    <Text style={{ fontFamily: "Manrope_500Medium", color: "#EF4444", fontSize: 13, textAlign: "center", marginBottom: 8 }}>
                      {error}
                    </Text>
                  )}

                  {/* Resend button */}
                  <View style={{ alignItems: "center", marginBottom: 16 }}>
                    {resendCooldown > 0 ? (
                      <Text style={{ fontFamily: "Manrope_500Medium", color: "#666", fontSize: 13 }}>
                        Resend code in {resendCooldown}s
                      </Text>
                    ) : (
                      <Pressable
                        onPress={handleSendCode}
                        disabled={sending}
                        style={{ flexDirection: "row", alignItems: "center", gap: 6 }}
                      >
                        <RefreshCw size={14} color="#FF9933" />
                        <Text style={{ fontFamily: "Manrope_600SemiBold", color: "#FF9933", fontSize: 13 }}>
                          Resend Code
                        </Text>
                      </Pressable>
                    )}
                  </View>

                  <Pressable
                    onPress={handleVerifyCode}
                    disabled={step === "verifying" || code.length < 4}
                    style={{
                      backgroundColor: code.length >= 4 ? "#FF9933" : "#333",
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
                          color: code.length >= 4 ? "#0f0f0f" : "#888",
                          fontSize: 16,
                        }}
                      >
                        Verify
                      </Text>
                    )}
                  </Pressable>
                </Animated.View>
              )}

              {/* ─── Step: Success ─── */}
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
                    Phone Verified!
                  </Text>
                  <Text style={{ fontFamily: "Manrope_500Medium", color: "#999", fontSize: 14, textAlign: "center" }}>
                    Your phone number has been successfully verified.
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

function formatPhoneDisplay(digits: string): string {
  if (digits.length <= 3) return digits.length ? `(${digits}` : "";
  if (digits.length <= 6) return `(${digits.slice(0, 3)}) ${digits.slice(3)}`;
  return `(${digits.slice(0, 3)}) ${digits.slice(3, 6)}-${digits.slice(6, 10)}`;
}
