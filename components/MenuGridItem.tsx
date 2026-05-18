import React from "react";
import { View, Text, Pressable, Platform, useWindowDimensions } from "react-native";
import { LinearGradient } from "expo-linear-gradient";
import { Plus, Leaf, Flame, Camera } from "lucide-react-native";
import type { UIMenuItem } from "@/lib/restaurant-types";
import { useAppTheme } from "@/lib/app-theme";
import { CachedImage } from "@/components/CachedImage";
import Animated, {
  FadeInUp,
  useAnimatedStyle,
  useSharedValue,
  withSpring,
} from "react-native-reanimated";
import * as Haptics from "expo-haptics";
import { DEFAULT_MENU_TAGS, normalizeMenuItemTags, type MenuTagConfig } from "@/lib/menu-tags";

const COLUMN_GAP = 10;
const FALLBACK_PADDING = 16;

interface MenuGridItemProps {
  item: UIMenuItem;
  index: number;
  onPress: () => void;
  onQuickAdd: () => void;
  showQuickAdd?: boolean;
  /** When false (e.g. restaurant closed), the + stays visible but greyed and inert. */
  orderingAvailable?: boolean;
  onContributeImage?: (item: UIMenuItem) => void;
  /**
   * When true, the parent editor draws a settings cog at top-right of
   * the card. We nudge the "No Image" corner badge down so it does not
   * collide with the cog. Only used on the owner's own restaurant.
   */
  ownerBadgeOffset?: boolean;
  /** Explicit card width from the parent grid. When omitted falls back to half-screen calculation. */
  cardWidth?: number;
}

export function MenuGridItem({
  item,
  index,
  onPress,
  onQuickAdd,
  showQuickAdd = true,
  orderingAvailable = true,
  onContributeImage,
  ownerBadgeOffset = false,
  menuTags,
  cardWidth: cardWidthProp,
}: MenuGridItemProps & { menuTags?: MenuTagConfig[] }) {
  const { colors, isDark } = useAppTheme();
  const { width: windowWidth } = useWindowDimensions();
  const cardWidth = cardWidthProp ?? (windowWidth - FALLBACK_PADDING * 2 - COLUMN_GAP) / 2;
  const pressScale = useSharedValue(1);
  const isEven = index % 2 === 0;
  const imageHeight = isEven ? 180 : 220;
  const quickAddMuted = !orderingAvailable || item.isAvailable === false;

  const animatedStyle = useAnimatedStyle(() => ({
    transform: [{ scale: pressScale.value }],
  }));
  const hasImage = !!item.image?.trim();

  return (
    <Animated.View
      entering={FadeInUp.delay(index * 50).duration(500)}
      style={{
        width: cardWidth,
        marginBottom: COLUMN_GAP,
      }}
    >
      <Animated.View style={animatedStyle}>
        <Pressable
          onPress={item.isAvailable === false ? undefined : onPress}
          disabled={item.isAvailable === false}
          onPressIn={() => {
            if (item.isAvailable !== false) pressScale.value = withSpring(0.96);
          }}
          onPressOut={() => {
            if (item.isAvailable !== false) pressScale.value = withSpring(1);
          }}
          className="rounded-xl overflow-hidden"
          style={{ opacity: item.isAvailable === false ? 0.45 : 1, backgroundColor: colors.card, borderWidth: 1, borderColor: colors.cardBorder }}
        >
          <View style={{ height: imageHeight, position: "relative" }}>
            {hasImage ? (
              <CachedImage
                source={{ uri: item.image }}
                style={{ width: "100%", height: "100%", opacity: item.isAvailable === false ? 0.8 : 1 }}
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
                    <Camera size={30} color={colors.iconMuted} />
                    <Text style={{ marginTop: 8, fontFamily: "Manrope_700Bold", color: colors.textMuted, fontSize: 12 }}>
                      No image
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
                <Camera size={30} color={colors.iconMuted} />
                <Text style={{ marginTop: 8, fontFamily: "Manrope_700Bold", color: colors.textMuted, fontSize: 12 }}>
                  No image
                </Text>
              </View>
            )}
            <LinearGradient
              colors={isDark ? ["transparent", "rgba(34,34,34,0.95)"] : ["transparent", "rgba(0,0,0,0.45)"]}
              style={{
                position: "absolute",
                bottom: 0,
                left: 0,
                right: 0,
                height: "50%",
              }}
            />

            {/* Quick Add Button */}
            {showQuickAdd && (
              <Pressable
                disabled={quickAddMuted}
                onPress={(e) => {
                  e.stopPropagation?.();
                  if (quickAddMuted) return;
                  if (Platform.OS !== "web") {
                    Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Medium);
                  }
                  onQuickAdd();
                }}
                className="absolute bottom-2 right-2"
                style={{
                  backgroundColor: quickAddMuted
                    ? colors.pressableBg
                    : (isDark ? "#f97316" : "#fb923c"),
                  width: 34,
                  height: 34,
                  borderRadius: 17,
                  alignItems: "center",
                  justifyContent: "center",
                  borderWidth: quickAddMuted ? 1 : 0,
                  borderColor: quickAddMuted ? colors.cardBorder : "rgba(255,255,255,0.12)",
                  shadowColor: quickAddMuted ? "transparent" : (isDark ? "#f97316" : "#fb923c"),
                  shadowOffset: { width: 0, height: 2 },
                  shadowOpacity: quickAddMuted ? 0 : 0.25,
                  shadowRadius: 6,
                  elevation: quickAddMuted ? 0 : 5,
                }}
              >
                <Plus size={18} color={quickAddMuted ? colors.textMuted : "#ffffff"} strokeWidth={2.75} />
              </Pressable>
            )}

            {/* Popular Badge */}
            {item.isPopular && (
              <View
                className="absolute top-2 left-2 px-2 py-0.5 rounded-full"
                style={{ backgroundColor: "rgba(251, 146, 60, 0.22)" }}
              >
                <Text
                  style={{
                    fontFamily: "Manrope_600SemiBold",
                    color: "#fdba74",
                    fontSize: 10,
                  }}
                >
                  Popular
                </Text>
              </View>
            )}

            {!hasImage && !item.communityImageCredit && (
              <View
                style={{
                  position: "absolute",
                  // Lower the badge when the owner cog is drawn at top-right
                  // so the two don't overlap on the empty-image placeholder.
                  top: ownerBadgeOffset ? 42 : 8,
                  right: 8,
                  backgroundColor: isDark ? "rgba(15,15,15,0.72)" : "rgba(255,255,255,0.9)",
                  borderRadius: 8,
                  paddingHorizontal: 7,
                  paddingVertical: 4,
                  borderWidth: 1,
                  borderColor: isDark ? "rgba(255,255,255,0.18)" : "rgba(0,0,0,0.08)",
                }}
              >
                <Text style={{ fontFamily: "Manrope_700Bold", color: colors.textSecondary, fontSize: 10 }}>
                  No Image
                </Text>
              </View>
            )}
          </View>

          <View className="p-2.5">
            <View className="flex-row items-center mb-1">
              {item.isVegetarian && (
                <Leaf size={11} color="#22C55E" style={{ marginRight: 4 }} />
              )}
              {item.spiceLevel > 0 && (
                <View className="flex-row items-center">
                  {Array.from({ length: item.spiceLevel }).map((_, i) => (
                    <Flame
                      key={i}
                      size={10}
                      color="#EF4444"
                      fill="#EF4444"
                      style={{ marginRight: 1 }}
                    />
                  ))}
                </View>
              )}
            </View>
            <Text
              style={{
                fontFamily: "BricolageGrotesque_700Bold",
                color: colors.text,
                fontSize: 14,
                marginBottom: 2,
              }}
              numberOfLines={1}
            >
              {item.name}
            </Text>
            <Text
              style={{
                fontFamily: "Manrope_500Medium",
                color: colors.textMuted,
                fontSize: 11,
                lineHeight: 15,
                marginBottom: 4,
              }}
              numberOfLines={2}
            >
              {item.description}
            </Text>
            {/* Meal time chips only — no category badges.
                Multiple raw keys (e.g. `lunch` + `dinner`, or `main_course` +
                `all_day`) can resolve to the same display label, so we dedupe
                by label before rendering. */}
            <View className="flex-row flex-wrap mb-1.5" style={{ gap: 3 }}>
              {(() => {
                if (!item.mealTimes) return null;
                const activeTags = menuTags || DEFAULT_MENU_TAGS;
                const normalizedTimes = normalizeMenuItemTags(item.mealTimes, activeTags);
                const seen = new Set<string>();
                const chips: Array<{ key: string; style: MenuTagConfig | { bg: string; border: string; color: string; label: string } }> = [];
                for (const mt of normalizedTimes) {
                  const configured = activeTags.find(t => t.key === mt) ?? DEFAULT_MENU_TAGS.find(t => t.key === mt);
                  const style = configured ?? {
                    bg: "rgba(148,163,184,0.15)",
                    border: "rgba(148,163,184,0.4)",
                    color: "#A3A3A3",
                    label: String(mt).replace(/_/g, " ").replace(/\b\w/g, (c) => c.toUpperCase()),
                  };
                  if (seen.has(style.label)) continue;
                  seen.add(style.label);
                  chips.push({ key: mt, style });
                }
                return chips.map(({ key, style }) => (
                  <View key={key} style={{ backgroundColor: style.bg, borderRadius: 4, paddingHorizontal: 5, paddingVertical: 2, borderWidth: 0.5, borderColor: style.border }}>
                    <Text style={{ fontFamily: "Manrope_600SemiBold", color: style.color, fontSize: 8 }}>
                      {style.label}
                    </Text>
                  </View>
                ));
              })()}
            </View>
            <View style={{ flexDirection: "row", alignItems: "center", gap: 6 }}>
              <Text
                style={{
                  fontFamily: "JetBrainsMono_600SemiBold",
                  color: item.isAvailable === false ? colors.textMuted : "#fb923c",
                  fontSize: 14,
                }}
              >
                ${item.price.toFixed(2)}
              </Text>
              {item.isAvailable === false && (
                <Text
                  style={{
                    fontFamily: "Manrope_700Bold",
                    color: "#EF4444",
                    fontSize: 10,
                    textTransform: "uppercase",
                  }}
                >
                  (Out of Stock)
                </Text>
              )}
            </View>
          </View>
        </Pressable>
      </Animated.View>
    </Animated.View>
  );
}
