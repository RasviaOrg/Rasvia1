import React, { useState } from "react";
import {
    View,
    Text,
    TextInput,
    Pressable,
    Alert,
    Platform,
    KeyboardAvoidingView,
    ScrollView,
    ActivityIndicator,
    Dimensions,
    Image,
} from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";
import { LinearGradient } from "expo-linear-gradient";
import { Mail, Lock, Eye, EyeOff, Phone } from "lucide-react-native";
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

let SCREEN_HEIGHT = Dimensions.get("window").height;
Dimensions.addEventListener("change", ({ window }) => { SCREEN_HEIGHT = window.height; });
WebBrowser.maybeCompleteAuthSession();
const VERIFY_EMAIL_WEB_URL = "http://192.168.1.96:5173/verify-email";

function formatPhoneNumber(raw: string): string {
    const digits = raw.replace(/\D/g, "").slice(0, 10);
    if (digits.length <= 3) return digits.length ? `(${digits}` : "";
    if (digits.length <= 6) return `(${digits.slice(0, 3)}) ${digits.slice(3)}`;
    return `(${digits.slice(0, 3)}) ${digits.slice(3, 6)}-${digits.slice(6)}`;
}

export default function AuthScreen() {
    const [isSignUp, setIsSignUp] = useState(false);
    const [usePhone, setUsePhone] = useState(false);
    const [email, setEmail] = useState("");
    const [phoneSignIn, setPhoneSignIn] = useState("");
    const [password, setPassword] = useState("");
    const [firstName, setFirstName] = useState("");
    const [lastInitial, setLastInitial] = useState("");
    const router = useRouter();
    const [phone, setPhone] = useState("");
    const [showPassword, setShowPassword] = useState(false);
    const [loading, setLoading] = useState(false);
    const [googleLoading, setGoogleLoading] = useState(false);
    const [notification, setNotification] = useState<{
        visible: boolean;
        message: string;
        type: "error" | "success" | "info";
    }>({ visible: false, message: "", type: "error" });

    const btnScale = useSharedValue(1);
    const btnStyle = useAnimatedStyle(() => ({
        transform: [{ scale: btnScale.value }],
    }));

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

    async function handleAuth() {
        // Sign-in validation
        if (!isSignUp) {
            const identifier = usePhone ? phoneSignIn.trim() : email.trim();
            if (!identifier || !password) {
                setNotification({
                    visible: true,
                    message: `Please enter your ${usePhone ? "phone number" : "email"} and password.`,
                    type: "error",
                });
                return;
            }
        }

        // Sign-up validation
        if (isSignUp) {
            if (!email || !password) {
                setNotification({ visible: true, message: "Please enter both email and password.", type: "error" });
                return;
            }
            if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email.trim())) {
                setNotification({ visible: true, message: "Please enter a valid email address.", type: "error" });
                return;
            }
            if (!firstName || !lastInitial) {
                setNotification({ visible: true, message: "Please enter your first name and last initial.", type: "error" });
                return;
            }
        }

        setLoading(true);
        try {
            if (isSignUp) {
                const fullName = `${firstName.trim()} ${lastInitial.trim().toUpperCase()}.`;
                const normalizedPhone = phone.replace(/\D/g, "").trim();
                const { data, error } = await supabase.auth.signUp({
                    email: email.trim(),
                    password,
                    options: {
                        emailRedirectTo: VERIFY_EMAIL_WEB_URL,
                        // Persist identity fields at auth level so first login can always sync profile.
                        data: {
                            full_name: fullName,
                            first_name: firstName.trim(),
                            last_name: `${lastInitial.trim().toUpperCase()}.`,
                            phone_number: normalizedPhone,
                        },
                    },
                });
                if (error) throw error;

                if (data.user) {
                    const { error: profileError } = await supabase
                        .from('profiles')
                        .upsert({
                            id: data.user.id,
                            email: email.trim(),
                            full_name: fullName,
                            phone_number: normalizedPhone,
                            created_at: new Date().toISOString(),
                        });
                    // Non-blocking: metadata fallback still allows profile-sync to populate name on sign-in.
                    if (profileError) {
                        console.warn("Profile upsert during sign-up failed:", profileError.message);
                    }
                }

                // Navigate to the dedicated email verification screen
                router.replace({
                    pathname: "/email-verify" as any,
                    params: { email: email.trim() },
                });
                return;
            } else if (usePhone) {
                // Phone sign-in: look up email stored in profiles, then sign in with password
                const rawPhone = phoneSignIn.replace(/\D/g, "").trim();
                const { data: profile, error: lookupError } = await supabase
                    .from('profiles')
                    .select('email')
                    .eq('phone_number', rawPhone)
                    .maybeSingle();

                if (lookupError || !profile?.email) {
                    throw new Error("No account found with that phone number.");
                }

                const { error } = await supabase.auth.signInWithPassword({
                    email: profile.email,
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
            if (message.includes("already registered")) {
                friendlyMessage = "This account already exists.\nPlease sign in instead.";
            } else if (
                message.toLowerCase().includes("email not confirmed") ||
                message.toLowerCase().includes("email_not_confirmed") ||
                message.toLowerCase().includes("not confirmed")
            ) {
                friendlyMessage = "Please verify your email before signing in.\nCheck your inbox for the link from Rasvia.";
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
                <KeyboardAvoidingView
                    behavior="padding"
                    style={{ flex: 1 }}
                    keyboardVerticalOffset={Platform.OS === "android" ? 0 : 0}
                >
                    <ScrollView
                        contentContainerStyle={{ flexGrow: 1, justifyContent: "flex-end" }}
                        keyboardShouldPersistTaps="handled"
                        showsVerticalScrollIndicator={false}
                        bounces={false}
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
                        {/* Title */}
                        <Text
                            style={{
                                fontFamily: "BricolageGrotesque_700Bold",
                                color: "#f5f5f5",
                                fontSize: 26,
                                marginBottom: 6,
                            }}
                        >
                            {isSignUp ? "Create Account" : "Welcome Back"}
                        </Text>
                        <Text
                            style={{
                                fontFamily: "Manrope_500Medium",
                                color: "#999999",
                                fontSize: 14,
                                marginBottom: 28,
                            }}
                        >
                            {isSignUp
                                ? "Join the waitlist revolution."
                                : "Sign in to skip the line."}
                        </Text>

                        {/* Name Inputs (Sign Up Only) */}
                        {isSignUp && (
                            <>
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
                                            onFocus={() => { if (Platform.OS !== "web") Haptics.selectionAsync(); }}
                                            autoCapitalize="words"
                                            autoCorrect={false}
                                        />
                                    </View>
                                    <View
                                        style={{
                                            width: 80,
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
                                                textAlign: "center",
                                            }}
                                            placeholder="L"
                                            placeholderTextColor="#666666"
                                            value={lastInitial}
                                            onChangeText={(text) => setLastInitial(text.slice(0, 1))}
                                            onFocus={() => { if (Platform.OS !== "web") Haptics.selectionAsync(); }}
                                            maxLength={1}
                                            autoCapitalize="characters"
                                            autoCorrect={false}
                                        />
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
                                    First name, last initial
                                </Text>

                                {/* Phone Number Input */}
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
                                        onFocus={() => { if (Platform.OS !== "web") Haptics.selectionAsync(); }}
                                        keyboardType="phone-pad"
                                        autoCapitalize="none"
                                        autoCorrect={false}
                                    />
                                </View>
                            </>
                        )}

                        {/* Email / Phone toggle (sign-in only) */}
                        {!isSignUp && (
                            <View
                                style={{
                                    flexDirection: "row",
                                    backgroundColor: "#1a1a1a",
                                    borderRadius: 12,
                                    borderWidth: 1,
                                    borderColor: "#333333",
                                    marginBottom: 14,
                                    padding: 4,
                                }}
                            >
                                <Pressable
                                    onPress={() => {
                                        if (Platform.OS !== "web") Haptics.selectionAsync();
                                        setUsePhone(false);
                                    }}
                                    style={{
                                        flex: 1,
                                        height: 36,
                                        borderRadius: 9,
                                        alignItems: "center",
                                        justifyContent: "center",
                                        backgroundColor: !usePhone ? "#FF9933" : "transparent",
                                    }}
                                >
                                    <Text
                                        style={{
                                            fontFamily: "Manrope_600SemiBold",
                                            color: !usePhone ? "#0f0f0f" : "#999999",
                                            fontSize: 13,
                                        }}
                                    >
                                        Email
                                    </Text>
                                </Pressable>
                                <Pressable
                                    onPress={() => {
                                        if (Platform.OS !== "web") Haptics.selectionAsync();
                                        setUsePhone(true);
                                    }}
                                    style={{
                                        flex: 1,
                                        height: 36,
                                        borderRadius: 9,
                                        alignItems: "center",
                                        justifyContent: "center",
                                        backgroundColor: usePhone ? "#FF9933" : "transparent",
                                    }}
                                >
                                    <Text
                                        style={{
                                            fontFamily: "Manrope_600SemiBold",
                                            color: usePhone ? "#0f0f0f" : "#999999",
                                            fontSize: 13,
                                        }}
                                    >
                                        Phone
                                    </Text>
                                </Pressable>
                            </View>
                        )}

                        {/* Email Input (sign-up always, sign-in when email mode) */}
                        {(!usePhone || isSignUp) && (
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
                                <Mail size={18} color="#999999" />
                                <TextInput
                                    style={{
                                        flex: 1,
                                        color: "#f5f5f5",
                                        fontFamily: "Manrope_500Medium",
                                        fontSize: 15,
                                        marginLeft: 12,
                                    }}
                                    placeholder="Email address"
                                    placeholderTextColor="#666666"
                                    value={email}
                                    onChangeText={setEmail}
                                    onFocus={() => { if (Platform.OS !== "web") Haptics.selectionAsync(); }}
                                    keyboardType="email-address"
                                    autoCapitalize="none"
                                    autoCorrect={false}
                                />
                            </View>
                        )}

                        {/* Phone Input (sign-in phone mode only) */}
                        {usePhone && !isSignUp && (
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
                                    value={phoneSignIn}
                                    onChangeText={(v) => setPhoneSignIn(formatPhoneNumber(v))}
                                    onFocus={() => { if (Platform.OS !== "web") Haptics.selectionAsync(); }}
                                    keyboardType="phone-pad"
                                    autoCapitalize="none"
                                    autoCorrect={false}
                                />
                            </View>
                        )}

                        {/* Password Input */}
                        <View
                            style={{
                                flexDirection: "row",
                                alignItems: "center",
                                backgroundColor: "#262626",
                                borderRadius: 16,
                                borderWidth: 1,
                                borderColor: "#333333",
                                paddingHorizontal: 16,
                                marginBottom: 24,
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
                                onFocus={() => { if (Platform.OS !== "web") Haptics.selectionAsync(); }}
                                secureTextEntry={!showPassword}
                                autoCapitalize="none"
                            />
                            <Pressable
                                onPress={() => setShowPassword(!showPassword)}
                                hitSlop={10}
                            >
                                {showPassword ? (
                                    <EyeOff size={18} color="#999999" />
                                ) : (
                                    <Eye size={18} color="#999999" />
                                )}
                            </Pressable>
                        </View>

                        {/* Terms & Privacy Disclaimer (Sign Up Only) */}
                        {isSignUp && (
                            <Text
                                style={{
                                    fontFamily: "Manrope_500Medium",
                                    color: "#666666",
                                    fontSize: 12,
                                    textAlign: "center",
                                    marginBottom: 20,
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
                                </Text>.
                            </Text>
                        )}

                        {/* Google OAuth */}
                        <Pressable
                            onPress={handleGoogleAuth}
                            disabled={loading || googleLoading}
                            style={{
                                borderRadius: 16,
                                height: 54,
                                alignItems: "center",
                                justifyContent: "center",
                                flexDirection: "row",
                                backgroundColor: "#202020",
                                borderWidth: 1,
                                borderColor: "#333333",
                                opacity: loading || googleLoading ? 0.7 : 1,
                                marginBottom: 14,
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
                                            borderRadius: 12,
                                            backgroundColor: "#ffffff",
                                            alignItems: "center",
                                            justifyContent: "center",
                                            marginRight: 10,
                                        }}
                                    >
                                        <Text
                                            style={{
                                                fontFamily: "BricolageGrotesque_700Bold",
                                                color: "#4285F4",
                                                fontSize: 14,
                                            }}
                                        >
                                            G
                                        </Text>
                                    </View>
                                    <Text
                                        style={{
                                            fontFamily: "Manrope_700Bold",
                                            color: "#f5f5f5",
                                            fontSize: 15,
                                        }}
                                    >
                                        Continue with Google
                                    </Text>
                                </>
                            )}
                        </Pressable>

                        <View style={{ flexDirection: "row", alignItems: "center", marginBottom: 18 }}>
                            <View style={{ flex: 1, height: 1, backgroundColor: "#2b2b2b" }} />
                            <Text style={{ marginHorizontal: 10, color: "#666666", fontFamily: "Manrope_500Medium", fontSize: 12 }}>
                                or
                            </Text>
                            <View style={{ flex: 1, height: 1, backgroundColor: "#2b2b2b" }} />
                        </View>

                        {/* Action Button */}
                        <Animated.View style={btnStyle}>
                            <Pressable
                                onPress={() => {
                                    if (Platform.OS !== "web") {
                                        Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Medium);
                                    }
                                    handleAuth();
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
                                        {isSignUp ? "Get Started" : "Welcome Back"}
                                    </Text>
                                )}
                            </Pressable>
                        </Animated.View>

                        {/* Toggle Sign In / Sign Up */}
                        <Pressable
                            onPress={() => {
                                if (Platform.OS !== "web") {
                                    Haptics.selectionAsync();
                                }
                                setIsSignUp(!isSignUp);
                                setEmail("");
                                setPassword("");
                                setPhone("");
                                setPhoneSignIn("");
                                setFirstName("");
                                setLastInitial("");
                                setUsePhone(false);
                            }}
                            style={{
                                marginTop: 20,
                                alignItems: "center",
                            }}
                        >
                            <Text
                                style={{
                                    fontFamily: "Manrope_500Medium",
                                    color: "#999999",
                                    fontSize: 14,
                                }}
                            >
                                {isSignUp ? "Already have an account? " : "New to Rasvia? "}
                                <Text
                                    style={{
                                        fontFamily: "Manrope_700Bold",
                                        color: "#FF9933",
                                    }}
                                >
                                    {isSignUp ? "Log In" : "Create Account"}
                                </Text>
                            </Text>
                        </Pressable>
                    </Animated.View>
                    </ScrollView>
                </KeyboardAvoidingView>
            </SafeAreaView>
        </View>
    );
}
