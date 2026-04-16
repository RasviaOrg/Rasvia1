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
import { authGateFlags } from "@/lib/auth-gate-flags";

interface ResetPasswordModalProps {
  visible: boolean;
  initialEmail?: string;
  onClose: () => void;
  onSuccess: () => void;
}

type ResetStep = "enter-email" | "sending" | "enter-code" | "verifying-code" | "new-password" | "updating" | "success";
const RESET_CODE_LENGTH = 7;

export function ResetPasswordModal({ visible, initialEmail = "", onClose, onSuccess }: ResetPasswordModalProps) {
  const [step, setStep] = useState<ResetStep>("enter-email");
  const [email, setEmail] = useState(initialEmail);
  const [code, setCode] = useState("");
  const [newPassword, setNewPassword] = useState("");
  const [confirmPassword, setConfirmPassword] = useState("");
  const [showPassword, setShowPassword] = useState(false);
  const [error, setError] = useState("");
  const [statusMsg, setStatusMsg] = useState("");
  const [resendCooldown, setResendCooldown] = useState(0);
  const codeInputRef = useRef<TextInput>(null);
  const cooldownInterval = useRef<ReturnType<typeof setInterval> | null>(null);

  useEffect(() => {
    if (visible) {
      // Suppress AuthGate redirects while this modal is active
      authGateFlags.suppressRedirect = true;
      setStep("enter-email");
      setEmail(initialEmail || "");
      setCode("");
      setNewPassword("");
      setConfirmPassword("");
      setShowPassword(false);
      setError("");
      setStatusMsg("");
      setResendCooldown(0);
    } else {
      authGateFlags.suppressRedirect = false;
    }
    return () => {
      authGateFlags.suppressRedirect = false;
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

  function handleClose() {
    authGateFlags.suppressRedirect = false;
    onClose();
  }

  async function handleSendCode() {
    if (!email.trim() || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email.trim())) {
      setError("Please enter a valid email address");
      return;
    }
    setStep("sending");
    setError("");
    setStatusMsg("Sending reset code…");
    try {
      const { error: resetError } = await supabase.auth.resetPasswordForEmail(email.trim());
      if (resetError) throw resetError;
      setStep("enter-code");
      setStatusMsg("Code sent! Check your email.");
      startCooldown();
      if (Platform.OS !== "web") Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
    } catch (e: any) {
      setStep("enter-email");
      setStatusMsg("");
      setError(e.message || "Failed to send reset code");
      if (Platform.OS !== "web") Haptics.notificationAsync(Haptics.NotificationFeedbackType.Error);
    }
  }

  async function handleVerifyCode() {
    if (code.length < RESET_CODE_LENGTH) {
      setError("Please enter the full verification code");
      return;
    }
    setStep("verifying-code");
    setError("");
    setStatusMsg("Verifying code…");
    try {
      const { data, error: verifyError } = await supabase.auth.verifyOtp({
        email: email.trim(),
        token: code,
        type: "recovery",
      });
      if (verifyError) throw verifyError;
      setStep("new-password");
      setStatusMsg("Code verified! Set your new password.");
      if (Platform.OS !== "web") Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
    } catch (e: any) {
      setStep("enter-code");
      setStatusMsg("");
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
    setStatusMsg("Updating password…");

    // Safety timeout — updateUser sometimes hangs after a recovery OTP session
    // even though the password IS updated server-side. This ensures the UI advances.
    let settled = false;

    const safetyTimer = setTimeout(() => {
      if (!settled) {
        settled = true;
        setStep("success");
        setStatusMsg("");
        if (Platform.OS !== "web") Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
        setTimeout(async () => {
          authGateFlags.suppressRedirect = false;
          await supabase.auth.signOut().catch(() => {});
          onSuccess();
          onClose();
        }, 1800);
      }
    }, 5000);

    try {
      const { error: updateError } = await supabase.auth.updateUser({ password: newPassword });
      if (settled) return; // safety timer already handled it
      clearTimeout(safetyTimer);
      settled = true;

      if (updateError) throw updateError;

      // Show success immediately
      setStep("success");
      setStatusMsg("");
      if (Platform.OS !== "web") Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);

      // After showing success, sign out and close
      setTimeout(async () => {
        authGateFlags.suppressRedirect = false;
        await supabase.auth.signOut().catch(() => {});
        onSuccess();
        onClose();
      }, 1800);
    } catch (e: any) {
      if (settled) return;
      clearTimeout(safetyTimer);
      settled = true;
      setStep("new-password");
      setStatusMsg("");
      setError(e.message || "Failed to update password");
      if (Platform.OS !== "web") Haptics.notificationAsync(Haptics.NotificationFeedbackType.Error);
    }
  }

  const isPasswordValid = newPassword.length >= 6;
  const doPasswordsMatch = newPassword === confirmPassword && confirmPassword.length > 0;

  function renderStatus() {
    if (!statusMsg) return null;
    return (
      <View style={{ flexDirection: "row", alignItems: "center", justifyContent: "center", marginBottom: 12, gap: 6 }}>
        {(step === "sending" || step === "verifying-code" || step === "updating") && (
          <ActivityIndicator size="small" color="#FF9933" />
        )}
        <Text style={{ fontFamily: "Manrope_600SemiBold", color: "#FF9933", fontSize: 13, textAlign: "center" }}>
          {statusMsg}
        </Text>
      </View>
    );
  }

  function renderError() {
    if (!error) return null;
    return (
      <Text style={{ fontFamily: "Manrope_500Medium", color: "#EF4444", fontSize: 13, textAlign: "center", marginBottom: 10 }}>
        {error}
      </Text>
    );
  }

  return (
    <Modal visible={visible} transparent animationType="fade" onRequestClose={handleClose}>
      <KeyboardAvoidingView
        behavior={Platform.OS === "ios" ? "padding" : "height"}
        style={{ flex: 1, backgroundColor: "rgba(0,0,0,0.7)", justifyContent: "center", padding: 20 }}
      >
        <TouchableWithoutFeedback onPress={Keyboard.dismiss}>
          <Animated.View entering={FadeIn.duration(300)} style={modalCard}>
            {/* Top bar */}
            <View style={topBar}>
              {(step === "enter-code" || step === "new-password") ? (
                <Pressable
                  onPress={() => {
                    setError(""); setStatusMsg("");
                    if (step === "new-password") setStep("enter-code");
                    else setStep("enter-email");
                  }}
                  hitSlop={10}
                  style={{ flexDirection: "row", alignItems: "center", gap: 6 }}
                >
                  <ArrowLeft size={18} color="#FF9933" />
                  <Text style={{ fontFamily: "Manrope_600SemiBold", color: "#FF9933", fontSize: 14 }}>Back</Text>
                </Pressable>
              ) : <View />}
              <Pressable onPress={handleClose} hitSlop={10}>
                <X size={20} color="#888" />
              </Pressable>
            </View>

            <View style={body}>

              {/* ─── Step: Enter Email ─── */}
              {(step === "enter-email" || step === "sending") && (
                <Animated.View entering={FadeInDown.duration(400)}>
                  <View style={headerWrap}>
                    <View style={iconCircle("#FF9933")}><Lock size={28} color="#FF9933" /></View>
                    <Text style={heading}>Reset Password</Text>
                    <Text style={subtext}>Enter your email and we'll send you a verification code</Text>
                  </View>

                  {renderStatus()}

                  <View style={inputRow(!!error)}>
                    <Mail size={18} color="#666" />
                    <TextInput
                      style={inputField}
                      placeholder="Email address"
                      placeholderTextColor="#555"
                      value={email}
                      onChangeText={(t) => { setEmail(t); setError(""); }}
                      autoCapitalize="none"
                      keyboardType="email-address"
                      keyboardAppearance="dark"
                      autoFocus={!initialEmail}
                      onSubmitEditing={handleSendCode}
                    />
                  </View>

                  {renderError()}

                  <Pressable
                    onPress={handleSendCode}
                    disabled={step === "sending"}
                    style={{ ...primaryBtn, backgroundColor: "#FF9933", opacity: step === "sending" ? 0.7 : 1 }}
                  >
                    {step === "sending" ? (
                      <ActivityIndicator color="#0f0f0f" />
                    ) : (
                      <Text style={{ ...btnText, color: "#0f0f0f" }}>Send Reset Code</Text>
                    )}
                  </Pressable>
                </Animated.View>
              )}

              {/* ─── Step: Enter Code ─── */}
              {(step === "enter-code" || step === "verifying-code") && (
                <Animated.View entering={FadeInDown.duration(400)}>
                  <View style={headerWrap}>
                    <View style={iconCircle("#60A5FA")}><ShieldCheck size={28} color="#60A5FA" /></View>
                    <Text style={heading}>Enter Code</Text>
                    <Text style={subtext}>We sent a code to</Text>
                    <Text style={{ fontFamily: "Manrope_700Bold", color: "#60A5FA", fontSize: 15, marginTop: 4 }}>{email}</Text>
                  </View>

                  {renderStatus()}

                  <Pressable
                    onPress={() => codeInputRef.current?.focus()}
                    style={{ marginBottom: 12 }}
                  >
                    <View style={{ flexDirection: "row", justifyContent: "space-between", gap: 8 }}>
                      {Array.from({ length: RESET_CODE_LENGTH }).map((_, idx) => {
                        const digit = code[idx] ?? "";
                        const isFocused = code.length === idx || (code.length >= RESET_CODE_LENGTH && idx === RESET_CODE_LENGTH - 1);
                        return (
                          <View
                            key={`reset-code-${idx}`}
                            style={{
                              flex: 1,
                              height: 56,
                              borderRadius: 14,
                              borderWidth: 1.5,
                              borderColor: error ? "#EF4444" : isFocused ? "#FF9933" : "#2a2a2a",
                              backgroundColor: "#1a1a1a",
                              alignItems: "center",
                              justifyContent: "center",
                            }}
                          >
                            <Text style={{ fontFamily: "JetBrainsMono_600SemiBold", color: "#f5f5f5", fontSize: 22 }}>
                              {digit || " "}
                            </Text>
                          </View>
                        );
                      })}
                    </View>
                    <TextInput
                      ref={codeInputRef}
                      value={code}
                      onChangeText={(text) => { setCode(text.replace(/\D/g, "").slice(0, RESET_CODE_LENGTH)); setError(""); setStatusMsg(""); }}
                      style={hiddenCodeInput}
                      keyboardType="number-pad"
                      maxLength={RESET_CODE_LENGTH}
                      autoFocus
                      keyboardAppearance="dark"
                      textContentType="oneTimeCode"
                      autoComplete="sms-otp"
                      caretHidden
                      onSubmitEditing={handleVerifyCode}
                    />
                  </Pressable>

                  {renderError()}

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
                    disabled={code.length < RESET_CODE_LENGTH || step === "verifying-code"}
                    style={{ ...primaryBtn, backgroundColor: code.length >= RESET_CODE_LENGTH ? "#FF9933" : "#333", opacity: step === "verifying-code" ? 0.7 : 1 }}
                  >
                    {step === "verifying-code" ? (
                      <ActivityIndicator color="#0f0f0f" />
                    ) : (
                      <Text style={{ ...btnText, color: code.length >= RESET_CODE_LENGTH ? "#0f0f0f" : "#888" }}>Verify Code</Text>
                    )}
                  </Pressable>
                </Animated.View>
              )}

              {/* ─── Step: New Password ─── */}
              {(step === "new-password" || step === "updating") && (
                <Animated.View entering={FadeInDown.duration(400)}>
                  <View style={headerWrap}>
                    <View style={iconCircle("#22C55E")}><Lock size={28} color="#22C55E" /></View>
                    <Text style={heading}>New Password</Text>
                    <Text style={subtext}>Choose a strong password for your account</Text>
                  </View>

                  {renderStatus()}

                  {/* New Password */}
                  <View style={inputRow(newPassword.length > 0 && !isPasswordValid)}>
                    <Lock size={18} color="#666" />
                    <TextInput
                      style={inputField}
                      placeholder="New password (min 6 chars)"
                      placeholderTextColor="#555"
                      value={newPassword}
                      onChangeText={(t) => { setNewPassword(t); setError(""); setStatusMsg(""); }}
                      secureTextEntry={!showPassword}
                      autoCapitalize="none"
                      autoCorrect={false}
                      textContentType="newPassword"
                      autoComplete="password"
                      keyboardType="ascii-capable"
                      keyboardAppearance="dark"
                      autoFocus
                    />
                    <Pressable onPress={() => setShowPassword(!showPassword)} hitSlop={12}>
                      {showPassword ? <EyeOff size={18} color="#777" /> : <Eye size={18} color="#777" />}
                    </Pressable>
                  </View>

                  {/* Confirm */}
                  <View style={inputRow(confirmPassword.length > 0 && !doPasswordsMatch)}>
                    <Lock size={18} color="#666" />
                    <TextInput
                      style={inputField}
                      placeholder="Confirm password"
                      placeholderTextColor="#555"
                      value={confirmPassword}
                      onChangeText={(t) => { setConfirmPassword(t); setError(""); setStatusMsg(""); }}
                      secureTextEntry={!showPassword}
                      autoCapitalize="none"
                      autoCorrect={false}
                      textContentType="newPassword"
                      autoComplete="password"
                      keyboardType="ascii-capable"
                      keyboardAppearance="dark"
                      onSubmitEditing={handleUpdatePassword}
                    />
                  </View>

                  {renderError()}

                  <Pressable
                    onPress={handleUpdatePassword}
                    disabled={step === "updating" || !isPasswordValid || !doPasswordsMatch}
                    style={{
                      ...primaryBtn,
                      backgroundColor: isPasswordValid && doPasswordsMatch ? "#FF9933" : "#333",
                      opacity: step === "updating" ? 0.7 : 1,
                    }}
                  >
                    {step === "updating" ? (
                      <ActivityIndicator color="#0f0f0f" />
                    ) : (
                      <Text style={{ ...btnText, color: isPasswordValid && doPasswordsMatch ? "#0f0f0f" : "#888" }}>
                        Update Password
                      </Text>
                    )}
                  </Pressable>
                </Animated.View>
              )}

              {/* ─── Success ─── */}
              {step === "success" && (
                <Animated.View entering={FadeIn.duration(600)} style={{ alignItems: "center", paddingVertical: 24 }}>
                  <View style={successCircle}>
                    <CheckCircle size={40} color="#22C55E" />
                  </View>
                  <Text style={{ fontFamily: "BricolageGrotesque_700Bold", color: "#22C55E", fontSize: 22, marginBottom: 8 }}>
                    Password Updated!
                  </Text>
                  <Text style={subtext}>Sign in with your new password.</Text>
                </Animated.View>
              )}
            </View>
          </Animated.View>
        </TouchableWithoutFeedback>
      </KeyboardAvoidingView>
    </Modal>
  );
}

// ─── Shared Styles ───

const modalCard = { backgroundColor: "#141414", borderRadius: 24, borderWidth: 1, borderColor: "#2a2a2a", overflow: "hidden" as const };
const topBar = { flexDirection: "row" as const, alignItems: "center" as const, justifyContent: "space-between" as const, paddingHorizontal: 20, paddingTop: 20, paddingBottom: 4 };
const body = { paddingHorizontal: 24, paddingBottom: 28, paddingTop: 8 };
const headerWrap = { alignItems: "center" as const, marginBottom: 20 };
const heading = { fontFamily: "BricolageGrotesque_700Bold", color: "#f5f5f5", fontSize: 22, textAlign: "center" as const, marginBottom: 8 };
const subtext = { fontFamily: "Manrope_500Medium", color: "#999", fontSize: 14, textAlign: "center" as const, lineHeight: 20 };

const iconCircle = (c: string) => ({
  width: 64, height: 64, borderRadius: 32,
  backgroundColor: `${c}18`, borderWidth: 1, borderColor: `${c}40`,
  alignItems: "center" as const, justifyContent: "center" as const, marginBottom: 16,
});

const inputRow = (err: boolean) => ({
  flexDirection: "row" as const, alignItems: "center" as const,
  backgroundColor: "#1a1a1a", borderRadius: 16, borderWidth: 1.5,
  borderColor: err ? "#EF4444" : "#2a2a2a",
  paddingHorizontal: 16, height: 56, marginBottom: 12,
});

const inputField = { flex: 1, color: "#f5f5f5", fontFamily: "Manrope_500Medium", fontSize: 15, marginLeft: 12 };

const hiddenCodeInput = {
  position: "absolute" as const,
  opacity: 0,
  width: 1,
  height: 1,
};

const primaryBtn = {
  borderRadius: 16, height: 52,
  alignItems: "center" as const, justifyContent: "center" as const,
  shadowColor: "#FF9933", shadowOffset: { width: 0, height: 4 }, shadowOpacity: 0.25, shadowRadius: 12,
};

const btnText = { fontFamily: "BricolageGrotesque_700Bold", fontSize: 16 };

const successCircle = {
  width: 80, height: 80, borderRadius: 40,
  backgroundColor: "rgba(34,197,94,0.15)", borderWidth: 1.5, borderColor: "rgba(34,197,94,0.35)",
  alignItems: "center" as const, justifyContent: "center" as const, marginBottom: 20,
};
