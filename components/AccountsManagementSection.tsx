import React, { useEffect, useState } from "react";
import {
  View,
  Text,
  Pressable,
  Modal,
  TextInput,
  Alert,
  ActivityIndicator,
  KeyboardAvoidingView,
  Keyboard,
  TouchableWithoutFeedback,
  Platform,
} from "react-native";
import { Users, Shield, Plus, X } from "lucide-react-native";
import Animated, { FadeIn } from "react-native-reanimated";
import { useRouter } from "expo-router";
import { supabase } from "@/lib/supabase";
import { isolatedSupabase } from "@/lib/isolated-supabase";
import { useAuth } from "@/lib/auth-context";
import { useAppTheme } from "@/lib/app-theme";
import {
  type SavedAccount,
  getSavedAccounts,
  upsertSavedAccount,
  removeSavedAccount,
  getSelfAccount,
  setSelfAccount as persistSelfAccount,
  clearSelfAccount,
  getSwitchedInFrom,
  setSwitchedInFrom,
  clearSwitchedInFrom,
  seedTargetWithOrigin,
} from "@/lib/accounts-store";

interface Props {
  /**
   * Sets an outer loading flag on the parent so it can disable other
   * controls during a sign-out / sign-in swap.
   */
  onLoggingOutChange?: (loggingOut: boolean) => void;
}

/**
 * Account-switching UI used by both the admin inline tab and the
 * standalone `/my-accounts` page reached by owners + switched-in users.
 *
 * Owns its own state so it can be dropped into any container without
 * prop-drilling dozens of callbacks. Persists everything through the
 * `lib/accounts-store` helpers, which keep bulk metadata in AsyncStorage
 * and passwords in SecureStore.
 */
export function AccountsManagementSection({ onLoggingOutChange }: Props) {
  const router = useRouter();
  const { session } = useAuth();
  const { colors, isDark } = useAppTheme();
  const modalBackdrop = isDark ? "rgba(0,0,0,0.6)" : "rgba(0,0,0,0.45)";
  const onBlueCta = isDark ? "#0f0f0f" : "#ffffff";
  const userId = session?.user?.id;
  const userEmail = session?.user?.email;

  const [savedAccounts, setSavedAccounts] = useState<SavedAccount[]>([]);
  const [selfAccount, setSelfAccountState] = useState<SavedAccount | null>(null);
  const [switchedInFromUserId, setSwitchedInFromUserId] = useState<string | null>(null);

  const [showAddAccountModal, setShowAddAccountModal] = useState(false);
  const [addAccountEmail, setAddAccountEmail] = useState("");
  const [addAccountPassword, setAddAccountPassword] = useState("");
  const [validatingAccount, setValidatingAccount] = useState(false);

  const [showSelfAccountModal, setShowSelfAccountModal] = useState(false);
  const [selfAccountPassword, setSelfAccountPassword] = useState("");
  const [savingSelfAccount, setSavingSelfAccount] = useState(false);

  const isSwitchedIn = !!switchedInFromUserId;

  useEffect(() => {
    if (!userId) {
      setSavedAccounts([]);
      setSelfAccountState(null);
      setSwitchedInFromUserId(null);
      return;
    }
    let cancelled = false;
    (async () => {
      try {
        const [list, self, marker] = await Promise.all([
          getSavedAccounts(userId),
          getSelfAccount(userId),
          getSwitchedInFrom(userId),
        ]);
        if (cancelled) return;
        setSavedAccounts(list);
        setSelfAccountState(self);
        setSwitchedInFromUserId(marker);
      } catch (err) {
        console.error("Error hydrating accounts panel", err);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [userId]);

  const handleRemoveAccount = (id: string) => {
    Alert.alert("Remove Account", "Are you sure you want to remove this saved account?", [
      { text: "Cancel", style: "cancel" },
      {
        text: "Remove",
        style: "destructive",
        onPress: async () => {
          if (!userId) return;
          const next = await removeSavedAccount(userId, id);
          setSavedAccounts(next);
        },
      },
    ]);
  };

  const performSwitch = async (account: SavedAccount) => {
    if (!userId) return;
    onLoggingOutChange?.(true);
    try {
      // 1. Validate the target credentials against Supabase BEFORE we tear
      //    down the current session. `isolatedSupabase` has its own storage
      //    so the sign-in doesn't clobber the primary client's tokens.
      //    If this fails we leave the user on their current account with an
      //    actionable error instead of stranding them signed-out.
      const { data: validateData, error: validateError } =
        await isolatedSupabase.auth.signInWithPassword({
          email: account.email,
          password: account.passwordPlain,
        });

      if (validateError || !validateData.user) {
        const message =
          validateError?.message?.toLowerCase().includes("invalid")
            ? "The saved password for this account is no longer valid. Remove and re-add the account."
            : validateError?.message || "Could not sign in with the saved credentials.";
        Alert.alert("Switch failed", message);
        return;
      }

      // Clean up the isolated client so its tokens aren't left around.
      await isolatedSupabase.auth.signOut().catch(() => {});

      // 2. Seed the target with a switch-back entry + marker (best-effort:
      //    failures here shouldn't block the actual switch).
      if (selfAccount) {
        try {
          await seedTargetWithOrigin(account.id, selfAccount);
          await setSwitchedInFrom(account.id, userId);
        } catch (seedErr) {
          console.warn("seedTargetWithOrigin failed", seedErr);
        }
      }

      if (switchedInFromUserId && switchedInFromUserId === account.id) {
        await clearSwitchedInFrom(userId).catch(() => {});
      }

      // 3. Now that we know the creds work, swap sessions on the primary
      //    client. If the sign-in here still fails (e.g. race with a
      //    password rotation mid-switch) we at least fall back to the auth
      //    screen instead of a half-broken session.
      await supabase.auth.signOut();
      const { error: signInError } = await supabase.auth.signInWithPassword({
        email: account.email,
        password: account.passwordPlain,
      });
      if (signInError) {
        console.error("Switch sign-in error after validation", signInError);
        Alert.alert(
          "Switch failed",
          "We were signed out but could not finish signing into the other account. Please sign in again."
        );
      } else {
        router.replace("/");
      }
    } catch (err) {
      console.error("Switch account error", err);
      Alert.alert("Error", "Failed to switch accounts.");
    } finally {
      onLoggingOutChange?.(false);
    }
  };

  const handleSwitch = (account: SavedAccount) => {
    const friendlyLabel = account.fullName || account.email;

    if (!account.passwordPlain) {
      Alert.alert(
        "Password missing",
        "We couldn't recover this account's password from the secure keystore. Remove and re-add the account to fix this."
      );
      return;
    }

    if (!selfAccount) {
      Alert.alert(
        "Enable switch-back first?",
        `Save your own credentials so you can hop back from ${friendlyLabel}. You can switch anyway, but you'll have to sign in manually on the other account.`,
        [
          { text: "Cancel", style: "cancel" },
          { text: "Switch anyway", style: "destructive", onPress: () => performSwitch(account) },
          { text: "Enable", onPress: () => setShowSelfAccountModal(true) },
        ]
      );
      return;
    }

    Alert.alert(
      "Switch Account",
      `You will be signed out of your current account.\n\nSwitch to ${friendlyLabel}?`,
      [
        { text: "Cancel", style: "cancel" },
        { text: "Switch", style: "destructive", onPress: () => performSwitch(account) },
      ]
    );
  };

  const handleAddAccount = async () => {
    if (!addAccountEmail || !addAccountPassword) {
      Alert.alert("Validation", "Please enter email and password.");
      return;
    }
    if (userEmail && addAccountEmail.trim().toLowerCase() === userEmail.toLowerCase()) {
      Alert.alert("Validation", "You cannot save your current account.");
      return;
    }
    if (!userId) return;
    setValidatingAccount(true);
    try {
      const { data, error } = await isolatedSupabase.auth.signInWithPassword({
        email: addAccountEmail.trim(),
        password: addAccountPassword,
      });
      if (error || !data.user) {
        Alert.alert("Invalid Credentials", "Could not sign in with these credentials.");
        return;
      }

      const { data: profile } = await supabase
        .from("profiles")
        .select("full_name, role")
        .eq("id", data.user.id)
        .maybeSingle();

      const record: SavedAccount = {
        email: addAccountEmail.trim(),
        passwordPlain: addAccountPassword,
        fullName: profile?.full_name || "Unknown",
        role: profile?.role || "user",
        id: data.user.id,
      };
      const next = await upsertSavedAccount(userId, record);
      setSavedAccounts(next);

      setShowAddAccountModal(false);
      setAddAccountEmail("");
      setAddAccountPassword("");
    } catch (err) {
      console.error("Add account error", err);
      Alert.alert("Error", "An unexpected error occurred.");
    } finally {
      setValidatingAccount(false);
    }
  };

  const handleSaveSelfAccount = async () => {
    if (!userEmail || !userId) {
      Alert.alert("Error", "No active session to associate this credential with.");
      return;
    }
    if (!selfAccountPassword) {
      Alert.alert("Validation", "Please enter your password.");
      return;
    }
    setSavingSelfAccount(true);
    try {
      const { data, error } = await isolatedSupabase.auth.signInWithPassword({
        email: userEmail,
        password: selfAccountPassword,
      });
      if (error || !data.user) {
        Alert.alert("Invalid Password", "Could not verify your password. Please try again.");
        return;
      }

      const { data: profile } = await supabase
        .from("profiles")
        .select("full_name, role")
        .eq("id", userId)
        .maybeSingle();

      const record: SavedAccount = {
        email: userEmail,
        passwordPlain: selfAccountPassword,
        fullName: profile?.full_name || "My Account",
        role: profile?.role || "user",
        id: userId,
      };
      await persistSelfAccount(userId, record);
      setSelfAccountState(record);
      setSelfAccountPassword("");
      setShowSelfAccountModal(false);
    } catch (err) {
      console.error("Save self account error", err);
      Alert.alert("Error", "Could not save your credentials. Please try again.");
    } finally {
      setSavingSelfAccount(false);
    }
  };

  const handleClearSelfAccount = () => {
    if (!userId) return;
    Alert.alert(
      "Disable switch-back",
      "This removes your stored credentials from this device. You'll need to enable it again to use switch-back later.",
      [
        { text: "Cancel", style: "cancel" },
        {
          text: "Disable",
          style: "destructive",
          onPress: async () => {
            await clearSelfAccount(userId);
            setSelfAccountState(null);
          },
        },
      ]
    );
  };

  return (
    <Animated.View entering={FadeIn.duration(200)}>
      {isSwitchedIn && (
        <View
          style={{
            marginHorizontal: 20,
            marginBottom: 16,
            padding: 16,
            backgroundColor: "rgba(96,165,250,0.08)",
            borderRadius: 16,
            borderWidth: 1,
            borderColor: "rgba(96,165,250,0.3)",
          }}
        >
          <Text style={{ fontFamily: "BricolageGrotesque_700Bold", color: "#60A5FA", fontSize: 14, marginBottom: 4 }}>
            Switched-in session
          </Text>
          <Text style={{ fontFamily: "Manrope_500Medium", color: "#9fb8d9", fontSize: 12, lineHeight: 18 }}>
            An admin or owner switched into this account. Tap Switch on the saved account below to hop back.
          </Text>
        </View>
      )}

      <View
        style={{
          marginHorizontal: 20,
          marginBottom: 16,
          padding: 20,
          backgroundColor: colors.card,
          borderRadius: 20,
          borderWidth: 1,
          borderColor: colors.cardBorder,
        }}
      >
        <View style={{ flexDirection: "row", alignItems: "center", gap: 10, marginBottom: 10 }}>
          <Shield size={18} color={selfAccount ? "#22C55E" : "#F59E0B"} />
          <Text style={{ fontFamily: "BricolageGrotesque_700Bold", color: colors.text, fontSize: 16 }}>
            Switch-back credential
          </Text>
        </View>
        <Text style={{ fontFamily: "Manrope_500Medium", color: colors.textMuted, fontSize: 12, lineHeight: 18, marginBottom: 14 }}>
          {selfAccount
            ? `Enabled for ${selfAccount.email}. When you switch into another account, we'll preload your credentials there so you can hop back in one tap.`
            : "Save your own password on this device to enable one-tap switch-back. Validated against Supabase; stored in the OS secure keystore."}
        </Text>
        <View style={{ flexDirection: "row", gap: 8 }}>
          <Pressable
            onPress={() => setShowSelfAccountModal(true)}
            style={{
              flex: 1,
              flexDirection: "row",
              alignItems: "center",
              justifyContent: "center",
              gap: 6,
              height: 44,
              borderRadius: 12,
              backgroundColor: selfAccount ? "rgba(34,197,94,0.12)" : "rgba(245,158,11,0.14)",
              borderWidth: 1,
              borderColor: selfAccount ? "rgba(34,197,94,0.4)" : "rgba(245,158,11,0.4)",
            }}
          >
            <Text style={{ fontFamily: "Manrope_700Bold", color: selfAccount ? "#22C55E" : "#F59E0B", fontSize: 13 }}>
              {selfAccount ? "Update credential" : "Enable switch-back"}
            </Text>
          </Pressable>
          {selfAccount && (
            <Pressable
              onPress={handleClearSelfAccount}
              style={{
                paddingHorizontal: 14,
                alignItems: "center",
                justifyContent: "center",
                borderRadius: 12,
                backgroundColor: "rgba(239,68,68,0.1)",
                borderWidth: 1,
                borderColor: "rgba(239,68,68,0.3)",
              }}
            >
              <Text style={{ fontFamily: "Manrope_700Bold", color: "#EF4444", fontSize: 13 }}>Disable</Text>
            </Pressable>
          )}
        </View>
      </View>

      <View
        style={{
          marginHorizontal: 20,
          marginBottom: 24,
          padding: 20,
          backgroundColor: colors.card,
          borderRadius: 20,
          borderWidth: 1,
          borderColor: colors.cardBorder,
        }}
      >
        <View style={{ flexDirection: "row", alignItems: "center", gap: 10, marginBottom: 16 }}>
          <Users size={20} color="#60A5FA" />
          <Text style={{ fontFamily: "BricolageGrotesque_700Bold", color: colors.text, fontSize: 18 }}>
            Saved Accounts
          </Text>
        </View>
        <Text style={{ fontFamily: "Manrope_500Medium", color: colors.textMuted, fontSize: 13, lineHeight: 18, marginBottom: 20 }}>
          Save credentials for quick switching between accounts. Validated securely.
        </Text>

        {savedAccounts.length === 0 ? (
          <View
            style={{
              alignItems: "center",
              paddingVertical: 20,
              backgroundColor: colors.pressableBg,
              borderRadius: 12,
              marginBottom: 16,
            }}
          >
            <Text style={{ fontFamily: "Manrope_600SemiBold", color: colors.textMuted, fontSize: 13 }}>
              No accounts saved yet.
            </Text>
          </View>
        ) : (
          savedAccounts.map((acc) => (
            <View
              key={acc.id}
              style={{
                flexDirection: "row",
                alignItems: "center",
                backgroundColor: colors.pressableBg,
                borderRadius: 12,
                padding: 14,
                marginBottom: 10,
                borderWidth: 1,
                borderColor: colors.cardBorder,
              }}
            >
              <View style={{ flex: 1, paddingRight: 12 }}>
                <View style={{ flexDirection: "row", alignItems: "center", gap: 6 }}>
                  <Text
                    style={{
                      fontFamily: "BricolageGrotesque_600SemiBold",
                      color: colors.text,
                      fontSize: 15,
                    }}
                  >
                    {acc.fullName}
                  </Text>
                  <View
                    style={{
                      backgroundColor:
                        acc.role === "admin"
                          ? "rgba(255,153,51,0.15)"
                          : acc.role === "restaurant_owner"
                            ? "rgba(167,139,250,0.15)"
                            : "rgba(96,165,250,0.15)",
                      borderRadius: 999,
                      paddingHorizontal: 6,
                      paddingVertical: 2,
                    }}
                  >
                    <Text
                      style={{
                        fontFamily: "Manrope_700Bold",
                        fontSize: 9,
                        color:
                          acc.role === "admin"
                            ? "#FF9933"
                            : acc.role === "restaurant_owner"
                              ? "#A78BFA"
                              : "#60A5FA",
                      }}
                    >
                      {acc.role === "admin"
                        ? "Admin"
                        : acc.role === "restaurant_owner"
                          ? "Owner"
                          : "User"}
                    </Text>
                  </View>
                </View>
                <Text style={{ fontFamily: "Manrope_500Medium", color: colors.textMuted, fontSize: 12, marginTop: 4 }}>
                  {acc.email}
                </Text>
              </View>

              <View style={{ flexDirection: "row", gap: 8 }}>
                <Pressable
                  onPress={() => handleRemoveAccount(acc.id)}
                  style={{
                    width: 36,
                    height: 36,
                    borderRadius: 18,
                    backgroundColor: "rgba(239,68,68,0.1)",
                    alignItems: "center",
                    justifyContent: "center",
                  }}
                >
                  <X size={16} color="#EF4444" />
                </Pressable>
                <Pressable
                  onPress={() => handleSwitch(acc)}
                  style={{
                    height: 36,
                    paddingHorizontal: 16,
                    borderRadius: 18,
                    backgroundColor: "#60A5FA",
                    alignItems: "center",
                    justifyContent: "center",
                  }}
                >
                  <Text style={{ fontFamily: "Manrope_700Bold", color: onBlueCta, fontSize: 13 }}>Switch</Text>
                </Pressable>
              </View>
            </View>
          ))
        )}

        <Pressable
          onPress={() => setShowAddAccountModal(true)}
          style={{
            flexDirection: "row",
            alignItems: "center",
            justifyContent: "center",
            gap: 8,
            height: 48,
            backgroundColor: "rgba(96,165,250,0.1)",
            borderWidth: 1,
            borderColor: "rgba(96,165,250,0.3)",
            borderRadius: 14,
            marginTop: 8,
          }}
        >
          <Plus size={18} color="#60A5FA" />
          <Text style={{ fontFamily: "BricolageGrotesque_700Bold", color: "#60A5FA", fontSize: 15 }}>
            Add Account
          </Text>
        </Pressable>
      </View>

      <Modal
        visible={showAddAccountModal}
        transparent
        animationType="fade"
        onRequestClose={() => setShowAddAccountModal(false)}
      >
        <KeyboardAvoidingView
          behavior={Platform.OS === "ios" ? "padding" : "height"}
          style={{ flex: 1, backgroundColor: modalBackdrop, justifyContent: "center", padding: 20 }}
        >
          <TouchableWithoutFeedback onPress={Keyboard.dismiss}>
            <View
              style={{
                backgroundColor: colors.card,
                borderRadius: 20,
                padding: 24,
                borderWidth: 1,
                borderColor: colors.cardBorder,
              }}
            >
              <View
                style={{
                  flexDirection: "row",
                  justifyContent: "space-between",
                  alignItems: "center",
                  marginBottom: 20,
                }}
              >
                <Text style={{ fontFamily: "BricolageGrotesque_700Bold", color: colors.text, fontSize: 20 }}>
                  Add Saved Account
                </Text>
                <Pressable onPress={() => setShowAddAccountModal(false)} hitSlop={10}>
                  <X size={20} color={colors.iconMuted} />
                </Pressable>
              </View>

              <View style={{ marginBottom: 16 }}>
                <Text style={{ fontFamily: "Manrope_600SemiBold", color: colors.textMuted, fontSize: 13, marginBottom: 8 }}>
                  Email Address
                </Text>
                <TextInput
                  style={{
                    height: 48,
                    backgroundColor: colors.pressableBg,
                    borderRadius: 12,
                    borderWidth: 1,
                    borderColor: colors.cardBorder,
                    paddingHorizontal: 16,
                    color: colors.text,
                    fontFamily: "Manrope_500Medium",
                  }}
                  value={addAccountEmail}
                  onChangeText={setAddAccountEmail}
                  autoCapitalize="none"
                  keyboardType="email-address"
                  placeholder="name@example.com"
                  placeholderTextColor={colors.textMuted}
                />
              </View>

              <View style={{ marginBottom: 24 }}>
                <Text style={{ fontFamily: "Manrope_600SemiBold", color: colors.textMuted, fontSize: 13, marginBottom: 8 }}>
                  Password
                </Text>
                <TextInput
                  style={{
                    height: 48,
                    backgroundColor: colors.pressableBg,
                    borderRadius: 12,
                    borderWidth: 1,
                    borderColor: colors.cardBorder,
                    paddingHorizontal: 16,
                    color: colors.text,
                    fontFamily: "Manrope_500Medium",
                  }}
                  value={addAccountPassword}
                  onChangeText={setAddAccountPassword}
                  secureTextEntry
                  placeholder="••••••••"
                  placeholderTextColor={colors.textMuted}
                />
              </View>

              <Pressable
                onPress={handleAddAccount}
                disabled={validatingAccount || !addAccountEmail || !addAccountPassword}
                style={{
                  height: 48,
                  backgroundColor: "#60A5FA",
                  borderRadius: 14,
                  alignItems: "center",
                  justifyContent: "center",
                  flexDirection: "row",
                  opacity: validatingAccount || !addAccountEmail || !addAccountPassword ? 0.6 : 1,
                }}
              >
                {validatingAccount ? (
                  <ActivityIndicator color={onBlueCta} />
                ) : (
                  <Text style={{ fontFamily: "BricolageGrotesque_700Bold", color: onBlueCta, fontSize: 16 }}>
                    Validate & Save
                  </Text>
                )}
              </Pressable>
            </View>
          </TouchableWithoutFeedback>
        </KeyboardAvoidingView>
      </Modal>

      <Modal
        visible={showSelfAccountModal}
        transparent
        animationType="fade"
        onRequestClose={() => {
          setShowSelfAccountModal(false);
          setSelfAccountPassword("");
        }}
      >
        <KeyboardAvoidingView
          behavior={Platform.OS === "ios" ? "padding" : "height"}
          style={{ flex: 1, backgroundColor: modalBackdrop, justifyContent: "center", padding: 20 }}
        >
          <TouchableWithoutFeedback onPress={Keyboard.dismiss}>
            <View
              style={{
                backgroundColor: colors.card,
                borderRadius: 20,
                padding: 24,
                borderWidth: 1,
                borderColor: colors.cardBorder,
              }}
            >
              <View
                style={{
                  flexDirection: "row",
                  justifyContent: "space-between",
                  alignItems: "center",
                  marginBottom: 10,
                }}
              >
                <Text style={{ fontFamily: "BricolageGrotesque_700Bold", color: colors.text, fontSize: 20 }}>
                  Enable switch-back
                </Text>
                <Pressable
                  onPress={() => {
                    setShowSelfAccountModal(false);
                    setSelfAccountPassword("");
                  }}
                  hitSlop={10}
                >
                  <X size={20} color={colors.iconMuted} />
                </Pressable>
              </View>
              <Text style={{ fontFamily: "Manrope_500Medium", color: colors.textMuted, fontSize: 12, lineHeight: 18, marginBottom: 20 }}>
                We'll validate {userEmail ? `"${userEmail}"` : "your account"} against Supabase and store the credentials in this device's secure keystore. Needed once per device.
              </Text>

              <View style={{ marginBottom: 24 }}>
                <Text style={{ fontFamily: "Manrope_600SemiBold", color: colors.textMuted, fontSize: 13, marginBottom: 8 }}>
                  Your password
                </Text>
                <TextInput
                  style={{
                    height: 48,
                    backgroundColor: colors.pressableBg,
                    borderRadius: 12,
                    borderWidth: 1,
                    borderColor: colors.cardBorder,
                    paddingHorizontal: 16,
                    color: colors.text,
                    fontFamily: "Manrope_500Medium",
                  }}
                  value={selfAccountPassword}
                  onChangeText={setSelfAccountPassword}
                  secureTextEntry
                  placeholder="••••••••"
                  placeholderTextColor={colors.textMuted}
                />
              </View>

              <Pressable
                onPress={handleSaveSelfAccount}
                disabled={savingSelfAccount || !selfAccountPassword}
                style={{
                  height: 48,
                  backgroundColor: "#22C55E",
                  borderRadius: 14,
                  alignItems: "center",
                  justifyContent: "center",
                  flexDirection: "row",
                  opacity: savingSelfAccount || !selfAccountPassword ? 0.6 : 1,
                }}
              >
                {savingSelfAccount ? (
                  <ActivityIndicator color={onBlueCta} />
                ) : (
                  <Text style={{ fontFamily: "BricolageGrotesque_700Bold", color: onBlueCta, fontSize: 16 }}>
                    Validate & Save
                  </Text>
                )}
              </Pressable>
            </View>
          </TouchableWithoutFeedback>
        </KeyboardAvoidingView>
      </Modal>
    </Animated.View>
  );
}
