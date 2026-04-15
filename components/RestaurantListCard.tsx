import React from "react";
import { View, Text, Pressable } from "react-native";
import { Star, Clock, Heart, Hourglass } from "lucide-react-native";
import type { UIRestaurant } from "@/lib/restaurant-types";
import type { RestaurantMediaSlide } from "@/lib/restaurant-media";
import { RestaurantMediaFrame } from "@/components/RestaurantMediaFrame";
import Animated, {
  FadeIn,
  FadeInRight,
  useAnimatedStyle,
  useSharedValue,
  withSpring,
} from "react-native-reanimated";

interface RestaurantListCardProps {
  restaurant: UIRestaurant;
  index: number;
  onPress: () => void;
  isFavorite?: boolean;
  onToggleFavorite?: (e: any) => void;
  mediaSlides?: RestaurantMediaSlide[];
}

export function RestaurantListCard({
  restaurant,
  index,
  onPress,
  isFavorite,
  onToggleFavorite,
  mediaSlides,
}: RestaurantListCardProps) {
  const pressScale = useSharedValue(1);

  const animatedStyle = useAnimatedStyle(() => ({
    transform: [{ scale: pressScale.value }],
  }));

  const entering =
    index === 0
      ? FadeIn.duration(400)
      : FadeInRight.delay(index * 50).duration(400);

  const waitColor =
    restaurant.isComingSoon
      ? "#888888"
      : restaurant.waitStatus === "green"
      ? "#22C55E"
      : restaurant.waitStatus === "amber"
      ? "#F59E0B"
      : restaurant.waitStatus === "grey"
      ? "#888888"
      : restaurant.waitStatus === "darkgrey"
      ? "#666666"
      : "#EF4444";

  const waitLabel =
    restaurant.isComingSoon
      ? "Coming soon"
      : restaurant.waitStatus === "darkgrey"
      ? "Closed"
      : restaurant.waitTime < 0
      ? "-- min"
      : `${restaurant.waitTime} min`;

  return (
    <Animated.View entering={entering} style={{ width: 200, marginRight: 12 }}>
      <Animated.View
        style={[
          animatedStyle,
          {
            borderRadius: 16,
            overflow: "hidden",
            backgroundColor: "#1a1a1a",
            borderWidth: 1,
            borderColor: "#2a2a2a",
          },
        ]}
      >
          {/* ─── Full-width image ─── */}
          <View style={{ height: 155, position: "relative", backgroundColor: "#2a2a2a" }}>
            <RestaurantMediaFrame
              defaultImage={restaurant.image}
              slides={mediaSlides}
              height={155}
              borderRadius={0}
              includeDefaultStarter={restaurant.useRegularImageAsFirstSlide}
            />

            {/* Coming Soon overlay */}
            {restaurant.isComingSoon && (
              <View
                style={{
                  position: "absolute",
                  inset: 0,
                  top: 0, left: 0, right: 0, bottom: 0,
                  backgroundColor: "rgba(15,15,15,0.62)",
                  alignItems: "center",
                  justifyContent: "center",
                }}
              >
                <View
                  style={{
                    backgroundColor: "rgba(10,10,10,0.92)",
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
                    shadowOpacity: 0.3,
                    shadowRadius: 10,
                    elevation: 6,
                  }}
                >
                  <Hourglass size={12} color="#FFB56B" />
                  <Text
                    style={{
                      fontFamily: "Manrope_700Bold",
                      color: "#FFC484",
                      fontSize: 12,
                      letterSpacing: 0.45,
                    }}
                  >
                    Coming Soon
                  </Text>
                </View>
              </View>
            )}

            {/* Price range badge — top-left */}
            <View
              style={{
                position: "absolute",
                top: 8,
                left: 8,
                backgroundColor: "rgba(0,0,0,0.65)",
                borderRadius: 8,
                paddingHorizontal: 7,
                paddingVertical: 3,
              }}
            >
              <Text
                style={{
                  fontFamily: "JetBrainsMono_600SemiBold",
                  color: "#FF9933",
                  fontSize: 11,
                }}
              >
                {restaurant.priceRange}
              </Text>
            </View>
          </View>

          {/* ─── Info section (only this area opens menu) ─── */}
          <Pressable
            onPress={onPress}
            onPressIn={() => { pressScale.value = withSpring(0.96); }}
            onPressOut={() => { pressScale.value = withSpring(1); }}
            style={{ padding: 10, paddingTop: 9 }}
          >
            {/* Name row + heart */}
            <View style={{ flexDirection: "row", alignItems: "center", marginBottom: 5 }}>
              <Text
                style={{
                  fontFamily: "BricolageGrotesque_700Bold",
                  color: "#f5f5f5",
                  fontSize: 15,
                  flex: 1,
                }}
                numberOfLines={1}
              >
                {restaurant.name}
              </Text>

              {isFavorite !== undefined && onToggleFavorite !== undefined && (
                <Pressable
                  onPress={onToggleFavorite}
                  hitSlop={14}
                  style={{ marginLeft: 6, padding: 2 }}
                >
                  <Heart
                    size={17}
                    color={isFavorite ? "#EF4444" : "#666"}
                    fill={isFavorite ? "#EF4444" : "transparent"}
                  />
                </Pressable>
              )}
            </View>

            {/* Cuisine */}
            <Text
              style={{
                fontFamily: "Manrope_500Medium",
                color: "#888",
                fontSize: 11,
                marginBottom: 7,
              }}
              numberOfLines={1}
            >
              {restaurant.cuisine}
            </Text>

            {/* Stats row */}
            <View style={{ flexDirection: "row", alignItems: "center", gap: 10 }}>
              <View style={{ flexDirection: "row", alignItems: "center" }}>
                <Star size={11} color="#FF9933" fill="#FF9933" />
                <Text
                  style={{
                    fontFamily: "Manrope_600SemiBold",
                    color: "#f5f5f5",
                    fontSize: 12,
                    marginLeft: 3,
                  }}
                >
                  {restaurant.rating}
                </Text>
              </View>

              <View style={{ flexDirection: "row", alignItems: "center" }}>
                <Clock size={11} color={waitColor} />
                <Text
                  style={{
                    fontFamily: "Manrope_600SemiBold",
                    color: waitColor,
                    fontSize: 12,
                    marginLeft: 3,
                  }}
                >
                  {waitLabel}
                </Text>
              </View>
            </View>
          </Pressable>
      </Animated.View>
    </Animated.View>
  );
}
