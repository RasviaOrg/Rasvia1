import React from "react";
import { View, Text, Pressable, Image } from "react-native";
import { LinearGradient } from "expo-linear-gradient";
import { Star, Clock, Heart } from "lucide-react-native";
import type { UIRestaurant } from "@/lib/restaurant-types";
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
}

export function RestaurantListCard({
  restaurant,
  index,
  onPress,
  isFavorite,
  onToggleFavorite,
}: RestaurantListCardProps) {
  const pressScale = useSharedValue(1);

  const animatedStyle = useAnimatedStyle(() => ({
    transform: [{ scale: pressScale.value }],
  }));

  // FadeInRight on index 0 in horizontal FlatLists often fails to complete on first paint (blank tile with layout preserved).
  const entering =
    index === 0
      ? FadeIn.duration(400)
      : FadeInRight.delay(index * 50).duration(400);

  return (
    <Animated.View
      entering={entering}
      style={{ width: 200, marginRight: 12 }}
    >
      <Animated.View style={animatedStyle}>
      <Pressable
        onPress={onPress}
        onPressIn={() => {
          pressScale.value = withSpring(0.95);
        }}
        onPressOut={() => {
          pressScale.value = withSpring(1);
        }}
        className="rounded-xl overflow-hidden bg-rasvia-card"
        style={{ borderWidth: 1, borderColor: "#2a2a2a" }}
      >
        <View style={{ height: 130, position: "relative", backgroundColor: "#2a2a2a" }}>
          <Image
            source={{ uri: restaurant.image }}
            style={{ width: "100%", height: "100%" }}
            resizeMode="cover"
          />
          <LinearGradient
            colors={["transparent", "rgba(34,34,34,0.9)"]}
            style={{
              position: "absolute",
              bottom: 0,
              left: 0,
              right: 0,
              height: "50%",
            }}
          />
          {(isFavorite !== undefined && onToggleFavorite !== undefined) && (
            <Pressable
              onPress={onToggleFavorite}
              hitSlop={15}
              style={{
                position: "absolute",
                top: 8,
                right: 8,
                backgroundColor: "rgba(0,0,0,0.7)",
                borderRadius: 20,
                padding: 6,
              }}
            >
              <Heart size={16} color={isFavorite ? "#EF4444" : "#fff"} fill={isFavorite ? "#EF4444" : "transparent"} />
            </Pressable>
          )}
        </View>
        <View className="p-3">
          <Text
            style={{
              fontFamily: "BricolageGrotesque_700Bold",
              color: "#f5f5f5",
              fontSize: 16,
              marginBottom: 2,
            }}
            numberOfLines={1}
          >
            {restaurant.name}
          </Text>
          <Text
            style={{
              fontFamily: "Manrope_500Medium",
              color: "#999999",
              fontSize: 12,
              marginBottom: 6,
            }}
            numberOfLines={1}
          >
            {restaurant.cuisine}
          </Text>
          <View className="flex-row items-center justify-between">
            <View className="flex-row items-center">
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
              
              <View className="ml-3 flex-row items-center">
                <Clock size={11} color={restaurant.waitStatus === "green" ? "#22C55E" : restaurant.waitStatus === "amber" ? "#F59E0B" : restaurant.waitStatus === "grey" ? "#888888" : restaurant.waitStatus === "darkgrey" ? "#999999" : "#EF4444"} />
                <Text
                  style={{
                    fontFamily: "Manrope_600SemiBold",
                    color: restaurant.waitStatus === "green" ? "#22C55E" : restaurant.waitStatus === "amber" ? "#F59E0B" : restaurant.waitStatus === "grey" ? "#888888" : restaurant.waitStatus === "darkgrey" ? "#999999" : "#EF4444",
                    fontSize: 12,
                    marginLeft: 3,
                  }}
                >
                  {restaurant.waitStatus === 'darkgrey' ? 'Closed' : restaurant.waitTime < 0 ? '-- min' : `${restaurant.waitTime} min`}
                </Text>
              </View>
            </View>
            <Text
              style={{
                fontFamily: "JetBrainsMono_600SemiBold",
                color: "#FF9933",
                fontSize: 12,
              }}
            >
              {restaurant.priceRange}
            </Text>
          </View>
        </View>
      </Pressable>
      </Animated.View>
    </Animated.View>
  );
}
