import React, { useState, useRef, useEffect, useCallback } from "react";
import {
    View,
    Text,
    Pressable,
    Alert,
    Platform,
    Dimensions,
    Image,
    ScrollView,
    ActivityIndicator,
} from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";
import { LinearGradient } from "expo-linear-gradient";
import {
    Leaf,
    Drumstick,
    ShieldCheck,
    MapPin,
    ChevronDown,
    Check,
    Sparkles,
} from "lucide-react-native";
import Animated, {
    FadeIn,
    FadeInDown,
    FadeInUp,
    useAnimatedStyle,
    useSharedValue,
    withSpring,
} from "react-native-reanimated";
import * as Haptics from "expo-haptics";
import { supabase } from "@/lib/supabase";
import { useAuth } from "@/lib/auth-context";

let SCREEN_WIDTH = Dimensions.get("window").width;
Dimensions.addEventListener("change", ({ window }) => { SCREEN_WIDTH = window.width; });

// ==========================================
// CONSTANTS (outside component — stable refs)
// ==========================================
const DFW_CITIES = [
    "Frisco, TX",
    "Plano, TX",
    "Irving, TX",
    "Dallas, TX",
    "Fort Worth, TX",
    "Richardson, TX",
    "Allen, TX",
    "McKinney, TX",
    "Carrollton, TX",
    "Denton, TX",
    "Arlington, TX",
    "Garland, TX",
    "Grapevine, TX",
    "Southlake, TX",
    "Coppell, TX",
    "Prosper, TX",
    "Lewisville, TX",
    "Flower Mound, TX",
    "The Colony, TX",
    "Little Elm, TX",
];

const DIETARY_OPTIONS = [
    { key: "Vegetarian", label: "Vegetarian", icon: Leaf, color: "#22C55E", desc: "No meat, no eggs" },
    { key: "Non-Veg", label: "Non-Veg", icon: Drumstick, color: "#EF4444", desc: "I eat everything" },
    { key: "Halal", label: "Halal", icon: ShieldCheck, color: "#60A5FA", desc: "Halal certified only" },
];

const DAYS = [
    { short: "M", full: "Mon" },
    { short: "T", full: "Tue" },
    { short: "W", full: "Wed" },
    { short: "T", full: "Thu" },
    { short: "F", full: "Fri" },
    { short: "S", full: "Sat" },
    { short: "S", full: "Sun" },
];

// ==========================================
// MAIN COMPONENT
// ==========================================
export default function OnboardingScreen() {
    const { session, setNeedsOnboarding } = useAuth();

    const [step, setStep] = useState(0);
    const [saving, setSaving] = useState(false);
    const [showCityPicker, setShowCityPicker] = useState(false);
    const [showTagline, setShowTagline] = useState(false);

    // Onboarding data — all in one stable ref
    const [city, setCity] = useState("Frisco, TX");
    const [dietaryType, setDietaryType] = useState("");
    const [restrictedDays, setRestrictedDays] = useState<string[]>([]);

    // Button animations
    const btnScale = useSharedValue(1);
    const btnStyle = useAnimatedStyle(() => ({
        transform: [{ scale: btnScale.value }],
    }));

    // Tagline delay
    useEffect(() => {
        const timer = setTimeout(() => setShowTagline(true), 1200);
        return () => clearTimeout(timer);
    }, []);

    // ==========================================
    // SAVE TO SUPABASE
    // ==========================================
    const handleFinish = useCallback(async () => {
        if (saving) return;
        if (!session?.user?.id) return;

        setSaving(true);
        try {
            if (Platform.OS !== "web") {
                Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
            }

            // Always upsert so onboarding_completed is guaranteed to be written,
            // even if the profile row doesn't exist yet or the previous write failed.
            const { error } = await supabase
                .from("profiles")
                .upsert(
                    {
                        id: session.user.id,
                        location_city: city,
                        dietary_type: dietaryType,
                        restricted_days: restrictedDays,
                        spice_level: "Medium",
                        onboarding_completed: true,
                        updated_at: new Date().toISOString(),
                    },
                    { onConflict: "id" }
                );

            if (error) {
                console.error("❌ Profile save error:", error);
                Alert.alert(
                    "Setup Error",
                    "Could not save your preferences.\n\nError: " + error.message
                );
                setSaving(false);
                return;
            }

            setNeedsOnboarding(false);
        } catch (err: any) {
            console.error("Profile save error:", err);
            Alert.alert("Error", err.message || "Something went wrong.");
        } finally {
            setSaving(false);
        }
    }, [saving, session, city, dietaryType, restrictedDays, setNeedsOnboarding]);

    // ==========================================
    // NAVIGATION
    // ==========================================
    const goBack = useCallback(() => {
        if (Platform.OS !== "web") Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
        setStep((prev) => Math.max(0, prev - 1));
    }, []);

    const goNext = useCallback(() => {
        if (Platform.OS !== "web") {
            Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Medium);
        }

        if (step === 1 && dietaryType !== "Non-Veg") {
            handleFinish();
            return;
        }

        setStep((prev) => prev + 1);
    }, [step, dietaryType, handleFinish]);

    const toggleDay = useCallback((dayFull: string) => {
        if (Platform.OS !== "web") {
            Haptics.selectionAsync();
        }
        setRestrictedDays((prev) =>
            prev.includes(dayFull) ? prev.filter((d) => d !== dayFull) : [...prev, dayFull]
        );
    }, []);

    // ==========================================
    // STEP INDICATOR
    // ==========================================
    const totalSteps = dietaryType === "Non-Veg" ? 3 : 2;

    // ==========================================
    // RENDER
    // ==========================================
    return (
        <View className="flex-1 bg-neutral-900">
            {/* ============ STEP 0: WELCOME & LOCATION ============ */}
            {step === 0 && (
                <View className="flex-1">
                    {/* Background */}
                    <Image
                        source={{
                            uri: "https://images.unsplash.com/photo-1596040033229-a9821ebd058d?w=1200&q=80",
                        }}
                        style={{ width: "100%", height: "100%", position: "absolute" }}
                        resizeMode="cover"
                    />
                    <LinearGradient
                        colors={[
                            "rgba(15,15,15,0.15)",
                            "rgba(15,15,15,0.45)",
                            "rgba(15,15,15,0.88)",
                            "#0f0f0f",
                        ]}
                        locations={[0, 0.25, 0.6, 0.8]}
                        style={{ position: "absolute", top: 0, left: 0, right: 0, bottom: 0 }}
                    />

                    <SafeAreaView className="flex-1 justify-between" edges={["top", "bottom"]}>
                        {/* Animated Brand */}
                        <View className="items-center" style={{ paddingTop: 100 }}>
                            <Animated.View entering={FadeInDown.duration(1000)}>
                                <Text
                                    style={{
                                        fontFamily: "BricolageGrotesque_800ExtraBold",
                                        color: "#FF9933",
                                        fontSize: 52,
                                        letterSpacing: -1.5,
                                        textAlign: "center",
                                    }}
                                >
                                    rasvia
                                </Text>
                            </Animated.View>

                            {showTagline && (
                                <Animated.View entering={FadeIn.duration(800)}>
                                    <Text
                                        style={{
                                            fontFamily: "Manrope_500Medium",
                                            color: "rgba(245,245,245,0.7)",
                                            fontSize: 18,
                                            marginTop: 8,
                                            letterSpacing: 2,
                                        }}
                                    >
                                        Dining, elevated.
                                    </Text>
                                </Animated.View>
                            )}
                        </View>

                        {/* Glassmorphism Card */}
                        <Animated.View
                            entering={FadeInUp.delay(800).duration(700)}
                            style={{
                                marginHorizontal: 20,
                                marginBottom: 20,
                                backgroundColor: "rgba(26, 26, 26, 0.92)",
                                borderRadius: 28,
                                borderWidth: 1,
                                borderColor: "rgba(255, 255, 255, 0.06)",
                                padding: 24,
                            }}
                        >
                            <View style={{ flexDirection: "row", alignItems: "center", marginBottom: 6 }}>
                                <MapPin size={18} color="#FF9933" />
                                <Text
                                    style={{
                                        fontFamily: "Manrope_600SemiBold",
                                        color: "#FF9933",
                                        fontSize: 12,
                                        marginLeft: 6,
                                        letterSpacing: 1.5,
                                        textTransform: "uppercase",
                                    }}
                                >
                                    Currently Serving
                                </Text>
                            </View>

                            <Text
                                style={{
                                    fontFamily: "BricolageGrotesque_700Bold",
                                    color: "#f5f5f5",
                                    fontSize: 22,
                                    marginBottom: 4,
                                }}
                            >
                                DFW Metroplex
                            </Text>
                            <Text
                                style={{
                                    fontFamily: "Manrope_500Medium",
                                    color: "#999999",
                                    fontSize: 14,
                                    marginBottom: 20,
                                }}
                            >
                                Select your city below
                            </Text>

                            {/* City Selector Button */}
                            <Pressable
                                onPress={() => setShowCityPicker((p) => !p)}
                                style={{
                                    flexDirection: "row",
                                    alignItems: "center",
                                    justifyContent: "space-between",
                                    backgroundColor: "#262626",
                                    borderRadius: 16,
                                    borderWidth: 1,
                                    borderColor: "#333",
                                    paddingHorizontal: 16,
                                    height: 56,
                                    marginBottom: showCityPicker ? 12 : 20,
                                }}
                            >
                                <Text style={{ fontFamily: "Manrope_600SemiBold", color: "#f5f5f5", fontSize: 16 }}>
                                    {city}
                                </Text>
                                <ChevronDown
                                    size={20}
                                    color="#999"
                                    style={{ transform: [{ rotate: showCityPicker ? "180deg" : "0deg" }] }}
                                />
                            </Pressable>

                            {/* City Dropdown */}
                            {showCityPicker && (
                                <View
                                    style={{
                                        backgroundColor: "#1a1a1a",
                                        borderRadius: 16,
                                        borderWidth: 1,
                                        borderColor: "#2a2a2a",
                                        maxHeight: 200,
                                        marginBottom: 20,
                                        overflow: "hidden",
                                    }}
                                >
                                    <ScrollView showsVerticalScrollIndicator={false} nestedScrollEnabled>
                                        {DFW_CITIES.map((c) => (
                                            <Pressable
                                                key={c}
                                                onPress={() => {
                                                    setCity(c);
                                                    setShowCityPicker(false);
                                                    if (Platform.OS !== "web") Haptics.selectionAsync();
                                                }}
                                                style={{
                                                    flexDirection: "row",
                                                    alignItems: "center",
                                                    justifyContent: "space-between",
                                                    paddingHorizontal: 16,
                                                    paddingVertical: 14,
                                                    borderBottomWidth: 1,
                                                    borderBottomColor: "#262626",
                                                    backgroundColor: city === c ? "rgba(255,153,51,0.08)" : "transparent",
                                                }}
                                            >
                                                <Text
                                                    style={{
                                                        fontFamily: "Manrope_500Medium",
                                                        color: city === c ? "#FF9933" : "#f5f5f5",
                                                        fontSize: 15,
                                                    }}
                                                >
                                                    {c}
                                                </Text>
                                                {city === c && <Check size={18} color="#FF9933" />}
                                            </Pressable>
                                        ))}
                                    </ScrollView>
                                </View>
                            )}

                            {/* Confirm Button */}
                            <Animated.View style={btnStyle}>
                                <Pressable
                                    onPress={goNext}
                                    onPressIn={() => { btnScale.value = withSpring(0.96); }}
                                    onPressOut={() => { btnScale.value = withSpring(1); }}
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
                                        Confirm Location
                                    </Text>
                                </Pressable>
                            </Animated.View>
                        </Animated.View>
                    </SafeAreaView>
                </View>
            )}

            {/* ============ STEP 1: DIETARY DNA ============ */}
            {step === 1 && (
                <SafeAreaView className="flex-1" edges={["top", "bottom"]}>
                    <ScrollView
                        className="flex-1"
                        contentContainerStyle={{ paddingHorizontal: 20, paddingBottom: 40, paddingTop: 16 }}
                        showsVerticalScrollIndicator={false}
                    >
                        {/* Back Link */}
                        <Pressable onPress={goBack} style={{ marginBottom: 12 }}>
                            <Text style={{ fontFamily: "Manrope_600SemiBold", color: "#999999", fontSize: 14 }}>
                                ← Back
                            </Text>
                        </Pressable>

                        {/* Step Dots */}
                        <View style={{ flexDirection: "row", alignItems: "center", justifyContent: "center", gap: 8, marginBottom: 24 }}>
                            {Array.from({ length: totalSteps }).map((_, i) => (
                                <View
                                    key={i}
                                    style={{
                                        width: i === 1 ? 28 : 8,
                                        height: 8,
                                        borderRadius: 4,
                                        backgroundColor: i === 1 ? "#FF9933" : i < 1 ? "#FF9933" : "#333",
                                    }}
                                />
                            ))}
                        </View>

                        {/* Headline */}
                        <Animated.View entering={FadeInDown.duration(500)}>
                            <Text
                                style={{
                                    fontFamily: "BricolageGrotesque_800ExtraBold",
                                    color: "#f5f5f5",
                                    fontSize: 36,
                                    letterSpacing: -0.5,
                                    marginBottom: 6,
                                }}
                            >
                                How do you eat?
                            </Text>
                            <Text
                                style={{
                                    fontFamily: "Manrope_500Medium",
                                    color: "#999999",
                                    fontSize: 16,
                                    marginBottom: 32,
                                }}
                            >
                                This helps us personalize your feed.
                            </Text>
                        </Animated.View>

                        {/* 2×2 Grid */}
                        <View style={{ flexDirection: "row", flexWrap: "wrap", gap: 14 }}>
                            {DIETARY_OPTIONS.map((option, index) => {
                                const isSelected = dietaryType === option.key;
                                const Icon = option.icon;
                                return (
                                    <Pressable
                                        key={option.key}
                                        onPress={() => {
                                            if (Platform.OS !== "web") {
                                                Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Medium);
                                            }
                                            setDietaryType(option.key);
                                        }}
                                        style={{
                                            width: (SCREEN_WIDTH - 54) / 2,
                                            backgroundColor: isSelected ? "rgba(255,153,51,0.12)" : "#1a1a1a",
                                            borderRadius: 20,
                                            borderWidth: isSelected ? 2 : 1,
                                            borderColor: isSelected ? "#FF9933" : "#2a2a2a",
                                            padding: 20,
                                            minHeight: 150,
                                            justifyContent: "space-between",
                                            shadowColor: isSelected ? "#FF9933" : "transparent",
                                            shadowOffset: { width: 0, height: 0 },
                                            shadowOpacity: isSelected ? 0.25 : 0,
                                            shadowRadius: 20,
                                            elevation: isSelected ? 8 : 0,
                                        }}
                                    >
                                        {/* Icon */}
                                        <View
                                            style={{
                                                width: 48,
                                                height: 48,
                                                borderRadius: 14,
                                                backgroundColor: isSelected ? "rgba(255,153,51,0.2)" : "rgba(255,255,255,0.05)",
                                                alignItems: "center",
                                                justifyContent: "center",
                                                marginBottom: 16,
                                            }}
                                        >
                                            <Icon size={24} color={isSelected ? "#FF9933" : option.color} />
                                        </View>

                                        {/* Label */}
                                        <View>
                                            <Text
                                                style={{
                                                    fontFamily: "BricolageGrotesque_700Bold",
                                                    color: isSelected ? "#FF9933" : "#f5f5f5",
                                                    fontSize: 18,
                                                    marginBottom: 4,
                                                }}
                                            >
                                                {option.label}
                                            </Text>
                                            <Text
                                                style={{
                                                    fontFamily: "Manrope_500Medium",
                                                    color: isSelected ? "rgba(255,153,51,0.7)" : "#666",
                                                    fontSize: 13,
                                                }}
                                            >
                                                {option.desc}
                                            </Text>
                                        </View>

                                        {/* Checkmark */}
                                        {isSelected && (
                                            <View
                                                style={{
                                                    position: "absolute",
                                                    top: 12,
                                                    right: 12,
                                                    width: 24,
                                                    height: 24,
                                                    borderRadius: 12,
                                                    backgroundColor: "#FF9933",
                                                    alignItems: "center",
                                                    justifyContent: "center",
                                                }}
                                            >
                                                <Check size={14} color="#0f0f0f" strokeWidth={3} />
                                            </View>
                                        )}
                                    </Pressable>
                                );
                            })}
                        </View>
                    </ScrollView>

                    {/* Continue Button */}
                    <View style={{ paddingHorizontal: 20, paddingBottom: 16 }}>
                        <Animated.View style={btnStyle}>
                            <Pressable
                                onPress={goNext}
                                onPressIn={() => { btnScale.value = withSpring(0.96); }}
                                onPressOut={() => { btnScale.value = withSpring(1); }}
                                disabled={!dietaryType || saving}
                                style={{
                                    backgroundColor: dietaryType ? "#FF9933" : "#333",
                                    borderRadius: 16,
                                    height: 56,
                                    alignItems: "center",
                                    justifyContent: "center",
                                    flexDirection: "row",
                                    shadowColor: dietaryType ? "#FF9933" : "transparent",
                                    shadowOffset: { width: 0, height: 4 },
                                    shadowOpacity: 0.35,
                                    shadowRadius: 16,
                                    elevation: dietaryType ? 10 : 0,
                                    opacity: dietaryType ? 1 : 0.5,
                                }}
                            >
                                {saving ? (
                                    <ActivityIndicator color="#0f0f0f" />
                                ) : (
                                    <Text
                                        style={{
                                            fontFamily: "BricolageGrotesque_700Bold",
                                            color: dietaryType ? "#0f0f0f" : "#666",
                                            fontSize: 17,
                                        }}
                                    >
                                        {dietaryType && dietaryType !== "Non-Veg" ? "Finish Setup" : "Continue"}
                                    </Text>
                                )}
                            </Pressable>
                        </Animated.View>
                    </View>
                </SafeAreaView>
            )}

            {/* ============ STEP 2: FLEXI-SCHEDULE (Non-Veg only) ============ */}
            {step === 2 && (
                <SafeAreaView className="flex-1 justify-between" edges={["top", "bottom"]}>
                    <View style={{ paddingHorizontal: 20, paddingTop: 16 }}>
                        {/* Back Link */}
                        <Pressable onPress={goBack} style={{ marginBottom: 12 }}>
                            <Text style={{ fontFamily: "Manrope_600SemiBold", color: "#999999", fontSize: 14 }}>
                                ← Back
                            </Text>
                        </Pressable>

                        {/* Step Dots */}
                        <View style={{ flexDirection: "row", alignItems: "center", justifyContent: "center", gap: 8, marginBottom: 24 }}>
                            {[0, 1, 2].map((i) => (
                                <View
                                    key={i}
                                    style={{
                                        width: i === 2 ? 28 : 8,
                                        height: 8,
                                        borderRadius: 4,
                                        backgroundColor: i <= 2 ? "#FF9933" : "#333",
                                    }}
                                />
                            ))}
                        </View>

                        {/* Headline */}
                        <Animated.View entering={FadeInDown.duration(500)}>
                            <Text
                                style={{
                                    fontFamily: "BricolageGrotesque_800ExtraBold",
                                    color: "#f5f5f5",
                                    fontSize: 36,
                                    letterSpacing: -0.5,
                                    marginBottom: 6,
                                }}
                            >
                                Veg-only days?
                            </Text>
                            <Text
                                style={{
                                    fontFamily: "Manrope_500Medium",
                                    color: "#999999",
                                    fontSize: 16,
                                    marginBottom: 8,
                                    lineHeight: 24,
                                }}
                            >
                                We won&apos;t show you meat dishes on these days.{"\n"}
                                Tap the days you eat vegetarian only.
                            </Text>
                        </Animated.View>

                        {/* Day Bubbles */}
                        <Animated.View
                            entering={FadeInUp.delay(200).duration(500)}
                            style={{
                                flexDirection: "row",
                                justifyContent: "space-between",
                                marginTop: 24,
                                marginBottom: 32,
                            }}
                        >
                            {DAYS.map((day, index) => {
                                const isActive = restrictedDays.includes(day.full);
                                return (
                                    <View key={day.full + index} style={{ alignItems: "center" }}>
                                        <Pressable
                                            onPress={() => toggleDay(day.full)}
                                            style={{
                                                width: 46,
                                                height: 46,
                                                borderRadius: 23,
                                                alignItems: "center",
                                                justifyContent: "center",
                                                backgroundColor: isActive ? "#10B981" : "#1a1a1a",
                                                borderWidth: isActive ? 0 : 1,
                                                borderColor: "#333",
                                                shadowColor: isActive ? "#10B981" : "transparent",
                                                shadowOffset: { width: 0, height: 0 },
                                                shadowOpacity: isActive ? 0.5 : 0,
                                                shadowRadius: 12,
                                                elevation: isActive ? 6 : 0,
                                            }}
                                        >
                                            <Text
                                                style={{
                                                    fontFamily: "BricolageGrotesque_700Bold",
                                                    color: isActive ? "#fff" : "#999",
                                                    fontSize: 16,
                                                }}
                                            >
                                                {day.short}
                                            </Text>
                                        </Pressable>
                                        <Text
                                            style={{
                                                fontFamily: "Manrope_500Medium",
                                                color: isActive ? "#10B981" : "#555",
                                                fontSize: 10,
                                                textAlign: "center",
                                                marginTop: 6,
                                            }}
                                        >
                                            {day.full}
                                        </Text>
                                    </View>
                                );
                            })}
                        </Animated.View>

                        {/* Info Card */}
                        <View
                            style={{
                                backgroundColor: "rgba(16,185,129,0.08)",
                                borderWidth: 1,
                                borderColor: "rgba(16,185,129,0.15)",
                                borderRadius: 16,
                                padding: 16,
                                flexDirection: "row",
                                alignItems: "center",
                            }}
                        >
                            <Leaf size={20} color="#10B981" />
                            <Text
                                style={{
                                    fontFamily: "Manrope_500Medium",
                                    color: "#999",
                                    fontSize: 14,
                                    marginLeft: 12,
                                    flex: 1,
                                    lineHeight: 20,
                                }}
                            >
                                {restrictedDays.length === 0
                                    ? "No restrictions — you'll see all dishes every day."
                                    : `On ${restrictedDays.join(", ")}, we'll only show vegetarian options.`}
                            </Text>
                        </View>
                    </View>

                    {/* Finish Button */}
                    <View style={{ paddingHorizontal: 20, paddingBottom: 16 }}>
                        <Animated.View style={btnStyle}>
                            <Pressable
                                onPress={handleFinish}
                                onPressIn={() => { btnScale.value = withSpring(0.96); }}
                                onPressOut={() => { btnScale.value = withSpring(1); }}
                                disabled={saving}
                                style={{
                                    backgroundColor: "#FF9933",
                                    borderRadius: 16,
                                    height: 56,
                                    alignItems: "center",
                                    justifyContent: "center",
                                    flexDirection: "row",
                                    shadowColor: "#FF9933",
                                    shadowOffset: { width: 0, height: 4 },
                                    shadowOpacity: 0.35,
                                    shadowRadius: 16,
                                    elevation: 10,
                                    opacity: saving ? 0.7 : 1,
                                }}
                            >
                                {saving ? (
                                    <ActivityIndicator color="#0f0f0f" />
                                ) : (
                                    <>
                                        <Sparkles size={18} color="#0f0f0f" />
                                        <Text
                                            style={{
                                                fontFamily: "BricolageGrotesque_700Bold",
                                                color: "#0f0f0f",
                                                fontSize: 17,
                                                marginLeft: 8,
                                            }}
                                        >
                                            Finish Setup
                                        </Text>
                                    </>
                                )}
                            </Pressable>
                        </Animated.View>
                    </View>
                </SafeAreaView>
            )}
        </View>
    );
}
