import React from "react";
import { View, Text, Pressable, Dimensions } from "react-native";
import { LinearGradient } from "expo-linear-gradient";
import { Star, MapPin, Clock, Heart, Hourglass } from "lucide-react-native";
import type { UIRestaurant } from "@/lib/restaurant-types";
import type { RestaurantMediaSlide } from "@/lib/restaurant-media";
import { RestaurantMediaFrame } from "@/components/RestaurantMediaFrame";
import Animated, {
  FadeInDown,
  useAnimatedStyle,
  useSharedValue,
  withSpring,
} from "react-native-reanimated";

let SCREEN_WIDTH = Dimensions.get("window").width;
Dimensions.addEventListener("change", ({ window }) => { SCREEN_WIDTH = window.width; });
const CARD_WIDTH = SCREEN_WIDTH - 48;

interface HeroCardProps {
  restaurant: UIRestaurant;
  index: number;
  onPress: () => void;
  isFavorite?: boolean;
  onToggleFavorite?: (e: any) => void;
  mediaSlides?: RestaurantMediaSlide[];
}

export function HeroCard({ restaurant, index, onPress, isFavorite, onToggleFavorite, mediaSlides }: HeroCardProps) {
  const pressScale = useSharedValue(1);

  const animatedStyle = useAnimatedStyle(() => ({
    transform: [{ scale: pressScale.value }],
  }));

  return (
    <Animated.View
      entering={FadeInDown.delay(index * 100).duration(600)}
      style={{ width: CARD_WIDTH, marginRight: 16 }}
    >
      <Animated.View
        style={[
          animatedStyle,
          { height: 315, borderWidth: 1, borderColor: "#2a2a2a", borderRadius: 16, overflow: "hidden" },
        ]}
      >
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
          colors={["transparent", "rgba(15,15,15,0.6)", "rgba(15,15,15,0.95)"]}
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
            onPress={onToggleFavorite}
            hitSlop={15}
            style={{
              position: "absolute",
              top: 16,
              right: 16,
              backgroundColor: "rgba(0,0,0,0.7)",
              borderRadius: 20,
              padding: 8,
            }}
          >
            <Heart size={16} color={isFavorite ? "#EF4444" : "#fff"} fill={isFavorite ? "#EF4444" : "transparent"} />
          </Pressable>
        )}

        {/* Coming Soon overlay */}
        {restaurant.isComingSoon && (
          <View
            style={{
              position: "absolute",
              top: 16,
              left: 16,
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
            <Hourglass size={13} color="#FFB56B" />
            <Text
              style={{
                fontFamily: "Manrope_700Bold",
                color: "#FFC484",
                fontSize: 13,
                letterSpacing: 0.45,
              }}
            >
              Coming Soon
            </Text>
          </View>
        )}

        {/* Content (only this bottom area opens menu) */}
        <Pressable
          onPress={onPress}
          onPressIn={() => {
            pressScale.value = withSpring(0.95);
          }}
          onPressOut={() => {
            pressScale.value = withSpring(1);
          }}
          style={{ position: "absolute", bottom: 0, left: 0, right: 0, padding: 20 }}
        >
          <View className="flex-row items-center mb-1">
            {restaurant.tags.slice(0, 2).map((tag, i) => (
              <View
                key={tag}
                className="rounded-full px-2.5 py-0.5 mr-2"
                style={{ backgroundColor: "rgba(255,153,51,0.35)" }}
              >
                <Text
                  style={{
                    fontFamily: "Manrope_600SemiBold",
                    color: "rgba(255,153,51,0.95)",
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
              color: "#f5f5f5",
              fontSize: 36,
              lineHeight: 40,
              marginBottom: 4,
              letterSpacing: -0.5,
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
                  color: "#f5f5f5",
                  fontSize: 14,
                  marginLeft: 4,
                }}
              >
                {restaurant.rating}
              </Text>
              <Text
                style={{
                  fontFamily: "Manrope_500Medium",
                  color: "#999999",
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
              <MapPin size={13} color="#999999" />
              <Text
                style={{
                  fontFamily: "Manrope_500Medium",
                  color: "#999999",
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
        </Pressable>
      </Animated.View>
    </Animated.View>
  );
}
