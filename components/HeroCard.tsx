import React from "react";
import { View, Text, Pressable, useWindowDimensions } from "react-native";
import { LinearGradient } from "expo-linear-gradient";
import { Star, MapPin, Clock, Heart, Hourglass } from "lucide-react-native";
import type { UIRestaurant } from "@/lib/restaurant-types";
import type { RestaurantMediaSlide } from "@/lib/restaurant-media";
import { RestaurantMediaFrame } from "@/components/RestaurantMediaFrame";
import { useAppTheme } from "@/lib/app-theme";
import Animated, {
  FadeInDown,
  useAnimatedStyle,
  useSharedValue,
  withSpring,
} from "react-native-reanimated";
import { heroCardWidth, HERO_CARD_ITEM_GAP } from "@/lib/hero-carousel-layout";

interface HeroCardProps {
  restaurant: UIRestaurant;
  index: number;
  onPress: () => void;
  isFavorite?: boolean;
  onToggleFavorite?: (e: any) => void;
  mediaSlides?: RestaurantMediaSlide[];
}

export function HeroCard({ restaurant, index, onPress, isFavorite, onToggleFavorite, mediaSlides }: HeroCardProps) {
  const { width: windowWidth } = useWindowDimensions();
  const cardWidth = heroCardWidth(windowWidth);
  const { colors, isDark } = useAppTheme();
  const heartBtnBg = isDark ? "rgba(0,0,0,0.7)" : "rgba(255,255,255,0.92)";
  const pressScale = useSharedValue(1);
  const heroGradient = isDark
    ? (["transparent", "rgba(15,15,15,0.6)", "rgba(15,15,15,0.95)"] as const)
    : (["transparent", "rgba(255,255,255,0.2)", "rgba(255,255,255,0.94)"] as const);

  const animatedStyle = useAnimatedStyle(() => ({
    transform: [{ scale: pressScale.value }],
  }));

  return (
    <Animated.View
      entering={FadeInDown.delay(index * 100).duration(600)}
      style={{ width: cardWidth, marginRight: HERO_CARD_ITEM_GAP }}
    >
      <Animated.View
        style={[
          animatedStyle,
          { height: 315, borderWidth: 1, borderColor: colors.cardBorder, borderRadius: 16, overflow: "hidden" },
        ]}
      >
        {/* Card-level pressable. We clip its tap region so the top-right
            corner is reserved for the favorites heart — otherwise the heart
            press is swallowed by the card press even with zIndex. */}
        <Pressable
          onPress={onPress}
          onPressIn={() => {
            pressScale.value = withSpring(0.95);
          }}
          onPressOut={() => {
            pressScale.value = withSpring(1);
          }}
          style={{ position: "absolute", top: 64, left: 0, right: 0, bottom: 0, zIndex: 1 }}
        />
        <Pressable
          onPress={onPress}
          onPressIn={() => {
            pressScale.value = withSpring(0.95);
          }}
          onPressOut={() => {
            pressScale.value = withSpring(1);
          }}
          style={{ position: "absolute", top: 0, left: 0, right: 64, height: 64, zIndex: 1 }}
        />
        <View style={{ position: "absolute", top: 0, left: 0, right: 0, bottom: 0 }}>
          <RestaurantMediaFrame
            defaultImage={restaurant.image}
            slides={mediaSlides}
            height={315}
            borderRadius={0}
            includeDefaultStarter={restaurant.useRegularImageAsFirstSlide}
          />
        </View>
        <LinearGradient
          colors={heroGradient}
          style={{
            position: "absolute",
            bottom: 0,
            left: 0,
            right: 0,
            height: "70%",
          }}
        />

        {(isFavorite !== undefined && onToggleFavorite !== undefined) && (
          <Pressable
            onPress={(e) => {
              e.stopPropagation?.();
              onToggleFavorite(e);
            }}
            hitSlop={15}
            style={{
              position: "absolute",
              top: 16,
              right: 16,
              backgroundColor: heartBtnBg,
              borderRadius: 20,
              padding: 8,
              zIndex: 5,
              borderWidth: isDark ? 0 : 1,
              borderColor: "rgba(0,0,0,0.06)",
            }}
          >
            <Heart size={16} color={isFavorite ? "#EF4444" : (isDark ? "#fff" : colors.textMuted)} fill={isFavorite ? "#EF4444" : "transparent"} />
          </Pressable>
        )}

        {/* Coming Soon overlay */}
        {restaurant.isComingSoon && (
          <View
            style={{
              position: "absolute",
              top: 16,
              left: 16,
              backgroundColor: isDark ? "rgba(10,10,10,0.92)" : "rgba(255,255,255,0.96)",
              borderWidth: 2,
              borderColor: "#FF9F43",
              borderRadius: 999,
              paddingHorizontal: 13,
              paddingVertical: 6,
              flexDirection: "row",
              alignItems: "center",
              gap: 6,
              shadowColor: "#FF9F43",
              shadowOffset: { width: 0, height: 4 },
              shadowOpacity: isDark ? 0.3 : 0.15,
              shadowRadius: 10,
              elevation: 6,
            }}
          >
            <Hourglass size={13} color="#FF9933" />
            <Text
              style={{
                fontFamily: "Manrope_700Bold",
                color: isDark ? "#FFC484" : "#C2410C",
                fontSize: 13,
                letterSpacing: 0.45,
              }}
            >
              Coming Soon
            </Text>
          </View>
        )}

        {/* Content */}
        <View style={{ position: "absolute", bottom: 0, left: 0, right: 0, padding: 20 }}>
          <View className="flex-row items-center mb-1">
            {restaurant.tags.slice(0, 2).map((tag) => (
              <View
                key={tag}
                className="rounded-full px-2.5 py-0.5 mr-2"
                style={{ backgroundColor: "rgba(255,153,51,0.85)" }}
              >
                <Text
                  style={{
                    fontFamily: "Manrope_600SemiBold",
                    color: "#ffffff",
                    fontSize: 11,
                  }}
                >
                  {tag}
                </Text>
              </View>
            ))}
          </View>

          <Text
            style={{
              fontFamily: "BricolageGrotesque_800ExtraBold",
              color: colors.text,
              fontSize: 36,
              lineHeight: 40,
              marginBottom: 4,
              letterSpacing: -0.5,
              textShadowColor: isDark ? "rgba(0,0,0,0.55)" : "rgba(0,0,0,0.2)",
              textShadowOffset: { width: 0, height: 1 },
              textShadowRadius: isDark ? 10 : 6,
            }}
            numberOfLines={1}
          >
            {restaurant.name}
          </Text>

          <View className="flex-row items-center justify-between">
            <View className="flex-row items-center">
              <Star size={14} color="#FF9933" fill="#FF9933" />
              <Text
                style={{
                  fontFamily: "Manrope_700Bold",
                  color: colors.text,
                  fontSize: 14,
                  marginLeft: 4,
                }}
              >
                {restaurant.rating}
              </Text>
              <Text
                style={{
                  fontFamily: "Manrope_500Medium",
                  color: colors.textMuted,
                  fontSize: 13,
                  marginLeft: 4,
                }}
              >
                ({restaurant.reviewCount.toLocaleString()})
              </Text>
              
              <View className="ml-4 flex-row items-center">
                <Clock size={13} color={restaurant.waitStatus === "green" ? "#22C55E" : restaurant.waitStatus === "amber" ? "#F59E0B" : restaurant.waitStatus === "grey" ? "#888888" : restaurant.waitStatus === "darkgrey" ? "#999999" : "#EF4444"} />
                <Text
                  style={{
                    fontFamily: "Manrope_600SemiBold",
                    color: restaurant.waitStatus === "green" ? "#22C55E" : restaurant.waitStatus === "amber" ? "#F59E0B" : restaurant.waitStatus === "grey" ? "#888888" : restaurant.waitStatus === "darkgrey" ? "#999999" : "#EF4444",
                    fontSize: 13,
                    marginLeft: 4,
                  }}
                >
                  {restaurant.waitStatus === 'darkgrey' ? 'Closed' : restaurant.waitTime < 0 ? '-- min' : `${restaurant.waitTime} min`}
                </Text>
              </View>
            </View>
            <View className="flex-row items-center">
              <MapPin size={13} color={colors.textMuted} />
              <Text
                style={{
                  fontFamily: "Manrope_500Medium",
                  color: colors.textMuted,
                  fontSize: 13,
                  marginLeft: 4,
                }}
              >
                {restaurant.distance}
              </Text>
            </View>
            <Text
              style={{
                fontFamily: "JetBrainsMono_600SemiBold",
                color: "#FF9933",
                fontSize: 14,
              }}
            >
              {restaurant.priceRange}
            </Text>
          </View>
        </View>
      </Animated.View>
    </Animated.View>
  );
}
