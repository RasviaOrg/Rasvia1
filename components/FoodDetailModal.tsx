import React from "react";
import { View, Text, Pressable, Image, Dimensions, Platform } from "react-native";
import { LinearGradient } from "expo-linear-gradient";
import { X, Plus, Leaf, Flame, Settings, Camera } from "lucide-react-native";
import type { UIMenuItem } from "@/lib/restaurant-types";
import Animated, { FadeIn, SlideInDown } from "react-native-reanimated";
import * as Haptics from "expo-haptics";

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
}

export function FoodDetailModal({
  item,
  onClose,
  onAddToCart,
  onOpenSettings,
  showContributeImage = false,
  onContributeImage,
}: FoodDetailModalProps) {
  const hasImage = !!item.image?.trim();
  return (
    <Animated.View
      entering={FadeIn.duration(300)}
      className="absolute inset-0"
      style={{
        backgroundColor: "rgba(0,0,0,0.85)",
        zIndex: 100,
      }}
    >
      <Animated.View
        entering={SlideInDown.duration(500).springify()}
        className="flex-1 justify-end"
      >
        <View
          className="bg-rasvia-dark rounded-t-3xl overflow-hidden"
          style={{ maxHeight: SCREEN_HEIGHT * 0.88 }}
        >
          {/* Image Section with Video Placeholder */}
          <View style={{ height: SCREEN_HEIGHT * 0.45, position: "relative" }}>
            {hasImage ? (
              <Image
                source={{ uri: item.image }}
                style={{ width: "100%", height: "100%" }}
                resizeMode="cover"
              />
            ) : (
              <View
                style={{
                  width: "100%",
                  height: "100%",
                  alignItems: "center",
                  justifyContent: "center",
                  backgroundColor: "#1b1b1b",
                }}
              >
                <Camera size={34} color="#7a7a7a" />
                <Text style={{ marginTop: 8, fontFamily: "Manrope_700Bold", color: "#8a8a8a", fontSize: 13 }}>
                  No image available
                </Text>
              </View>
            )}
            <LinearGradient
              colors={["rgba(26,26,26,0.3)", "transparent", "rgba(26,26,26,0.95)"]}
              style={{
                position: "absolute",
                top: 0,
                left: 0,
                right: 0,
                bottom: 0,
              }}
            />

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
                    backgroundColor: "rgba(15, 15, 15, 0.6)",
                    width: 40,
                    height: 40,
                    borderRadius: 20,
                    alignItems: "center",
                    justifyContent: "center",
                  }}
                >
                  <Settings size={18} color="#f5f5f5" />
                </Pressable>
              )}
              <Pressable
                onPress={() => {
                  if (Platform.OS !== "web") Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
                  onClose();
                }}
                style={{
                  backgroundColor: "rgba(15, 15, 15, 0.6)",
                  width: 40,
                  height: 40,
                  borderRadius: 20,
                  alignItems: "center",
                  justifyContent: "center",
                }}
              >
                <X size={20} color="#f5f5f5" />
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
                    color: "#f5f5f5",
                    fontSize: 32,
                    lineHeight: 36,
                    letterSpacing: -0.5,
                  }}
                >
                  {item.name}
                </Text>
              </View>
              <View style={{ alignItems: "flex-end" }}>
                <View style={{ flexDirection: "row", alignItems: "center", gap: 6, marginBottom: 8 }}>
                  {showContributeImage && onContributeImage && (
                    <Pressable
                      onPress={() => {
                        if (Platform.OS !== "web") Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
                        onContributeImage();
                      }}
                      style={{
                        flexDirection: "row",
                        alignItems: "center",
                        gap: 5,
                        backgroundColor: "rgba(15,15,15,0.72)",
                        borderRadius: 999,
                        paddingHorizontal: 10,
                        paddingVertical: 6,
                        borderWidth: 1,
                        borderColor: "rgba(255,255,255,0.2)",
                      }}
                    >
                      <Camera size={12} color="#FF9933" />
                      <Text style={{ fontFamily: "Manrope_700Bold", color: "#FF9933", fontSize: 11 }}>
                        Add Photo
                      </Text>
                    </Pressable>
                  )}
                </View>
                <Text
                  style={{
                    fontFamily: "JetBrainsMono_600SemiBold",
                    color: "#FF9933",
                    fontSize: 24,
                  }}
                >
                  ${item.price.toFixed(2)}
                </Text>
              </View>
            </View>

            <Text
              style={{
                fontFamily: "Manrope_500Medium",
                color: "#999999",
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
                breakfast: { bg: "rgba(249,115,22,0.15)", border: "rgba(249,115,22,0.4)",  color: "#F97316", label: "Breakfast" },
                lunch:     { bg: "rgba(34,197,94,0.15)",  border: "rgba(34,197,94,0.4)",   color: "#22C55E", label: "Lunch" },
                dinner:    { bg: "rgba(129,140,248,0.15)",border: "rgba(129,140,248,0.4)", color: "#818CF8", label: "Dinner" },
                all_day:   { bg: "rgba(56,189,248,0.15)", border: "rgba(56,189,248,0.4)",  color: "#38BDF8", label: "All Day" },
                specials:  { bg: "rgba(245,158,11,0.15)", border: "rgba(245,158,11,0.4)",  color: "#F59E0B", label: "Specials" },
              };
              const chips = item.mealTimes
                .map((mt) => MEAL_STYLES[mt])
                .filter(Boolean);
              if (chips.length === 0) return null;
              return (
                <View className="flex-row flex-wrap mb-4" style={{ gap: 6 }}>
                  {item.mealTimes.map((mt, i) => {
                    const s = MEAL_STYLES[mt];
                    if (!s) return null;
                    return (
                      <View key={i} style={{ backgroundColor: s.bg, borderRadius: 8, paddingHorizontal: 10, paddingVertical: 5, borderWidth: 1, borderColor: s.border }}>
                        <Text style={{ fontFamily: "Manrope_700Bold", color: s.color, fontSize: 12 }}>
                          {s.label}
                        </Text>
                      </View>
                    );
                  })}
                </View>
              );
            })()}
          </View>

          {/* Add to Cart */}
          <View className="px-5 pb-10">
            <Pressable
              onPress={() => {
                if (Platform.OS !== "web") {
                  Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
                }
                onAddToCart();
              }}
              className="rounded-2xl py-4 flex-row items-center justify-center"
              style={{
                backgroundColor: "#FF9933",
                shadowColor: "#FF9933",
                shadowOffset: { width: 0, height: 4 },
                shadowOpacity: 0.3,
                shadowRadius: 12,
                elevation: 8,
              }}
            >
              <Plus size={20} color="#0f0f0f" strokeWidth={3} />
              <Text
                style={{
                  fontFamily: "BricolageGrotesque_700Bold",
                  color: "#0f0f0f",
                  fontSize: 17,
                  marginLeft: 8,
                }}
              >
                Add to Cart — ${item.price.toFixed(2)}
              </Text>
            </Pressable>
          </View>
        </View>
      </Animated.View>
    </Animated.View>
  );
}
