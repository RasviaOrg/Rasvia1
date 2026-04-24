import React, { useState, useEffect, useCallback, useMemo } from "react";
import {
  View,
  Text,
  Pressable,
  ScrollView,
  Alert,
  Platform,
  ActivityIndicator,
} from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";
import { useRouter } from "expo-router";
import {
  ArrowLeft,
  Leaf,
  Drumstick,
  ShieldCheck,
  MapPin,
  Check,
  Sparkles,
  ChevronDown,
} from "lucide-react-native";
import Animated, {
  FadeInDown,
  useAnimatedStyle,
  useSharedValue,
  withRepeat,
  withSpring,
  withTiming,
} from "react-native-reanimated";
import * as Haptics from "expo-haptics";
import { supabase } from "@/lib/supabase";
import { useAuth } from "@/lib/auth-context";
import { useLocation } from "@/lib/location-context";
import { APP_BOTTOM_NAV_HEIGHT, APP_BOTTOM_NAV_OFFSET } from "@/components/AppBottomNav";
import { useAppTheme } from "@/lib/app-theme";

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
  { key: "Vegetarian", label: "Vegetarian", icon: Leaf, color: "#22C55E" },
  { key: "Non-Veg", label: "Non-Veg", icon: Drumstick, color: "#EF4444" },
  { key: "Halal", label: "Halal", icon: ShieldCheck, color: "#60A5FA" },
];

const DAYS = [
  { short: "M", full: "Mon" },
  { short: "Tu", full: "Tue" },
  { short: "W", full: "Wed" },
  { short: "Th", full: "Thu" },
  { short: "F", full: "Fri" },
  { short: "Sa", full: "Sat" },
  { short: "Su", full: "Sun" },
];

function DiningPrefsLoadingSkeleton() {
  const { colors } = useAppTheme();
  const pulse = useSharedValue(0.28);
  useEffect(() => {
    pulse.value = withRepeat(withTiming(0.52, { duration: 720 }), -1, true);
  }, [pulse]);
  const pulseStyle = useAnimatedStyle(() => ({ opacity: pulse.value }));
  const chips = useMemo(() => [0, 1, 2], []);
  const dayDots = useMemo(() => [0, 1, 2, 3, 4, 5, 6], []);

  return (
    <View>
      <Animated.View
        entering={FadeInDown.delay(40).duration(420)}
        style={{
          backgroundColor: colors.card,
          borderRadius: 20,
          borderWidth: 1,
          borderColor: colors.cardBorder,
          padding: 20,
        }}
      >
        <Animated.View
          style={[
            { height: 11, width: 72, borderRadius: 5, backgroundColor: colors.skeletonLine, marginBottom: 10 },
            pulseStyle,
          ]}
        />
        <Animated.View
          style={[{ height: 48, borderRadius: 14, backgroundColor: colors.skeleton, marginBottom: 22 }, pulseStyle]}
        />
        <Animated.View
          style={[
            { height: 11, width: 96, borderRadius: 5, backgroundColor: colors.skeletonLine, marginBottom: 10 },
            pulseStyle,
          ]}
        />
        <View style={{ flexDirection: "row", gap: 10, marginBottom: 22 }}>
          {chips.map((i) => (
            <Animated.View
              key={i}
              entering={FadeInDown.delay(80 + i * 48).duration(400)}
              style={[
                { flex: 1, height: 44, borderRadius: 12, backgroundColor: colors.skeleton },
                pulseStyle,
              ]}
            />
          ))}
        </View>
        <Animated.View
          style={[
            { height: 11, width: 110, borderRadius: 5, backgroundColor: colors.skeletonLine, marginBottom: 10 },
            pulseStyle,
          ]}
        />
        <View style={{ flexDirection: "row", flexWrap: "wrap", gap: 8 }}>
          {dayDots.map((i) => (
            <Animated.View
              key={i}
              entering={FadeInDown.delay(120 + i * 36).duration(380)}
              style={[
                { width: 40, height: 40, borderRadius: 12, backgroundColor: colors.skeleton },
                pulseStyle,
              ]}
            />
          ))}
        </View>
      </Animated.View>
    </View>
  );
}

export default function DiningPreferencesScreen() {
  const { colors, isDark } = useAppTheme();
  const router = useRouter();
  const { session } = useAuth();
  const { reloadLocationPrefs } = useLocation();

  const [loadingPrefs, setLoadingPrefs] = useState(true);
  const [savingPrefs, setSavingPrefs] = useState(false);
  const [city, setCity] = useState("Frisco, TX");
  const [dietaryType, setDietaryType] = useState("");
  const [restrictedDays, setRestrictedDays] = useState<string[]>([]);
  const [showCityPicker, setShowCityPicker] = useState(false);
  const [prefsChanged, setPrefsChanged] = useState(false);

  const [origCity, setOrigCity] = useState("");
  const [origDietary, setOrigDietary] = useState("");
  const [origDays, setOrigDays] = useState<string[]>([]);

  const saveScale = useSharedValue(1);
  const saveStyle = useAnimatedStyle(() => ({
    transform: [{ scale: saveScale.value }],
  }));

  useEffect(() => {
    async function loadPrefs() {
      if (!session?.user?.id) {
        setLoadingPrefs(false);
        return;
      }
      try {
        const { data, error } = await supabase
          .from("profiles")
          .select("location_city, dietary_type, restricted_days")
          .eq("id", session.user.id)
          .maybeSingle();

        if (!error && data) {
          const c = data.location_city || "Frisco, TX";
          const d = data.dietary_type || "";
          const r = data.restricted_days || [];
          setCity(c);
          setOrigCity(c);
          setDietaryType(d);
          setOrigDietary(d);
          setRestrictedDays(r);
          setOrigDays(r);
        }
      } catch {}
      setLoadingPrefs(false);
    }
    loadPrefs();
  }, [session?.user?.id]);

  useEffect(() => {
    if (loadingPrefs) return;
    const changed =
      city !== origCity ||
      dietaryType !== origDietary ||
      JSON.stringify([...restrictedDays].sort()) !==
        JSON.stringify([...origDays].sort());
    setPrefsChanged(changed);
  }, [city, dietaryType, restrictedDays, origCity, origDietary, origDays, loadingPrefs]);

  const savePreferences = useCallback(async () => {
    if (!session?.user?.id || savingPrefs) return;
    setSavingPrefs(true);
    try {
      const { error } = await supabase
        .from("profiles")
        .update({
          location_city: city,
          dietary_type: dietaryType,
          restricted_days: dietaryType === "Non-Veg" ? restrictedDays : [],
          updated_at: new Date().toISOString(),
        })
        .eq("id", session.user.id);

      if (error) throw error;

      setOrigCity(city);
      setOrigDietary(dietaryType);
      setOrigDays(dietaryType === "Non-Veg" ? restrictedDays : []);

      await reloadLocationPrefs();

      if (Platform.OS !== "web") {
        Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
      }
      Alert.alert("Saved!", "Your preferences have been updated.");
    } catch (err: any) {
      Alert.alert("Error", err.message || "Could not save preferences.");
    }
    setSavingPrefs(false);
  }, [session, city, dietaryType, restrictedDays, savingPrefs, reloadLocationPrefs]);

  return (
    <View style={{ flex: 1, backgroundColor: colors.background }}>
      <SafeAreaView style={{ flex: 1 }} edges={["top"]}>
        {/* Header */}
        <View
          style={{
            flexDirection: "row",
            alignItems: "center",
            paddingHorizontal: 20,
            paddingVertical: 14,
            borderBottomWidth: 1,
            borderBottomColor: colors.cardBorder,
            backgroundColor: colors.homeHeaderBg,
          }}
        >
          <Pressable
            onPress={() => {
              if (Platform.OS !== "web") Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
              router.back();
            }}
            hitSlop={12}
            style={{
              width: 38,
              height: 38,
              borderRadius: 19,
              backgroundColor: colors.pressableBg,
              alignItems: "center",
              justifyContent: "center",
              borderWidth: 1,
              borderColor: colors.cardBorder,
              marginRight: 14,
            }}
          >
            <ArrowLeft size={20} color={colors.text} />
          </Pressable>
          <View style={{ flex: 1 }}>
            <Text
              style={{
                fontFamily: "BricolageGrotesque_700Bold",
                color: colors.text,
                fontSize: 20,
              }}
            >
              Dining preferences
            </Text>
            <Text
              style={{
                fontFamily: "Manrope_500Medium",
                color: colors.textMuted,
                fontSize: 12,
                marginTop: 2,
              }}
            >
              Home area, how you eat, and vegetarian-only days
            </Text>
          </View>
        </View>

        <ScrollView
          style={{ flex: 1 }}
          contentContainerStyle={{ padding: 20, paddingBottom: APP_BOTTOM_NAV_HEIGHT + APP_BOTTOM_NAV_OFFSET + 40 }}
          showsVerticalScrollIndicator={false}
          keyboardShouldPersistTaps="handled"
        >
          {loadingPrefs ? (
            <DiningPrefsLoadingSkeleton />
          ) : (
            <View
              style={{
                backgroundColor: colors.card,
                borderRadius: 20,
                borderWidth: 1,
                borderColor: colors.cardBorder,
                padding: 20,
              }}
            >
              {/* Location */}
              <Text
                style={{
                  fontFamily: "Manrope_600SemiBold",
                  color: colors.textMuted,
                  fontSize: 12,
                  letterSpacing: 1,
                  textTransform: "uppercase",
                  marginBottom: 8,
                }}
              >
                Home area
              </Text>
              <Pressable
                onPress={() => setShowCityPicker((p) => !p)}
                style={{
                  flexDirection: "row",
                  alignItems: "center",
                  justifyContent: "space-between",
                  backgroundColor: colors.backgroundElevated,
                  borderRadius: 14,
                  borderWidth: 1,
                  borderColor: colors.cardBorder,
                  paddingHorizontal: 14,
                  height: 48,
                  marginBottom: showCityPicker ? 8 : 20,
                }}
              >
                <View style={{ flexDirection: "row", alignItems: "center" }}>
                  <MapPin size={16} color="#FF9933" />
                  <Text
                    style={{
                      fontFamily: "Manrope_600SemiBold",
                      color: colors.text,
                      fontSize: 15,
                      marginLeft: 8,
                    }}
                  >
                    {city}
                  </Text>
                </View>
                <ChevronDown
                  size={18}
                  color={colors.textMuted}
                  style={{
                    transform: [{ rotate: showCityPicker ? "180deg" : "0deg" }],
                  }}
                />
              </Pressable>

              {showCityPicker && (
                <View
                  style={{
                    backgroundColor: colors.backgroundElevated,
                    borderRadius: 14,
                    borderWidth: 1,
                    borderColor: colors.cardBorder,
                    maxHeight: 180,
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
                          paddingHorizontal: 14,
                          paddingVertical: 12,
                          borderBottomWidth: 1,
                          borderBottomColor: colors.cardBorder,
                          backgroundColor: city === c ? "rgba(255,153,51,0.1)" : "transparent",
                        }}
                      >
                        <Text
                          style={{
                            fontFamily: "Manrope_500Medium",
                            color: city === c ? "#FF9933" : colors.text,
                            fontSize: 14,
                          }}
                        >
                          {c}
                        </Text>
                        {city === c && <Check size={16} color="#FF9933" />}
                      </Pressable>
                    ))}
                  </ScrollView>
                </View>
              )}

              {/* Dietary Preference */}
              <Text
                style={{
                  fontFamily: "Manrope_600SemiBold",
                  color: colors.textMuted,
                  fontSize: 12,
                  letterSpacing: 1,
                  textTransform: "uppercase",
                  marginBottom: 10,
                }}
              >
                How you eat
              </Text>
              <View
                style={{
                  flexDirection: "row",
                  flexWrap: "wrap",
                  gap: 10,
                  marginBottom: 20,
                }}
              >
                {DIETARY_OPTIONS.map((option) => {
                  const isSelected = dietaryType === option.key;
                  const Icon = option.icon;
                  return (
                    <Pressable
                      key={option.key}
                      onPress={() => {
                        setDietaryType(option.key);
                        if (Platform.OS !== "web") Haptics.selectionAsync();
                      }}
                      style={{
                        flexDirection: "row",
                        alignItems: "center",
                        backgroundColor: isSelected ? "rgba(255,153,51,0.12)" : colors.pressableBg,
                        borderWidth: isSelected ? 1.5 : 1,
                        borderColor: isSelected ? "#FF9933" : colors.cardBorder,
                        borderRadius: 12,
                        paddingHorizontal: 14,
                        paddingVertical: 10,
                      }}
                    >
                      <Icon size={16} color={isSelected ? "#FF9933" : option.color} />
                      <Text
                        style={{
                          fontFamily: "Manrope_600SemiBold",
                          color: isSelected ? "#FF9933" : colors.textSecondary,
                          fontSize: 14,
                          marginLeft: 8,
                        }}
                      >
                        {option.label}
                      </Text>
                      {isSelected && (
                        <View
                          style={{
                            marginLeft: 6,
                            width: 18,
                            height: 18,
                            borderRadius: 9,
                            backgroundColor: "#FF9933",
                            alignItems: "center",
                            justifyContent: "center",
                          }}
                        >
                          <Check size={11} color="#0f0f0f" strokeWidth={3} />
                        </View>
                      )}
                    </Pressable>
                  );
                })}
              </View>

              {/* Veg-Only Days */}
              {dietaryType === "Non-Veg" && (
                <>
                  <Text
                    style={{
                      fontFamily: "Manrope_600SemiBold",
                      color: colors.textMuted,
                      fontSize: 12,
                      letterSpacing: 1,
                      textTransform: "uppercase",
                      marginBottom: 10,
                    }}
                  >
                    Vegetarian-only days
                  </Text>
                  <View
                    style={{
                      flexDirection: "row",
                      justifyContent: "space-between",
                      marginBottom: 10,
                    }}
                  >
                    {DAYS.map((day, index) => {
                      const isActive = restrictedDays.includes(day.full);
                      return (
                        <Pressable
                          key={day.full + index}
                          onPress={() => {
                            setRestrictedDays((prev) =>
                              prev.includes(day.full)
                                ? prev.filter((d) => d !== day.full)
                                : [...prev, day.full]
                            );
                            if (Platform.OS !== "web") Haptics.selectionAsync();
                          }}
                          style={{ alignItems: "center" }}
                        >
                          <View
                            style={{
                              width: 38,
                              height: 38,
                              borderRadius: 19,
                              alignItems: "center",
                              justifyContent: "center",
                              backgroundColor: isActive ? "#10B981" : colors.pressableBg,
                              borderWidth: isActive ? 0 : 1,
                              borderColor: colors.cardBorder,
                            }}
                          >
                            <Text
                              style={{
                                fontFamily: "BricolageGrotesque_700Bold",
                                color: isActive ? "#fff" : colors.textMuted,
                                fontSize: 13,
                              }}
                            >
                              {day.short}
                            </Text>
                          </View>
                          <Text
                            style={{
                              fontFamily: "Manrope_500Medium",
                              color: isActive ? "#10B981" : colors.textMuted,
                              fontSize: 9,
                              marginTop: 4,
                            }}
                          >
                            {day.full}
                          </Text>
                        </Pressable>
                      );
                    })}
                  </View>
                  <Text
                    style={{
                      fontFamily: "Manrope_500Medium",
                      color: colors.textMuted,
                      fontSize: 12,
                      marginBottom: 10,
                    }}
                  >
                    {restrictedDays.length === 0
                      ? "No vegetarian-only days — menus won\u2019t be filtered by weekday."
                      : `On ${restrictedDays.join(", ")}, we\u2019ll emphasize vegetarian-friendly picks.`}
                  </Text>
                </>
              )}

              {/* Save Button */}
              {prefsChanged && (
                <Animated.View style={saveStyle}>
                  <Pressable
                    onPress={savePreferences}
                    onPressIn={() => {
                      saveScale.value = withSpring(0.96);
                    }}
                    onPressOut={() => {
                      saveScale.value = withSpring(1);
                    }}
                    disabled={savingPrefs}
                    style={{
                      backgroundColor: isDark ? "#FF9933" : "#fb923c",
                      borderRadius: 14,
                      height: 48,
                      alignItems: "center",
                      justifyContent: "center",
                      flexDirection: "row",
                      marginTop: 8,
                      shadowColor: isDark ? "#FF9933" : "#7c2d12",
                      shadowOffset: { width: 0, height: 4 },
                      shadowOpacity: isDark ? 0.3 : 0.18,
                      shadowRadius: 12,
                      elevation: 8,
                      opacity: savingPrefs ? 0.7 : 1,
                    }}
                  >
                    {savingPrefs ? (
                      <ActivityIndicator color={isDark ? "#0f0f0f" : "#ffffff"} />
                    ) : (
                      <>
                        <Sparkles size={16} color={isDark ? "#0f0f0f" : "#ffffff"} />
                        <Text
                          style={{
                            fontFamily: "BricolageGrotesque_700Bold",
                            color: isDark ? "#0f0f0f" : "#ffffff",
                            fontSize: 15,
                            marginLeft: 6,
                          }}
                        >
                          Save preferences
                        </Text>
                      </>
                    )}
                  </Pressable>
                </Animated.View>
              )}
            </View>
          )}
        </ScrollView>
      </SafeAreaView>
    </View>
  );
}
