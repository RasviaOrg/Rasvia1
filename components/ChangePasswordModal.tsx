import React, { useState, useEffect } from "react";
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
import { Lock, Eye, EyeOff, CheckCircle, X } from "lucide-react-native";
import * as Haptics from "expo-haptics";
import { supabase } from "@/lib/supabase";

interface ChangePasswordModalProps {
  visible: boolean;
  onClose: () => void;
  onSuccess: () => void;
}

export function ChangePasswordModal({ visible, onClose, onSuccess }: ChangePasswordModalProps) {
  const [newPassword, setNewPassword] = useState("");
  const [confirmPassword, setConfirmPassword] = useState("");
  const [showPassword, setShowPassword] = useState(false);
  const [error, setError] = useState("");
  const [updating, setUpdating] = useState(false);
  const [success, setSuccess] = useState(false);

  useEffect(() => {
    if (visible) {
      setNewPassword("");
      setConfirmPassword("");
      setShowPassword(false);
      setError("");
      setUpdating(false);
      setSuccess(false);
    }
  }, [visible]);

  const isPasswordValid = newPassword.length >= 6;
  const doPasswordsMatch = newPassword === confirmPassword && confirmPassword.length > 0;

  async function handleUpdatePassword() {
    if (!isPasswordValid) {
      setError("Password must be at least 6 characters");
      return;
    }
    if (!doPasswordsMatch) {
      setError("Passwords do not match");
      return;
    }
    setUpdating(true);
    setError("");
    try {
      const { error: updateError } = await supabase.auth.updateUser({
        password: newPassword,
      });
      if (updateError) throw updateError;

      setSuccess(true);
      if (Platform.OS !== "web") Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
      setTimeout(() => {
        onSuccess();
        onClose();
      }, 1500);
    } catch (e: any) {
      setUpdating(false);
      setError(e.message || "Failed to update password");
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
              {!success ? (
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
                      <Lock size={28} color="#60A5FA" />
                    </View>
                    <Text style={{ fontFamily: "BricolageGrotesque_700Bold", color: "#f5f5f5", fontSize: 22, textAlign: "center", marginBottom: 8 }}>
                      Change Password
                    </Text>
                    <Text style={{ fontFamily: "Manrope_500Medium", color: "#999", fontSize: 14, textAlign: "center", lineHeight: 20 }}>
                      Enter a new password for your account
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
                      autoFocus
                    />
                    <Pressable onPress={() => setShowPassword(!showPassword)} hitSlop={10}>
                      {showPassword ? <EyeOff size={18} color="#999" /> : <Eye size={18} color="#999" />}
                    </Pressable>
                  </View>

                  {/* Confirm */}
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
                    disabled={updating || !isPasswordValid || !doPasswordsMatch}
                    style={{
                      backgroundColor: isPasswordValid && doPasswordsMatch ? "#FF9933" : "#333",
                      borderRadius: 16, height: 52,
                      alignItems: "center", justifyContent: "center",
                      opacity: updating ? 0.7 : 1,
                      shadowColor: "#FF9933",
                      shadowOffset: { width: 0, height: 4 },
                      shadowOpacity: isPasswordValid && doPasswordsMatch ? 0.3 : 0,
                      shadowRadius: 12,
                    }}
                  >
                    {updating ? (
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
              ) : (
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
                    Your password has been changed successfully.
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
