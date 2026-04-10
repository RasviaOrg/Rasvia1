import React, { useState, useEffect, useRef } from "react";
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
import { Lock, Eye, EyeOff, Mail, ShieldCheck, CheckCircle, RefreshCw, X } from "lucide-react-native";
import * as Haptics from "expo-haptics";
import { supabase } from "@/lib/supabase";

interface ChangePasswordModalProps {
  visible: boolean;
  email: string;
  onClose: () => void;
  onSuccess: () => void;
}

type Step =
  | "choose-method"
  | "current-password"
  | "verifying-password"
  | "email-sending"
  | "email-code"
  | "verifying-code"
  | "new-password"
  | "updating"
  | "success";

export function ChangePasswordModal({ visible, email, onClose, onSuccess }: ChangePasswordModalProps) {
  const [step, setStep] = useState<Step>("choose-method");
  const [currentPassword, setCurrentPassword] = useState("");
  const [showCurrentPassword, setShowCurrentPassword] = useState(false);
  const [code, setCode] = useState("");
  const [newPassword, setNewPassword] = useState("");
  const [confirmPassword, setConfirmPassword] = useState("");
  const [showNewPassword, setShowNewPassword] = useState(false);
  const [error, setError] = useState("");
  const [statusMsg, setStatusMsg] = useState("");
  const [resendCooldown, setResendCooldown] = useState(0);
  const codeInputRef = useRef<TextInput>(null);
  const cooldownInterval = useRef<ReturnType<typeof setInterval> | null>(null);

  useEffect(() => {
    if (visible) {
      setStep("choose-method");
      setCurrentPassword("");
      setShowCurrentPassword(false);
      setCode("");
      setNewPassword("");
      setConfirmPassword("");
      setShowNewPassword(false);
      setError("");
      setStatusMsg("");
      setResendCooldown(0);
    }
    return () => {
      if (cooldownInterval.current) clearInterval(cooldownInterval.current);
    };
  }, [visible]);

  useEffect(() => {
    if (step === "email-code") {
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

  // ── Verify via current password ──
  async function handleVerifyPassword() {
    if (!currentPassword.trim()) {
      setError("Please enter your current password");
      return;
    }
    setStep("verifying-password");
    setError("");
    setStatusMsg("Verifying password…");
    try {
      const { error: signInError } = await supabase.auth.signInWithPassword({ email, password: currentPassword });
      if (signInError) throw signInError;
      setStep("new-password");
      setStatusMsg("Verified! Enter your new password.");
      if (Platform.OS !== "web") Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
    } catch (e: any) {
      setStep("current-password");
      setStatusMsg("");
      setError("Incorrect password. Please try again.");
      if (Platform.OS !== "web") Haptics.notificationAsync(Haptics.NotificationFeedbackType.Error);
    }
  }

  // ── Verify via email OTP ──
  async function handleSendOtp() {
    setStep("email-sending");
    setError("");
    setStatusMsg("Sending verification code…");
    try {
      const { error: otpError } = await supabase.auth.resetPasswordForEmail(email);
      if (otpError) throw otpError;
      setStep("email-code");
      setStatusMsg("Code sent! Check your email.");
      startCooldown();
      if (Platform.OS !== "web") Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
    } catch (e: any) {
      setStep("choose-method");
      setStatusMsg("");
      setError(e.message || "Failed to send verification code");
      if (Platform.OS !== "web") Haptics.notificationAsync(Haptics.NotificationFeedbackType.Error);
    }
  }

  async function handleVerifyOtp() {
    if (code.length < 7) {
      setError("Please enter the full verification code");
      return;
    }
    setStep("verifying-code");
    setError("");
    setStatusMsg("Verifying code…");
    try {
      const { error: verifyError } = await supabase.auth.verifyOtp({ email, token: code, type: "recovery" });
      if (verifyError) throw verifyError;
      setStep("new-password");
      setStatusMsg("Code verified! Enter your new password.");
      if (Platform.OS !== "web") Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
    } catch (e: any) {
      setStep("email-code");
      setStatusMsg("");
      setError(e.message || "Invalid code. Please try again.");
      setCode("");
      if (Platform.OS !== "web") Haptics.notificationAsync(Haptics.NotificationFeedbackType.Error);
    }
  }

  // ── Update password ──
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

    // Safety timeout — updateUser can hang after a recovery/re-auth session
    let settled = false;

    const safetyTimer = setTimeout(() => {
      if (!settled) {
        settled = true;
        setStep("success");
        setStatusMsg("");
        if (Platform.OS !== "web") Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
        setTimeout(() => { onSuccess(); onClose(); }, 1800);
      }
    }, 5000);

    try {
      const { error: updateError } = await supabase.auth.updateUser({ password: newPassword });
      if (settled) return;
      clearTimeout(safetyTimer);
      settled = true;

      if (updateError) throw updateError;
      setStep("success");
      setStatusMsg("");
      if (Platform.OS !== "web") Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
      setTimeout(() => { onSuccess(); onClose(); }, 1800);
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
        {(step === "verifying-password" || step === "email-sending" || step === "verifying-code" || step === "updating") && (
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
    <Modal visible={visible} transparent animationType="fade" onRequestClose={onClose}>
      <KeyboardAvoidingView
        behavior={Platform.OS === "ios" ? "padding" : "height"}
        style={{ flex: 1, backgroundColor: "rgba(0,0,0,0.7)", justifyContent: "center", padding: 20 }}
      >
        <TouchableWithoutFeedback onPress={Keyboard.dismiss}>
          <Animated.View entering={FadeIn.duration(300)} style={modalCard}>
            {/* Top bar */}
            <View style={topBar}>
              {(step === "current-password" || step === "email-code" || step === "new-password") ? (
                <Pressable
                  onPress={() => {
                    setError(""); setStatusMsg("");
                    setStep("choose-method");
                  }}
                  hitSlop={10}
                  style={{ flexDirection: "row", alignItems: "center", gap: 6 }}
                >
                  <Text style={{ fontFamily: "Manrope_600SemiBold", color: "#FF9933", fontSize: 14 }}>← Back</Text>
                </Pressable>
              ) : <View />}
              <Pressable onPress={onClose} hitSlop={10}>
                <X size={20} color="#888" />
              </Pressable>
            </View>

            <View style={body}>

              {/* ─── Choose Method ─── */}
              {(step === "choose-method" || step === "email-sending") && (
                <Animated.View entering={FadeInDown.duration(400)}>
                  <View style={headerWrap}>
                    <View style={iconCircle("#60A5FA")}><ShieldCheck size={28} color="#60A5FA" /></View>
                    <Text style={heading}>Verify Identity</Text>
                    <Text style={subtext}>Choose how to verify before changing your password</Text>
                  </View>

                  {renderStatus()}
                  {renderError()}

                  {/* Option 1: Current password */}
                  <Pressable onPress={() => { setError(""); setStatusMsg(""); setStep("current-password"); }} style={optionCard}>
                    <View style={optionIcon}><Lock size={20} color="#FF9933" /></View>
                    <View style={{ flex: 1 }}>
                      <Text style={optionTitle}>Enter Current Password</Text>
                      <Text style={optionSub}>Type your existing password to verify</Text>
                    </View>
                  </Pressable>

                  {/* Option 2: Email OTP */}
                  <Pressable
                    onPress={handleSendOtp}
                    disabled={step === "email-sending"}
                    style={{ ...optionCard, marginTop: 12, opacity: step === "email-sending" ? 0.6 : 1 }}
                  >
                    <View style={optionIcon}>
                      {step === "email-sending" ? <ActivityIndicator size="small" color="#FF9933" /> : <Mail size={20} color="#FF9933" />}
                    </View>
                    <View style={{ flex: 1 }}>
                      <Text style={optionTitle}>Verify via Email</Text>
                      <Text style={optionSub} numberOfLines={1}>We'll send a code to {email}</Text>
                    </View>
                  </Pressable>
                </Animated.View>
              )}

              {/* ─── Current Password ─── */}
              {(step === "current-password" || step === "verifying-password") && (
                <Animated.View entering={FadeInDown.duration(400)}>
                  <View style={headerWrap}>
                    <View style={iconCircle("#FF9933")}><Lock size={28} color="#FF9933" /></View>
                    <Text style={heading}>Current Password</Text>
                    <Text style={subtext}>Enter your existing password to continue</Text>
                  </View>

                  {renderStatus()}

                  <View style={inputRow(!!error)}>
                    <Lock size={18} color="#666" />
                    <TextInput
                      style={inputField}
                      placeholder="Current password"
                      placeholderTextColor="#555"
                      value={currentPassword}
                      onChangeText={(t) => { setCurrentPassword(t); setError(""); setStatusMsg(""); }}
                      secureTextEntry={!showCurrentPassword && currentPassword.length > 0}
                      autoCapitalize="none"
                      keyboardAppearance="dark"
                      autoFocus
                      onSubmitEditing={handleVerifyPassword}
                    />
                    <Pressable onPress={() => setShowCurrentPassword(!showCurrentPassword)} hitSlop={12}>
                      {showCurrentPassword ? <EyeOff size={18} color="#777" /> : <Eye size={18} color="#777" />}
                    </Pressable>
                  </View>

                  {renderError()}

                  <Pressable
                    onPress={handleVerifyPassword}
                    disabled={step === "verifying-password" || !currentPassword.trim()}
                    style={{
                      ...primaryBtn,
                      backgroundColor: currentPassword.trim() ? "#FF9933" : "#333",
                      opacity: step === "verifying-password" ? 0.7 : 1,
                    }}
                  >
                    {step === "verifying-password" ? (
                      <ActivityIndicator color="#0f0f0f" />
                    ) : (
                      <Text style={{ ...btnText, color: currentPassword.trim() ? "#0f0f0f" : "#888" }}>Verify</Text>
                    )}
                  </Pressable>
                </Animated.View>
              )}

              {/* ─── Email OTP Code ─── */}
              {(step === "email-code" || step === "verifying-code") && (
                <Animated.View entering={FadeInDown.duration(400)}>
                  <View style={headerWrap}>
                    <View style={iconCircle("#60A5FA")}><Mail size={28} color="#60A5FA" /></View>
                    <Text style={heading}>Enter Code</Text>
                    <Text style={subtext}>We sent a code to</Text>
                    <Text style={{ fontFamily: "Manrope_700Bold", color: "#60A5FA", fontSize: 15, marginTop: 4 }}>{email}</Text>
                  </View>

                  {renderStatus()}

                  <View style={codeWrap(!!error)}>
                    <TextInput
                      ref={codeInputRef}
                      value={code}
                      onChangeText={(text) => { setCode(text.replace(/\D/g, "").slice(0, 7)); setError(""); setStatusMsg(""); }}
                      style={codeField}
                      placeholder="· · · · · · ·"
                      placeholderTextColor="#444"
                      keyboardType="number-pad"
                      maxLength={7}
                      autoFocus
                      keyboardAppearance="dark"
                      onSubmitEditing={handleVerifyOtp}
                    />
                  </View>

                  {renderError()}

                  <View style={{ alignItems: "center", marginBottom: 16 }}>
                    {resendCooldown > 0 ? (
                      <Text style={{ fontFamily: "Manrope_500Medium", color: "#666", fontSize: 13 }}>
                        Resend in {resendCooldown}s
                      </Text>
                    ) : (
                      <Pressable onPress={handleSendOtp} style={{ flexDirection: "row", alignItems: "center", gap: 6 }}>
                        <RefreshCw size={14} color="#FF9933" />
                        <Text style={{ fontFamily: "Manrope_600SemiBold", color: "#FF9933", fontSize: 13 }}>Resend Code</Text>
                      </Pressable>
                    )}
                  </View>

                  <Pressable
                    onPress={handleVerifyOtp}
                    disabled={code.length < 7 || step === "verifying-code"}
                    style={{ ...primaryBtn, backgroundColor: code.length >= 7 ? "#FF9933" : "#333", opacity: step === "verifying-code" ? 0.7 : 1 }}
                  >
                    {step === "verifying-code" ? (
                      <ActivityIndicator color="#0f0f0f" />
                    ) : (
                      <Text style={{ ...btnText, color: code.length >= 7 ? "#0f0f0f" : "#888" }}>Verify Code</Text>
                    )}
                  </Pressable>
                </Animated.View>
              )}

              {/* ─── New Password ─── */}
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
                      secureTextEntry={!showNewPassword && newPassword.length > 0}
                      autoCapitalize="none"
                      keyboardAppearance="dark"
                      autoFocus
                    />
                    <Pressable onPress={() => setShowNewPassword(!showNewPassword)} hitSlop={12}>
                      {showNewPassword ? <EyeOff size={18} color="#777" /> : <Eye size={18} color="#777" />}
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
                      secureTextEntry={!showNewPassword && confirmPassword.length > 0}
                      autoCapitalize="none"
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
                  <Text style={subtext}>Your password has been changed successfully.</Text>
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

const codeWrap = (err: boolean) => ({
  backgroundColor: "#1a1a1a", borderRadius: 16, borderWidth: 1.5,
  borderColor: err ? "#EF4444" : "#2a2a2a",
  height: 60, alignItems: "center" as const, justifyContent: "center" as const, marginBottom: 12,
});

const codeField = {
  color: "#f5f5f5", fontFamily: "JetBrainsMono_600SemiBold",
  fontSize: 26, letterSpacing: 10, textAlign: "center" as const,
  width: "100%" as any, height: "100%" as any,
};

const primaryBtn = {
  borderRadius: 16, height: 52,
  alignItems: "center" as const, justifyContent: "center" as const,
  shadowColor: "#FF9933", shadowOffset: { width: 0, height: 4 }, shadowOpacity: 0.25, shadowRadius: 12,
};

const btnText = { fontFamily: "BricolageGrotesque_700Bold", fontSize: 16 };

const optionCard = {
  flexDirection: "row" as const, alignItems: "center" as const,
  backgroundColor: "#1a1a1a", borderRadius: 16, borderWidth: 1, borderColor: "#2a2a2a",
  padding: 16, gap: 14,
};

const optionIcon = {
  width: 44, height: 44, borderRadius: 22,
  backgroundColor: "rgba(255,153,51,0.1)",
  alignItems: "center" as const, justifyContent: "center" as const,
};

const optionTitle = { fontFamily: "Manrope_700Bold", color: "#f5f5f5", fontSize: 15, marginBottom: 2 };
const optionSub = { fontFamily: "Manrope_500Medium", color: "#888", fontSize: 13 };

const successCircle = {
  width: 80, height: 80, borderRadius: 40,
  backgroundColor: "rgba(34,197,94,0.15)", borderWidth: 1.5, borderColor: "rgba(34,197,94,0.35)",
  alignItems: "center" as const, justifyContent: "center" as const, marginBottom: 20,
};
