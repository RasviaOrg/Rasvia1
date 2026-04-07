import React, { useState, useEffect, useCallback } from "react";
import {
  View,
  Text,
  Pressable,
  ScrollView,
  Platform,
  RefreshControl,
  Image,
} from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";
import { useRouter, useFocusEffect } from "expo-router";
import { ArrowLeft, MapPin, Clock } from "lucide-react-native";
import Animated, { FadeIn, FadeInDown } from "react-native-reanimated";
import * as Haptics from "expo-haptics";
import { supabase } from "@/lib/supabase";
import { useAuth } from "@/lib/auth-context";
import { parseFavorites } from "@/lib/restaurant-types";
import { useClosedRestaurantIds } from "@/hooks/useClosedRestaurantIds";
import { BrandedLoader } from "@/components/BrandedLoader";

export default function FavoritesScreen() {
  const router = useRouter();
  const { session } = useAuth();
  const closedRestaurantIds = useClosedRestaurantIds();
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [favorites, setFavorites] = useState<any[]>([]);

  const fetchFavorites = async () => {
    if (!session?.user?.id) {
      setLoading(false);
      setRefreshing(false);
      return;
    }

    try {
      // Get the user's favorite restaurant IDs
      const { data: profileData, error: profileError } = await supabase
        .from("profiles")
        .select("favorite_restaurants")
        .eq("id", session.user.id)
        .maybeSingle();

      if (profileError) throw profileError;
      if (!profileData) {
        setFavorites([]);
        setLoading(false);
        setRefreshing(false);
        return;
      }

      const favoriteIds = parseFavorites(profileData?.favorite_restaurants);

      if (favoriteIds.length === 0) {
        setFavorites([]);
        setLoading(false);
        setRefreshing(false);
        return;
      }

      // Fetch the full restaurant details for those IDs
      const { data: restaurantsData, error: restaurantsError } = await supabase
        .from("restaurants")
        .select("*")
        .in("id", favoriteIds);

      if (restaurantsError) throw restaurantsError;

      setFavorites(restaurantsData || []);
    } catch (e) {
      console.error("Error fetching favorites:", e);
    } finally {
      setLoading(false);
      setRefreshing(false);
    }
  };

  useFocusEffect(
    useCallback(() => {
      fetchFavorites();
    }, [session])
  );

  const onRefresh = useCallback(() => {
    setRefreshing(true);
    fetchFavorites();
  }, [session]);

  const handleRestaurantPress = (restaurantId: number) => {
    if (Platform.OS !== "web") {
      Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
    }
    router.push(`/restaurant/${restaurantId}` as any);
  };

  return (
    <View className="flex-1 bg-rasvia-black">
      <SafeAreaView className="flex-1" edges={["top"]}>
        {/* Header */}
        <Animated.View
          entering={FadeIn.duration(400)}
          className="flex-row items-center px-5 pt-2 pb-4"
        >
          <Pressable
            onPress={() => {
              if (Platform.OS !== "web") {
                Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
              }
              router.back();
            }}
            style={{
              backgroundColor: "#1a1a1a",
              width: 44,
              height: 44,
              borderRadius: 22,
              alignItems: "center",
              justifyContent: "center",
              borderWidth: 1,
              borderColor: "#2a2a2a",
              marginRight: 16,
            }}
          >
            <ArrowLeft size={22} color="#f5f5f5" />
          </Pressable>
          <Text
            style={{
              fontFamily: "BricolageGrotesque_800ExtraBold",
              color: "#f5f5f5",
              fontSize: 28,
              letterSpacing: -0.5,
            }}
          >
            Favorites
          </Text>
        </Animated.View>

        {loading ? (
          <BrandedLoader message="Loading favorites..." />
        ) : (
          <ScrollView
            showsVerticalScrollIndicator={false}
            contentContainerStyle={{ paddingBottom: 40, paddingHorizontal: 20 }}
            refreshControl={
              <RefreshControl
                refreshing={refreshing}
                onRefresh={onRefresh}
                tintColor="#FF9933"
              />
            }
          >
            {favorites.length === 0 ? (
              <Animated.View
                entering={FadeInDown.delay(100).duration(500)}
                style={{
                  alignItems: "center",
                  justifyContent: "center",
                  marginTop: 60,
                }}
              >
                <Text
                  style={{
                    fontFamily: "BricolageGrotesque_700Bold",
                    color: "#f5f5f5",
                    fontSize: 20,
                    marginBottom: 8,
                  }}
                >
                  No favorites yet
                </Text>
                <Text
                  style={{
                    fontFamily: "Manrope_500Medium",
                    color: "#999",
                    fontSize: 15,
                    textAlign: "center",
                  }}
                >
                  Hit the heart icon on a restaurant to save it here for later.
                </Text>
              </Animated.View>
            ) : (
              favorites.map((restaurant, index) => {
                const isComingSoon = restaurant.is_coming_soon === true;
                const isClosed =
                  closedRestaurantIds.has(String(restaurant.id)) ||
                  restaurant.waitlist_open === false ||
                  restaurant.current_wait_time >= 999 ||
                  restaurant.is_enabled === false;
                const noWait = !isClosed && !isComingSoon && restaurant.current_wait_time != null && restaurant.current_wait_time < 0;
                const wt = restaurant.current_wait_time;
                const waitTimeStr = isComingSoon
                  ? "Coming soon"
                  : isClosed
                  ? "Closed"
                  : noWait
                    ? "No wait"
                    : wt != null && wt >= 0
                      ? `${wt} min wait`
                      : "-- min wait";
                const waitColor = isComingSoon
                  ? "#888888"
                  : isClosed
                  ? "#888888"
                  : noWait
                    ? "#10B981"
                    : wt < 15
                      ? "#10B981"
                      : wt < 45
                        ? "#F59E0B"
                        : "#EF4444";

                return (
                  <Animated.View
                    key={restaurant.id}
                    entering={FadeInDown.delay(100 + index * 50).duration(500)}
                  >
                    <Pressable
                      onPress={() => handleRestaurantPress(restaurant.id)}
                      style={{
                        flexDirection: "row",
                        backgroundColor: "#1a1a1a",
                        borderRadius: 16,
                        borderWidth: 1,
                        borderColor: "#2a2a2a",
                        padding: 12,
                        marginBottom: 16,
                        alignItems: "center",
                        opacity: isClosed ? 0.6 : 1,
                      }}
                    >
                      <Image
                        source={{
                          uri: restaurant.image_url || "https://images.unsplash.com/photo-1517248135467-4c7edcad34c4",
                        }}
                        style={{
                          width: 80,
                          height: 80,
                          borderRadius: 12,
                          backgroundColor: "#262626",
                        }}
                      />
                      <View style={{ flex: 1, marginLeft: 16 }}>
                        <Text
                          style={{
                            fontFamily: "BricolageGrotesque_700Bold",
                            color: "#f5f5f5",
                            fontSize: 16,
                            marginBottom: 4,
                          }}
                          numberOfLines={1}
                        >
                          {restaurant.name}
                        </Text>
                        <View style={{ flexDirection: "row", alignItems: "center", marginBottom: 4 }}>
                          <MapPin size={12} color="#999" />
                          <Text
                            style={{
                              fontFamily: "Manrope_500Medium",
                              color: "#999",
                              fontSize: 12,
                              marginLeft: 4,
                            }}
                            numberOfLines={1}
                          >
                            {restaurant.address}
                          </Text>
                        </View>
                        <View style={{ flexDirection: "row", alignItems: "center" }}>
                          <Clock size={12} color={waitColor} />
                          <Text
                            style={{
                              fontFamily: "Manrope_600SemiBold",
                              color: waitColor,
                              fontSize: 12,
                              marginLeft: 4,
                            }}
                          >
                            {waitTimeStr}
                          </Text>
                        </View>
                      </View>
                    </Pressable>
                  </Animated.View>
                );
              })
            )}
          </ScrollView>
        )}
      </SafeAreaView>
    </View>
  );
}
