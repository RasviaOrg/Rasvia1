import React, { useCallback, useState, useEffect } from "react";
import {
  View,
  Text,
  ScrollView,
  Pressable,
  Platform,
  Dimensions,
  ActivityIndicator,
} from "react-native";
import { CachedImage } from "@/components/CachedImage";
import { SafeAreaView } from "react-native-safe-area-context";
import { useLocalSearchParams, useRouter } from "expo-router";
import { ArrowLeft, Star, MapPin, Clock, Users } from "lucide-react-native";
import Animated, {
  FadeIn,
  FadeInDown,
  useAnimatedStyle,
  useSharedValue,
  withSpring,
} from "react-native-reanimated";
import * as Haptics from "expo-haptics";
import { supabase } from "@/lib/supabase";
import { type UIRestaurant, mapSupabaseToUI, type SupabaseRestaurant, haversineDistance } from "@/lib/restaurant-types";
import { useLocation } from "@/lib/location-context";
import { useAdminMode } from "@/hooks/useAdminMode";
import { useClosedRestaurantIds } from "@/hooks/useClosedRestaurantIds";

const cuisineEmojis: Record<string, string> = {
  "North Indian": "🍛",
  "South Indian": "🥘",
  "Pakistani": "🍢",
  "Sri Lankan": "🦐",
  "Indo-Chinese": "🥡",
  "Desserts": "🍰",
};

export default function CuisinePage() {
  const { name } = useLocalSearchParams<{ name: string }>();
  const router = useRouter();
  const { userCoords } = useLocation();
  const { isAdmin } = useAdminMode();
  const closedRestaurantIds = useClosedRestaurantIds();
  const [restaurants, setRestaurants] = useState<UIRestaurant[]>([]);
  const [loading, setLoading] = useState(true);
  const [sortBy, setSortBy] = useState<"wait" | "distance">("wait");

  const decodedName = decodeURIComponent(name || "");
  const emoji = cuisineEmojis[decodedName] || "🍽️";
  const CUISINE_EXPLORATION_ENABLED = false;

  useEffect(() => {
    if (!CUISINE_EXPLORATION_ENABLED) {
      router.replace("/" as any);
    }
  }, [router]);

  useEffect(() => {
    if (!CUISINE_EXPLORATION_ENABLED) return;
    async function fetchRestaurants() {
      try {
        const { data, error } = await supabase
          .from('restaurants')
          .select('*')
          .contains('cuisine_tags', [decodedName])
          .order('current_wait_time', { ascending: true });

        if (error) throw error;
        if (data) {
          const uiRestaurants = data
            .map((r: SupabaseRestaurant) => mapSupabaseToUI(r, userCoords))
            .filter((r) => isAdmin || r.isEnabled);
          setRestaurants(uiRestaurants);
        }
      } catch (error) {
        console.error('Error fetching restaurants for cuisine:', error);
      } finally {
        setLoading(false);
      }
    }
    fetchRestaurants();
  }, [decodedName]);

  // Recalculate distances when userCoords arrives after initial fetch
  useEffect(() => {
    if (!CUISINE_EXPLORATION_ENABLED) return;
    if (!userCoords) return;
    setRestaurants((prev) =>
      prev.map((r) => {
        if (r.lat == null || r.long == null) return r;
        const dist = haversineDistance(
          userCoords.latitude, userCoords.longitude, r.lat, r.long,
        );
        return { ...r, distance: `${dist.toFixed(1)} mi` };
      }),
    );
  }, [userCoords]);

  const matchingRestaurants = [...restaurants]
    .map((r) =>
      closedRestaurantIds.has(r.id)
        ? { ...r, waitStatus: 'darkgrey' as const, waitTime: -1 }
        : r
    )
    .sort((a, b) => {
    const aClosed = a.waitStatus === 'darkgrey';
    const bClosed = b.waitStatus === 'darkgrey';
    if (aClosed !== bClosed) return aClosed ? 1 : -1;
    if (sortBy === "distance") {
      const da = parseFloat(a.distance) || 9999;
      const db = parseFloat(b.distance) || 9999;
      return da - db;
    }
    return a.waitTime - b.waitTime;
  });

  const handleRestaurantPress = useCallback(
    (id: string) => {
      if (Platform.OS !== "web") {
        Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
      }
      router.push(`/restaurant/${id}` as any);
    },
    [router]
  );

  if (!CUISINE_EXPLORATION_ENABLED) {
    return (
      <View className="flex-1 bg-rasvia-black items-center justify-center">
        <ActivityIndicator size="small" color="#FF9933" />
      </View>
    );
  }

  return (
    <View className="flex-1 bg-rasvia-black">
      <SafeAreaView className="flex-1" edges={["top"]}>
        <Animated.View
          entering={FadeIn.duration(400)}
          className="flex-row items-center px-5 pt-2 pb-4"
        >
          <Pressable
            onPress={() => router.back()}
            style={{
              backgroundColor: "#1a1a1a",
              width: 44,
              height: 44,
              borderRadius: 22,
              alignItems: "center",
              justifyContent: "center",
              borderWidth: 1,
              borderColor: "#2a2a2a",
            }}
          >
            <ArrowLeft size={22} color="#f5f5f5" />
          </Pressable>
          <View style={{ marginLeft: 14, flex: 1 }}>
            <View style={{ flexDirection: "row", alignItems: "center" }}>
              <Text style={{ fontSize: 26, marginRight: 8 }}>{emoji}</Text>
              <Text
                style={{
                  fontFamily: "BricolageGrotesque_800ExtraBold",
                  color: "#f5f5f5",
                  fontSize: 28,
                  letterSpacing: -0.5,
                }}
              >
                {decodedName}
              </Text>
            </View>
            <Text
              style={{
                fontFamily: "Manrope_500Medium",
                color: "#999999",
                fontSize: 13,
                marginTop: 2,
              }}
            >
              {matchingRestaurants.length} restaurant
              {matchingRestaurants.length !== 1 ? "s" : ""} found
            </Text>
          </View>
        </Animated.View>


        {/* Sort controls */}
        <View style={{ flexDirection: "row", alignItems: "center", paddingHorizontal: 20, paddingBottom: 14, gap: 8 }}>
          <Text style={{ fontFamily: "Manrope_600SemiBold", color: "#999999", fontSize: 12, marginRight: 4 }}>
            Sort by
          </Text>
          {([
            { key: "wait", label: "Wait Time", Icon: Clock },
            { key: "distance", label: "Distance", Icon: MapPin },
          ] as const).map(({ key, label, Icon }) => {
            const active = sortBy === key;
            return (
              <Pressable
                key={key}
                onPress={() => {
                  if (Platform.OS !== "web") Haptics.selectionAsync();
                  setSortBy(key);
                }}
                style={{
                  backgroundColor: active ? "rgba(255,153,51,0.2)" : "#1a1a1a",
                  borderRadius: 20,
                  paddingHorizontal: 14,
                  paddingVertical: 7,
                  borderWidth: 1,
                  borderColor: active ? "#FF9933" : "#2a2a2a",
                }}
              >
                <View style={{ flexDirection: "row", alignItems: "center" }}>
                  <Icon size={12} color={active ? "#FF9933" : "#999999"} />
                  <Text
                    style={{
                      fontFamily: "Manrope_600SemiBold",
                      color: active ? "#FF9933" : "#999999",
                      fontSize: 12,
                      marginLeft: 5,
                    }}
                  >
                    {label}
                  </Text>
                </View>
              </Pressable>
            );
          })}
        </View>

        <ScrollView
          showsVerticalScrollIndicator={false}
          contentContainerStyle={{ paddingHorizontal: 20, paddingBottom: 40 }}
        >
          {loading ? (
            <View style={{ paddingVertical: 60, alignItems: "center" }}>
              <ActivityIndicator size="large" color="#FF9933" />
              <Text
                style={{
                  fontFamily: "Manrope_500Medium",
                  color: "#999999",
                  fontSize: 14,
                  marginTop: 16,
                }}
              >
                Loading restaurants...
              </Text>
            </View>
          ) : matchingRestaurants.length === 0 ? (
            <Animated.View
              entering={FadeInDown.delay(200).duration(500)}
              style={{
                alignItems: "center",
                justifyContent: "center",
                paddingVertical: 80,
              }}
            >
              <Text style={{ fontSize: 48, marginBottom: 16 }}>🍽️</Text>
              <Text
                style={{
                  fontFamily: "BricolageGrotesque_700Bold",
                  color: "#f5f5f5",
                  fontSize: 20,
                  textAlign: "center",
                  marginBottom: 8,
                }}
              >
                No restaurants yet
              </Text>
              <Text
                style={{
                  fontFamily: "Manrope_500Medium",
                  color: "#999999",
                  fontSize: 14,
                  textAlign: "center",
                }}
              >
                We&apos;re adding more {decodedName} spots soon!
              </Text>
            </Animated.View>
          ) : (
            matchingRestaurants.map((restaurant, index) => (
              <CuisineRestaurantCard
                key={restaurant.id}
                restaurant={restaurant}
                index={index}
                onPress={() => handleRestaurantPress(restaurant.id)}
              />
            ))
          )}
        </ScrollView>
      </SafeAreaView>
    </View>
  );
}

function waitColor(status: string): string {
  switch (status) {
    case "green": return "#22C55E";
    case "amber": return "#F59E0B";
    case "red":   return "#EF4444";
    case "darkgrey": return "#666666";
    default:      return "#999999"; // grey / unknown
  }
}

function CuisineRestaurantCard({
  restaurant,
  index,
  onPress,
}: {
  restaurant: UIRestaurant;
  index: number;
  onPress: () => void;
}) {
  const pressScale = useSharedValue(1);
  const animatedStyle = useAnimatedStyle(() => ({
    transform: [{ scale: pressScale.value }],
  }));

  return (
    <Animated.View
      entering={FadeInDown.delay(index * 80).duration(500)}
      style={{ marginBottom: 16 }}
    >
      <Animated.View style={animatedStyle}>
        <Pressable
          onPress={onPress}
          onPressIn={() => {
            pressScale.value = withSpring(0.97);
          }}
          onPressOut={() => {
            pressScale.value = withSpring(1);
          }}
          style={{
            borderRadius: 20,
            overflow: "hidden",
            backgroundColor: "#1a1a1a",
            borderWidth: 1,
            borderColor: "#2a2a2a",
          }}
        >
        <CachedImage
          source={{ uri: restaurant.image }}
          style={{ width: "100%", height: 110 }}
          resizeMode="cover"
          fallback={<View style={{ width: "100%", height: 110, backgroundColor: "#1b1b1b" }} />}
        />

        {/* Info */}
        <View style={{ paddingHorizontal: 14, paddingVertical: 12 }}>
          {/* Tags – filter out generic "Indian" label */}
          {restaurant.tags.filter((t) => t.trim().toLowerCase() !== "indian").length > 0 && (
            <View style={{ flexDirection: "row", flexWrap: "wrap", gap: 6, marginBottom: 8 }}>
              {restaurant.tags.filter((t) => t.trim().toLowerCase() !== "indian").slice(0, 3).map((tag) => (
                <View
                  key={tag}
                  style={{
                    backgroundColor: "rgba(255,153,51,0.35)",
                    borderRadius: 20,
                    paddingHorizontal: 10,
                    paddingVertical: 3,
                    borderWidth: 1,
                    borderColor: "rgba(255,153,51,0.5)",
                  }}
                >
                  <Text style={{ fontFamily: "Manrope_600SemiBold", color: "rgba(255,153,51,0.95)", fontSize: 11 }}>
                    {tag}
                  </Text>
                </View>
              ))}
            </View>
          )}

          <Text
            numberOfLines={1}
            style={{
              fontFamily: "BricolageGrotesque_800ExtraBold",
              color: "#f5f5f5",
              fontSize: 18,
              letterSpacing: -0.3,
              marginBottom: 8,
            }}
          >
            {restaurant.name}
          </Text>

          <View style={{ flexDirection: "row", alignItems: "center", gap: 14 }}>
            {/* Rating */}
            <View style={{ flexDirection: "row", alignItems: "center" }}>
              <Star size={12} color="#FF9933" fill="#FF9933" />
              <Text style={{ fontFamily: "Manrope_700Bold", color: "#f5f5f5", fontSize: 13, marginLeft: 4 }}>
                {restaurant.rating}
              </Text>
            </View>

            {/* Divider */}
            <View style={{ width: 1, height: 12, backgroundColor: "#333" }} />

            {/* Wait time — show "Closed" with grey for darkgrey status */}
            <View style={{ flexDirection: "row", alignItems: "center" }}>
              <Clock size={12} color={restaurant.waitStatus === "darkgrey" ? "#666666" : waitColor(restaurant.waitStatus)} />
              <Text style={{ fontFamily: "JetBrainsMono_600SemiBold", color: restaurant.waitStatus === "darkgrey" ? "#666666" : waitColor(restaurant.waitStatus), fontSize: 12, marginLeft: 4 }}>
                {restaurant.waitStatus === "darkgrey" ? "Closed" : restaurant.waitTime >= 999 ? "Closed" : restaurant.waitTime < 0 ? "—" : `${restaurant.waitTime}m`}
              </Text>
            </View>

            {/* Divider */}
            <View style={{ width: 1, height: 12, backgroundColor: "#333" }} />

            {/* Queue */}
            <View style={{ flexDirection: "row", alignItems: "center" }}>
              <Users size={12} color="#999999" />
              <Text style={{ fontFamily: "JetBrainsMono_600SemiBold", color: "#f5f5f5", fontSize: 12, marginLeft: 4 }}>
                {restaurant.queueLength}
              </Text>
              <Text style={{ fontFamily: "Manrope_500Medium", color: "#999999", fontSize: 11, marginLeft: 4 }}>
                in queue
              </Text>
            </View>

            {/* Distance pushed to far right */}
            <View style={{ flex: 1, flexDirection: "row", alignItems: "center", justifyContent: "flex-end" }}>
              <MapPin size={11} color="#999999" />
              <Text style={{ fontFamily: "Manrope_500Medium", color: "#999999", fontSize: 12, marginLeft: 3 }}>
                {restaurant.distance}
              </Text>
            </View>
          </View>
        </View>
      </Pressable>
      </Animated.View>
    </Animated.View>
  );
}
