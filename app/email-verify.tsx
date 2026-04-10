import React from "react";
import { View, Text, Pressable, Platform } from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";
import { LinearGradient } from "expo-linear-gradient";
import { Mail, CheckCircle } from "lucide-react-native";
import { useRouter, useLocalSearchParams } from "expo-router";
import Animated, { FadeIn, FadeInUp } from "react-native-reanimated";
import * as Haptics from "expo-haptics";

export default function EmailVerifyScreen() {
    const router = useRouter();
    const { email } = useLocalSearchParams<{ email?: string }>();

    function handleBackToSignIn() {
        if (Platform.OS !== "web") {
            Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
        }
        router.replace("/auth");
    }

    return (
        <View style={{ flex: 1, backgroundColor: "#0f0f0f" }}>
            <LinearGradient
                colors={["#1a0a00", "#0f0f0f", "#0f0f0f"]}
                locations={[0, 0.4, 1]}
                style={{ position: "absolute", top: 0, left: 0, right: 0, bottom: 0 }}
            />

            <SafeAreaView style={{ flex: 1, alignItems: "center", justifyContent: "center", paddingHorizontal: 32 }}>
                {/* Logo */}
                <Animated.Text
                    entering={FadeIn.duration(600)}
                    style={{
                        fontFamily: "BricolageGrotesque_800ExtraBold",
                        color: "#FF9933",
                        fontSize: 42,
                        letterSpacing: -1,
                        marginBottom: 48,
                    }}
                >
                    rasvia
                </Animated.Text>

                {/* Icon */}
                <Animated.View
                    entering={FadeInUp.delay(150).duration(600)}
                    style={{
                        width: 80,
                        height: 80,
                        borderRadius: 40,
                        backgroundColor: "rgba(255, 153, 51, 0.12)",
                        alignItems: "center",
                        justifyContent: "center",
                        marginBottom: 28,
                        borderWidth: 1,
                        borderColor: "rgba(255, 153, 51, 0.25)",
                    }}
                >
                    <Mail size={36} color="#FF9933" />
                </Animated.View>

                {/* Heading */}
                <Animated.Text
                    entering={FadeInUp.delay(250).duration(600)}
                    style={{
                        fontFamily: "BricolageGrotesque_700Bold",
                        color: "#f5f5f5",
                        fontSize: 26,
                        textAlign: "center",
                        marginBottom: 14,
                    }}
                >
                    Check Your Email
                </Animated.Text>

                {/* Subtext */}
                <Animated.Text
                    entering={FadeInUp.delay(350).duration(600)}
                    style={{
                        fontFamily: "Manrope_500Medium",
                        color: "#999999",
                        fontSize: 15,
                        textAlign: "center",
                        lineHeight: 24,
                        marginBottom: 12,
                    }}
                >
                    We sent a 6-digit verification code to
                </Animated.Text>

                {email ? (
                    <Animated.Text
                        entering={FadeInUp.delay(400).duration(600)}
                        style={{
                            fontFamily: "Manrope_700Bold",
                            color: "#FF9933",
                            fontSize: 15,
                            textAlign: "center",
                            marginBottom: 24,
                        }}
                    >
                        {email}
                    </Animated.Text>
                ) : null}

                {/* Info Card */}
                <Animated.View
                    entering={FadeInUp.delay(500).duration(600)}
                    style={{
                        backgroundColor: "rgba(26, 26, 26, 0.9)",
                        borderRadius: 20,
                        borderWidth: 1,
                        borderColor: "rgba(255, 255, 255, 0.07)",
                        padding: 20,
                        width: "100%",
                        marginBottom: 32,
                        gap: 12,
                    }}
                >
                    {[
                        "Enter the 6-digit code from your email to verify.",
                        "The code expires in 60 seconds.",
                        "Don't see it? Check your spam folder.",
                    ].map((tip, i) => (
                        <View key={i} style={{ flexDirection: "row", alignItems: "flex-start", gap: 10 }}>
                            <CheckCircle size={16} color="#FF9933" style={{ marginTop: 2 }} />
                            <Text
                                style={{
                                    flex: 1,
                                    fontFamily: "Manrope_500Medium",
                                    color: "#cccccc",
                                    fontSize: 14,
                                    lineHeight: 20,
                                }}
                            >
                                {tip}
                            </Text>
                        </View>
                    ))}
                </Animated.View>

                {/* Back to Sign In */}
                <Animated.View entering={FadeInUp.delay(600).duration(600)} style={{ width: "100%" }}>
                    <Pressable
                        onPress={handleBackToSignIn}
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
                        }}
                    >
                        <Text
                            style={{
                                fontFamily: "BricolageGrotesque_700Bold",
                                color: "#0f0f0f",
                                fontSize: 17,
                            }}
                        >
                            Back to Sign In
                        </Text>
                    </Pressable>
                </Animated.View>
            </SafeAreaView>
        </View>
    );
}
