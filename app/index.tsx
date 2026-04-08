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
  Animated as RNAnimated,
} from "react-native";
import { Swipeable } from "react-native-gesture-handler";
import { SafeAreaView } from "react-native-safe-area-context";
import { useRouter, useFocusEffect } from "expo-router";
import { Search, Bell, MapPin, TrendingUp, Zap, User, Map, UtensilsCrossed, ChevronRight, Users, Crown, X, RefreshCw, Sparkles, Clock, Heart, Megaphone, ClipboardList, ChefHat, ShoppingBag, CheckCircle, Trash2, Leaf, ShieldCheck } from "lucide-react-native";
import Animated, {
  FadeIn,
  FadeInDown,
  useAnimatedStyle,
  useSharedValue,
  withSpring,
  withTiming,
  runOnJS,
  interpolateColor,
} from "react-native-reanimated";
import * as Haptics from "expo-haptics";
import * as SecureStore from 'expo-secure-store';
import { HeroCard } from "@/components/HeroCard";
import { RestaurantListCard } from "@/components/RestaurantListCard";
import { FilterBar } from "@/components/FilterBar";
import { SearchOverlay } from "@/components/SearchOverlay";
import { type FilterType } from "@/data/mockData";
import { supabase } from "@/lib/supabase";
import { fetchBatchReviewStats } from "@/lib/review-stats";
import {
  type SupabaseRestaurant,
  type UIRestaurant,
  type OrderStatus,
  mapSupabaseToUI,
  haversineDistance,
  parseFavorites,
  deduplicateChains,
} from "@/lib/restaurant-types";
import { useLocation } from "@/lib/location-context";
import { useAdminMode } from "@/hooks/useAdminMode";
import { useAuth } from "@/lib/auth-context";
import { useNotifications } from "@/lib/notifications-context";
import { useClosedRestaurantIds } from "@/hooks/useClosedRestaurantIds";
import { usePersonalization } from "@/hooks/usePersonalization";
import { OwnerHomeContent } from "@/components/OwnerHomeContent";
import { BrandedLoader } from "@/components/BrandedLoader";

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

const LIVE_TRACK_STEPS: {
  label: string;
  Icon: React.ComponentType<{ size: number; color: string }>;
}[] = [
  { label: "Received", Icon: ClipboardList },
  { label: "Preparing", Icon: ChefHat },
  { label: "Ready", Icon: ShoppingBag },
  { label: "Served", Icon: CheckCircle },
];

function liveStepIndex(status: OrderStatus): number {
  if (status === "pending") return 0;
  if (status === "preparing") return 1;
  if (status === "ready") return 2;
  if (status === "served") return 3;
  return -1;
}

const HOME_LIVE_ORDER_DISMISSED_KEY = "rasvia_home-live-order-dismissed-ids_v1";
const HOME_WAITLIST_SEATED_DISMISSED_KEY = "rasvia_home-waitlist-seated-dismissed-entry-ids_v1";

/** Live order banner: Received → Preparing → Ready → Served (orange → blue → teal → green) */
const LIVE_ORDER_CARD_BG = [
  "rgba(249,115,22,0.09)",
  "rgba(59,130,246,0.09)",
  "rgba(20,184,166,0.09)",
  "rgba(34,197,94,0.09)",
];
const LIVE_ORDER_CARD_BORDER = [
  "rgba(249,115,22,0.32)",
  "rgba(59,130,246,0.32)",
  "rgba(20,184,166,0.32)",
  "rgba(34,197,94,0.32)",
];
const LIVE_ORDER_ICON_BG = [
  "rgba(249,115,22,0.16)",
  "rgba(59,130,246,0.16)",
  "rgba(20,184,166,0.16)",
  "rgba(34,197,94,0.16)",
];
const LIVE_ORDER_ICON_BORDER = [
  "#F97316",
  "#3B82F6",
  "#14B8A6",
  "#22C55E",
];
const LIVE_ORDER_ACCENT_SOLID = ["#F97316", "#3B82F6", "#14B8A6", "#22C55E"];

export default function DiscoveryFeed() {
  const router = useRouter();
  const { userCoords, locationLabel } = useLocation();
  const {
    isAdmin,
    isRestaurantOwner,
    effectiveOwnerRestaurantId,
    loading: roleLoading,
  } = useAdminMode();
  const { session } = useAuth();
  const { notificationBadgeCount } = useNotifications();
  const closedRestaurantIds = useClosedRestaurantIds();
  const [activeFilter, setActiveFilter] = useState<FilterType>("all");
  const [showSearch, setShowSearch] = useState(false);
  const [activeGroupOrder, setActiveGroupOrder] = useState<ActiveGroupOrder | null>(null);
  const [liveOrderTrack, setLiveOrderTrack] = useState<{
    id: string;
    restaurantName: string;
    status: OrderStatus;
  } | null>(null);
  const [liveWaitlistBanner, setLiveWaitlistBanner] = useState<{
    entryId: string;
    restaurantId: string;
    restaurantName: string;
    partySize: number;
    position: number;
    phase: "in_queue" | "table_ready" | "seated";
  } | null>(null);
  const [dismissedLiveOrderIds, setDismissedLiveOrderIds] = useState<Set<string>>(() => new Set());
  const [dismissedSeatedWaitlistEntryIds, setDismissedSeatedWaitlistEntryIds] = useState<Set<string>>(
    () => new Set()
  );
  const liveOrderSwipeRef = useRef<Swipeable>(null);
  const liveOrderTrackRef = useRef<typeof liveOrderTrack>(null);
  const dismissedLiveOrderIdsRef = useRef<Set<string>>(new Set());
  const liveOrderFadeOutRef = useRef(false);
  const bannerOpacity = useSharedValue(1);
  const liveColorProgress = useSharedValue(0);

  useEffect(() => {
    liveOrderTrackRef.current = liveOrderTrack;
  }, [liveOrderTrack]);

  useEffect(() => {
    dismissedLiveOrderIdsRef.current = dismissedLiveOrderIds;
  }, [dismissedLiveOrderIds]);

  useEffect(() => {
    if (!liveOrderTrack) return;
    const idx = liveStepIndex(liveOrderTrack.status);
    if (idx < 0) return;
    liveColorProgress.value = withTiming(idx, { duration: 550 });
  }, [liveOrderTrack?.status, liveOrderTrack?.id]);

  const liveOrderBannerOpacityStyle = useAnimatedStyle(() => ({
    opacity: bannerOpacity.value,
  }));

  const liveOrderCardSurfaceStyle = useAnimatedStyle(() => ({
    backgroundColor: interpolateColor(
      liveColorProgress.value,
      [0, 1, 2, 3],
      LIVE_ORDER_CARD_BG
    ),
    borderColor: interpolateColor(
      liveColorProgress.value,
      [0, 1, 2, 3],
      LIVE_ORDER_CARD_BORDER
    ),
  }));

  const liveOrderIconCircleStyle = useAnimatedStyle(() => ({
    backgroundColor: interpolateColor(
      liveColorProgress.value,
      [0, 1, 2, 3],
      LIVE_ORDER_ICON_BG
    ),
    borderColor: interpolateColor(
      liveColorProgress.value,
      [0, 1, 2, 3],
      LIVE_ORDER_ICON_BORDER
    ),
  }));

  useEffect(() => {
    (async () => {
      try {
        const raw = await SecureStore.getItemAsync(HOME_LIVE_ORDER_DISMISSED_KEY);
        if (raw) setDismissedLiveOrderIds(new Set(JSON.parse(raw) as string[]));
        const rawWl = await SecureStore.getItemAsync(HOME_WAITLIST_SEATED_DISMISSED_KEY);
        if (rawWl) setDismissedSeatedWaitlistEntryIds(new Set(JSON.parse(rawWl) as string[]));
      } catch {
        /* ignore */
      }
    })();
  }, []);

  const dismissLiveOrderBanner = useCallback((orderId: string) => {
    setDismissedLiveOrderIds((prev) => {
      const next = new Set(prev).add(orderId);
      void SecureStore.setItemAsync(HOME_LIVE_ORDER_DISMISSED_KEY, JSON.stringify([...next]));
      return next;
    });
  }, []);

  const dismissSeatedWaitlistBanner = useCallback((entryId: string) => {
    setDismissedSeatedWaitlistEntryIds((prev) => {
      const next = new Set(prev).add(entryId);
      void SecureStore.setItemAsync(HOME_WAITLIST_SEATED_DISMISSED_KEY, JSON.stringify([...next]));
      return next;
    });
  }, []);
  const personalization = usePersonalization();
  const [refreshing, setRefreshing] = useState(false);
  const [favoriteRestaurantIds, setFavoriteRestaurantIds] = useState<number[]>([]);
  const [announcementBanner, setAnnouncementBanner] = useState("");
  const [userDietaryType, setUserDietaryType] = useState("");
  const [userRestrictedDays, setUserRestrictedDays] = useState<string[]>([]);
  const [ownerHomeMode, setOwnerHomeMode] = useState<"discover" | "dashboard">("dashboard");

  // Owners see their dashboard inline — no redirect needed

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

  const fetchAnnouncementBanner = useCallback(async () => {
    try {
      const { data } = await supabase
        .from("system_config")
        .select("value")
        .eq("key", "announcement_banner")
        .single();
      setAnnouncementBanner((data as any)?.value ?? "");
    } catch {
      setAnnouncementBanner("");
    }
  }, []);

  useEffect(() => {
    fetchRestaurants();
    fetchAnnouncementBanner();

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

    const bannerSubscription = supabase
      .channel('system_config:announcement')
      .on(
        'postgres_changes',
        { event: '*', schema: 'public', table: 'system_config', filter: 'key=eq.announcement_banner' },
        (payload) => {
          setAnnouncementBanner((payload.new as any)?.value ?? "");
        }
      )
      .subscribe();

    return () => {
      supabase.removeChannel(subscription);
      supabase.removeChannel(bannerSubscription);
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

  const handleToggleFavorite = useCallback(async (restaurantId: number) => {
    const userId = session?.user?.id;
    if (!userId) return;
    const isFav = favoriteRestaurantIds.includes(restaurantId);
    let nextFavs: number[];
    if (isFav) {
      nextFavs = favoriteRestaurantIds.filter((id) => id !== restaurantId);
    } else {
      nextFavs = [...favoriteRestaurantIds, restaurantId];
    }
    
    // Optimistic UI update
    setFavoriteRestaurantIds(nextFavs);
    if (Platform.OS !== "web") Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);

    try {
      const { error } = await supabase
        .from("profiles")
        .update({ favorite_restaurants: nextFavs })
        .eq("id", userId);
      if (error) throw error;
    } catch (e) {
      // Revert if error
      setFavoriteRestaurantIds(favoriteRestaurantIds);
    }
  }, [session?.user?.id, favoriteRestaurantIds]);

  const fetchDietaryPreferences = useCallback(async () => {
    const userId = session?.user?.id;
    if (!userId) {
      setUserDietaryType("");
      setUserRestrictedDays([]);
      return;
    }
    try {
      const { data } = await supabase
        .from("profiles")
        .select("dietary_type, restricted_days")
        .eq("id", userId)
        .single();
      setUserDietaryType((data as any)?.dietary_type ?? "");
      setUserRestrictedDays(((data as any)?.restricted_days as string[]) ?? []);
    } catch {
      setUserDietaryType("");
      setUserRestrictedDays([]);
    }
  }, [session?.user?.id]);

  useEffect(() => {
    fetchDietaryPreferences();
  }, [fetchDietaryPreferences]);

  useEffect(() => {
    if (!isRestaurantOwner && !isAdmin) return;
    SecureStore.getItemAsync("rasvia_owner-home-mode_v1")
      .then((saved) => {
        if (saved === "discover" || saved === "dashboard") {
          setOwnerHomeMode(saved);
        }
      })
      .catch(() => {
        // ignore
      });
  }, [isRestaurantOwner, isAdmin]);

  const setOwnerMode = useCallback((mode: "discover" | "dashboard") => {
    setOwnerHomeMode(mode);
    void SecureStore.setItemAsync("rasvia_owner-home-mode_v1", mode);
  }, []);


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
        // Overlay live review stats (count + average) from restaurant_reviews
        const ids = uiRestaurants.map((r) => r.id);
        const statsMap = await fetchBatchReviewStats(ids);
        setRestaurants(uiRestaurants.map((r) => {
          const s = statsMap.get(r.id);
          if (!s) return r;
          return { ...r, rating: s.average, reviewCount: s.count };
        }));
      }
    } catch (error) {
      console.error('Error fetching restaurants:', error);
    } finally {
      setLoading(false);
    }
  }

  const currentUserId = session?.user?.id;
  const activeOrderKey = currentUserId
    ? `rasvia_active_group_order_${currentUserId}`
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
              if (activeOrderKey) await SecureStore.deleteItemAsync(activeOrderKey);
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
      const stored = await SecureStore.getItemAsync(activeOrderKey);
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
        await SecureStore.deleteItemAsync(activeOrderKey);
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
        await SecureStore.setItemAsync(activeOrderKey, JSON.stringify(order));
        setActiveGroupOrder(order);
        return;
      }

      setActiveGroupOrder(null);
    } catch {
      setActiveGroupOrder(null);
    }
  }, [currentUserId, activeOrderKey]);

  const fetchLiveOrder = useCallback(async () => {
    if (!currentUserId) {
      liveOrderFadeOutRef.current = false;
      bannerOpacity.value = 1;
      setLiveOrderTrack(null);
      return;
    }
    try {
      const { data, error } = await supabase
        .from("orders")
        .select("id, status, restaurants(name)")
        .eq("created_by", currentUserId)
        .in("status", ["pending", "preparing", "ready", "served"])
        .order("created_at", { ascending: false })
        .limit(1);

      const row = data?.[0];
      if (error || !row) {
        const prev = liveOrderTrackRef.current;
        const dismissed = dismissedLiveOrderIdsRef.current;
        if (prev && !dismissed.has(prev.id) && !liveOrderFadeOutRef.current) {
          liveOrderFadeOutRef.current = true;
          bannerOpacity.value = withTiming(0, { duration: 620 }, (finished) => {
            if (finished) {
              runOnJS(() => {
                setLiveOrderTrack(null);
                bannerOpacity.value = 1;
                liveOrderFadeOutRef.current = false;
              })();
            }
          });
        } else if (!liveOrderFadeOutRef.current) {
          liveOrderFadeOutRef.current = false;
          bannerOpacity.value = 1;
          setLiveOrderTrack(null);
        }
        return;
      }

      liveOrderFadeOutRef.current = false;
      bannerOpacity.value = 1;
      setLiveOrderTrack({
        id: String(row.id),
        restaurantName: (row.restaurants as { name?: string } | null)?.name ?? "Restaurant",
        status: row.status as OrderStatus,
      });
    } catch {
      const prev = liveOrderTrackRef.current;
      const dismissed = dismissedLiveOrderIdsRef.current;
      if (prev && !dismissed.has(prev.id) && !liveOrderFadeOutRef.current) {
        liveOrderFadeOutRef.current = true;
        bannerOpacity.value = withTiming(0, { duration: 620 }, (finished) => {
          if (finished) {
            runOnJS(() => {
              setLiveOrderTrack(null);
              bannerOpacity.value = 1;
              liveOrderFadeOutRef.current = false;
            })();
          }
        });
      } else if (!liveOrderFadeOutRef.current) {
        liveOrderFadeOutRef.current = false;
        bannerOpacity.value = 1;
        setLiveOrderTrack(null);
      }
    }
  }, [currentUserId]);

  const fetchLiveWaitlist = useCallback(async () => {
    if (!currentUserId) {
      setLiveWaitlistBanner(null);
      return;
    }
    try {
      const { data, error } = await supabase
        .from("waitlist_entries")
        .select("id, party_size, restaurant_id, created_at, notified_at, status, restaurants(name)")
        .eq("user_id", currentUserId)
        .in("status", ["waiting", "seated"])
        .order("created_at", { ascending: false })
        .limit(1);

      const row = data?.[0];
      if (error || !row) {
        setLiveWaitlistBanner(null);
        return;
      }

      const status = String(row.status ?? "");
      let phase: "in_queue" | "table_ready" | "seated";
      if (status === "seated") {
        phase = "seated";
      } else if (row.notified_at) {
        phase = "table_ready";
      } else {
        phase = "in_queue";
      }

      let position = 1;
      if (phase === "in_queue") {
        const rid = row.restaurant_id;
        const createdAt = row.created_at;
        const { count: ahead } = await supabase
          .from("waitlist_entries")
          .select("*", { count: "exact", head: true })
          .eq("restaurant_id", rid)
          .eq("status", "waiting")
          .lt("created_at", createdAt);
        position = (ahead ?? 0) + 1;
      }

      setLiveWaitlistBanner({
        entryId: String(row.id),
        restaurantId: String(row.restaurant_id),
        restaurantName: (row.restaurants as { name?: string } | null)?.name ?? "Restaurant",
        partySize: row.party_size,
        position,
        phase,
      });
    } catch {
      setLiveWaitlistBanner(null);
    }
  }, [currentUserId]);

  useEffect(() => {
    if (!currentUserId) {
      liveOrderFadeOutRef.current = false;
      bannerOpacity.value = 1;
      setLiveOrderTrack(null);
      return;
    }
    void fetchLiveOrder();
    const ch = supabase
      .channel(`home-live-order:${currentUserId}`)
      .on(
        "postgres_changes",
        {
          event: "*",
          schema: "public",
          table: "orders",
          filter: `created_by=eq.${currentUserId}`,
        },
        () => {
          void fetchLiveOrder();
        }
      )
      .subscribe();
    return () => {
      supabase.removeChannel(ch);
    };
  }, [currentUserId, fetchLiveOrder]);

  useEffect(() => {
    if (!currentUserId) {
      setLiveWaitlistBanner(null);
      return;
    }
    void fetchLiveWaitlist();
    const ch = supabase
      .channel(`home-waitlist:${currentUserId}`)
      .on(
        "postgres_changes",
        {
          event: "*",
          schema: "public",
          table: "waitlist_entries",
          filter: `user_id=eq.${currentUserId}`,
        },
        () => {
          void fetchLiveWaitlist();
        }
      )
      .subscribe();
    return () => {
      supabase.removeChannel(ch);
    };
  }, [currentUserId, fetchLiveWaitlist]);

  // Extra subscription on the active entry so notified_at / status updates from the dashboard always refetch (Realtime filter nuances).
  useEffect(() => {
    const eid = liveWaitlistBanner?.entryId;
    if (!eid || !currentUserId) return;
    const ch = supabase
      .channel(`home-waitlist-entry:${eid}`)
      .on(
        "postgres_changes",
        {
          event: "UPDATE",
          schema: "public",
          table: "waitlist_entries",
          filter: `id=eq.${eid}`,
        },
        () => {
          void fetchLiveWaitlist();
        }
      )
      .subscribe();
    return () => {
      supabase.removeChannel(ch);
    };
  }, [liveWaitlistBanner?.entryId, currentUserId, fetchLiveWaitlist]);

  useFocusEffect(
    useCallback(() => {
      checkActiveGroupOrder();
      fetchFavoriteRestaurantIds();
      void fetchLiveOrder();
      void fetchLiveWaitlist();
    }, [checkActiveGroupOrder, fetchFavoriteRestaurantIds, fetchLiveOrder, fetchLiveWaitlist])
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
  const availabilityRank = (r: UIRestaurant) => {
    if (r.isComingSoon) return 1;
    if (r.waitStatus === "darkgrey") return 2;
    return 0;
  };

  const filteredRestaurants = restaurantsWithHoursStatus.filter((r) => {
    if (!isAdmin && !r.isEnabled) return false;
    if (r.waitStatus === 'darkgrey') return false; // always exclude closed restaurants from Nearby
    if (r.isComingSoon && activeFilter !== "all") return false;
    if (activeFilter === "all") return true;
    return r.waitStatus === activeFilter;
  });

  const parseDist = (d: string) => parseFloat(d) || 9999;
  const lower = (v: string) => v.trim().toLowerCase();
  const todayName = new Date().toLocaleDateString("en-US", {
    timeZone: "America/Chicago",
    weekday: "short",
  });
  const isVegSortMode =
    userDietaryType === "Vegetarian" ||
    (userDietaryType === "Non-Veg" && userRestrictedDays.includes(todayName));
  const isHalalSortMode = userDietaryType === "Halal";

  const dietarySortScore = (restaurant: UIRestaurant) => {
    const tags = (restaurant.tags ?? []).map(lower);
    const hasVegetarianTag = tags.some(
      (t) => t.includes("vegetarian") || t.includes("vegan") || t === "veg"
    );
    const hasHalalTag = tags.some((t) => t.includes("halal"));
    const explicitAllHalal = tags.some(
      (t) =>
        t.includes("all halal") ||
        t.includes("100% halal") ||
        t.includes("fully halal") ||
        t.includes("only halal")
    );
    const hasNonHalalHint = tags.some(
      (t) =>
        t.includes("non-halal") ||
        t.includes("non halal") ||
        t.includes("pork") ||
        t.includes("alcohol") ||
        t.includes("beer") ||
        t.includes("wine")
    );

    if (isVegSortMode) return hasVegetarianTag ? 2 : -2;
    if (isHalalSortMode) {
      if (explicitAllHalal && !hasNonHalalHint) return 3;
      if (hasHalalTag) return 1;
      if (hasNonHalalHint) return -3;
      return -1;
    }
    return 0;
  };

  const nearbyRestaurants = deduplicateChains(
    [...filteredRestaurants].sort((a, b) => {
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
    })
  );

  const trendingRestaurants = deduplicateChains(
    restaurantsWithHoursStatus
      .filter((r) => (isAdmin || r.isEnabled) && !r.isComingSoon && r.waitStatus !== "darkgrey" && r.waitStatus !== "grey")
      .sort((a, b) => {
        const scoreDelta = dietarySortScore(b) - dietarySortScore(a);
        if (scoreDelta !== 0) return scoreDelta;
        return (a.waitTime ?? 9999) - (b.waitTime ?? 9999);
      })
  ).slice(0, 3);

  const quickBites = deduplicateChains(
    restaurantsWithHoursStatus
      .filter((r) => (isAdmin || r.isEnabled) && !r.isComingSoon && r.waitStatus === "green")
      .sort((a, b) => {
        const scoreDelta = dietarySortScore(b) - dietarySortScore(a);
        if (scoreDelta !== 0) return scoreDelta;
        return parseDist(a.distance) - parseDist(b.distance);
      })
  );

  const favoritesRestaurants = restaurantsWithHoursStatus
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

  const openDiscoverSection = useCallback((section: "trending" | "favorites" | "nearby" | "quick-bites") => {
    if (Platform.OS !== "web") {
      Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
    }
    if (section === "nearby") {
      router.push(`/discover/${section}?filter=${activeFilter}` as any);
      return;
    }
    router.push(`/discover/${section}` as any);
  }, [activeFilter, router]);

  const isOwnerDashboardMode =
    (isRestaurantOwner || isAdmin) && ownerHomeMode === "dashboard";
  const shouldShowFeedLoader =
    roleLoading ||
    (((!isRestaurantOwner && !isAdmin) || ownerHomeMode === "discover") && loading);

  if (shouldShowFeedLoader) {
    return <BrandedLoader message="Loading your feed..." />;
  }

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
                if (Platform.OS !== "web") Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
                if (isOwnerDashboardMode && effectiveOwnerRestaurantId) {
                  router.push(`/restaurant/${effectiveOwnerRestaurantId}` as any);
                } else {
                  setShowSearch(true);
                }
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
              {isOwnerDashboardMode
                ? <UtensilsCrossed size={20} color="#f5f5f5" />
                : <Search size={20} color="#f5f5f5" />
              }
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
              {notificationBadgeCount > 0 && (
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
                    paddingHorizontal: notificationBadgeCount > 9 ? 3 : 0,
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
                    {notificationBadgeCount > 9 ? "9+" : notificationBadgeCount}
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

        {(isRestaurantOwner || isAdmin) && (
          <View style={{ paddingHorizontal: 20, paddingTop: 8, paddingBottom: 8 }}>
            <View style={{
              backgroundColor: "#141414",
              borderWidth: 1,
              borderColor: "#2a2a2a",
              borderRadius: 14,
              padding: 4,
              flexDirection: "row",
              alignItems: "center",
            }}>
              {(["dashboard", "discover"] as const).map((mode) => {
                const active = ownerHomeMode === mode;
                return (
                  <Pressable
                    key={mode}
                    onPress={() => {
                      if (Platform.OS !== "web") Haptics.selectionAsync();
                      setOwnerMode(mode);
                    }}
                    style={{
                      flex: 1,
                      borderRadius: 10,
                      paddingVertical: 10,
                      alignItems: "center",
                      backgroundColor: active ? "rgba(255,153,51,0.14)" : "transparent",
                      borderWidth: active ? 1 : 0,
                      borderColor: active ? "rgba(255,153,51,0.35)" : "transparent",
                    }}
                  >
                    <Text style={{
                      fontFamily: active ? "Manrope_700Bold" : "Manrope_600SemiBold",
                      fontSize: 12,
                      color: active ? "#FF9933" : "#888",
                    }}>
                      {mode === "discover" ? "Discover" : "Owner Dashboard"}
                    </Text>
                  </Pressable>
                );
              })}
            </View>
          </View>
        )}

        <View style={{ flex: 1 }}>
          {(isRestaurantOwner || isAdmin) && (
            <View
              style={isOwnerDashboardMode ? { flex: 1 } : { height: 0, opacity: 0 }}
              pointerEvents={isOwnerDashboardMode ? "auto" : "none"}
            >
              <OwnerHomeContent
                refreshing={refreshing}
                onRefreshSignal={() => {
                  if (Platform.OS !== "web") Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
                  setRefreshing(true);
                  setTimeout(() => setRefreshing(false), 1500);
                }}
              />
            </View>
          )}
          {(!isOwnerDashboardMode || (!isRestaurantOwner && !isAdmin)) && (
        <ScrollView
          style={{ flex: 1 }}
          showsVerticalScrollIndicator={false}
          contentContainerStyle={{ paddingBottom: 100 }}
          refreshControl={
            <RefreshControl
              refreshing={refreshing}
              onRefresh={() => {
                if (Platform.OS !== "web") Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
                setRefreshing(true);
                setLiveOrderTrack(null);
                Promise.all([
                  fetchRestaurants(),
                  fetchFavoriteRestaurantIds(),
                  fetchDietaryPreferences(),
                  fetchAnnouncementBanner(),
                  fetchLiveOrder(),
                  fetchLiveWaitlist(),
                ]).finally(() => setRefreshing(false));
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

          {/* Announcement Banner */}
          {!!announcementBanner && (
            <Animated.View entering={FadeInDown.duration(400)} style={{ paddingHorizontal: 16, paddingTop: 12, paddingBottom: 4 }}>
              <View style={{
                backgroundColor: "rgba(255,153,51,0.08)",
                borderRadius: 16,
                borderWidth: 1,
                borderColor: "rgba(255,153,51,0.25)",
                padding: 14,
                flexDirection: "row",
                alignItems: "center",
                gap: 12,
              }}>
                <View style={{
                  width: 36, height: 36, borderRadius: 18,
                  backgroundColor: "rgba(255,153,51,0.15)",
                  alignItems: "center", justifyContent: "center",
                }}>
                  <Megaphone size={18} color="#FF9933" />
                </View>
                <Text style={{
                  fontFamily: "Manrope_600SemiBold",
                  color: "#f5f5f5",
                  fontSize: 14,
                  flex: 1,
                  lineHeight: 20,
                }}>
                  {announcementBanner}
                </Text>
              </View>
            </Animated.View>
          )}

          {(isVegSortMode || isHalalSortMode) && (
            <Animated.View entering={FadeInDown.duration(350)} style={{ paddingHorizontal: 16, paddingTop: 8, paddingBottom: 2 }}>
              <View style={{
                backgroundColor: "rgba(26,26,26,0.95)",
                borderRadius: 14,
                borderWidth: 1,
                borderColor: isVegSortMode ? "rgba(34,197,94,0.3)" : "rgba(96,165,250,0.35)",
                paddingHorizontal: 12,
                paddingVertical: 10,
                flexDirection: "row",
                alignItems: "center",
                gap: 8,
              }}>
                {isVegSortMode ? (
                  <Leaf size={14} color="#22C55E" />
                ) : (
                  <ShieldCheck size={14} color="#60A5FA" />
                )}
                <View style={{ flex: 1 }}>
                  <Text style={{ fontFamily: "Manrope_600SemiBold", color: "#f5f5f5", fontSize: 12 }}>
                    {isVegSortMode
                      ? "Sorted for vegetarian-friendly options first."
                      : "Sorted for halal-friendly options first."}
                  </Text>
                </View>
              </View>
            </Animated.View>
          )}

          {/* Live order tracker — directly above Trending (swipe left → remove to hide) */}
          {liveOrderTrack &&
            liveStepIndex(liveOrderTrack.status) >= 0 &&
            !dismissedLiveOrderIds.has(liveOrderTrack.id) && (
            <Animated.View entering={FadeInDown.duration(400)} style={{ paddingHorizontal: 16, paddingTop: 12, paddingBottom: 4 }}>
              <Animated.View style={liveOrderBannerOpacityStyle}>
              <Swipeable
                ref={liveOrderSwipeRef}
                overshootRight={false}
                friction={2}
                renderRightActions={(
                  _progress: RNAnimated.AnimatedInterpolation<number>,
                  dragX: RNAnimated.AnimatedInterpolation<number>
                ) => {
                  const scale = dragX.interpolate({
                    inputRange: [-80, 0],
                    outputRange: [1, 0.6],
                    extrapolate: "clamp",
                  });
                  return (
                    <RNAnimated.View
                      style={{
                        width: 72,
                        alignItems: "center",
                        justifyContent: "center",
                        transform: [{ scale }],
                      }}
                    >
                      <Pressable
                        onPress={() => {
                          if (Platform.OS !== "web") Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
                          liveOrderSwipeRef.current?.close();
                          dismissLiveOrderBanner(liveOrderTrack.id);
                        }}
                        style={{
                          width: 44,
                          height: 44,
                          borderRadius: 22,
                          backgroundColor: "#EF444420",
                          borderWidth: 1,
                          borderColor: "#EF444440",
                          alignItems: "center",
                          justifyContent: "center",
                        }}
                      >
                        <Trash2 size={18} color="#EF4444" />
                      </Pressable>
                    </RNAnimated.View>
                  );
                }}
              >
                <Pressable
                  onPress={() => {
                    if (Platform.OS !== "web") Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Medium);
                    router.push("/my-orders" as any);
                  }}
                >
                  <Animated.View
                    style={[
                      liveOrderCardSurfaceStyle,
                      {
                        borderRadius: 20,
                        borderWidth: 1.5,
                        padding: 16,
                        flexDirection: "row",
                        alignItems: "center",
                        gap: 14,
                      },
                    ]}
                  >
                  <Animated.View
                    style={[
                      liveOrderIconCircleStyle,
                      {
                        width: 48,
                        height: 48,
                        borderRadius: 24,
                        borderWidth: 2,
                        alignItems: "center",
                        justifyContent: "center",
                      },
                    ]}
                  >
                    <UtensilsCrossed
                      size={22}
                      color={LIVE_ORDER_ACCENT_SOLID[liveStepIndex(liveOrderTrack.status)] ?? LIVE_ORDER_ACCENT_SOLID[0]}
                    />
                  </Animated.View>
                  <View style={{ flex: 1 }}>
                    <View style={{ flexDirection: "row", alignItems: "center", gap: 6, marginBottom: 4 }}>
                      <View
                        style={{
                          width: 8,
                          height: 8,
                          borderRadius: 4,
                          backgroundColor:
                            LIVE_ORDER_ACCENT_SOLID[liveStepIndex(liveOrderTrack.status)] ?? LIVE_ORDER_ACCENT_SOLID[0],
                        }}
                      />
                      <Text
                        style={{
                          fontFamily: "Manrope_600SemiBold",
                          color:
                            LIVE_ORDER_ACCENT_SOLID[liveStepIndex(liveOrderTrack.status)] ?? LIVE_ORDER_ACCENT_SOLID[0],
                          fontSize: 11,
                          letterSpacing: 0.5,
                          textTransform: "uppercase",
                        }}
                      >
                        Live order
                      </Text>
                    </View>
                    <Text
                      style={{
                        fontFamily: "BricolageGrotesque_700Bold",
                        color: "#f5f5f5",
                        fontSize: 16,
                        letterSpacing: -0.2,
                      }}
                      numberOfLines={1}
                    >
                      {liveOrderTrack.restaurantName}
                    </Text>
                    <View style={{ flexDirection: "row", alignItems: "center", marginTop: 10, gap: 4 }}>
                      {LIVE_TRACK_STEPS.map((step, idx) => {
                        const cur = liveStepIndex(liveOrderTrack.status);
                        const done = idx < cur;
                        const active = idx === cur;
                        const accent = LIVE_ORDER_ACCENT_SOLID[idx] ?? "#555";
                        const dim = "#333";
                        const StepIcon = step.Icon;
                        const lineColor = cur >= idx ? LIVE_ORDER_ACCENT_SOLID[idx - 1] ?? dim : dim;
                        return (
                          <React.Fragment key={step.label}>
                            {idx > 0 && (
                              <View
                                style={{
                                  width: 12,
                                  height: 2,
                                  backgroundColor: lineColor,
                                  borderRadius: 1,
                                }}
                              />
                            )}
                            <View style={{ alignItems: "center", minWidth: 56 }}>
                              <View
                                style={{
                                  width: active ? 30 : 26,
                                  height: active ? 30 : 26,
                                  borderRadius: 15,
                                  backgroundColor:
                                    done || active
                                      ? `${accent}22`
                                      : "#1a1a1a",
                                  borderWidth: 1,
                                  borderColor: done || active ? accent : "#333",
                                  alignItems: "center",
                                  justifyContent: "center",
                                }}
                              >
                                <StepIcon
                                  size={active ? 14 : 12}
                                  color={done || active ? accent : "#555"}
                                />
                              </View>
                              <Text
                                style={{
                                  fontFamily: active ? "Manrope_700Bold" : "Manrope_500Medium",
                                  fontSize: 9,
                                  color: active ? accent : done ? "#888" : "#444",
                                  marginTop: 4,
                                  textAlign: "center",
                                }}
                                numberOfLines={1}
                              >
                                {step.label}
                              </Text>
                            </View>
                          </React.Fragment>
                        );
                      })}
                    </View>
                  </View>
                  <View style={{ marginTop: -15, justifyContent: "center" }}>
                    <ChevronRight
                      size={20}
                      color={
                        LIVE_ORDER_ACCENT_SOLID[liveStepIndex(liveOrderTrack.status)] ?? LIVE_ORDER_ACCENT_SOLID[0]
                      }
                    />
                  </View>
                  </Animated.View>
                </Pressable>
              </Swipeable>
              </Animated.View>
            </Animated.View>
          )}

          {/* Active waitlist — queue / table ready / seated (syncs when staff updates from web) */}
          {liveWaitlistBanner &&
            !(liveWaitlistBanner.phase === "seated" && dismissedSeatedWaitlistEntryIds.has(liveWaitlistBanner.entryId)) &&
            (() => {
            const wl = liveWaitlistBanner;
            const isReady = wl.phase === "table_ready";
            const isSeated = wl.phase === "seated";
            const accent = isReady || isSeated ? "#22C55E" : "#FF9933";
            const cardBg = isReady || isSeated ? "rgba(34,197,94,0.09)" : "rgba(255,153,51,0.08)";
            const cardBorder = isReady || isSeated ? "rgba(34,197,94,0.3)" : "rgba(255,153,51,0.28)";
            const iconBg = isReady || isSeated ? "rgba(34,197,94,0.16)" : "rgba(255,153,51,0.15)";
            const kicker =
              isSeated ? "Seated" : isReady ? "Table ready" : "Waitlist";
            const kickerUpper = kicker.toUpperCase();
            const waitlistCardStyle = {
              backgroundColor: cardBg,
              borderRadius: 20,
              borderWidth: 1.5,
              borderColor: cardBorder,
              padding: 16,
              flexDirection: "row" as const,
              alignItems: "center" as const,
              gap: 14,
            };
            const miniStatBox = {
              alignItems: "center" as const,
              paddingVertical: 10,
              paddingHorizontal: 12,
              backgroundColor: "#1a1a1a",
              borderRadius: 16,
              borderWidth: 1,
              borderColor: "#2a2a2a",
            };
            const cardBody = (
              <>
                <View
                  style={{
                    width: 48,
                    height: 48,
                    borderRadius: 24,
                    backgroundColor: iconBg,
                    borderWidth: 2,
                    borderColor: accent,
                    alignItems: "center",
                    justifyContent: "center",
                  }}
                >
                  {isReady ? (
                    <Bell size={22} color={accent} />
                  ) : isSeated ? (
                    <CheckCircle size={22} color={accent} />
                  ) : (
                    <Users size={22} color={accent} />
                  )}
                </View>
                <View style={{ flex: 1, minWidth: 0 }}>
                  <View style={{ flexDirection: "row", alignItems: "center", gap: 6, marginBottom: 4 }}>
                    <View style={{ width: 8, height: 8, borderRadius: 4, backgroundColor: accent }} />
                    <Text
                      style={{
                        fontFamily: "Manrope_600SemiBold",
                        color: accent,
                        fontSize: 11,
                        letterSpacing: 0.5,
                        textTransform: "uppercase",
                      }}
                    >
                      {kickerUpper}
                    </Text>
                  </View>
                  <Text
                    style={{
                      fontFamily: "BricolageGrotesque_700Bold",
                      color: "#f5f5f5",
                      fontSize: 16,
                      letterSpacing: -0.2,
                    }}
                    numberOfLines={1}
                  >
                    {wl.restaurantName}
                  </Text>
                  {(isReady || isSeated) && (
                    <Text
                      style={{
                        fontFamily: "Manrope_500Medium",
                        color: "#888888",
                        fontSize: 12,
                        marginTop: 4,
                      }}
                      numberOfLines={2}
                    >
                      {isReady
                        ? "Your table is ready — check in with the host."
                        : "You're seated. Bon appétit!"}
                    </Text>
                  )}
                </View>
                {wl.phase === "in_queue" ? (
                  <View style={miniStatBox}>
                    <View style={{ flexDirection: "row", alignItems: "center" }}>
                      <Users size={13} color={accent} />
                      <Text
                        style={{
                          fontFamily: "JetBrainsMono_600SemiBold",
                          color: "#f5f5f5",
                          fontSize: 16,
                          marginLeft: 4,
                        }}
                      >
                        #{wl.position}
                      </Text>
                    </View>
                    <Text
                      style={{
                        fontFamily: "Manrope_500Medium",
                        color: "#999999",
                        fontSize: 11,
                        marginTop: 3,
                      }}
                    >
                      in queue
                    </Text>
                  </View>
                ) : isReady ? (
                  <View style={miniStatBox}>
                    <Bell size={20} color={accent} />
                    <Text
                      style={{
                        fontFamily: "Manrope_600SemiBold",
                        color: "#22C55E",
                        fontSize: 12,
                        marginTop: 6,
                        textAlign: "center",
                      }}
                    >
                      See host
                    </Text>
                  </View>
                ) : (
                  <Pressable
                    onPress={() => {
                      if (Platform.OS !== "web") Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
                      dismissSeatedWaitlistBanner(wl.entryId);
                    }}
                    hitSlop={10}
                    style={{
                      width: 44,
                      height: 44,
                      borderRadius: 22,
                      backgroundColor: "#EF444420",
                      borderWidth: 1,
                      borderColor: "#EF444440",
                      alignItems: "center",
                      justifyContent: "center",
                    }}
                  >
                    <Trash2 size={18} color="#EF4444" />
                  </Pressable>
                )}
                {!isSeated && (
                  <View style={{ marginTop: -15, justifyContent: "center" }}>
                    <ChevronRight size={20} color={accent} />
                  </View>
                )}
              </>
            );
            return (
            <Animated.View entering={FadeInDown.duration(400)} style={{ paddingHorizontal: 16, paddingTop: 12, paddingBottom: 4 }}>
              {isSeated ? (
                <View style={waitlistCardStyle}>{cardBody}</View>
              ) : (
                <Pressable
                  onPress={() => {
                    if (Platform.OS !== "web") Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Medium);
                    router.push(
                      `/waitlist/${wl.restaurantId}?entry_id=${wl.entryId}&party_size=${wl.partySize}` as any
                    );
                  }}
                  style={waitlistCardStyle}
                >
                  {cardBody}
                </Pressable>
              )}
            </Animated.View>
            );
          })()}

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
                  <View className="flex-row items-center justify-between mb-1">
                    <View className="flex-row items-center">
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
                    <Pressable
                      onPress={() => openDiscoverSection("trending")}
                      style={{
                        width: 36,
                        height: 36,
                        borderRadius: 18,
                        backgroundColor: "#242424",
                        borderWidth: 1,
                        borderColor: "#333",
                        alignItems: "center",
                        justifyContent: "center",
                      }}
                    >
                      <ChevronRight size={18} color="#f5f5f5" />
                    </Pressable>
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
                    isFavorite={favoriteRestaurantIds.includes(Number(restaurant.id))}
                    onToggleFavorite={(e) => handleToggleFavorite(Number(restaurant.id))}
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
                  <View className="flex-row items-center justify-between mb-1">
                    <View className="flex-row items-center">
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
                    <Pressable
                      onPress={() => openDiscoverSection("favorites")}
                      style={{
                        width: 36,
                        height: 36,
                        borderRadius: 18,
                        backgroundColor: "#242424",
                        borderWidth: 1,
                        borderColor: "#333",
                        alignItems: "center",
                        justifyContent: "center",
                      }}
                    >
                      <ChevronRight size={18} color="#f5f5f5" />
                    </Pressable>
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
                decelerationRate="fast"
                snapToInterval={212}
                snapToAlignment="start"
                removeClippedSubviews={false}
                initialNumToRender={Math.min(8, Math.max(4, favoritesRestaurants.length))}
                renderItem={({ item: restaurant, index }) => (
                  <RestaurantListCard
                    restaurant={restaurant}
                    index={index}
                    onPress={() => handleRestaurantPress(restaurant.id)}
                    isFavorite={favoriteRestaurantIds.includes(Number(restaurant.id))}
                    onToggleFavorite={(e) => handleToggleFavorite(Number(restaurant.id))}
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
                  <View style={{ flexDirection: "row", alignItems: "center", justifyContent: "space-between" }}>
                    <Text
                      style={{
                        fontFamily: "BricolageGrotesque_800ExtraBold",
                        color: "#f5f5f5",
                        fontSize: 24,
                      }}
                    >
                      Nearby
                    </Text>
                    <Pressable
                      onPress={() => openDiscoverSection("nearby")}
                      style={{
                        width: 36,
                        height: 36,
                        borderRadius: 18,
                        backgroundColor: "#242424",
                        borderWidth: 1,
                        borderColor: "#333",
                        alignItems: "center",
                        justifyContent: "center",
                      }}
                    >
                      <ChevronRight size={18} color="#f5f5f5" />
                    </Pressable>
                  </View>
                  <Text
                    style={{
                      fontFamily: "Manrope_500Medium",
                      color: "#999999",
                      fontSize: 14,
                      marginTop: 2,
                    }}
                  >
                    {isVegSortMode
                      ? "Vegetarian-friendly spots prioritized"
                      : isHalalSortMode
                        ? "Halal-friendly spots prioritized"
                        : "Filter by wait time"}
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
                decelerationRate="fast"
                snapToInterval={212}
                snapToAlignment="start"
                renderItem={({ item: restaurant, index }) => (
                  <RestaurantListCard
                    restaurant={restaurant}
                    index={index}
                    onPress={() => handleRestaurantPress(restaurant.id)}
                    isFavorite={favoriteRestaurantIds.includes(Number(restaurant.id))}
                    onToggleFavorite={(e) => handleToggleFavorite(Number(restaurant.id))}
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
                  <View className="flex-row items-center justify-between mb-1">
                    <View className="flex-row items-center">
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
                    <Pressable
                      onPress={() => openDiscoverSection("quick-bites")}
                      style={{
                        width: 36,
                        height: 36,
                        borderRadius: 18,
                        backgroundColor: "#242424",
                        borderWidth: 1,
                        borderColor: "#333",
                        alignItems: "center",
                        justifyContent: "center",
                      }}
                    >
                      <ChevronRight size={18} color="#f5f5f5" />
                    </Pressable>
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

              <FlatList
                horizontal
                data={quickBites}
                keyExtractor={(r) => `quick-${r.id}`}
                showsHorizontalScrollIndicator={false}
                contentContainerStyle={{ paddingHorizontal: 20, paddingBottom: 4 }}
                decelerationRate="fast"
                snapToInterval={212}
                snapToAlignment="start"
                renderItem={({ item: restaurant, index }) => (
                  <RestaurantListCard
                    key={restaurant.id}
                    restaurant={restaurant}
                    index={index}
                    onPress={() => handleRestaurantPress(restaurant.id)}
                    isFavorite={favoriteRestaurantIds.includes(Number(restaurant.id))}
                    onToggleFavorite={(e) => handleToggleFavorite(Number(restaurant.id))}
                  />
                )}
              />
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
                          if (restaurant.waitStatus === 'darkgrey') return;
                          if (Platform.OS !== "web") Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
                          const orderId = lastOrder?.orderId;
                          router.push(`/restaurant/${restaurant.id}${orderId ? `?reorder=${orderId}` : ''}` as any);
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
                          {restaurant.isComingSoon ? (
                            <View style={{ backgroundColor: "rgba(100,100,100,0.12)", borderRadius: 8, borderWidth: 1, borderColor: "rgba(100,100,100,0.2)", paddingHorizontal: 8, paddingVertical: 4 }}>
                              <Text style={{ fontFamily: "Manrope_700Bold", color: "#7a7a7a", fontSize: 11 }}>Coming soon</Text>
                            </View>
                          ) : restaurant.waitStatus === 'darkgrey' ? (
                            <View style={{ backgroundColor: "rgba(100,100,100,0.12)", borderRadius: 8, borderWidth: 1, borderColor: "rgba(100,100,100,0.2)", paddingHorizontal: 8, paddingVertical: 4 }}>
                              <Text style={{ fontFamily: "Manrope_700Bold", color: "#555", fontSize: 11 }}>Closed</Text>
                            </View>
                          ) : (
                            <View style={{ backgroundColor: "rgba(255,153,51,0.1)", borderRadius: 8, borderWidth: 1, borderColor: "rgba(255,153,51,0.25)", paddingHorizontal: 8, paddingVertical: 4 }}>
                              <Text style={{ fontFamily: "Manrope_700Bold", color: "#FF9933", fontSize: 11 }}>Order Again →</Text>
                            </View>
                          )}
                          {restaurant.isComingSoon ? (
                            <Text style={{ fontFamily: "Manrope_600SemiBold", color: "#666", fontSize: 11 }}>Coming soon</Text>
                          ) : restaurant.waitStatus === 'darkgrey' ? (
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
                <FlatList
                  horizontal
                  data={recommendations}
                  keyExtractor={(r) => `rec-${r.id}`}
                  showsHorizontalScrollIndicator={false}
                  contentContainerStyle={{ paddingHorizontal: 20, paddingBottom: 4 }}
                  decelerationRate="fast"
                  snapToInterval={212}
                  snapToAlignment="start"
                  renderItem={({ item: restaurant, index }) => (
                    <RestaurantListCard
                      key={restaurant.id}
                      restaurant={restaurant}
                      index={index}
                      onPress={() => handleRestaurantPress(restaurant.id)}
                      isFavorite={favoriteRestaurantIds.includes(Number(restaurant.id))}
                      onToggleFavorite={(e) => handleToggleFavorite(Number(restaurant.id))}
                    />
                  )}
                />
              </Animated.View>
            );
          })()}

        </ScrollView>
          )}
        </View>

        {/* Search Overlay */}
        {showSearch && <SearchOverlay onClose={() => setShowSearch(false)} />}
      </SafeAreaView>
    </View>
  );
}
