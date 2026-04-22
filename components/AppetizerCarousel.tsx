import React from "react";
import { View, Text, Pressable, ScrollView, Platform } from "react-native";
import { LinearGradient } from "expo-linear-gradient";
import { Plus } from "lucide-react-native";
import * as Haptics from "expo-haptics";
import type { MenuItem } from "@/data/mockData";
import { CachedImage } from "@/components/CachedImage";
import Animated, {
  FadeInRight,
  useAnimatedStyle,
  useSharedValue,
  withSpring,
} from "react-native-reanimated";

import type { MenuTagConfig } from "@/lib/menu-tags";
import { DEFAULT_MENU_TAGS, normalizeMenuItemTags } from "@/lib/menu-tags";

interface AppetizerCarouselProps {
  items: MenuItem[];
  onAddItem: (item: MenuItem) => void;
  menuTags?: MenuTagConfig[];
}

export function AppetizerCarousel({ items, onAddItem, menuTags }: AppetizerCarouselProps) {
  return (
    <View>
      <Text
        style={{
          fontFamily: "BricolageGrotesque_800ExtraBold",
          color: "#f5f5f5",
          fontSize: 22,
          marginBottom: 4,
          paddingHorizontal: 20,
        }}
      >
        While you wait...
      </Text>
      <Text
        style={{
          fontFamily: "Manrope_500Medium",
          color: "#999999",
          fontSize: 14,
          marginBottom: 16,
          paddingHorizontal: 20,
        }}
      >
        Add items to your cart and checkout — same menu and payment as the full restaurant order flow
      </Text>
      <ScrollView
        horizontal
        showsHorizontalScrollIndicator={false}
        contentContainerStyle={{ paddingHorizontal: 20 }}
      >
        {items.map((item, index) => (
          <AppetizerCard
            key={item.id}
            item={item}
            index={index}
            onAdd={() => onAddItem(item)}
            menuTags={menuTags}
          />
        ))}
      </ScrollView>
    </View>
  );
}

function AppetizerCard({
  item,
  index,
  onAdd,
  menuTags,
}: {
  item: MenuItem;
  index: number;
  onAdd: () => void;
  menuTags?: MenuTagConfig[];
}) {
  const pressScale = useSharedValue(1);
  const animatedStyle = useAnimatedStyle(() => ({
    transform: [{ scale: pressScale.value }],
  }));

  const activeTags = menuTags && menuTags.length > 0 ? menuTags : DEFAULT_MENU_TAGS;
  const normalizedTimes = normalizeMenuItemTags(item.mealTimes, activeTags);

  return (
    <Animated.View
      entering={FadeInRight.delay(index * 80).duration(400)}
      style={{ width: 150, marginRight: 12 }}
    >
      <Animated.View style={animatedStyle}>
        <Pressable
          onPressIn={() => {
            pressScale.value = withSpring(0.95);
          }}
          onPressOut={() => {
            pressScale.value = withSpring(1);
          }}
          className="rounded-xl overflow-hidden bg-rasvia-card"
        >
          <View style={{ height: 110, position: "relative" }}>
            <CachedImage
              source={{ uri: item.image }}
              style={{ width: "100%", height: "100%" }}
              resizeMode="cover"
              fallback={<View style={{ width: "100%", height: "100%", backgroundColor: "#1b1b1b" }} />}
            />
            <LinearGradient
              colors={["transparent", "rgba(34,34,34,0.95)"]}
              style={{
                position: "absolute",
                bottom: 0,
                left: 0,
                right: 0,
                height: "50%",
              }}
            />
          </View>
          <View className="p-2.5">
            <Text
              style={{
                fontFamily: "Manrope_700Bold",
                color: "#f5f5f5",
                fontSize: 13,
                marginBottom: 2,
              }}
              numberOfLines={1}
            >
              {item.name}
            </Text>
            {/* Category + meal time chips */}
            <View className="flex-row flex-wrap mb-1" style={{ gap: 3 }}>
              {item.category && item.category !== "Menu Item" && (
                <View
                  style={{
                    backgroundColor: "rgba(255,153,51,0.12)",
                    borderRadius: 4,
                    paddingHorizontal: 4,
                    paddingVertical: 2,
                    borderWidth: 0.5,
                    borderColor: "rgba(255,153,51,0.3)",
                  }}
                >
                  <Text
                    style={{
                      fontFamily: "Manrope_600SemiBold",
                      color: "#FF9933",
                      fontSize: 8,
                      textTransform: "capitalize",
                    }}
                  >
                    {item.category}
                  </Text>
                </View>
              )}
              {normalizedTimes.slice(0, 2).map((mt, i) => {
                  const style = activeTags.find(t => t.key === mt) ?? DEFAULT_MENU_TAGS.find(t => t.key === mt);
                  if (!style) return null;
                  return (
                    <View
                      key={i}
                      style={{
                        backgroundColor: style.bg,
                        borderRadius: 4,
                        paddingHorizontal: 5,
                        paddingVertical: 2,
                        borderWidth: 0.5,
                        borderColor: style.border,
                      }}
                    >
                      <Text
                        style={{
                          fontFamily: "Manrope_600SemiBold",
                          color: style.color,
                          fontSize: 8,
                        }}
                      >
                        {style.label}
                      </Text>
                    </View>
                  );
                })}
            </View>
            <View className="flex-row items-center justify-between mt-1">
              <Text
                style={{
                  fontFamily: "JetBrainsMono_600SemiBold",
                  color: "#FF9933",
                  fontSize: 13,
                }}
              >
                ${item.price.toFixed(2)}
              </Text>
              <Pressable
                onPress={() => {
                  if (Platform.OS !== "web") {
                    Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Medium);
                  }
                  onAdd();
                }}
                style={{
                  backgroundColor: "#FF9933",
                  width: 26,
                  height: 26,
                  borderRadius: 13,
                  alignItems: "center",
                  justifyContent: "center",
                }}
              >
                <Plus size={14} color="#0f0f0f" strokeWidth={3} />
              </Pressable>
            </View>
          </View>
        </Pressable>
      </Animated.View>
    </Animated.View>
  );
}
