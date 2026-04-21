import React, { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  View,
  Text,
  Pressable,
  ScrollView,
  RefreshControl,
  Platform,
} from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";
import { Stack, useLocalSearchParams, useRouter } from "expo-router";
import { ArrowLeft, ChevronRight, Clock, MapPin, Star, Leaf, ShieldCheck } from "lucide-react-native";
import * as Haptics from "expo-haptics";
import Animated, {
  FadeIn,
  FadeInDown,
  useAnimatedStyle,
  useSharedValue,
  withRepeat,
  withTiming,
} from "react-native-reanimated";
import { supabase } from "@/lib/supabase";
import { fetchBatchReviewStats } from "@/lib/review-stats";
import {
  type SupabaseRestaurant,
  type UIRestaurant,
  mapSupabaseToUI,
  haversineDistance,
  parseFavorites,
} from "@/lib/restaurant-types";
import { useLocation } from "@/lib/location-context";
import { useAdminMode } from "@/hooks/useAdminMode";
import { useClosedRestaurantIds } from "@/hooks/useClosedRestaurantIds";
import { useAuth } from "@/lib/auth-context";
import { FilterBar } from "@/components/FilterBar";
import type { FilterType } from "@/data/mockData";
import { RestaurantMediaFrame } from "@/components/RestaurantMediaFrame";
import { fetchRestaurantMediaSlides, fetchRecentlyViewedRestaurantIds, type RestaurantMediaSlide } from "@/lib/restaurant-media";
import { useAppTheme } from "@/lib/app-theme";

function parseDist(distance: string) {
  return parseFloat(distance) || 9999;
}

function normalizeFilter(value: string | string[] | undefined): FilterType {
  const raw = typeof value === "string" ? value : Array.isArray(value) ? value[0] : "all";
  if (raw === "green" || raw === "amber" || raw === "red") return raw;
  return "all";
}

function lower(value: string) {
  return value.trim().toLowerCase();
}

function getSectionCopy(section: string): { title: string; subtitle: string } {
  switch (section) {
    case "favorites":
      return { title: "Favorites", subtitle: "Your saved spots in one place" };
    case "recently-viewed":
      return { title: "Recently Viewed", subtitle: "Restaurants you opened recently" };
    case "nearby":
      return { title: "Nearby", subtitle: "Filter by wait time and keep dietary sorting" };
    case "quick-bites":
      return { title: "Quick Bites", subtitle: "Under 15 min wait" };
    default:
      return { title: "Trending Now", subtitle: "Popular spots with live wait times" };
  }
}

function DiscoverLoadingSkeleton() {
  const { colors } = useAppTheme();
  const pulse = useSharedValue(0.28);
  useEffect(() => {
    pulse.value = withRepeat(withTiming(0.52, { duration: 700 }), -1, true);
  }, [pulse]);
  const pulseStyle = useAnimatedStyle(() => ({ opacity: pulse.value }));

  const blocks = [0, 1, 2, 3];
  return (
    <View style={{ paddingTop: 4 }}>
      {blocks.map((i) => (
        <Animated.View
          key={i}
          entering={FadeInDown.delay(32 + i * 68).duration(420)}
          style={{
            borderRadius: 14,
            borderWidth: 1,
            borderColor: colors.cardBorder,
            backgroundColor: colors.card,
            padding: 12,
            marginBottom: 10,
          }}
        >
          <Animated.View
            style={[
              { height: 198, borderRadius: 12, backgroundColor: colors.skeleton },
              pulseStyle,
            ]}
          />
          <View style={{ marginTop: 14, gap: 10 }}>
            <Animated.View style={[{ height: 22, width: "72%", borderRadius: 8, backgroundColor: colors.skeletonLine }, pulseStyle]} />
            <Animated.View style={[{ height: 14, width: "44%", borderRadius: 6, backgroundColor: colors.skeletonLine }, pulseStyle]} />
            <View style={{ flexDirection: "row", gap: 10, marginTop: 4 }}>
              <Animated.View style={[{ height: 12, width: 52, borderRadius: 4, backgroundColor: colors.skeletonLine }, pulseStyle]} />
              <Animated.View style={[{ height: 12, width: 64, borderRadius: 4, backgroundColor: colors.skeletonLine }, pulseStyle]} />
              <Animated.View style={[{ height: 12, width: 56, borderRadius: 4, backgroundColor: colors.skeletonLine }, pulseStyle]} />
            </View>
          </View>
        </Animated.View>
      ))}
    </View>
  );
}

function SectionRestaurantRow({
  restaurant,
  mediaSlides,
  onPress,
  isTrending = false,
}: {
  restaurant: UIRestaurant;
  mediaSlides?: RestaurantMediaSlide[];
  onPress: () => void;
  /** Trending list: stronger tag chips + title legibility (matches home carousel). */
  isTrending?: boolean;
}) {
  const { colors, isDark } = useAppTheme();
  const isComingSoon = restaurant.isComingSoon;
  const waitColor =
    isComingSoon
      ? "#8a8a8a"
      : restaurant.waitStatus === "green"
      ? "#22C55E"
      : restaurant.waitStatus === "amber"
      ? "#F59E0B"
      : restaurant.waitStatus === "darkgrey"
      ? "#888"
      : "#EF4444";

  return (
    <View
      style={{
        borderRadius: 14,
        borderWidth: 1,
        borderColor: colors.cardBorder,
        backgroundColor: colors.card,
        padding: 12,
        marginBottom: 10,
      }}
    >
      <RestaurantMediaFrame
        defaultImage={restaurant.image}
        slides={mediaSlides}
        height={198}
        borderRadius={12}
        includeDefaultStarter={restaurant.useRegularImageAsFirstSlide}
      />
      <Pressable onPress={onPress} style={{ marginTop: 12 }}>
        {isTrending && (restaurant.tags?.length ?? 0) > 0 && (
          <View style={{ flexDirection: "row", flexWrap: "wrap", gap: 6, marginBottom: 8 }}>
            {restaurant.tags
              .filter((t) => t.trim().toLowerCase() !== "indian")
              .slice(0, 2)
              .map((tag) => (
                <View
                  key={tag}
                  style={{
                    backgroundColor: "rgba(255,153,51,0.85)",
                    borderRadius: 999,
                    paddingHorizontal: 8,
                    paddingVertical: 4,
                  }}
                >
                  <Text style={{ fontFamily: "Manrope_600SemiBold", color: "#ffffff", fontSize: 11 }}>{tag}</Text>
                </View>
              ))}
          </View>
        )}
        <View style={{ flexDirection: "row", alignItems: "center", gap: 8 }}>
          <Text
            style={{
              fontFamily: "BricolageGrotesque_700Bold",
              color: colors.text,
              fontSize: isTrending ? 26 : 24,
              flex: 1,
              letterSpacing: isTrending ? -0.4 : undefined,
              textShadowColor: isTrending ? (isDark ? "rgba(0,0,0,0.35)" : "rgba(0,0,0,0.12)") : undefined,
              textShadowOffset: isTrending ? { width: 0, height: 1 } : undefined,
              textShadowRadius: isTrending ? 6 : undefined,
            }}
            numberOfLines={1}
          >
            {restaurant.name}
          </Text>
          <ChevronRight size={18} color={colors.iconMuted} />
        </View>
        <Text
          style={{
            fontFamily: "Manrope_500Medium",
            color: colors.textMuted,
            fontSize: 13,
            marginTop: 2,
          }}
          numberOfLines={1}
        >
          {restaurant.cuisine}
        </Text>

        <View style={{ flexDirection: "row", alignItems: "center", gap: 10, marginTop: 8 }}>
          <View style={{ flexDirection: "row", alignItems: "center", gap: 4 }}>
            <Star size={12} color="#FF9933" fill="#FF9933" />
            <Text style={{ fontFamily: "Manrope_600SemiBold", color: colors.text, fontSize: 12 }}>
              {restaurant.rating.toFixed(1)}
            </Text>
          </View>
          <View style={{ flexDirection: "row", alignItems: "center", gap: 4 }}>
            <Clock size={12} color={waitColor} />
            <Text style={{ fontFamily: "Manrope_600SemiBold", color: waitColor, fontSize: 12 }}>
              {isComingSoon ? "Coming soon" : restaurant.waitStatus === "darkgrey" ? "Closed" : `${restaurant.waitTime} min`}
            </Text>
          </View>
          <View style={{ flexDirection: "row", alignItems: "center", gap: 4 }}>
            <MapPin size={11} color={colors.iconMuted} />
            <Text style={{ fontFamily: "Manrope_500Medium", color: colors.textMuted, fontSize: 11 }}>
              {restaurant.distance}
            </Text>
          </View>
        </View>
      </Pressable>
    </View>
  );
}

export default function DiscoverSectionPage() {
  const { colors } = useAppTheme();
  const router = useRouter();
  const params = useLocalSearchParams<{ section?: string; filter?: string }>();
  const section = (params.section ?? "trending") as string;
  const { session } = useAuth();
  const { userCoords } = useLocation();
  const { isAdmin } = useAdminMode();
  const closedRestaurantIds = useClosedRestaurantIds();

  const userCoordsRef = useRef(userCoords);
  userCoordsRef.current = userCoords;

  const [restaurants, setRestaurants] = useState<UIRestaurant[]>([]);
  const [restaurantMediaById, setRestaurantMediaById] = useState<Record<string, RestaurantMediaSlide[]>>({});
  const [favoriteRestaurantIds, setFavoriteRestaurantIds] = useState<number[]>([]);
  const [recentlyViewedIds, setRecentlyViewedIds] = useState<number[]>([]);
  const [userDietaryType, setUserDietaryType] = useState("");
  const [userRestrictedDays, setUserRestrictedDays] = useState<string[]>([]);
  const [activeFilter, setActiveFilter] = useState<FilterType>(normalizeFilter(params.filter));
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);

  useEffect(() => {
    setActiveFilter(normalizeFilter(params.filter));
  }, [params.filter]);

  const fetchScreenData = useCallback(async () => {
    try {
      const userId = session?.user?.id;
      const restaurantsPromise = supabase
        .from("restaurants")
        .select("*")
        .order("current_wait_time", { ascending: true });

      const profilePromise = userId
        ? supabase
            .from("profiles")
            .select("favorite_restaurants, dietary_type, restricted_days, recently_viewed_restaurants")
            .eq("id", userId)
            .maybeSingle()
        : Promise.resolve({ data: null, error: null } as any);

      const [{ data: restRows, error: restError }, { data: profileRow }] = await Promise.all([
        restaurantsPromise,
        profilePromise,
      ]);

      if (restError) throw restError;

      const mapped = ((restRows ?? []) as SupabaseRestaurant[]).map((row) => mapSupabaseToUI(row, userCoordsRef.current));
      const statsMap = await fetchBatchReviewStats(mapped.map((r) => r.id));
      const withReviews = mapped.map((r) => {
        const stats = statsMap.get(r.id);
        if (!stats) return r;
        return { ...r, rating: stats.average, reviewCount: stats.count };
      });

      setRestaurants(withReviews);
      setRestaurantMediaById(await fetchRestaurantMediaSlides(withReviews.map((r) => r.id)));

      setFavoriteRestaurantIds(parseFavorites((profileRow as any)?.favorite_restaurants));
      setRecentlyViewedIds(await fetchRecentlyViewedRestaurantIds(userId ?? ""));
      setUserDietaryType((profileRow as any)?.dietary_type ?? "");
      setUserRestrictedDays(((profileRow as any)?.restricted_days as string[]) ?? []);
    } catch (error) {
      console.error("discover section fetch error", error);
    } finally {
      setLoading(false);
      setRefreshing(false);
    }
  }, [session?.user?.id]);

  useEffect(() => {
    void fetchScreenData();
  }, [fetchScreenData]);

  useEffect(() => {
    if (!userCoords) return;
    setRestaurants((prev) =>
      prev.map((r) => {
        if (r.lat == null || r.long == null) return r;
        const dist = haversineDistance(userCoords.latitude, userCoords.longitude, r.lat, r.long);
        return { ...r, distance: `${dist.toFixed(1)} mi` };
      })
    );
  }, [userCoords]);

  const todayName = new Date().toLocaleDateString("en-US", {
    timeZone: "America/Chicago",
    weekday: "short",
  });
  const isVegSortMode =
    userDietaryType === "Vegetarian" ||
    (userDietaryType === "Non-Veg" && userRestrictedDays.includes(todayName));
  const isHalalSortMode = userDietaryType === "Halal";

  const dietarySortScore = useCallback((restaurant: UIRestaurant) => {
    const tags = (restaurant.tags ?? []).map(lower);
    const hasVegetarianTag = tags.some((t) => t.includes("vegetarian") || t.includes("vegan") || t === "veg");
    const hasHalalTag = tags.some((t) => t.includes("halal"));
    const explicitAllHalal = tags.some(
      (t) => t.includes("all halal") || t.includes("100% halal") || t.includes("fully halal") || t.includes("only halal")
    );
    const hasNonHalalHint = tags.some(
      (t) => t.includes("non-halal") || t.includes("non halal") || t.includes("pork") || t.includes("alcohol") || t.includes("beer") || t.includes("wine")
    );

    if (isVegSortMode) return hasVegetarianTag ? 2 : -2;
    if (isHalalSortMode) {
      if (explicitAllHalal && !hasNonHalalHint) return 3;
      if (hasHalalTag) return 1;
      if (hasNonHalalHint) return -3;
      return -1;
    }
    return 0;
  }, [isHalalSortMode, isVegSortMode]);

  const restaurantsWithHoursStatus = useMemo(() => {
    return restaurants.map((r) =>
      closedRestaurantIds.has(r.id) || !r.waitlistOpen
        ? { ...r, waitStatus: "darkgrey" as const, waitTime: -1 }
        : r
    );
  }, [closedRestaurantIds, restaurants]);
  const availabilityRank = useCallback((r: UIRestaurant) => {
    if (r.isComingSoon) return 1;
    if (r.waitStatus === "darkgrey") return 2;
    return 0;
  }, []);

  const nearbyRestaurants = useMemo(() => {
    const filtered = restaurantsWithHoursStatus.filter((r) => {
      if (!isAdmin && !r.isEnabled) return false;
      if (r.waitStatus === "darkgrey") return false;
      if (r.isComingSoon && activeFilter !== "all") return false;
      if (activeFilter === "all") return true;
      return r.waitStatus === activeFilter;
    });

    return [...filtered].sort((a, b) => {
      const ar = availabilityRank(a);
      const br = availabilityRank(b);
      if (ar !== br) return ar - br;
      const scoreDelta = dietarySortScore(b) - dietarySortScore(a);
      if (scoreDelta !== 0) return scoreDelta;
      if (activeFilter !== "all") {
        const aw = a.waitTime ?? 9999;
        const bw = b.waitTime ?? 9999;
        if (aw !== bw) return aw - bw;
        return parseDist(a.distance) - parseDist(b.distance);
      }
      return parseDist(a.distance) - parseDist(b.distance);
    });
  }, [activeFilter, availabilityRank, dietarySortScore, isAdmin, restaurantsWithHoursStatus]);

  const trendingRestaurants = useMemo(() => {
    return restaurantsWithHoursStatus
      .filter((r) => (isAdmin || r.isEnabled) && !r.isComingSoon && r.waitStatus !== "darkgrey" && r.waitStatus !== "grey")
      .sort((a, b) => {
        const scoreDelta = dietarySortScore(b) - dietarySortScore(a);
        if (scoreDelta !== 0) return scoreDelta;
        return (a.waitTime ?? 9999) - (b.waitTime ?? 9999);
      });
  }, [dietarySortScore, isAdmin, restaurantsWithHoursStatus]);

  const quickBites = useMemo(() => {
    return restaurantsWithHoursStatus
      .filter((r) => (isAdmin || r.isEnabled) && !r.isComingSoon && r.waitStatus === "green")
      .sort((a, b) => {
        const scoreDelta = dietarySortScore(b) - dietarySortScore(a);
        if (scoreDelta !== 0) return scoreDelta;
        return parseDist(a.distance) - parseDist(b.distance);
      });
  }, [dietarySortScore, isAdmin, restaurantsWithHoursStatus]);

  const favoritesRestaurants = useMemo(() => {
    return restaurantsWithHoursStatus
      .filter((r) => (isAdmin || r.isEnabled) && favoriteRestaurantIds.includes(Number(r.id)))
      .sort((a, b) => {
        const ar = availabilityRank(a);
        const br = availabilityRank(b);
        if (ar !== br) return ar - br;
        const aw = a.waitTime >= 0 ? a.waitTime : Number.POSITIVE_INFINITY;
        const bw = b.waitTime >= 0 ? b.waitTime : Number.POSITIVE_INFINITY;
        if (aw !== bw) return aw - bw;
        return parseDist(a.distance) - parseDist(b.distance);
      });
  }, [availabilityRank, favoriteRestaurantIds, isAdmin, restaurantsWithHoursStatus]);

  const recentlyViewedRestaurants = useMemo(() => {
    if (recentlyViewedIds.length === 0) return [] as UIRestaurant[];
    const byId = new Map(restaurantsWithHoursStatus.map((r) => [Number(r.id), r]));
    const seen = new Set<number>();
    const ordered: UIRestaurant[] = [];
    for (const id of recentlyViewedIds) {
      if (seen.has(id)) continue;
      seen.add(id);
      const row = byId.get(id);
      if (row) ordered.push(row);
    }
    return ordered;
  }, [recentlyViewedIds, restaurantsWithHoursStatus]);

  const content = useMemo(() => {
    if (section === "favorites") {
      return {
        title: "Favorites",
        subtitle: "Your saved spots in one place",
        rows: favoritesRestaurants,
      };
    }
    if (section === "recently-viewed") {
      return {
        title: "Recently Viewed",
        subtitle: "Restaurants you opened recently",
        rows: recentlyViewedRestaurants,
      };
    }
    if (section === "nearby") {
      return {
        title: "Nearby",
        subtitle: "Filter by wait time and keep dietary sorting",
        rows: nearbyRestaurants,
      };
    }
    if (section === "quick-bites") {
      return {
        title: "Quick Bites",
        subtitle: "Under 15 min wait",
        rows: quickBites,
      };
    }
    return {
      title: "Trending Now",
      subtitle: "Popular spots with live wait times",
      rows: trendingRestaurants,
    };
  }, [favoritesRestaurants, nearbyRestaurants, quickBites, recentlyViewedRestaurants, section, trendingRestaurants]);

  const handleRestaurantPress = useCallback((id: string) => {
    if (Platform.OS !== "web") Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
    router.push(`/restaurant/${id}` as any);
  }, [router]);

  const headerCopy = getSectionCopy(section);

  return (
    <View style={{ flex: 1, backgroundColor: colors.background }}>
      <Stack.Screen options={{ headerShown: false }} />
      <SafeAreaView style={{ flex: 1 }} edges={["top"]}>
        <Animated.View
          entering={FadeIn.duration(280)}
          style={{
            flexDirection: "row",
            alignItems: "center",
            paddingHorizontal: 16,
            paddingTop: 6,
            paddingBottom: 12,
            borderBottomWidth: 1,
            borderBottomColor: colors.navBarBorder,
            gap: 10,
          }}
        >
          <Pressable
            onPress={() => router.back()}
            hitSlop={10}
            style={{ width: 38, height: 38, borderRadius: 19, alignItems: "center", justifyContent: "center", backgroundColor: colors.card, borderWidth: 1, borderColor: colors.cardBorder }}
          >
            <ArrowLeft size={18} color={colors.text} />
          </Pressable>
          <View style={{ flex: 1 }}>
            <Text style={{ fontFamily: "BricolageGrotesque_700Bold", color: colors.text, fontSize: 21 }}>
              {loading ? headerCopy.title : content.title}
            </Text>
            <Text style={{ fontFamily: "Manrope_500Medium", color: colors.textMuted, fontSize: 12, marginTop: 2 }}>
              {loading ? headerCopy.subtitle : content.subtitle}
            </Text>
          </View>
        </Animated.View>

        <ScrollView
          style={{ flex: 1 }}
          contentContainerStyle={{ padding: 16, paddingBottom: 34 }}
          refreshControl={
            <RefreshControl
              refreshing={refreshing}
              onRefresh={() => {
                setRefreshing(true);
                void fetchScreenData();
              }}
              tintColor="#FF9933"
              colors={["#FF9933"]}
            />
          }
        >
          {loading ? (
            <DiscoverLoadingSkeleton />
          ) : (
            <Animated.View entering={FadeIn.duration(320)}>
              {(isVegSortMode || isHalalSortMode) && (
                <Animated.View
                  entering={FadeInDown.delay(40).duration(380)}
                  style={{
                    backgroundColor: "rgba(26,26,26,0.95)",
                    borderRadius: 14,
                    borderWidth: 1,
                    borderColor: isVegSortMode ? "rgba(34,197,94,0.3)" : "rgba(96,165,250,0.35)",
                    paddingHorizontal: 12,
                    paddingVertical: 10,
                    flexDirection: "row",
                    alignItems: "center",
                    gap: 8,
                    marginBottom: 10,
                  }}
                >
                  {isVegSortMode ? (
                    <Leaf size={14} color="#22C55E" />
                  ) : (
                    <ShieldCheck size={14} color="#60A5FA" />
                  )}
                  <Text style={{ fontFamily: "Manrope_600SemiBold", color: "#f5f5f5", fontSize: 12, flex: 1 }}>
                    {isVegSortMode
                      ? "Vegetarian-friendly options are sorted first."
                      : "Halal-friendly options are sorted first."}
                  </Text>
                </Animated.View>
              )}

              {section === "nearby" && (
                <Animated.View entering={FadeInDown.delay(60).duration(380)} style={{ marginBottom: 10 }}>
                  <FilterBar
                    activeFilter={activeFilter}
                    onFilterChange={(filter) => {
                      if (Platform.OS !== "web") Haptics.selectionAsync();
                      setActiveFilter(filter);
                    }}
                  />
                </Animated.View>
              )}

              {content.rows.length === 0 ? (
                <Animated.Text
                  entering={FadeInDown.delay(80).duration(400)}
                  style={{ textAlign: "center", color: "#777", fontFamily: "Manrope_500Medium", marginTop: 24 }}
                >
                  Nothing to show right now.
                </Animated.Text>
              ) : (
                content.rows.map((restaurant, index) => (
                  <Animated.View
                    key={restaurant.id}
                    entering={FadeInDown.delay(70 + Math.min(index, 12) * 48).duration(420)}
                  >
                    <SectionRestaurantRow
                      restaurant={restaurant}
                      mediaSlides={restaurantMediaById[restaurant.id]}
                      onPress={() => handleRestaurantPress(restaurant.id)}
                      isTrending={section === "trending"}
                    />
                  </Animated.View>
                ))
              )}
            </Animated.View>
          )}
        </ScrollView>
      </SafeAreaView>
    </View>
  );
}
