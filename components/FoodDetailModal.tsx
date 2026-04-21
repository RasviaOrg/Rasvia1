import React from "react";
import { View, Text, Pressable, Dimensions, Platform } from "react-native";
import { LinearGradient } from "expo-linear-gradient";
import { X, Plus, Leaf, Moon, Flame, Settings, Camera } from "lucide-react-native";
import type { UIMenuItem } from "@/lib/restaurant-types";
import Animated, { FadeIn, SlideInDown } from "react-native-reanimated";
import * as Haptics from "expo-haptics";
import { useAppTheme } from "@/lib/app-theme";
import { CachedImage } from "@/components/CachedImage";

let SCREEN_WIDTH = Dimensions.get("window").width;
let SCREEN_HEIGHT = Dimensions.get("window").height;
Dimensions.addEventListener("change", ({ window }) => { SCREEN_WIDTH = window.width; SCREEN_HEIGHT = window.height; });

interface FoodDetailModalProps {
  item: UIMenuItem;
  onClose: () => void;
  onAddToCart: () => void;
  onOpenSettings?: () => void;
  showContributeImage?: boolean;
  onContributeImage?: () => void;
  /** When false, primary CTA is greyed (restaurant closed or item unavailable). */
  canAddToCart?: boolean;
}

export function FoodDetailModal({
  item,
  onClose,
  onAddToCart,
  onOpenSettings,
  showContributeImage = false,
  onContributeImage,
  canAddToCart = true,
}: FoodDetailModalProps) {
  const { colors, isDark } = useAppTheme();
  const hasImage = !!item.image?.trim();
  const addBlocked = !canAddToCart || item.isAvailable === false;
  const addLabel = !canAddToCart
    ? "Restaurant is closed"
    : item.isAvailable === false
      ? "Out of stock"
      : `Add to Cart — $${item.price.toFixed(2)}`;
  return (
    <Animated.View
      entering={FadeIn.duration(300)}
      className="absolute inset-0"
      style={{
        backgroundColor: isDark ? "rgba(0,0,0,0.85)" : "rgba(0,0,0,0.4)",
        zIndex: 100,
      }}
    >
      <Animated.View
        entering={SlideInDown.duration(500).springify()}
        className="flex-1 justify-end"
      >
        <View
          className="rounded-t-3xl overflow-hidden"
          style={{ maxHeight: SCREEN_HEIGHT * 0.88, backgroundColor: colors.card, borderTopWidth: 1, borderColor: colors.cardBorder }}
        >
          {/* Image Section with Video Placeholder */}
          <View style={{ height: SCREEN_HEIGHT * 0.45, position: "relative" }}>
            {hasImage ? (
              <CachedImage
                source={{ uri: item.image }}
                style={{ width: "100%", height: "100%" }}
                resizeMode="cover"
                fallback={
                  <View
                    style={{
                      width: "100%",
                      height: "100%",
                      alignItems: "center",
                      justifyContent: "center",
                      backgroundColor: isDark ? "#1b1b1b" : colors.pressableBg,
                    }}
                  >
                    <Camera size={34} color={colors.iconMuted} />
                    <Text style={{ marginTop: 8, fontFamily: "Manrope_700Bold", color: colors.textMuted, fontSize: 13 }}>
                      No image available
                    </Text>
                  </View>
                }
              />
            ) : (
              <View
                style={{
                  width: "100%",
                  height: "100%",
                  alignItems: "center",
                  justifyContent: "center",
                  backgroundColor: isDark ? "#1b1b1b" : colors.pressableBg,
                }}
              >
                <Camera size={34} color={colors.iconMuted} />
                <Text style={{ marginTop: 8, fontFamily: "Manrope_700Bold", color: colors.textMuted, fontSize: 13 }}>
                  No image available
                </Text>
              </View>
            )}
            <LinearGradient
              colors={
                isDark
                  ? ["rgba(26,26,26,0.3)", "transparent", "rgba(26,26,26,0.95)"]
                  : ["rgba(255,255,255,0.25)", "transparent", "rgba(0,0,0,0.55)"]
              }
              style={{
                position: "absolute",
                top: 0,
                left: 0,
                right: 0,
                bottom: 0,
              }}
            />

            <View
              style={{
                position: "absolute",
                top: 16,
                left: 16,
                backgroundColor: isDark ? "rgba(0,0,0,0.65)" : "rgba(255,255,255,0.94)",
                borderRadius: 8,
                paddingHorizontal: 10,
                paddingVertical: 5,
                borderWidth: 1,
                borderColor: isDark ? "rgba(255,255,255,0.12)" : "rgba(0,0,0,0.08)",
              }}
            >
              <Text style={{ fontFamily: "JetBrainsMono_600SemiBold", color: "#FF9933", fontSize: 15 }}>
                ${item.price.toFixed(2)}
              </Text>
            </View>

            {hasImage && item.communityImageCredit && (
              <View
                style={{
                  position: "absolute",
                  bottom: 14,
                  right: 14,
                  backgroundColor: "rgba(0,0,0,0.62)",
                  borderRadius: 10,
                  paddingHorizontal: 8,
                  paddingVertical: 5,
                  borderWidth: 1,
                  borderColor: "rgba(255,255,255,0.2)",
                  flexDirection: "row",
                  alignItems: "center",
                  gap: 5,
                  maxWidth: "70%",
                }}
              >
                <Camera size={11} color="#d1d5db" />
                <Text
                  style={{
                    fontFamily: "Manrope_500Medium",
                    color: "#e5e7eb",
                    fontSize: 9,
                  }}
                  numberOfLines={1}
                >
                  {`Image taken by ${item.communityImageCredit}`}
                </Text>
              </View>
            )}

            {/* Top-right controls */}
            <View
              style={{
                position: "absolute",
                top: 16,
                right: 16,
                flexDirection: "row",
                alignItems: "center",
                gap: 8,
              }}
            >
              {onOpenSettings && (
                <Pressable
                  onPress={() => {
                    if (Platform.OS !== "web") Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
                    onOpenSettings();
                  }}
                  style={{
                    backgroundColor: isDark ? "rgba(15, 15, 15, 0.6)" : "rgba(255,255,255,0.92)",
                    width: 40,
                    height: 40,
                    borderRadius: 20,
                    alignItems: "center",
                    justifyContent: "center",
                    borderWidth: isDark ? 0 : 1,
                    borderColor: "rgba(0,0,0,0.08)",
                  }}
                >
                  <Settings size={18} color={colors.text} />
                </Pressable>
              )}
              <Pressable
                onPress={() => {
                  if (Platform.OS !== "web") Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
                  onClose();
                }}
                style={{
                  backgroundColor: isDark ? "rgba(15, 15, 15, 0.6)" : "rgba(255,255,255,0.92)",
                  width: 40,
                  height: 40,
                  borderRadius: 20,
                  alignItems: "center",
                  justifyContent: "center",
                  borderWidth: isDark ? 0 : 1,
                  borderColor: "rgba(0,0,0,0.08)",
                }}
              >
                <X size={20} color={colors.text} />
              </Pressable>
            </View>

            {/* Badges */}
            <View className="absolute bottom-4 left-5 flex-row items-center">
              {item.isVegetarian && (
                <View
                  className="flex-row items-center mr-2 px-2.5 py-1 rounded-full"
                  style={{ backgroundColor: "rgba(34, 197, 94, 0.2)" }}
                >
                  <Leaf size={12} color="#22C55E" />
                  <Text
                    style={{
                      fontFamily: "Manrope_600SemiBold",
                      color: "#22C55E",
                      fontSize: 11,
                      marginLeft: 4,
                    }}
                  >
                    Vegetarian
                  </Text>
                </View>
              )}
              {item.isHalal && (
                <View
                  className="flex-row items-center mr-2 px-2.5 py-1 rounded-full"
                  style={{ backgroundColor: "rgba(56, 189, 248, 0.2)" }}
                >
                  <Moon size={12} color="#38BDF8" />
                  <Text
                    style={{
                      fontFamily: "Manrope_600SemiBold",
                      color: "#38BDF8",
                      fontSize: 11,
                      marginLeft: 4,
                    }}
                  >
                    Halal
                  </Text>
                </View>
              )}
              {item.spiceLevel > 0 && (
                <View
                  className="flex-row items-center px-2.5 py-1 rounded-full"
                  style={{ backgroundColor: "rgba(239, 68, 68, 0.2)" }}
                >
                  {Array.from({ length: item.spiceLevel }).map((_, i) => (
                    <Flame
                      key={i}
                      size={12}
                      color="#EF4444"
                      fill="#EF4444"
                      style={{ marginRight: 2 }}
                    />
                  ))}
                </View>
              )}
            </View>
          </View>

          {/* Content */}
          <View className="px-5 pt-5 pb-4">
            <View className="flex-row items-start justify-between mb-2">
              <View className="flex-1 mr-4">
                <Text
                  style={{
                    fontFamily: "BricolageGrotesque_800ExtraBold",
                    color: colors.text,
                    fontSize: 32,
                    lineHeight: 36,
                    letterSpacing: -0.5,
                  }}
                >
                  {item.name}
                </Text>
              </View>
              {showContributeImage && onContributeImage ? (
                <View style={{ alignItems: "flex-end" }}>
                  <Pressable
                    onPress={() => {
                      if (Platform.OS !== "web") Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
                      onContributeImage();
                    }}
                    style={{
                      flexDirection: "row",
                      alignItems: "center",
                      gap: 5,
                      backgroundColor: isDark ? "rgba(15,15,15,0.72)" : colors.pressableBg,
                      borderRadius: 999,
                      paddingHorizontal: 10,
                      paddingVertical: 6,
                      borderWidth: 1,
                      borderColor: isDark ? "rgba(255,255,255,0.2)" : colors.cardBorder,
                    }}
                  >
                    <Camera size={12} color="#FF9933" />
                    <Text style={{ fontFamily: "Manrope_700Bold", color: "#FF9933", fontSize: 11 }}>
                      Add Photo
                    </Text>
                  </Pressable>
                </View>
              ) : null}
            </View>

            <Text
              style={{
                fontFamily: "Manrope_500Medium",
                color: colors.textMuted,
                fontSize: 15,
                lineHeight: 22,
                marginBottom: 6,
              }}
            >
              {item.description}
            </Text>

            {/* Meal time chips — colored by period, no category badge */}
            {item.mealTimes && item.mealTimes.length > 0 && (() => {
              const MEAL_STYLES: Record<string, { bg: string; border: string; color: string; label: string }> = {
                breakfast: { bg: "rgba(249,115,22,0.15)", border: "rgba(249,115,22,0.4)",  color: "#F97316", label: "Entree" },
                lunch:     { bg: "rgba(129,140,248,0.15)",border: "rgba(129,140,248,0.4)", color: "#818CF8", label: "Main Course" },
                dinner:    { bg: "rgba(129,140,248,0.15)",border: "rgba(129,140,248,0.4)", color: "#818CF8", label: "Main Course" },
                entree:    { bg: "rgba(249,115,22,0.15)", border: "rgba(249,115,22,0.4)",  color: "#F97316", label: "Entree" },
                appetizer: { bg: "rgba(34,197,94,0.15)",  border: "rgba(34,197,94,0.4)",   color: "#22C55E", label: "Appetizer" },
                main_course:{ bg: "rgba(129,140,248,0.15)",border: "rgba(129,140,248,0.4)", color: "#818CF8", label: "Main Course" },
                dessert:   { bg: "rgba(236,72,153,0.15)", border: "rgba(236,72,153,0.4)",  color: "#EC4899", label: "Dessert" },
                beverage:  { bg: "rgba(56,189,248,0.15)", border: "rgba(56,189,248,0.4)",  color: "#38BDF8", label: "Beverage" },
                sides:     { bg: "rgba(148,163,184,0.15)", border: "rgba(148,163,184,0.4)", color: "#94A3B8", label: "Sides" },
                all_day:   { bg: "rgba(129,140,248,0.15)", border: "rgba(129,140,248,0.4)",  color: "#818CF8", label: "Main Course" },
                specials:  { bg: "rgba(245,158,11,0.15)", border: "rgba(245,158,11,0.4)",  color: "#F59E0B", label: "Specials" },
              };
              // Dedupe chips by display label so e.g. lunch+dinner don't
              // both render as "Main Course".
              const seen = new Set<string>();
              const chips: Array<{ key: string; style: typeof MEAL_STYLES[string] }> = [];
              for (const mt of item.mealTimes) {
                const s = MEAL_STYLES[mt] ?? {
                  bg: "rgba(148,163,184,0.15)",
                  border: "rgba(148,163,184,0.4)",
                  color: "#A3A3A3",
                  label: String(mt).replace(/_/g, " ").replace(/\b\w/g, (c) => c.toUpperCase()),
                };
                if (seen.has(s.label)) continue;
                seen.add(s.label);
                chips.push({ key: mt, style: s });
              }
              if (chips.length === 0) return null;
              return (
                <View className="flex-row flex-wrap mb-4" style={{ gap: 6 }}>
                  {chips.map(({ key, style: s }) => (
                    <View key={key} style={{ backgroundColor: s.bg, borderRadius: 8, paddingHorizontal: 10, paddingVertical: 5, borderWidth: 1, borderColor: s.border }}>
                      <Text style={{ fontFamily: "Manrope_700Bold", color: s.color, fontSize: 12 }}>
                        {s.label}
                      </Text>
                    </View>
                  ))}
                </View>
              );
            })()}
          </View>

          {/* Add to Cart */}
          <View className="px-5 pb-10">
            <Pressable
              disabled={addBlocked}
              onPress={() => {
                if (addBlocked) return;
                if (Platform.OS !== "web") {
                  Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
                }
                onAddToCart();
              }}
              className="rounded-2xl py-4 flex-row items-center justify-center"
              style={{
                backgroundColor: addBlocked ? colors.pressableBg : "#FF9933",
                borderWidth: addBlocked ? 1 : 0,
                borderColor: addBlocked ? colors.cardBorder : "rgba(255,255,255,0.08)",
                shadowColor: addBlocked ? "transparent" : "#FF9933",
                shadowOffset: { width: 0, height: 4 },
                shadowOpacity: addBlocked ? 0 : 0.3,
                shadowRadius: 12,
                elevation: addBlocked ? 0 : 8,
              }}
            >
              {!addBlocked && <Plus size={20} color="#0f0f0f" strokeWidth={3} />}
              <Text
                style={{
                  fontFamily: "BricolageGrotesque_700Bold",
                  color: addBlocked ? colors.textMuted : "#0f0f0f",
                  fontSize: addBlocked ? 15 : 17,
                  marginLeft: addBlocked ? 0 : 8,
                  textAlign: "center",
                }}
              >
                {addLabel}
              </Text>
            </Pressable>
          </View>
        </View>
      </Animated.View>
    </Animated.View>
  );
}
