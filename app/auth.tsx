import React, { useEffect, useState } from "react";
import {
    View,
    Text,
    TextInput,
    Pressable,
    Alert,
    Platform,

    ScrollView,
    ActivityIndicator,
    Dimensions,
    Image,
} from "react-native";
import { SafeAreaView, useSafeAreaInsets } from "react-native-safe-area-context";
import { LinearGradient } from "expo-linear-gradient";
import { Mail, Lock, Eye, EyeOff, Phone, ArrowLeft } from "lucide-react-native";
import { FontAwesome5 } from "@expo/vector-icons";
import { useRouter } from "expo-router";
import * as Linking from "expo-linking";
import * as WebBrowser from "expo-web-browser";
import Animated, {
    FadeIn,
    FadeInUp,
    useAnimatedStyle,
    useSharedValue,
    withSpring,
} from "react-native-reanimated";
import * as Haptics from "expo-haptics";
import { supabase } from "@/lib/supabase";
import { upsertProfileFromAuthUser } from "@/lib/profile-sync";
import { InAppNotification } from "@/components/InAppNotification";
import { PhoneVerifyModal } from "@/components/PhoneVerifyModal";
import { EmailVerifyModal } from "@/components/EmailVerifyModal";
import { ResetPasswordModal } from "@/components/ResetPasswordModal";

let SCREEN_HEIGHT = Dimensions.get("window").height;
Dimensions.addEventListener("change", ({ window }) => { SCREEN_HEIGHT = window.height; });
WebBrowser.maybeCompleteAuthSession();
const VERIFY_EMAIL_WEB_URL = "https://rasvia.com/verify-email";

/** Create-account card, filler strip, and sticky footer — same value so gaps blend. */
const SIGNUP_PANEL_BG = "rgba(26, 26, 26, 0.92)";

/** Ref to store the normalized phone after sign-up so the PhoneVerifyModal can use it */
let pendingSignupPhoneRef = "";

function formatPhoneNumber(raw: string): string {
    const digits = raw.replace(/\D/g, "").slice(0, 10);
    if (digits.length <= 3) return digits.length ? `(${digits}` : "";
    if (digits.length <= 6) return `(${digits.slice(0, 3)}) ${digits.slice(3)}`;
    return `(${digits.slice(0, 3)}) ${digits.slice(3, 6)}-${digits.slice(6)}`;
}

function isValidEmail(s: string): boolean {
    return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(s.trim());
}

function digitsOnly(s: string): string {
    return s.replace(/\D/g, "");
}

type AuthPhase = "identifier" | "signin_password" | "signup";

export default function AuthScreen() {
    const [authPhase, setAuthPhase] = useState<AuthPhase>("identifier");
    const [identifierInput, setIdentifierInput] = useState("");
    const [signInWithPhone, setSignInWithPhone] = useState(false);
    const [email, setEmail] = useState("");
    const [phoneSignIn, setPhoneSignIn] = useState("");
    const [password, setPassword] = useState("");
    const [firstName, setFirstName] = useState("");
    const [lastName, setLastName] = useState("");
    const router = useRouter();
    const insets = useSafeAreaInsets();
    /** Reserve space so scroll content clears the sticky signup footer (absolute bottom bar). */
    const signupStickyFooterReserve =
        12 + 56 + Math.max(insets.bottom, 12) + 8 + 8;
    const [identifierChecking, setIdentifierChecking] = useState(false);
    const [phone, setPhone] = useState("");
    const [showPassword, setShowPassword] = useState(false);
    const [loading, setLoading] = useState(false);
    const [googleLoading, setGoogleLoading] = useState(false);
    const [notification, setNotification] = useState<{
        visible: boolean;
        message: string;
        type: "error" | "success" | "info";
    }>({ visible: false, message: "", type: "error" });
    const [showEmailVerify, setShowEmailVerify] = useState(false);
    const [showResetPassword, setShowResetPassword] = useState(false);
    const [pendingVerifyEmail, setPendingVerifyEmail] = useState("");

    const btnScale = useSharedValue(1);
    const btnStyle = useAnimatedStyle(() => ({
        transform: [{ scale: btnScale.value }],
    }));

    useEffect(() => {
        // Warm these routes early to reduce post-auth transition hitching.
        try {
            router.prefetch("/" as any);
            router.prefetch("/onboarding" as any);
        } catch {
            // no-op on unsupported platforms
        }
    }, [router]);

    const clearField = (setter: (v: string) => void) => () => {
        setter("");
        if (Platform.OS !== "web") Haptics.selectionAsync();
    };

    function parseOAuthCallback(url: string): {
        accessToken?: string;
        refreshToken?: string;
        code?: string;
    } {
        const parsed = Linking.parse(url);
        const query = (parsed.queryParams ?? {}) as Record<string, string | undefined>;
        const hashPart = url.includes("#") ? url.split("#")[1] : "";
        const hashParams = new URLSearchParams(hashPart);

        return {
            accessToken: query.access_token ?? hashParams.get("access_token") ?? undefined,
            refreshToken: query.refresh_token ?? hashParams.get("refresh_token") ?? undefined,
            code: query.code ?? hashParams.get("code") ?? undefined,
        };
    }

    async function handleGoogleAuth() {
        setGoogleLoading(true);
        try {
            if (Platform.OS !== "web") {
                await Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Medium);
            }

            const redirectTo =
                Platform.OS === "web"
                    ? Linking.createURL("auth/callback")
                    : Linking.createURL("auth/callback", { scheme: "rasvia" });

            const { data, error } = await supabase.auth.signInWithOAuth({
                provider: "google",
                options: {
                    redirectTo,
                    skipBrowserRedirect: true,
                    queryParams: {
                        access_type: "offline",
                        prompt: "consent",
                    },
                },
            });

            if (error) throw error;
            if (!data?.url) throw new Error("Could not start Google OAuth.");

            const result = await WebBrowser.openAuthSessionAsync(data.url, redirectTo);
            if (result.type !== "success" || !("url" in result) || !result.url) {
                return;
            }

            const { accessToken, refreshToken, code } = parseOAuthCallback(result.url);

            if (accessToken && refreshToken) {
                const { error: sessionError } = await supabase.auth.setSession({
                    access_token: accessToken,
                    refresh_token: refreshToken,
                });
                if (sessionError) throw sessionError;
            } else if (code) {
                const { error: exchangeError } = await supabase.auth.exchangeCodeForSession(code);
                if (exchangeError) throw exchangeError;
            } else {
                throw new Error("Google sign-in returned an invalid callback.");
            }

            const { data: userData } = await supabase.auth.getUser();
            if (userData?.user) {
                await upsertProfileFromAuthUser(userData.user);
            }
        } catch (error: any) {
            setNotification({
                visible: true,
                message: error?.message || "Google sign-in failed. Please try again.",
                type: "error",
            });
        } finally {
            setGoogleLoading(false);
        }
    }

    async function handleIdentifierContinue() {
        const raw = identifierInput.trim();
        if (!raw) {
            setNotification({
                visible: true,
                message: "Enter your phone number or email to continue.",
                type: "error",
            });
            return;
        }
        if (isValidEmail(raw)) {
            setIdentifierChecking(true);
            try {
                const { data: exists, error } = await supabase.rpc("account_exists_for_email", {
                    p_email: raw.trim(),
                });
                if (error) throw error;
                setEmail(raw.trim());
                setSignInWithPhone(false);
                setPhoneSignIn("");
                setPassword("");
                if (exists === true) setAuthPhase("signin_password");
                else setAuthPhase("signup");
            } catch (e: any) {
                setNotification({
                    visible: true,
                    message: e?.message || "Could not verify. Please try again.",
                    type: "error",
                });
            } finally {
                setIdentifierChecking(false);
            }
            return;
        }
        const d = digitsOnly(raw);
        if (d.length === 10) {
            setIdentifierChecking(true);
            try {
                const { data: exists, error } = await supabase.rpc("account_exists_for_phone", {
                    p_phone_digits: d,
                });
                if (error) throw error;
                setPhoneSignIn(formatPhoneNumber(d));
                setSignInWithPhone(true);
                setEmail("");
                setPassword("");
                if (exists === true) setAuthPhase("signin_password");
                else {
                    setPhone(formatPhoneNumber(d));
                    setAuthPhase("signup");
                }
            } catch (e: any) {
                setNotification({
                    visible: true,
                    message: e?.message || "Could not verify. Please try again.",
                    type: "error",
                });
            } finally {
                setIdentifierChecking(false);
            }
            return;
        }
        setNotification({
            visible: true,
            message: "Enter a valid email or a 10-digit US phone number.",
            type: "error",
        });
    }

    async function handleSignInWithPassword() {
        if (!password) {
            setNotification({
                visible: true,
                message: "Enter your password.",
                type: "error",
            });
            return;
        }
        setLoading(true);
        try {
            if (signInWithPhone) {
                const rawPhone = phoneSignIn.replace(/\D/g, "").trim();
                const { data: email, error: lookupError } = await supabase
                    .rpc("get_email_for_phone", { p_phone_digits: rawPhone });

                if (lookupError || !email) {
                    throw new Error("No account found with that phone number.");
                }

                const { error } = await supabase.auth.signInWithPassword({
                    email: email,
                    password,
                });
                if (error) throw error;
            } else {
                const { error } = await supabase.auth.signInWithPassword({
                    email: email.trim(),
                    password,
                });
                if (error) throw error;
            }
        } catch (error: any) {
            const message = error.message || "Something went wrong.";
            let friendlyMessage = message;
            const lower = message.toLowerCase();
            if (lower.includes("already registered") || lower.includes("already exists")) {
                friendlyMessage = "Email already exists. Please Log In.";
            } else if (
                lower.includes("email not confirmed") ||
                lower.includes("email_not_confirmed") ||
                lower.includes("not confirmed")
            ) {
                friendlyMessage =
                    "Please verify your email before signing in.\nCheck your inbox for the link from Rasvia.";
            }
            setNotification({
                visible: true,
                message: friendlyMessage,
                type: "error",
            });
        } finally {
            setLoading(false);
        }
    }

    async function handleSignUpSubmit() {
        if (!email || !password) {
            setNotification({
                visible: true,
                message: "Please enter both email and password.",
                type: "error",
            });
            return;
        }
        if (!isValidEmail(email)) {
            setNotification({
                visible: true,
                message: "Please enter a valid email address.",
                type: "error",
            });
            return;
        }
        const ln = lastName.trim();
        if (!firstName?.trim() || !ln || ln.length < 2) {
            setNotification({
                visible: true,
                message: "Please enter your first and last name (last name at least 2 letters).",
                type: "error",
            });
            return;
        }
        if (digitsOnly(phone).length !== 10) {
            setNotification({
                visible: true,
                message: "Please enter a valid 10-digit phone number.",
                type: "error",
            });
            return;
        }

        setLoading(true);
        try {
            const fullName = `${firstName.trim()} ${ln}`;
            const normalizedPhone = phone.replace(/\D/g, "").trim();
            const { data, error } = await supabase.auth.signUp({
                email: email.trim(),
                password,
                options: {
                    emailRedirectTo: VERIFY_EMAIL_WEB_URL,
                    data: {
                        full_name: fullName,
                        first_name: firstName.trim(),
                        last_name: ln,
                        phone_number: normalizedPhone,
                    },
                },
            });
            if (error) throw error;

            const identities = (data.user as any)?.identities;
            const emailAlreadyExists = Array.isArray(identities) && identities.length === 0;
            if (emailAlreadyExists) {
                setNotification({
                    visible: true,
                    message: "Email already exists. Please Log In.",
                    type: "error",
                });
                return;
            }

            if (data.user && data.session?.access_token) {
                const { error: profileError } = await supabase.from("profiles").upsert({
                    id: data.user.id,
                    email: email.trim(),
                    full_name: fullName,
                    phone_number: normalizedPhone,
                    created_at: new Date().toISOString(),
                });
                if (profileError) {
                    console.warn("Profile upsert during sign-up failed:", profileError.message);
                }
            }

            // Show email verification modal with 6-digit OTP
            setPendingVerifyEmail(email.trim());
            setShowEmailVerify(true);
        } catch (error: any) {
            const message = error.message || "Something went wrong.";
            let friendlyMessage = message;
            const lower = message.toLowerCase();
            if (lower.includes("already registered") || lower.includes("already exists")) {
                friendlyMessage = "Email already exists. Please Log In.";
            }
            setNotification({
                visible: true,
                message: friendlyMessage,
                type: "error",
            });
        } finally {
            setLoading(false);
        }
    }

    async function handleForgotPassword() {
        if (!email.trim()) {
            setNotification({ visible: true, message: "Please enter your email first.", type: "error" });
            return;
        }
        setPendingVerifyEmail(email.trim());
        setShowResetPassword(true);
    }

    return (
        <View className="flex-1 bg-rasvia-black">
            {/* In-App Notification */}
            <InAppNotification
                visible={notification.visible}
                message={notification.message}
                type={notification.type}
                onDismiss={() => setNotification({ ...notification, visible: false })}
            />

            {/* Background Image */}
            <Image
                source={{
                    uri: "https://images.unsplash.com/photo-1596040033229-a9821ebd058d?w=1200&q=80",
                }}
                style={{ width: "100%", height: "100%", position: "absolute" }}
                resizeMode="cover"
            />

            {/* Dark Gradient Overlay */}
            <LinearGradient
                colors={[
                    "rgba(15,15,15,0.3)",
                    "rgba(15,15,15,0.6)",
                    "rgba(15,15,15,0.95)",
                    "#0f0f0f",
                ]}
                locations={[0, 0.3, 0.65, 0.85]}
                style={{
                    position: "absolute",
                    top: 0,
                    left: 0,
                    right: 0,
                    bottom: 0,
                }}
            />

            <SafeAreaView className="flex-1" edges={["top"]}>
                {authPhase !== "signup" ? (
                    <View style={{ flex: 1 }}>
                    <ScrollView
                        contentContainerStyle={{ flexGrow: 1, justifyContent: "flex-end" }}
                        keyboardShouldPersistTaps="handled"
                        showsVerticalScrollIndicator={false}
                        bounces={false}
                        automaticallyAdjustKeyboardInsets
                    >
                    {/* Header Logo */}
                    <Animated.View
                        entering={FadeIn.duration(800)}
                        className="items-center mb-6"
                        style={{ paddingTop: SCREEN_HEIGHT * 0.08 }}
                    >
                        <Text
                            style={{
                                fontFamily: "BricolageGrotesque_800ExtraBold",
                                color: "#FF9933",
                                fontSize: 48,
                                letterSpacing: -1,
                            }}
                        >
                            rasvia
                        </Text>
                        <Text
                            style={{
                                fontFamily: "Manrope_500Medium",
                                color: "#999999",
                                fontSize: 16,
                                marginTop: 4,
                            }}
                        >
                            The Path to Flavor.
                        </Text>
                    </Animated.View>

                    {/* Glassmorphism Form Card */}
                    <Animated.View
                        entering={FadeInUp.delay(300).duration(600)}
                        style={{
                            backgroundColor: "rgba(26, 26, 26, 0.92)",
                            borderTopLeftRadius: 32,
                            borderTopRightRadius: 32,
                            borderTopWidth: 1,
                            borderLeftWidth: 1,
                            borderRightWidth: 1,
                            borderColor: "rgba(255, 255, 255, 0.06)",
                            paddingHorizontal: 24,
                            paddingTop: 32,
                            paddingBottom: 40,
                        }}
                    >
                        {/* ─── Phase: identifier (email or phone, then Continue) ─── */}
                        {authPhase === "identifier" && (
                            <>
                        <Text
                            style={{
                                fontFamily: "BricolageGrotesque_700Bold",
                                color: "#f5f5f5",
                                fontSize: 24,
                                marginBottom: 8,
                                textAlign: "center",
                            }}
                        >
                            Sign in or create your account
                        </Text>
                        <Text
                            style={{
                                fontFamily: "Manrope_500Medium",
                                color: "#999999",
                                fontSize: 14,
                                marginBottom: 22,
                                textAlign: "center",
                                lineHeight: 20,
                            }}
                        >
                            Not sure if you have an account? Enter your phone number or email and we&apos;ll take you to the next step.
                        </Text>

                        <Text
                            style={{
                                fontFamily: "Manrope_700Bold",
                                color: "#e5e5e5",
                                fontSize: 13,
                                marginBottom: 8,
                            }}
                        >
                            Phone number or email *
                        </Text>
                        <View
                            style={{
                                backgroundColor: "#262626",
                                borderRadius: 16,
                                borderWidth: 1,
                                borderColor: "#333333",
                                paddingHorizontal: 16,
                                height: 56,
                                marginBottom: 14,
                                flexDirection: "row",
                                alignItems: "center",
                            }}
                        >
                            <TextInput
                                style={{
                                    flex: 1,
                                    color: "#f5f5f5",
                                    fontFamily: "Manrope_500Medium",
                                    fontSize: 16,
                                }}
                                placeholder="you@email.com or (555) 000-0000"
                                placeholderTextColor="#666666"
                                value={identifierInput}
                                onChangeText={(text) => {
                                    // Make formatting adaptable: if letters are typed, it's an email/username -> plain string
                                    // If only digits/phone characters exist, auto-format like (XXX) XXX-XXXX
                                    if (/[a-zA-Z@]/.test(text)) {
                                        // User typed a letter, strip brackets/dashes and keep formatting as plain email
                                        setIdentifierInput(text.replace(/[()\- ]/g, ""));
                                    } else {
                                        const rawDigits = text.replace(/\D/g, "");
                                        if (rawDigits.length === 0) {
                                            setIdentifierInput(text); // allowing clearing
                                        } else {
                                            const formatPhone = (r: string) => {
                                                const d = r.slice(0, 10);
                                                if (d.length <= 3) return d.length ? `(${d}` : "";
                                                if (d.length <= 6) return `(${d.slice(0, 3)}) ${d.slice(3)}`;
                                                return `(${d.slice(0, 3)}) ${d.slice(3, 6)}-${d.slice(6)}`;
                                            };
                                            // Handle backspace gracefully by comparing previous text
                                            if (
                                                identifierInput.length > text.length &&
                                                (identifierInput.endsWith(" ") || identifierInput.endsWith("-") || identifierInput.endsWith(")"))
                                            ) {
                                                // Used backspace on a formatting character
                                                setIdentifierInput(formatPhone(rawDigits.slice(0, -1)));
                                            } else {
                                                setIdentifierInput(formatPhone(rawDigits));
                                            }
                                        }
                                    }
                                }}
                                onFocus={() => {
                                    if (Platform.OS !== "web") Haptics.selectionAsync();
                                }}
                                onSubmitEditing={handleIdentifierContinue}
                                keyboardType="email-address"
                                autoCapitalize="none"
                                autoCorrect={false}
                                autoComplete="email"
                                returnKeyType="next"
                                keyboardAppearance="dark"
                            />
                            {!!identifierInput && (
                                <Pressable onPress={clearField(setIdentifierInput)} hitSlop={10}>
                                    <Text style={{ fontFamily: "Manrope_700Bold", color: "#888", fontSize: 18 }}>×</Text>
                                </Pressable>
                            )}
                        </View>

                        <Text
                            style={{
                                fontFamily: "Manrope_500Medium",
                                color: "#666666",
                                fontSize: 12,
                                marginBottom: 20,
                                lineHeight: 18,
                            }}
                        >
                            Securing your personal information is our priority. See our{" "}
                            <Text
                                onPress={() => router.push("/privacy" as any)}
                                style={{ color: "#FF9933", fontFamily: "Manrope_700Bold", textDecorationLine: "underline" }}
                            >
                                Privacy Policy
                            </Text>
                            .
                        </Text>

                        <Animated.View style={btnStyle}>
                            <Pressable
                                onPress={() => {
                                    if (Platform.OS !== "web") Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Medium);
                                    handleIdentifierContinue();
                                }}
                                onPressIn={() => {
                                    btnScale.value = withSpring(0.96);
                                }}
                                onPressOut={() => {
                                    btnScale.value = withSpring(1);
                                }}
                                disabled={loading || googleLoading || identifierChecking}
                                style={{
                                    backgroundColor: "#FF9933",
                                    borderRadius: 28,
                                    height: 54,
                                    alignItems: "center",
                                    justifyContent: "center",
                                    shadowColor: "#FF9933",
                                    shadowOffset: { width: 0, height: 4 },
                                    shadowOpacity: 0.35,
                                    shadowRadius: 16,
                                    elevation: 10,
                                    opacity: loading || googleLoading || identifierChecking ? 0.7 : 1,
                                }}
                            >
                                {identifierChecking ? (
                                    <ActivityIndicator color="#0f0f0f" />
                                ) : (
                                    <Text
                                        style={{
                                            fontFamily: "Manrope_700Bold",
                                            color: "#0f0f0f",
                                            fontSize: 17,
                                        }}
                                    >
                                        Continue
                                    </Text>
                                )}
                            </Pressable>
                        </Animated.View>

                        <View style={{ flexDirection: "row", alignItems: "center", marginVertical: 18 }}>
                            <View style={{ flex: 1, height: 1, backgroundColor: "#2b2b2b" }} />
                            <Text style={{ marginHorizontal: 10, color: "#666666", fontFamily: "Manrope_500Medium", fontSize: 12 }}>
                                or
                            </Text>
                            <View style={{ flex: 1, height: 1, backgroundColor: "#2b2b2b" }} />
                        </View>

                        <Pressable
                            onPress={handleGoogleAuth}
                            disabled={loading || googleLoading || identifierChecking}
                            style={{
                                borderRadius: 16,
                                height: 54,
                                alignItems: "center",
                                justifyContent: "center",
                                flexDirection: "row",
                                backgroundColor: "#202020",
                                borderWidth: 1,
                                borderColor: "#333333",
                                opacity: loading || googleLoading || identifierChecking ? 0.7 : 1,
                                marginBottom: 20,
                            }}
                        >
                            {googleLoading ? (
                                <ActivityIndicator color="#f5f5f5" />
                            ) : (
                                <>
                                    <View
                                        style={{
                                            width: 24,
                                            height: 24,
                                            alignItems: "center",
                                            justifyContent: "center",
                                            marginRight: 10,
                                        }}
                                    >
                                        <FontAwesome5 name="google" size={16} color="#EA4335" />
                                    </View>
                                    <Text style={{ fontFamily: "Manrope_700Bold", color: "#f5f5f5", fontSize: 15 }}>
                                        Continue with Google
                                    </Text>
                                </>
                            )}
                        </Pressable>
                            </>
                        )}

                        {/* ─── Phase: sign in with password ─── */}
                        {authPhase === "signin_password" && (
                            <>
                        <Pressable
                            onPress={() => {
                                if (Platform.OS !== "web") Haptics.selectionAsync();
                                setAuthPhase("identifier");
                                setPassword("");
                            }}
                            style={{ flexDirection: "row", alignItems: "center", marginBottom: 16, gap: 8 }}
                        >
                            <ArrowLeft size={18} color="#FF9933" />
                            <Text style={{ fontFamily: "Manrope_600SemiBold", color: "#FF9933", fontSize: 15 }}>
                                Back
                            </Text>
                        </Pressable>
                        <Text
                            style={{
                                fontFamily: "BricolageGrotesque_700Bold",
                                color: "#f5f5f5",
                                fontSize: 26,
                                marginBottom: 6,
                            }}
                        >
                            Sign in
                        </Text>
                        <Text
                            style={{
                                fontFamily: "Manrope_500Medium",
                                color: "#999999",
                                fontSize: 14,
                                marginBottom: 22,
                            }}
                        >
                            {signInWithPhone ? phoneSignIn : email}
                        </Text>

                        <View
                            style={{
                                flexDirection: "row",
                                alignItems: "center",
                                backgroundColor: "#262626",
                                borderRadius: 16,
                                borderWidth: 1,
                                borderColor: "#333333",
                                paddingHorizontal: 16,
                                marginBottom: 12,
                                height: 56,
                            }}
                        >
                            <Lock size={18} color="#999999" />
                            <TextInput
                                style={{
                                    flex: 1,
                                    color: "#f5f5f5",
                                    fontFamily: "Manrope_500Medium",
                                    fontSize: 15,
                                    marginLeft: 12,
                                }}
                                placeholder="Password"
                                placeholderTextColor="#666666"
                                value={password}
                                onChangeText={setPassword}
                                onFocus={() => {
                                    if (Platform.OS !== "web") Haptics.selectionAsync();
                                }}
                                onSubmitEditing={handleSignInWithPassword}
                                secureTextEntry={!showPassword}
                                autoCapitalize="none"
                                returnKeyType="go"
                                keyboardAppearance="dark"
                            />
                            {!!password && (
                                <Pressable onPress={clearField(setPassword)} hitSlop={10} style={{ marginRight: 10 }}>
                                    <Text style={{ fontFamily: "Manrope_700Bold", color: "#888", fontSize: 18 }}>×</Text>
                                </Pressable>
                            )}
                            <Pressable onPress={() => setShowPassword(!showPassword)} hitSlop={10}>
                                {showPassword ? <EyeOff size={18} color="#999999" /> : <Eye size={18} color="#999999" />}
                            </Pressable>
                        </View>

                        {!signInWithPhone && (
                            <Pressable onPress={handleForgotPassword} style={{ marginBottom: 18, alignSelf: "flex-start" }}>
                                <Text style={{ fontFamily: "Manrope_600SemiBold", color: "#FF9933", fontSize: 13 }}>
                                    Forgot password?
                                </Text>
                            </Pressable>
                        )}

                        <Animated.View style={btnStyle}>
                            <Pressable
                                onPress={() => {
                                    if (Platform.OS !== "web") Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Medium);
                                    handleSignInWithPassword();
                                }}
                                onPressIn={() => {
                                    btnScale.value = withSpring(0.96);
                                }}
                                onPressOut={() => {
                                    btnScale.value = withSpring(1);
                                }}
                                disabled={loading || googleLoading}
                                style={{
                                    backgroundColor: "#FF9933",
                                    borderRadius: 16,
                                    height: 56,
                                    alignItems: "center",
                                    justifyContent: "center",
                                    shadowColor: "#FF9933",
                                    shadowOffset: { width: 0, height: 4 },
                                    shadowOpacity: 0.35,
                                    shadowRadius: 16,
                                    elevation: 10,
                                    opacity: loading || googleLoading ? 0.7 : 1,
                                }}
                            >
                                {loading ? (
                                    <ActivityIndicator color="#0f0f0f" />
                                ) : (
                                    <Text style={{ fontFamily: "BricolageGrotesque_700Bold", color: "#0f0f0f", fontSize: 17 }}>
                                        Sign in
                                    </Text>
                                )}
                            </Pressable>
                        </Animated.View>
                            </>
                        )}
                    </Animated.View>
                    </ScrollView>
                    </View>
                ) : (
                    <View style={{ flex: 1 }}>
                        <ScrollView
                            style={{ flex: 1 }}
                            contentContainerStyle={{
                                flexGrow: 1,
                            }}
                            keyboardShouldPersistTaps="handled"
                            showsVerticalScrollIndicator={false}
                            bounces={false}
                        >
                            <Animated.View
                                entering={FadeIn.duration(800)}
                                className="items-center mb-6"
                                style={{ paddingTop: SCREEN_HEIGHT * 0.05 }}
                            >
                                <Text
                                    style={{
                                        fontFamily: "BricolageGrotesque_800ExtraBold",
                                        color: "#FF9933",
                                        fontSize: 48,
                                        letterSpacing: -1,
                                    }}
                                >
                                    rasvia
                                </Text>
                                <Text
                                    style={{
                                        fontFamily: "Manrope_500Medium",
                                        color: "#999999",
                                        fontSize: 16,
                                        marginTop: 4,
                                    }}
                                >
                                    The Path to Flavor.
                                </Text>
                            </Animated.View>

                            <Animated.View
                                entering={FadeInUp.delay(300).duration(600)}
                                style={{
                                    backgroundColor: SIGNUP_PANEL_BG,
                                    borderTopLeftRadius: 32,
                                    borderTopRightRadius: 32,
                                    borderTopWidth: 1,
                                    borderLeftWidth: 1,
                                    borderRightWidth: 1,
                                    borderColor: "rgba(255, 255, 255, 0.06)",
                                    paddingHorizontal: 24,
                                    paddingTop: 32,
                                    paddingBottom: 24,
                                }}
                            >
                                <Pressable
                                    onPress={() => {
                                        if (Platform.OS !== "web") Haptics.selectionAsync();
                                        setAuthPhase("identifier");
                                        setPassword("");
                                        setFirstName("");
                                        setLastName("");
                                    }}
                                    style={{ flexDirection: "row", alignItems: "center", marginBottom: 16, gap: 8 }}
                                >
                                    <ArrowLeft size={18} color="#FF9933" />
                                    <Text style={{ fontFamily: "Manrope_600SemiBold", color: "#FF9933", fontSize: 15 }}>
                                        Back
                                    </Text>
                                </Pressable>
                                <Text
                                    style={{
                                        fontFamily: "BricolageGrotesque_700Bold",
                                        color: "#f5f5f5",
                                        fontSize: 26,
                                        marginBottom: 6,
                                    }}
                                >
                                    Create Account
                                </Text>
                                <Text
                                    style={{
                                        fontFamily: "Manrope_500Medium",
                                        color: "#999999",
                                        fontSize: 14,
                                        marginBottom: 28,
                                    }}
                                >
                                    Join the waitlist revolution.
                                </Text>

                                <View
                                    style={{
                                        flexDirection: "row",
                                        marginBottom: 6,
                                        gap: 12,
                                    }}
                                >
                                    <View
                                        style={{
                                            flex: 1,
                                            flexDirection: "row",
                                            alignItems: "center",
                                            backgroundColor: "#262626",
                                            borderRadius: 16,
                                            borderWidth: 1,
                                            borderColor: "#333333",
                                            paddingHorizontal: 16,
                                            height: 56,
                                        }}
                                    >
                                        <TextInput
                                            style={{
                                                flex: 1,
                                                color: "#f5f5f5",
                                                fontFamily: "Manrope_500Medium",
                                                fontSize: 15,
                                            }}
                                            placeholder="First name"
                                            placeholderTextColor="#666666"
                                            value={firstName}
                                            onChangeText={setFirstName}
                                            onFocus={() => {
                                                if (Platform.OS !== "web") Haptics.selectionAsync();
                                            }}
                                            autoCapitalize="words"
                                            autoCorrect={false}
                                            keyboardAppearance="dark"
                                        />
                                        {!!firstName && (
                                            <Pressable onPress={clearField(setFirstName)} hitSlop={10}>
                                                <Text style={{ fontFamily: "Manrope_700Bold", color: "#888", fontSize: 18 }}>×</Text>
                                            </Pressable>
                                        )}
                                    </View>
                                    <View
                                        style={{
                                            flex: 1,
                                            flexDirection: "row",
                                            alignItems: "center",
                                            backgroundColor: "#262626",
                                            borderRadius: 16,
                                            borderWidth: 1,
                                            borderColor: "#333333",
                                            paddingHorizontal: 16,
                                            height: 56,
                                        }}
                                    >
                                        <TextInput
                                            style={{
                                                flex: 1,
                                                color: "#f5f5f5",
                                                fontFamily: "Manrope_500Medium",
                                                fontSize: 15,
                                            }}
                                            placeholder="Last name"
                                            placeholderTextColor="#666666"
                                            value={lastName}
                                            onChangeText={setLastName}
                                            onFocus={() => {
                                                if (Platform.OS !== "web") Haptics.selectionAsync();
                                            }}
                                            autoCapitalize="words"
                                            autoCorrect={false}
                                            keyboardAppearance="dark"
                                        />
                                        {!!lastName && (
                                            <Pressable onPress={clearField(setLastName)} hitSlop={8}>
                                                <Text style={{ fontFamily: "Manrope_700Bold", color: "#888", fontSize: 14 }}>×</Text>
                                            </Pressable>
                                        )}
                                    </View>
                                </View>
                                <Text
                                    style={{
                                        fontFamily: "Manrope_500Medium",
                                        color: "#666666",
                                        fontSize: 12,
                                        marginBottom: 14,
                                        marginLeft: 4,
                                    }}
                                >
                                    First and last name
                                </Text>

                                <View
                                    style={{
                                        flexDirection: "row",
                                        alignItems: "center",
                                        backgroundColor: "#262626",
                                        borderRadius: 16,
                                        borderWidth: 1,
                                        borderColor: "#333333",
                                        paddingHorizontal: 16,
                                        marginBottom: 14,
                                        height: 56,
                                    }}
                                >
                                    <Phone size={18} color="#999999" />
                                    <TextInput
                                        style={{
                                            flex: 1,
                                            color: "#f5f5f5",
                                            fontFamily: "Manrope_500Medium",
                                            fontSize: 15,
                                            marginLeft: 12,
                                        }}
                                        placeholder="(555) 000-0000"
                                        placeholderTextColor="#666666"
                                        value={phone}
                                        onChangeText={(v) => setPhone(formatPhoneNumber(v))}
                                        onFocus={() => {
                                            if (Platform.OS !== "web") Haptics.selectionAsync();
                                        }}
                                        keyboardType="phone-pad"
                                        autoCapitalize="none"
                                        autoCorrect={false}
                                        keyboardAppearance="dark"
                                    />
                                    {!!phone && (
                                        <Pressable onPress={clearField(setPhone)} hitSlop={10}>
                                            <Text style={{ fontFamily: "Manrope_700Bold", color: "#888", fontSize: 18 }}>×</Text>
                                        </Pressable>
                                    )}
                                </View>

                                <View
                                    style={{
                                        flexDirection: "row",
                                        alignItems: "center",
                                        backgroundColor: "#1a1a1a",
                                        borderRadius: 16,
                                        borderWidth: 1,
                                        borderColor: "#2a2a2a",
                                        paddingHorizontal: 16,
                                        marginBottom: 14,
                                        height: 56,
                                        opacity: 0.65,
                                    }}
                                >
                                    <Mail size={18} color="#555555" />
                                    <TextInput
                                        style={{
                                            flex: 1,
                                            color: "#888888",
                                            fontFamily: "Manrope_500Medium",
                                            fontSize: 15,
                                            marginLeft: 12,
                                        }}
                                        value={email}
                                        editable={false}
                                        keyboardType="email-address"
                                        autoCapitalize="none"
                                        autoCorrect={false}
                                        keyboardAppearance="dark"
                                    />
                                </View>

                                <View
                                    style={{
                                        flexDirection: "row",
                                        alignItems: "center",
                                        backgroundColor: "#262626",
                                        borderRadius: 16,
                                        borderWidth: 1,
                                        borderColor: "#333333",
                                        paddingHorizontal: 16,
                                        marginBottom: 20,
                                        height: 56,
                                    }}
                                >
                                    <Lock size={18} color="#999999" />
                                    <TextInput
                                        style={{
                                            flex: 1,
                                            color: "#f5f5f5",
                                            fontFamily: "Manrope_500Medium",
                                            fontSize: 15,
                                            marginLeft: 12,
                                        }}
                                        placeholder="Password"
                                        placeholderTextColor="#666666"
                                        value={password}
                                        onChangeText={setPassword}
                                        onFocus={() => {
                                            if (Platform.OS !== "web") Haptics.selectionAsync();
                                        }}
                                        secureTextEntry={!showPassword}
                                        autoCapitalize="none"
                                        keyboardAppearance="dark"
                                    />
                                    {!!password && (
                                        <Pressable onPress={clearField(setPassword)} hitSlop={10} style={{ marginRight: 10 }}>
                                            <Text style={{ fontFamily: "Manrope_700Bold", color: "#888", fontSize: 18 }}>×</Text>
                                        </Pressable>
                                    )}
                                    <Pressable onPress={() => setShowPassword(!showPassword)} hitSlop={10}>
                                        {showPassword ? (
                                            <EyeOff size={18} color="#999999" />
                                        ) : (
                                            <Eye size={18} color="#999999" />
                                        )}
                                    </Pressable>
                                </View>

                                <Text
                                    style={{
                                        fontFamily: "Manrope_500Medium",
                                        color: "#666666",
                                        fontSize: 12,
                                        textAlign: "center",
                                        marginBottom: 0,
                                        lineHeight: 18,
                                    }}
                                >
                                    By continuing, you agree to our{" "}
                                    <Text
                                        onPress={() => router.push("/terms" as any)}
                                        style={{ color: "#FF9933", fontFamily: "Manrope_700Bold" }}
                                    >
                                        Terms of Service
                                    </Text>{" "}
                                    and{" "}
                                    <Text
                                        onPress={() => router.push("/privacy" as any)}
                                        style={{ color: "#FF9933", fontFamily: "Manrope_700Bold" }}
                                    >
                                        Privacy Policy
                                    </Text>
                                    .
                                </Text>
                            </Animated.View>

                            <View
                                style={{
                                    flex: 1,
                                    minHeight: 0,
                                    backgroundColor: SIGNUP_PANEL_BG,
                                    paddingBottom: signupStickyFooterReserve,
                                }}
                            />
                        </ScrollView>

                        <View
                            style={{
                                position: "absolute",
                                left: 0,
                                right: 0,
                                bottom: 0,
                                backgroundColor: SIGNUP_PANEL_BG,
                                paddingHorizontal: 24,
                                paddingTop: 12,
                                paddingBottom: Math.max(insets.bottom, 12) + 8,
                            }}
                        >
                            <Animated.View style={btnStyle}>
                                <Pressable
                                    onPress={() => {
                                        if (Platform.OS !== "web") {
                                            Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Medium);
                                        }
                                        handleSignUpSubmit();
                                    }}
                                    onPressIn={() => {
                                        btnScale.value = withSpring(0.96);
                                    }}
                                    onPressOut={() => {
                                        btnScale.value = withSpring(1);
                                    }}
                                    disabled={loading || googleLoading}
                                    style={{
                                        backgroundColor: "#FF9933",
                                        borderRadius: 16,
                                        height: 56,
                                        alignItems: "center",
                                        justifyContent: "center",
                                        shadowColor: "#FF9933",
                                        shadowOffset: { width: 0, height: 4 },
                                        shadowOpacity: 0.35,
                                        shadowRadius: 16,
                                        elevation: 10,
                                        opacity: loading || googleLoading ? 0.7 : 1,
                                    }}
                                >
                                    {loading ? (
                                        <ActivityIndicator color="#0f0f0f" />
                                    ) : (
                                        <Text
                                            style={{
                                                fontFamily: "BricolageGrotesque_700Bold",
                                                color: "#0f0f0f",
                                                fontSize: 17,
                                            }}
                                        >
                                            Get Started
                                        </Text>
                                    )}
                                </Pressable>
                            </Animated.View>
                        </View>
                    </View>
                )}
            </SafeAreaView>

            {/* Email Verification Modal (6-digit OTP) */}
            <EmailVerifyModal
                visible={showEmailVerify}
                email={pendingVerifyEmail}
                onClose={() => setShowEmailVerify(false)}
                onVerified={() => {
                    setShowEmailVerify(false);
                    setNotification({ visible: true, message: "Email verified! You can now sign in.", type: "success" });
                    setAuthPhase("identifier");
                }}
            />

            {/* Reset Password Modal (OTP-based) */}
            <ResetPasswordModal
                visible={showResetPassword}
                initialEmail={pendingVerifyEmail}
                onClose={() => setShowResetPassword(false)}
                onSuccess={() => {
                    setShowResetPassword(false);
                    setNotification({ visible: true, message: "Password updated! Sign in with your new password.", type: "success" });
                }}
            />
        </View>
    );
}
