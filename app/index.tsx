import React, { useState, useCallback, useEffect, useRef } from "react";
import {
  View,
  Text,
  ScrollView,
  FlatList,
  Pressable,
  Dimensions,
  Alert,
  Platform,
  RefreshControl,
} from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";
import { useRouter, useFocusEffect } from "expo-router";
import { Search, Bell, MapPin, TrendingUp, Zap, User, Map, UtensilsCrossed, ChevronRight, Users, Crown, X, RefreshCw, Sparkles, Clock, Heart } from "lucide-react-native";
import Animated, {
  FadeIn,
  FadeInDown,
  FadeInRight,
  useAnimatedStyle,
  useSharedValue,
  withSpring,
} from "react-native-reanimated";
import * as Haptics from "expo-haptics";
import AsyncStorage from "@react-native-async-storage/async-storage";
import { HeroCard } from "@/components/HeroCard";
import { RestaurantListCard } from "@/components/RestaurantListCard";
import { FilterBar } from "@/components/FilterBar";
import { SearchOverlay } from "@/components/SearchOverlay";
import { type FilterType } from "@/data/mockData";
import { supabase } from "@/lib/supabase";
import {
  type SupabaseRestaurant,
  type UIRestaurant,
  mapSupabaseToUI,
  haversineDistance,
  parseFavorites,
} from "@/lib/restaurant-types";
import { useLocation } from "@/lib/location-context";
import { useAdminMode } from "@/hooks/useAdminMode";
import { useAuth } from "@/lib/auth-context";
import { useNotifications } from "@/lib/notifications-context";
import { useClosedRestaurantIds } from "@/hooks/useClosedRestaurantIds";
import { usePersonalization } from "@/hooks/usePersonalization";

let SCREEN_WIDTH = Dimensions.get("window").width;
Dimensions.addEventListener("change", ({ window }) => { SCREEN_WIDTH = window.width; });

interface ActiveGroupOrder {
  sessionId: string;
  restaurantName: string;
  isHost: boolean;
  joinedAt: string;
  itemCount?: number;
  memberCount?: number;
}

export default function DiscoveryFeed() {
  const router = useRouter();
  const { userCoords, locationLabel } = useLocation();
  const { isAdmin } = useAdminMode();
  const { session } = useAuth();
  const { unreadCount } = useNotifications();
  const closedRestaurantIds = useClosedRestaurantIds();
  const [activeFilter, setActiveFilter] = useState<FilterType>("all");
  const [showSearch, setShowSearch] = useState(false);
  const [activeGroupOrder, setActiveGroupOrder] = useState<ActiveGroupOrder | null>(null);
  const personalization = usePersonalization();
  const [refreshing, setRefreshing] = useState(false);
  const [favoriteRestaurantIds, setFavoriteRestaurantIds] = useState<number[]>([]);

  // ==================================================
  // STATE MANAGEMENT - Replace Mock Data
  // ==================================================
  const [restaurants, setRestaurants] = useState<UIRestaurant[]>([]);
  const [loading, setLoading] = useState(true);

  // ==================================================
  // THE "CHALO" REALTIME ENGINE
  // ==================================================
  const userCoordsRef = useRef(userCoords);
  userCoordsRef.current = userCoords;

  useEffect(() => {
    fetchRestaurants();

    const subscription = supabase
      .channel('public:restaurants')
      .on(
        'postgres_changes',
        { event: 'UPDATE', schema: 'public', table: 'restaurants' },
        (payload) => {
          const updatedRestaurant = mapSupabaseToUI(payload.new as SupabaseRestaurant, userCoordsRef.current);
          setRestaurants((currentData) =>
            currentData.map((item) =>
              item.id === updatedRestaurant.id ? updatedRestaurant : item
            )
          );
        }
      )
      .subscribe();

    return () => {
      supabase.removeChannel(subscription);
    };
  }, []);

  // Load favorites for the signed-in user so we can render a dedicated Favorites rail.
  const fetchFavoriteRestaurantIds = useCallback(async () => {
    const userId = session?.user?.id;
    if (!userId) {
      setFavoriteRestaurantIds([]);
      return;
    }
    try {
      const { data } = await supabase
        .from("profiles")
        .select("favorite_restaurants")
        .eq("id", userId)
        .single();
      setFavoriteRestaurantIds(parseFavorites((data as any)?.favorite_restaurants));
    } catch {
      setFavoriteRestaurantIds([]);
    }
  }, [session?.user?.id]);

  useEffect(() => {
    fetchFavoriteRestaurantIds();
  }, [fetchFavoriteRestaurantIds]);


  async function fetchRestaurants() {
    try {
      const { data, error } = await supabase
        .from('restaurants')
        .select('*')
        .order('current_wait_time', { ascending: true }); // Show fastest first

      if (error) {
        console.error('❌ Supabase Error:', error);
        Alert.alert(
          'Database Error',
          `Could not fetch restaurants:\n\n${error.message}\n\nℹ️ This might be a Row Level Security (RLS) policy issue.`,
          [{ text: 'OK' }]
        );
        throw error;
      }
      if (data) {
        const uiRestaurants = data.map((r: SupabaseRestaurant) => mapSupabaseToUI(r, userCoordsRef.current));
        setRestaurants(uiRestaurants);
      }
    } catch (error) {
      console.error('Error fetching restaurants:', error);
    } finally {
      setLoading(false);
    }
  }

  const currentUserId = session?.user?.id;
  const activeOrderKey = currentUserId
    ? `rasvia:active_group_order:${currentUserId}`
    : null;

  const discardGroupOrder = useCallback(async (sessId: string) => {
    Alert.alert(
      "Cancel Group Order",
      "This will discard the entire group order and remove all items. This cannot be undone.",
      [
        { text: "Keep Order", style: "cancel" },
        {
          text: "Cancel Order",
          style: "destructive",
          onPress: async () => {
            try {
              await supabase.from("party_items").delete().eq("session_id", sessId);
              await supabase.from("party_sessions").update({ status: "cancelled" }).eq("id", sessId);
              if (activeOrderKey) await AsyncStorage.removeItem(activeOrderKey);
              setActiveGroupOrder(null);
              if (Platform.OS !== "web") Haptics.notificationAsync(Haptics.NotificationFeedbackType.Warning);
            } catch {
              Alert.alert("Error", "Could not cancel the order. Try again.");
            }
          },
        },
      ]
    );
  }, [activeOrderKey]);

  // Check for active group orders — user-scoped key, lightweight
  const checkActiveGroupOrder = useCallback(async () => {
    if (!currentUserId || !activeOrderKey) {
      setActiveGroupOrder(null);
      return;
    }
    try {
      // Check user-scoped AsyncStorage first (fast, local)
      const stored = await AsyncStorage.getItem(activeOrderKey);
      if (stored) {
        const parsed = JSON.parse(stored) as ActiveGroupOrder;
        const { data: sess, error } = await supabase
          .from('party_sessions')
          .select('id, status, restaurants(name)')
          .eq('id', parsed.sessionId)
          .single();

        if (!error && sess && sess.status === 'open') {
          setActiveGroupOrder({
            ...parsed,
            restaurantName: (sess.restaurants as any)?.name ?? parsed.restaurantName,
          });
          return;
        }
        // Not open anymore — clean up
        await AsyncStorage.removeItem(activeOrderKey);
      }

      // Fallback: check if the user hosts any open sessions
      const { data: hostSessions } = await supabase
        .from('party_sessions')
        .select('id, restaurants(name)')
        .eq('host_user_id', currentUserId)
        .eq('status', 'open')
        .order('created_at', { ascending: false })
        .limit(1);

      if (hostSessions && hostSessions.length > 0) {
        const sess = hostSessions[0];
        const order: ActiveGroupOrder = {
          sessionId: sess.id,
          restaurantName: (sess.restaurants as any)?.name ?? 'Restaurant',
          isHost: true,
          joinedAt: new Date().toISOString(),
        };
        // Re-persist so the banner works immediately next time
        await AsyncStorage.setItem(activeOrderKey, JSON.stringify(order));
        setActiveGroupOrder(order);
        return;
      }

      setActiveGroupOrder(null);
    } catch {
      setActiveGroupOrder(null);
    }
  }, [currentUserId, activeOrderKey]);

  useFocusEffect(
    useCallback(() => {
      checkActiveGroupOrder();
      fetchFavoriteRestaurantIds();
    }, [checkActiveGroupOrder, fetchFavoriteRestaurantIds])
  );

  // Recalculate distances when userCoords arrives after initial fetch
  useEffect(() => {
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

  // Override waitStatus/waitTime for restaurants closed per their hours
  const restaurantsWithHoursStatus = restaurants.map((r) =>
    closedRestaurantIds.has(r.id) || !r.waitlistOpen
      ? { ...r, waitStatus: 'darkgrey' as const, waitTime: -1 }
      : r
  );

  const filteredRestaurants = restaurantsWithHoursStatus.filter((r) => {
    if (!isAdmin && !r.isEnabled) return false;
    if (r.waitStatus === 'darkgrey') return false; // always exclude closed restaurants from Nearby
    if (activeFilter === "all") return true;
    return r.waitStatus === activeFilter;
  });

  const parseDist = (d: string) => parseFloat(d) || 9999;

  const nearbyRestaurants = [...filteredRestaurants].sort((a, b) => {
    if (activeFilter !== "all") {
      const aw = a.waitTime ?? 9999;
      const bw = b.waitTime ?? 9999;
      if (aw !== bw) return aw - bw;
      return parseDist(a.distance) - parseDist(b.distance);
    }
    return parseDist(a.distance) - parseDist(b.distance);
  });

  const trendingRestaurants = restaurantsWithHoursStatus
    .filter((r) => (isAdmin || r.isEnabled) && r.waitStatus !== "darkgrey" && r.waitStatus !== "grey")
    .slice(0, 3);
  
  const quickBites = restaurantsWithHoursStatus.filter((r) => 
    (isAdmin || r.isEnabled) && r.waitStatus === "green"
  );

  const favoritesRestaurants = restaurantsWithHoursStatus
    .filter((r) => (isAdmin || r.isEnabled) && favoriteRestaurantIds.includes(Number(r.id)))
    .sort((a, b) => {
      const aClosed = a.waitStatus === "darkgrey" ? 1 : 0;
      const bClosed = b.waitStatus === "darkgrey" ? 1 : 0;
      if (aClosed !== bClosed) return aClosed - bClosed;
      const aw = a.waitTime >= 0 ? a.waitTime : Number.POSITIVE_INFINITY;
      const bw = b.waitTime >= 0 ? b.waitTime : Number.POSITIVE_INFINITY;
      if (aw !== bw) return aw - bw;
      return parseDist(a.distance) - parseDist(b.distance);
    });

  const nothingToShow = trendingRestaurants.length === 0 && nearbyRestaurants.length === 0 && quickBites.length === 0;

  const handleRestaurantPress = useCallback(
    (id: string) => {
      if (Platform.OS !== "web") {
        Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
      }
      router.push(`/restaurant/${id}` as any);
    },
    [router]
  );


  const handleFilterChange = useCallback((filter: FilterType) => {
    if (Platform.OS !== "web") {
      Haptics.selectionAsync();
    }
    setActiveFilter(filter);
  }, []);

  return (
    <View className="flex-1 bg-rasvia-black">
      <SafeAreaView className="flex-1" edges={["top"]}>
        {/* Header */}
        <Animated.View
          entering={FadeIn.duration(500)}
          className="flex-row items-center justify-between px-5"
          style={{ paddingTop: 0, paddingBottom: 4, backgroundColor: "#0f0f0f", zIndex: 10 }}
        >
          <View style={{ flex: 1, marginRight: 12 }}>
            <View className="flex-row items-center mb-1">
              <MapPin size={13} color="#FF9933" style={{ flexShrink: 0 }} />
              <Text
                numberOfLines={1}
                style={{
                  fontFamily: "Manrope_500Medium",
                  color: "#999999",
                  fontSize: 12,
                  marginLeft: 4,
                  flexShrink: 1,
                }}
              >
                {locationLabel ?? "Locating…"}
              </Text>
            </View>
            <Text
              style={{
                fontFamily: "BricolageGrotesque_800ExtraBold",
                color: "#f5f5f5",
                fontSize: 32,
                letterSpacing: -0.5,
              }}
            >
              rasvia
            </Text>
          </View>
          <View className="flex-row items-center" style={{ flexShrink: 0 }}>
            <Pressable
              className="mr-3"
              onPress={() => {
                if (Platform.OS !== "web") {
                  Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
                }
                setShowSearch(true);
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
              }}
            >
              <Search size={20} color="#f5f5f5" />
            </Pressable>
            <Pressable
              className="mr-3"
              onPress={() => {
                if (Platform.OS !== "web") {
                  Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
                }
                router.push("/map" as any);
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
              }}
            >
              <Map size={20} color="#f5f5f5" />
            </Pressable>
            <Pressable
              onPress={() => {
                if (Platform.OS !== "web") {
                  Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
                }
                router.push("/notifications" as any);
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
                position: "relative",
              }}
            >
              <Bell size={20} color="#f5f5f5" />
              {unreadCount > 0 && (
                <View
                  style={{
                    position: "absolute",
                    top: 8,
                    right: 8,
                    minWidth: 16,
                    height: 16,
                    borderRadius: 8,
                    backgroundColor: "#EF4444",
                    borderWidth: 1.5,
                    borderColor: "#1a1a1a",
                    alignItems: "center",
                    justifyContent: "center",
                    paddingHorizontal: unreadCount > 9 ? 3 : 0,
                  }}
                >
                  <Text
                    style={{
                      fontFamily: "JetBrainsMono_600SemiBold",
                      color: "#fff",
                      fontSize: 8,
                      lineHeight: 10,
                    }}
                  >
                    {unreadCount > 9 ? "9+" : unreadCount}
                  </Text>
                </View>
              )}
            </Pressable>
            <Pressable
              onPress={() => {
                if (Platform.OS !== "web") {
                  Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
                }
                router.push("/profile" as any);
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
                marginLeft: 10,
              }}
            >
              <User size={20} color="#FF9933" />
            </Pressable>
          </View>
        </Animated.View>

        <ScrollView
          showsVerticalScrollIndicator={false}
          contentContainerStyle={{ paddingBottom: 100 }}
          refreshControl={
            <RefreshControl
              refreshing={refreshing}
              onRefresh={() => {
                if (Platform.OS !== "web") Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
                setRefreshing(true);
                Promise.all([fetchRestaurants(), fetchFavoriteRestaurantIds()]).finally(() => setRefreshing(false));
              }}
              tintColor="#FF9933"
              colors={["#FF9933"]}
            />
          }
        >
          {/* Active Group Order Banner */}
          {activeGroupOrder && (
            <Animated.View entering={FadeInDown.duration(400)} style={{ paddingHorizontal: 16, paddingTop: 12, paddingBottom: 4 }}>
              <View style={{
                backgroundColor: "rgba(255,153,51,0.1)",
                borderRadius: 20,
                borderWidth: 1.5,
                borderColor: "rgba(255,153,51,0.3)",
                padding: 16,
                flexDirection: "row",
                alignItems: "center",
                gap: 14,
              }}>
                <Pressable
                  onPress={() => {
                    if (Platform.OS !== "web") Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Medium);
                    router.push(`/join/${activeGroupOrder.sessionId}` as any);
                  }}
                  style={{ flexDirection: "row", alignItems: "center", gap: 14, flex: 1 }}
                >
                  <View style={{
                    width: 48, height: 48, borderRadius: 24,
                    backgroundColor: "rgba(255,153,51,0.2)",
                    borderWidth: 2, borderColor: "#FF9933",
                    alignItems: "center", justifyContent: "center",
                  }}>
                    <UtensilsCrossed size={22} color="#FF9933" />
                  </View>
                  <View style={{ flex: 1 }}>
                    <View style={{ flexDirection: "row", alignItems: "center", gap: 6, marginBottom: 4 }}>
                      <View style={{ width: 8, height: 8, borderRadius: 4, backgroundColor: "#22C55E" }} />
                      <Text style={{ fontFamily: "Manrope_600SemiBold", color: "#22C55E", fontSize: 11, letterSpacing: 0.5, textTransform: "uppercase" }}>
                        In Progress
                      </Text>
                      {activeGroupOrder.isHost && <Crown size={11} color="#FF9933" />}
                    </View>
                    <Text style={{ fontFamily: "BricolageGrotesque_700Bold", color: "#f5f5f5", fontSize: 16, letterSpacing: -0.2 }} numberOfLines={1}>
                      Group Order at {activeGroupOrder.restaurantName}
                    </Text>
                  </View>
                  <ChevronRight size={20} color="#FF9933" />
                </Pressable>
                {activeGroupOrder.isHost && (
                  <Pressable
                    onPress={() => discardGroupOrder(activeGroupOrder.sessionId)}
                    hitSlop={8}
                    style={{
                      width: 32, height: 32, borderRadius: 16,
                      backgroundColor: "rgba(239,68,68,0.12)",
                      borderWidth: 1, borderColor: "rgba(239,68,68,0.3)",
                      alignItems: "center", justifyContent: "center",
                    }}
                  >
                    <X size={16} color="#EF4444" />
                  </Pressable>
                )}
              </View>
            </Animated.View>
          )}

          {/* Trending Section */}
          <View style={{ height: 10 }} />
          
          {nothingToShow && (
             <Animated.View entering={FadeInDown.delay(100).duration(500)}>
               <View className="px-5 my-8 items-center justify-center">
                 <Text
                   style={{
                     fontFamily: "BricolageGrotesque_600SemiBold",
                     color: "#999999",
                     fontSize: 18,
                     textAlign: "center"
                   }}
                 >
                  it&apos;s quiet right now...
                 </Text>
               </View>
             </Animated.View>
          )}

          {trendingRestaurants.length > 0 && (
            <>
              <Animated.View entering={FadeInDown.delay(100).duration(500)}>
                <View className="px-5 mb-1">
                  <View className="flex-row items-center mb-1">
                    <TrendingUp size={18} color="#FF9933" />
                    <Text
                      style={{
                        fontFamily: "BricolageGrotesque_800ExtraBold",
                        color: "#f5f5f5",
                        fontSize: 24,
                        marginLeft: 8,
                      }}
                    >
                      Trending Now
                    </Text>
                  </View>
                  <Text
                    style={{
                      fontFamily: "Manrope_500Medium",
                      color: "#999999",
                      fontSize: 14,
                      marginTop: 2,
                    }}
                  >
                    Popular spots with live wait times
                  </Text>
                </View>
              </Animated.View>
              <View style={{ height: 5 }} />

              {/* Hero Carousel */}
              <FlatList
                horizontal
                data={trendingRestaurants}
                keyExtractor={(r) => r.id}
                showsHorizontalScrollIndicator={false}
                contentContainerStyle={{ paddingHorizontal: 20, paddingBottom: 4 }}
                decelerationRate="fast"
                snapToInterval={SCREEN_WIDTH - 48 + 16}
                snapToAlignment="start"
                renderItem={({ item: restaurant, index }) => (
                  <HeroCard
                    restaurant={restaurant}
                    index={index}
                    onPress={() => handleRestaurantPress(restaurant.id)}
                  />
                )}
              />
            </>
          )}

          {/* Favorites Section */}
          {favoritesRestaurants.length > 0 && (
            <>
              <Animated.View entering={FadeInDown.delay(320).duration(500)}>
                <View className="px-5 mt-8 mb-4">
                  <View className="flex-row items-center mb-1">
                    <Heart size={18} color="#EF4444" />
                    <Text
                      style={{
                        fontFamily: "BricolageGrotesque_800ExtraBold",
                        color: "#f5f5f5",
                        fontSize: 24,
                        marginLeft: 8,
                      }}
                    >
                      Favorites
                    </Text>
                  </View>
                  <Text
                    style={{
                      fontFamily: "Manrope_500Medium",
                      color: "#999999",
                      fontSize: 14,
                      marginTop: 2,
                    }}
                  >
                    Your saved spots, sorted by wait
                  </Text>
                </View>
              </Animated.View>
              <FlatList
                horizontal
                data={favoritesRestaurants}
                keyExtractor={(r) => `favorite-${r.id}`}
                showsHorizontalScrollIndicator={false}
                contentContainerStyle={{ paddingHorizontal: 20, paddingBottom: 4 }}
                renderItem={({ item: restaurant, index }) => (
                  <RestaurantListCard
                    restaurant={restaurant}
                    index={index}
                    onPress={() => handleRestaurantPress(restaurant.id)}
                  />
                )}
              />
            </>
          )}

          {/* Filter Section */}
          {(nearbyRestaurants.length > 0 || activeFilter !== "all") && (
            <>
              <View className="mt-8 mb-4">
                <View className="px-5 mb-3">
                  <Text
                    style={{
                      fontFamily: "BricolageGrotesque_800ExtraBold",
                      color: "#f5f5f5",
                      fontSize: 24,
                    }}
                  >
                    Nearby
                  </Text>
                  <Text
                    style={{
                      fontFamily: "Manrope_500Medium",
                      color: "#999999",
                      fontSize: 14,
                      marginTop: 2,
                    }}
                  >
                    Filter by wait time
                  </Text>
                </View>
                <FilterBar
                  activeFilter={activeFilter}
                  onFilterChange={handleFilterChange}
                />
              </View>

              {/* Nearby Restaurants List */}
              <FlatList
                horizontal
                data={nearbyRestaurants}
                keyExtractor={(r) => r.id}
                showsHorizontalScrollIndicator={false}
                contentContainerStyle={{ paddingHorizontal: 20, paddingBottom: 4 }}
                renderItem={({ item: restaurant, index }) => (
                  <RestaurantListCard
                    restaurant={restaurant}
                    index={index}
                    onPress={() => handleRestaurantPress(restaurant.id)}
                  />
                )}
              />
            </>
          )}

          {/* Quick Bites Section */}
          {quickBites.length > 0 && (
            <>
              <Animated.View entering={FadeInDown.delay(400).duration(500)}>
                <View className="px-5 mt-8 mb-4">
                  <View className="flex-row items-center mb-1">
                    <Zap size={18} color="#22C55E" />
                    <Text
                      style={{
                        fontFamily: "BricolageGrotesque_800ExtraBold",
                        color: "#f5f5f5",
                        fontSize: 24,
                        marginLeft: 8,
                      }}
                    >
                      Quick Bites
                    </Text>
                  </View>
                  <Text
                    style={{
                      fontFamily: "Manrope_500Medium",
                      color: "#999999",
                      fontSize: 14,
                      marginTop: 2,
                    }}
                  >
                    Under 15 min wait
                  </Text>
                </View>
              </Animated.View>

              <ScrollView
                horizontal
                showsHorizontalScrollIndicator={false}
                contentContainerStyle={{ paddingHorizontal: 20, paddingBottom: 4 }}
              >
                {quickBites.map((restaurant, index) => (
                    <RestaurantListCard
                      key={restaurant.id}
                      restaurant={restaurant}
                      index={index}
                      onPress={() => handleRestaurantPress(restaurant.id)}
                    />
                  ))}
              </ScrollView>
            </>
          )}

          {/* ── ORDER AGAIN ── */}
          {!personalization.loading && personalization.orderedRestaurantIds.length > 0 && (() => {
            const orderAgainRestaurants = personalization.orderedRestaurantIds
              .map((rid) => restaurantsWithHoursStatus.find((r) => r.id === rid))
              .filter(Boolean) as typeof restaurantsWithHoursStatus;
            if (orderAgainRestaurants.length === 0) return null;
            return (
              <Animated.View entering={FadeInDown.delay(450).duration(500)}>
                <View className="px-5 mt-8 mb-4">
                  <View className="flex-row items-center mb-1">
                    <RefreshCw size={18} color="#FF9933" />
                    <Text style={{ fontFamily: "BricolageGrotesque_800ExtraBold", color: "#f5f5f5", fontSize: 24, marginLeft: 8 }}>
                      Order Again
                    </Text>
                  </View>
                  <Text style={{ fontFamily: "Manrope_500Medium", color: "#999999", fontSize: 14, marginTop: 2 }}>
                    Your go-to spots
                  </Text>
                </View>
                <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={{ paddingHorizontal: 20, gap: 12, paddingBottom: 4 }}>
                  {orderAgainRestaurants.slice(0, 6).map((restaurant) => {
                    const lastOrder = personalization.lastOrderByRestaurant[restaurant.id];
                    return (
                      <Pressable
                        key={restaurant.id}
                        onPress={() => {
                          if (restaurant.waitStatus !== 'darkgrey') handleRestaurantPress(restaurant.id);
                        }}
                        style={{
                          backgroundColor: "#141414",
                          borderRadius: 18,
                          borderWidth: 1,
                          borderColor: restaurant.waitStatus === 'darkgrey' ? "#222" : "#2a2a2a",
                          padding: 14,
                          width: 200,
                          opacity: restaurant.waitStatus === 'darkgrey' ? 0.7 : 1,
                          flexDirection: "column",
                          justifyContent: "space-between",
                          minHeight: 90,
                        }}
                      >
                        <View>
                          <Text style={{ fontFamily: "BricolageGrotesque_700Bold", color: restaurant.waitStatus === 'darkgrey' ? "#555" : "#f5f5f5", fontSize: 15, marginBottom: 4 }} numberOfLines={1}>
                            {restaurant.name}
                          </Text>
                          {lastOrder?.items?.length > 0 ? (
                            <View style={{ marginBottom: 0 }}>
                              {lastOrder.items.map((item, idx) => {
                                const mpColor =
                                  item.mealPeriod === 'breakfast' ? '#FBAB73' :
                                  item.mealPeriod === 'lunch'     ? '#7ADC9E' :
                                  item.mealPeriod === 'dinner'    ? '#B3BAFB' :
                                  item.mealPeriod === 'specials'  ? '#F9C56D' :
                                  item.mealPeriod === 'all_day'   ? '#BFC8D4' : '#999';
                                return (
                                  <View key={idx} style={{ flexDirection: 'row', alignItems: 'center', gap: 3, flexShrink: 1 }}>
                                    <Text
                                      numberOfLines={1}
                                      style={{ fontFamily: "Manrope_500Medium", color: mpColor, fontSize: 11, flexShrink: 1 }}
                                    >
                                      {item.name}
                                    </Text>
                                    {item.quantity > 1 && (
                                      <Text style={{ fontFamily: "Manrope_600SemiBold", color: '#06B6D4', fontSize: 9, flexShrink: 0 }}>
                                        (×{item.quantity})
                                      </Text>
                                    )}
                                  </View>
                                );
                              })}
                            </View>
                          ) : lastOrder?.itemsSummary ? (
                            <Text style={{ fontFamily: "Manrope_500Medium", color: "#555", fontSize: 11 }} numberOfLines={2}>
                              {lastOrder.itemsSummary}
                            </Text>
                          ) : null}
                        </View>
                        <View style={{ flexDirection: "row", alignItems: "center", justifyContent: "space-between", marginTop: 10 }}>
                          {restaurant.waitStatus === 'darkgrey' ? (
                            <View style={{ backgroundColor: "rgba(100,100,100,0.12)", borderRadius: 8, borderWidth: 1, borderColor: "rgba(100,100,100,0.2)", paddingHorizontal: 8, paddingVertical: 4 }}>
                              <Text style={{ fontFamily: "Manrope_700Bold", color: "#555", fontSize: 11 }}>Closed</Text>
                            </View>
                          ) : (
                            <View style={{ backgroundColor: "rgba(255,153,51,0.1)", borderRadius: 8, borderWidth: 1, borderColor: "rgba(255,153,51,0.25)", paddingHorizontal: 8, paddingVertical: 4 }}>
                              <Text style={{ fontFamily: "Manrope_700Bold", color: "#FF9933", fontSize: 11 }}>Order Again →</Text>
                            </View>
                          )}
                          {restaurant.waitStatus === 'darkgrey' ? (
                            <Text style={{ fontFamily: "Manrope_600SemiBold", color: "#444", fontSize: 11 }}>—</Text>
                          ) : restaurant.waitTime >= 0 && restaurant.waitTime < 999 ? (
                            <View style={{ flexDirection: 'row', alignItems: 'center', gap: 3 }}>
                              <Clock
                                size={11}
                                color={restaurant.waitStatus === 'green' ? '#22C55E' : restaurant.waitStatus === 'amber' ? '#F59E0B' : restaurant.waitStatus === 'red' ? '#EF4444' : '#888'}
                                strokeWidth={2.5}
                              />
                              <Text style={{
                                fontFamily: "JetBrainsMono_600SemiBold",
                                color: restaurant.waitStatus === 'green' ? '#22C55E' : restaurant.waitStatus === 'amber' ? '#F59E0B' : restaurant.waitStatus === 'red' ? '#EF4444' : '#888',
                                fontSize: 11
                              }}>{restaurant.waitTime}m</Text>
                            </View>
                          ) : null}
                        </View>
                      </Pressable>
                    );
                  })}
                </ScrollView>
              </Animated.View>
            );
          })()}

          {/* ── YOU MAY LIKE ── */}
          {!personalization.loading && personalization.topCuisineTags.length >= 1 && (() => {
            const visitedIds = new Set(personalization.orderedRestaurantIds);
            const recommendations = restaurantsWithHoursStatus
              .filter((r) => (isAdmin || r.isEnabled) && !visitedIds.has(r.id))
              .filter((r) =>
                // Score: how many of the restaurant's tags overlap with user's top tags
                r.tags.some((tag) => personalization.topCuisineTags.includes(tag))
              )
              .sort((a, b) => {
                const scoreA = a.tags.filter((t) => personalization.topCuisineTags.includes(t)).length;
                const scoreB = b.tags.filter((t) => personalization.topCuisineTags.includes(t)).length;
                return scoreB - scoreA;
              })
              .slice(0, 6);
            if (recommendations.length === 0) return null;
            return (
              <Animated.View entering={FadeInDown.delay(500).duration(500)}>
                <View className="px-5 mt-8 mb-4">
                  <View className="flex-row items-center mb-1">
                    <Sparkles size={18} color="#818CF8" />
                    <Text style={{ fontFamily: "BricolageGrotesque_800ExtraBold", color: "#f5f5f5", fontSize: 24, marginLeft: 8 }}>
                      You May Like
                    </Text>
                  </View>
                  <Text style={{ fontFamily: "Manrope_500Medium", color: "#999999", fontSize: 14, marginTop: 2 }}>
                    Based on your taste in {personalization.topCuisineTags.slice(0, 2).join(" & ")}
                  </Text>
                </View>
                <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={{ paddingHorizontal: 20, paddingBottom: 4 }}>
                  {recommendations.map((restaurant, index) => (
                    <RestaurantListCard
                      key={restaurant.id}
                      restaurant={restaurant}
                      index={index}
                      onPress={() => handleRestaurantPress(restaurant.id)}
                    />
                  ))}
                </ScrollView>
              </Animated.View>
            );
          })()}

          {/* Popular Cuisines */}
          <Animated.View entering={FadeInDown.delay(500).duration(500)}>
            <View className="px-5 mt-8 mb-4">
              <Text
                style={{
                  fontFamily: "BricolageGrotesque_800ExtraBold",
                  color: "#f5f5f5",
                  fontSize: 24,
                }}
              >
                Explore Cuisines
              </Text>
            </View>
            <View style={{ flexDirection: "row", flexWrap: "wrap", paddingHorizontal: 20, gap: 10 }}>
              {[
                { emoji: "🍛", label: "North Indian" },
                { emoji: "🥘", label: "South Indian" },
                { emoji: "🍢", label: "Pakistani" },
                { emoji: "🦐", label: "Sri Lankan" },
                { emoji: "🥡", label: "Indo-Chinese" },
                { emoji: "🍰", label: "Desserts" },
              ].map((cuisine, i) => (
                <CuisineChip
                  key={cuisine.label}
                  cuisine={cuisine}
                  index={i}
                  onPress={() => router.push(`/cuisine/${encodeURIComponent(cuisine.label)}` as any)}
                />
              ))}
            </View>
          </Animated.View>
        </ScrollView>

        {/* Search Overlay */}
        {showSearch && <SearchOverlay onClose={() => setShowSearch(false)} />}
      </SafeAreaView>
    </View>
  );
}

function CuisineChip({
  cuisine,
  index,
  onPress,
}: {
  cuisine: { emoji: string; label: string };
  index: number;
  onPress: () => void;
}) {
  const pressScale = useSharedValue(1);
  const animatedStyle = useAnimatedStyle(() => ({
    transform: [{ scale: pressScale.value }],
  }));

  return (
    <Animated.View
      entering={FadeInRight.delay(index * 60).duration(400)}
      style={{ width: (SCREEN_WIDTH - 40 - 10) / 2 }}
    >
      <Animated.View style={animatedStyle}>
        <Pressable
          onPress={() => {
            if (Platform.OS !== "web") Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
            onPress();
          }}
          onPressIn={() => { pressScale.value = withSpring(0.93); }}
          onPressOut={() => { pressScale.value = withSpring(1); }}
          style={{
            flexDirection: "row",
            alignItems: "center",
            backgroundColor: "#1a1a1a",
            borderRadius: 16,
            borderWidth: 1,
            borderColor: "#2a2a2a",
            paddingVertical: 14,
            paddingHorizontal: 16,
            gap: 10,
            width: "100%",
          }}
        >
          <Text style={{ fontSize: 22 }}>{cuisine.emoji}</Text>
          <Text
            style={{
              fontFamily: "Manrope_600SemiBold",
              color: "#f5f5f5",
              fontSize: 14,
              flexShrink: 1,
            }}
            numberOfLines={1}
          >
            {cuisine.label}
          </Text>
        </Pressable>
      </Animated.View>
    </Animated.View>
  );
}
