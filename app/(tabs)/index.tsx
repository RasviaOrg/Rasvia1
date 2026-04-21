import React, { useState, useCallback, useEffect, useRef, useMemo } from "react";
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
  Image,
  Linking,
} from "react-native";
import { Swipeable } from "react-native-gesture-handler";
import { SafeAreaView } from "react-native-safe-area-context";
import { useRouter, useFocusEffect } from "expo-router";
import { Search, Bell, MapPin, User, Map as MapIcon, UtensilsCrossed, ChevronRight, Users, Crown, X, Clock, Megaphone, ClipboardList, ChefHat, ShoppingBag, ShoppingCart, CheckCircle, Trash2, Leaf, ShieldCheck, Crosshair, ChevronDown, ChevronUp, Camera, AlertTriangle } from "lucide-react-native";
import Animated, {
  FadeInDown,
  FadeOutDown,
  useAnimatedStyle,
  useSharedValue,
  withSpring,
  withTiming,
  runOnJS,
  interpolateColor,
  cancelAnimation,
} from "react-native-reanimated";
import * as Haptics from "expo-haptics";
import * as SecureStore from 'expo-secure-store';
import { HeroCard } from "@/components/HeroCard";
import { RestaurantListCard } from "@/components/RestaurantListCard";
import { FilterBar } from "@/components/FilterBar";
import { SearchOverlay } from "@/components/SearchOverlay";
import { type FilterType } from "@/data/mockData";
import { supabase } from "@/lib/supabase";
import { cancelOrder, cancelErrorMessage } from "@/lib/order-cancel";
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
import { useAppTheme } from "@/lib/app-theme";
import { useNotifications } from "@/lib/notifications-context";
import { useClosedRestaurantIds } from "@/hooks/useClosedRestaurantIds";
import { usePersonalization } from "@/hooks/usePersonalization";
import { OwnerHomeContent } from "@/components/OwnerHomeContent";
import { ExpandedLocationSettings } from "@/components/ExpandedLocationSettings";
import { LoadingBlurOverlay } from "@/components/LoadingBlurOverlay";
import { TabScreenEntrance } from "@/components/TabScreenEntrance";
import { withTimeout } from "@/lib/with-timeout";
import { fetchRestaurantMediaSlides, fetchRecentlyViewedRestaurantIds, recordRecentlyViewedRestaurant, type RestaurantMediaSlide } from "@/lib/restaurant-media";
import { loadActiveParties, removeActiveParty, subscribeActiveParties } from "@/lib/party-active";
import { loadPartyCreds } from "@/lib/party-credentials";
import { fetchSnapshot } from "@/lib/party-session";

let SCREEN_WIDTH = Dimensions.get("window").width;
// Store the subscription so it's a tracked singleton (not a leaked anonymous
// listener) — in production the module is imported once so this is registered
// exactly once for the lifetime of the app. The real per-navigation leaks
// that contributed to the sequential-crash were elsewhere (realtime channels,
// timers, reanimated values) and are handled separately.
// eslint-disable-next-line @typescript-eslint/no-unused-vars
const __homeDimensionsSub = Dimensions.addEventListener("change", ({ window }) => {
  SCREEN_WIDTH = window.width;
});

interface ActiveGroupOrder {
  sessionId: string;
  restaurantName: string;
  /** Cover image for the restaurant shown as the banner's leading thumbnail. */
  restaurantImage?: string | null;
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
  if (status === "pending" || status === "pending_payment") return 0;
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

function getHomeGreetingLine(fullName: string | null | undefined): string {
  const first = fullName?.trim().split(/\s+/).filter(Boolean)[0];
  const hour = new Date().getHours();
  const period = hour < 12 ? "morning" : hour < 17 ? "afternoon" : "evening";
  const base = `Good ${period}`;
  if (first) return `${base}, ${first}`;
  return base;
}

export default function DiscoveryFeed() {
  const router = useRouter();
  const { colors } = useAppTheme();
  const { session, profile } = useAuth();
  const {
    isAdmin,
    isRestaurantOwner,
    effectiveOwnerRestaurantId,
  } = useAdminMode();
  const {
    userCoords,
    locationLabel,
  } = useLocation();
  const [addressBarExpanded, setAddressBarExpanded] = useState(false);
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
  const [allLiveOrders, setAllLiveOrders] = useState<{
    id: string;
    restaurantName: string;
    status: OrderStatus;
  }[]>([]);
  const [liveWaitlistBanner, setLiveWaitlistBanner] = useState<{
    entryId: string;
    restaurantId: string;
    restaurantName: string;
    partySize: number;
    position: number;
    phase: "in_queue" | "table_ready" | "seated";
  } | null>(null);
  // Active group orders the current device is a member of. Populated from the
  // SecureStore-backed index in lib/party-active.ts. Renders as a pressable
  // banner near the top of the home feed so users can hop back into a group
  // order without needing the original invite link.
  const [activeGroupOrders, setActiveGroupOrders] = useState<
    Array<{
      sessionId: string;
      restaurantId: number;
      restaurantName: string;
      memberCount: number;
      status: string;
    }>
  >([]);

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

  // Cancel any in-flight withTiming callbacks on unmount so they can't fire
  // `runOnJS` or write back to shared values after the component has been torn
  // down. Previously these animations would keep rescheduling across
  // navigations and contribute to the sequential-crash memory pressure.
  useEffect(() => {
    return () => {
      cancelAnimation(bannerOpacity);
      cancelAnimation(liveColorProgress);
    };
    // bannerOpacity / liveColorProgress identities are stable for the life of
    // this component (useSharedValue returns the same object), so no deps.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => {
    liveOrderTrackRef.current = liveOrderTrack;
  }, [liveOrderTrack]);

  // Stable JS-side callback invoked (via `runOnJS`) when the live-order banner
  // finishes its 620ms fade-out. Previously this was an *inline* arrow
  // function declared inside the `withTiming` worklet, which Reanimated can't
  // safely serialize — on Hermes this frequently crashed the app the moment
  // the kitchen flipped the order to "served" / "completed" and the banner
  // tried to disappear. Defining it at render scope and passing the stable
  // reference into `runOnJS` is the supported pattern.
  const finishLiveOrderFadeOut = useCallback(() => {
    setLiveOrderTrack(null);
    bannerOpacity.value = 1;
    liveOrderFadeOutRef.current = false;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

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

  const activeLiveOrders = useMemo(
    () => allLiveOrders.filter((o) => o.status !== "cancelled" && o.status !== "completed"),
    [allLiveOrders]
  );
  const additionalActiveOrderCount = useMemo(() => {
    if (!liveOrderTrack) return activeLiveOrders.length;
    return activeLiveOrders.filter((o) => o.id !== liveOrderTrack.id).length;
  }, [activeLiveOrders, liveOrderTrack]);

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

  /**
   * Lookup a restaurant's phone number for "Contact to cancel" fallback.
   * Returns null if unknown.
   */
  const fetchRestaurantPhone = useCallback(async (restaurantName: string): Promise<string | null> => {
    try {
      const { data } = await supabase
        .from("restaurants")
        .select("phone")
        .eq("name", restaurantName)
        .maybeSingle();
      const phone = (data as any)?.phone ?? null;
      return phone && typeof phone === "string" && phone.length > 0 ? phone : null;
    } catch {
      return null;
    }
  }, []);

  /**
   * Attempt to cancel an active order from the home banner. Cash/unpaid orders
   * are flipped to `cancelled` directly; paid-card orders surface a "contact
   * restaurant" flow with a tap-to-call button when the phone is available.
   */
  const handleCancelLiveOrder = useCallback(
    async (orderId: string, restaurantName: string) => {
      if (Platform.OS !== "web") Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Medium);
      const confirm = await new Promise<boolean>((resolve) => {
        Alert.alert(
          "Cancel order?",
          `This will cancel your current order at ${restaurantName}. You can't undo this.`,
          [
            { text: "Keep order", style: "cancel", onPress: () => resolve(false) },
            { text: "Cancel order", style: "destructive", onPress: () => resolve(true) },
          ],
          { cancelable: true, onDismiss: () => resolve(false) },
        );
      });
      if (!confirm) return;

      const result = await cancelOrder(orderId);
      if (result.ok) {
        dismissLiveOrderBanner(orderId);
        if (Platform.OS !== "web") Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
        return;
      }

      if (result.reason === "paid_card") {
        const phone = await fetchRestaurantPhone(restaurantName);
        const { title, message } = cancelErrorMessage(result.reason, restaurantName);
        Alert.alert(
          title,
          message,
          phone
            ? [
                { text: "Not now", style: "cancel" },
                {
                  text: `Call ${restaurantName}`,
                  onPress: () => Linking.openURL(`tel:${phone.replace(/[^0-9+]/g, "")}`),
                },
              ]
            : [{ text: "OK", style: "cancel" }],
        );
        return;
      }

      const { title, message } = cancelErrorMessage(result.reason, restaurantName);
      Alert.alert(title, message);
    },
    [dismissLiveOrderBanner, fetchRestaurantPhone],
  );

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
  const [recentlyViewedIds, setRecentlyViewedIds] = useState<number[]>([]);
  const [announcementBanner, setAnnouncementBanner] = useState("");
  const [userDietaryType, setUserDietaryType] = useState("");
  const [userRestrictedDays, setUserRestrictedDays] = useState<string[]>([]);
  const [ownerHomeMode, setOwnerHomeMode] = useState<"discover" | "dashboard">("dashboard");

  // Owners see their dashboard inline — no redirect needed

  // ==================================================
  // STATE MANAGEMENT - Replace Mock Data
  // ==================================================
  const [restaurants, setRestaurants] = useState<UIRestaurant[]>([]);
  const [restaurantMediaById, setRestaurantMediaById] = useState<Record<string, RestaurantMediaSlide[]>>({});
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    if (!loading) return;
    const safetyTimer = setTimeout(() => {
      setLoading(false);
    }, 9000);
    return () => clearTimeout(safetyTimer);
  }, [loading]);

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

  // Per-mount random suffix so Supabase realtime always hands us a *fresh*
  // channel instance on remount. Without this, a fast remount (fast refresh,
  // nav back) can find the previous channel still in 'joined' state under the
  // same topic, which makes `.on()` throw "cannot add postgres_changes
  // callbacks ... after subscribe()". Removing the channel in cleanup is still
  // correct; the suffix just avoids racing the teardown.
  const realtimeSuffixRef = useRef(Math.random().toString(36).slice(2, 8));

  useEffect(() => {
    fetchRestaurants();
    fetchAnnouncementBanner();

    const suffix = realtimeSuffixRef.current;
    const subscription = supabase
      .channel(`public:restaurants:${suffix}`)
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
      .channel(`system_config:announcement:${suffix}`)
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

  const fetchRecentlyViewedIds = useCallback(async () => {
    const userId = session?.user?.id;
    if (!userId) {
      setRecentlyViewedIds([]);
      return;
    }
    setRecentlyViewedIds(await fetchRecentlyViewedRestaurantIds(userId));
  }, [session?.user?.id]);

  useEffect(() => {
    fetchRecentlyViewedIds();
  }, [fetchRecentlyViewedIds]);

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
      const restaurantsQuery = (supabase
        .from('restaurants')
        .select('*')
        .order('current_wait_time', { ascending: true })) as any;
      let restaurantsResponse: any;
      try {
        restaurantsResponse = await withTimeout(
          restaurantsQuery,
          15000,
          "Timed out while loading restaurants."
        );
      } catch {
        // If the guarded request times out, retry once without the timeout
        // wrapper so slow mobile networks can still eventually resolve.
        restaurantsResponse = await restaurantsQuery;
      }
      const { data, error } = restaurantsResponse;

      if (error) {
        console.error("Supabase error (restaurants):", error);
        Alert.alert(
          'Database Error',
          `Could not fetch restaurants:\n\n${error.message}\n\nThis might be a Row Level Security (RLS) policy issue.`,
          [{ text: 'OK' }]
        );
        throw error;
      }
      if (data) {
        const uiRestaurants = data.map((r: SupabaseRestaurant) => mapSupabaseToUI(r, userCoordsRef.current));
        setRestaurants(uiRestaurants);
        // Overlay live review stats (count + average) from restaurant_reviews
        const ids = uiRestaurants.map((r: UIRestaurant) => r.id);
        let statsMap = new Map<number, { count: number; average: number }>();
        try {
          statsMap = await withTimeout(
            fetchBatchReviewStats(ids),
            9000,
            "Timed out while loading review stats."
          );
        } catch {
          // Soft-fail review stats so restaurant feed still renders.
          statsMap = new Map<number, { count: number; average: number }>();
        }
        const withReviews = uiRestaurants.map((r: UIRestaurant) => {
          const s = statsMap.get(r.id);
          if (!s) return r;
          return { ...r, rating: s.average, reviewCount: s.count };
        });
        setRestaurants(withReviews);
        setRestaurantMediaById(await fetchRestaurantMediaSlides(withReviews.map((r: UIRestaurant) => r.id)));
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
          .select('id, status, host_user_id, restaurants(name, image_url)')
          .eq('id', parsed.sessionId)
          .single();

        const statusOk =
          !error &&
          sess &&
          ['open', 'locked', 'paying'].includes(String((sess as any).status));

        if (!statusOk) {
          await SecureStore.deleteItemAsync(activeOrderKey);
        } else {
          const hostId = String((sess as any).host_user_id ?? '');
          const isCurrentHost = !!hostId && hostId === currentUserId;

          // Cached banner must match reality: session can still be "open" after
          // this user leaves — without a membership (or host) check the home
          // screen would keep showing the group order forever.
          if (!isCurrentHost) {
            const { data: stillMember } = await supabase
              .from('party_members')
              .select('id')
              .eq('session_id', parsed.sessionId)
              .eq('user_id', currentUserId)
              .is('left_at', null)
              .maybeSingle();

            if (!stillMember) {
              await SecureStore.deleteItemAsync(activeOrderKey);
            } else {
              setActiveGroupOrder({
                ...parsed,
                isHost: false,
                restaurantName: (sess.restaurants as any)?.name ?? parsed.restaurantName,
                restaurantImage: (sess.restaurants as any)?.image_url ?? parsed.restaurantImage ?? null,
              });
              return;
            }
          } else {
            setActiveGroupOrder({
              ...parsed,
              isHost: true,
              restaurantName: (sess.restaurants as any)?.name ?? parsed.restaurantName,
              restaurantImage: (sess.restaurants as any)?.image_url ?? parsed.restaurantImage ?? null,
            });
            return;
          }
        }
      }

      // Fallback: check if the user hosts any open sessions
      const { data: hostSessions } = await supabase
        .from('party_sessions')
        .select('id, restaurants(name, image_url)')
        .eq('host_user_id', currentUserId)
        .in('status', ['open', 'locked', 'paying'])
        .order('created_at', { ascending: false })
        .limit(1);

      if (hostSessions && hostSessions.length > 0) {
        const sess = hostSessions[0];
        const order: ActiveGroupOrder = {
          sessionId: sess.id,
          restaurantName: (sess.restaurants as any)?.name ?? 'Restaurant',
          restaurantImage: (sess.restaurants as any)?.image_url ?? null,
          isHost: true,
          joinedAt: new Date().toISOString(),
        };
        // Re-persist so the banner works immediately next time
        await SecureStore.setItemAsync(activeOrderKey, JSON.stringify(order));
        setActiveGroupOrder(order);
        return;
      }

      // Guest fallback — if the logged-in user is a member of any active
      // session (joined via an invite link from the app), surface the same
      // banner so they can jump back in without re-scanning the link. This
      // was previously host-only, which is why guests had no home-screen
      // handle on sessions they'd joined from another device/tab.
      const { data: guestMemberships } = await supabase
        .from('party_members')
        .select(
          'session_id, party_sessions!inner(id, status, restaurant_id, restaurants(name, image_url))',
        )
        .eq('user_id', currentUserId)
        .is('left_at', null)
        .in('party_sessions.status', ['open', 'locked', 'paying'])
        .order('joined_at', { ascending: false })
        .limit(1);

      if (guestMemberships && guestMemberships.length > 0) {
        const row: any = guestMemberships[0];
        const sess = row.party_sessions;
        if (sess?.id) {
          const order: ActiveGroupOrder = {
            sessionId: sess.id,
            restaurantName: sess.restaurants?.name ?? 'Restaurant',
            restaurantImage: sess.restaurants?.image_url ?? null,
            isHost: false,
            joinedAt: new Date().toISOString(),
          };
          await SecureStore.setItemAsync(activeOrderKey, JSON.stringify(order));
          setActiveGroupOrder(order);
          return;
        }
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
        .in("status", ["pending", "pending_payment", "preparing", "ready", "served", "cancelled"])
        .order("created_at", { ascending: false })
        .limit(5);

      const allRows = (data ?? []).map((r: any) => ({
        id: String(r.id),
        restaurantName: (r.restaurants as { name?: string } | null)?.name ?? "Restaurant",
        status: r.status as OrderStatus,
      }));
      setAllLiveOrders(allRows.filter((r) => r.status !== "cancelled" && r.status !== "completed"));

      const row = data?.[0];
      if (error || !row) {
        const prev = liveOrderTrackRef.current;
        const dismissed = dismissedLiveOrderIdsRef.current;
        if (prev && !dismissed.has(prev.id) && !liveOrderFadeOutRef.current) {
          liveOrderFadeOutRef.current = true;
          bannerOpacity.value = withTiming(0, { duration: 620 }, (finished) => {
            "worklet";
            if (finished) {
              runOnJS(finishLiveOrderFadeOut)();
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
          "worklet";
          if (finished) {
            runOnJS(finishLiveOrderFadeOut)();
          }
        });
      } else if (!liveOrderFadeOutRef.current) {
        liveOrderFadeOutRef.current = false;
        bannerOpacity.value = 1;
        setLiveOrderTrack(null);
      }
    }
  }, [currentUserId, finishLiveOrderFadeOut]);

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
        // Include "notified" so the home banner matches what Alerts shows —
        // otherwise a table-ready entry disappears from home until the user
        // is physically seated by staff.
        .in("status", ["waiting", "notified", "seated"])
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
    const topicSuffix = Math.random().toString(36).slice(2, 8);
    const ch = supabase
      .channel(`home-live-order:${currentUserId}:${topicSuffix}`)
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
    const topicSuffix = Math.random().toString(36).slice(2, 8);
    const ch = supabase
      .channel(`home-waitlist:${currentUserId}:${topicSuffix}`)
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
    const topicSuffix = Math.random().toString(36).slice(2, 8);
    const ch = supabase
      .channel(`home-waitlist-entry:${eid}:${topicSuffix}`)
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

  // ── Active group orders (from device-local index) ──
  //
  // Loads the list of party sessions this device is in, fetches a lightweight
  // snapshot for each, drops finished/cancelled sessions, and exposes the rest
  // to the render tree for the LiveGroupOrderBanner. Re-runs whenever the
  // party-active subscriber fires (i.e. after join/leave) so the banner shows
  // up or disappears in real time.
  const refreshActiveGroupOrders = useCallback(async () => {
    const ids = await loadActiveParties();
    // Guest sessions joined on another device/tab won't be in this device's
    // local index. Backfill from party_members so the banner shows up the
    // moment the user logs in anywhere. We intentionally only *read* creds
    // from disk below — if the creds aren't on this device we can't render
    // the snapshot, so those rows are skipped silently.
    let enriched = ids.slice();
    if (currentUserId) {
      try {
        const { data: guestMemberships } = await supabase
          .from("party_members")
          .select(
            "session_id, party_sessions!inner(id, status)",
          )
          .eq("user_id", currentUserId)
          .is("left_at", null)
          .in("party_sessions.status", ["open", "locked", "paying"]);
        if (Array.isArray(guestMemberships)) {
          const seen = new Set(enriched);
          for (const row of guestMemberships as any[]) {
            const sid = String(row?.session_id ?? "");
            if (sid && !seen.has(sid)) {
              enriched.push(sid);
              seen.add(sid);
            }
          }
        }
      } catch {
        // Non-fatal — we still have whatever was in the local index.
      }
    }
    if (enriched.length === 0) {
      setActiveGroupOrders([]);
      return;
    }
    const ids2 = enriched;
    const rows = await Promise.all(
      ids2.map(async (sid) => {
        try {
          const creds = await loadPartyCreds(sid);
          if (!creds) {
            // No credentials on this device — either a stale local-index
            // entry, or a backfilled membership joined elsewhere. Either
            // way we can't render the snapshot; just skip (and only evict
            // from the local index if it actually was there).
            if (ids.includes(sid)) await removeActiveParty(sid);
            return null;
          }
          const snap = await fetchSnapshot(supabase, creds);
          if (!snap) {
            await removeActiveParty(sid);
            return null;
          }
          const status = String(snap.session.status ?? "");
          if (status === "completed" || status === "cancelled") {
            await removeActiveParty(sid);
            return null;
          }
          // Best-effort restaurant name lookup — the snapshot has a
          // restaurant_id but not a name, so resolve once here.
          let restaurantName = "Restaurant";
          try {
            const { data } = await supabase
              .from("restaurants")
              .select("name")
              .eq("id", snap.session.restaurant_id)
              .maybeSingle();
            if ((data as any)?.name) restaurantName = String((data as any).name);
          } catch { /* ignore */ }
          return {
            sessionId: sid,
            restaurantId: snap.session.restaurant_id,
            restaurantName,
            memberCount: snap.members.length,
            status,
          };
        } catch {
          return null;
        }
      }),
    );
    setActiveGroupOrders(rows.filter((r): r is NonNullable<typeof r> => r !== null));
  }, [currentUserId]);

  useEffect(() => {
    void refreshActiveGroupOrders();
    const unsub = subscribeActiveParties(() => {
      void refreshActiveGroupOrders();
    });
    return () => {
      unsub();
    };
  }, [refreshActiveGroupOrders]);

  // Light refresh when the Home tab gains focus (party / live order / waitlist /
  // favorites may have changed in another tab). Single callback so work runs once per focus.
  useFocusEffect(
    useCallback(() => {
      void refreshActiveGroupOrders();
      checkActiveGroupOrder();
      void fetchFavoriteRestaurantIds();
      void fetchLiveOrder();
      void fetchLiveWaitlist();
    }, [
      refreshActiveGroupOrders,
      checkActiveGroupOrder,
      fetchFavoriteRestaurantIds,
      fetchLiveOrder,
      fetchLiveWaitlist,
    ]),
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

  const nothingToShow = trendingRestaurants.length === 0 && nearbyRestaurants.length === 0 && quickBites.length === 0;

  const handleRestaurantPress = useCallback(
    (id: string) => {
      if (Platform.OS !== "web") {
        Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
      }
      const restaurantIdNum = Number(id);
      if (Number.isFinite(restaurantIdNum) && restaurantIdNum > 0) {
        setRecentlyViewedIds((prev) => [restaurantIdNum, ...prev.filter((x) => x !== restaurantIdNum)].slice(0, 10));
        const userId = session?.user?.id;
        if (userId) {
          void recordRecentlyViewedRestaurant(userId, restaurantIdNum);
        }
      }
      router.push(`/restaurant/${id}` as any);
    },
    [router, session?.user?.id]
  );


  const handleFilterChange = useCallback((filter: FilterType) => {
    if (Platform.OS !== "web") {
      Haptics.selectionAsync();
    }
    setActiveFilter(filter);
  }, []);

  const openDiscoverSection = useCallback((section: "trending" | "favorites" | "nearby" | "quick-bites" | "recently-viewed") => {
    if (Platform.OS !== "web") {
      Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
    }
    if (section === "nearby") {
      router.push(`/discover/${section}?filter=${activeFilter}` as any);
      return;
    }
    router.push(`/discover/${section}` as any);
  }, [activeFilter, router]);

  const homeGreetingLine = useMemo(
    () => getHomeGreetingLine(profile?.full_name),
    [profile?.full_name]
  );

  const isOwnerDashboardMode =
    (isRestaurantOwner || isAdmin) && ownerHomeMode === "dashboard";
  const isDiscoverFeedRoute =
    (!isRestaurantOwner && !isAdmin) || ownerHomeMode === "discover";
  const showDiscoverFeedLoading = isDiscoverFeedRoute && loading;

  return (
    <View className="flex-1" style={{ backgroundColor: colors.homeBg }}>
      <SafeAreaView className="flex-1" edges={["top"]} style={{ backgroundColor: colors.homeBg }}>
        <TabScreenEntrance>
        <View style={{ flex: 1, backgroundColor: colors.homeBg }}>
        {/* Header */}
        <View
          className="flex-row items-center justify-between px-5"
          style={{ paddingTop: 0, paddingBottom: 10, backgroundColor: colors.homeHeaderBg, zIndex: 10 }}
        >
          <View style={{ flex: 1, marginRight: 12, justifyContent: "center" }}>
            <Text
              style={{
                fontFamily: "Manrope_700Bold",
                color: colors.text,
                fontSize: 22,
                letterSpacing: -0.35,
              }}
              numberOfLines={2}
            >
              {homeGreetingLine}
            </Text>
          </View>
          <Pressable
            onPress={() => {
              if (Platform.OS !== "web") Haptics.selectionAsync();
              setAddressBarExpanded(!addressBarExpanded);
            }}
            style={{
              maxWidth: "52%",
              alignSelf: "center",
              backgroundColor: colors.homeSurface,
              borderRadius: 12,
              borderWidth: 1,
              borderColor: addressBarExpanded ? "rgba(255,153,51,0.3)" : colors.homeBorder,
              paddingHorizontal: 10,
              paddingVertical: 8,
              flexDirection: "row",
              alignItems: "center",
              gap: 6,
            }}
          >
            <MapPin size={14} color="#FF9933" />
            <Text
              numberOfLines={1}
              style={{
                flexShrink: 1,
                fontFamily: "Manrope_600SemiBold",
                color: locationLabel && locationLabel !== "GPS Location" ? "#e2e2e2" : "#777",
                fontSize: 13,
              }}
            >
              {locationLabel && locationLabel !== "GPS Location" ? locationLabel : "Unknown"}
            </Text>
            {addressBarExpanded ? (
              <ChevronUp size={13} color="#999" />
            ) : (
              <ChevronDown size={13} color="#999" />
            )}
          </Pressable>
        </View>

        {/* Floating search bar */}
          <Pressable
            onPress={() => {
              if (Platform.OS !== "web") Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
              if (isOwnerDashboardMode && effectiveOwnerRestaurantId) {
                router.push(`/restaurant/${effectiveOwnerRestaurantId}` as any);
              } else {
                setShowSearch(true);
              }
            }}
            style={{
              marginHorizontal: 16,
              marginBottom: 6,
              backgroundColor: colors.homeSurface,
              borderRadius: 16,
              borderWidth: 1,
              borderColor: colors.homeBorder,
              paddingHorizontal: 14,
              paddingVertical: 11,
              flexDirection: "row",
              alignItems: "center",
              gap: 10,
            }}
          >
            {isOwnerDashboardMode ? (
              <UtensilsCrossed size={16} color="#f5f5f5" />
            ) : (
              <Search size={16} color="#FF9933" />
            )}
            <Text
              style={{
                flex: 1,
                fontFamily: "Manrope_500Medium",
                color: "#888",
                fontSize: 14,
              }}
            >
            Search Rasvia
          </Text>
          </Pressable>

        {addressBarExpanded && (
          <View
            style={{
              marginHorizontal: 16,
              marginBottom: 8,
              backgroundColor: colors.homeSurface,
              borderRadius: 16,
              borderWidth: 1,
              borderColor: colors.homeBorder,
              padding: 14,
              zIndex: 20,
            }}
          >
            <ExpandedLocationSettings onApplied={() => setAddressBarExpanded(false)} />
          </View>
        )}

        {(isRestaurantOwner || isAdmin) && (
          <View style={{ paddingHorizontal: 20, paddingTop: 8, paddingBottom: 8 }}>
            <View style={{
              backgroundColor: colors.homeSurface,
              borderWidth: 1,
              borderColor: colors.homeBorder,
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
          contentContainerStyle={{ paddingBottom: 168 }}
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
                  {/* Rounded-rectangle restaurant thumbnail. Falls back to a
                      neutral icon tile when the restaurant has no cover image. */}
                  <View
                    style={{
                      width: 52,
                      height: 52,
                      borderRadius: 12,
                      backgroundColor: "rgba(255,153,51,0.15)",
                      borderWidth: 1,
                      borderColor: "rgba(255,153,51,0.4)",
                      alignItems: "center",
                      justifyContent: "center",
                      overflow: "hidden",
                    }}
                  >
                    {activeGroupOrder.restaurantImage ? (
                      <Image
                        source={{ uri: activeGroupOrder.restaurantImage }}
                        style={{ width: "100%", height: "100%" }}
                        resizeMode="cover"
                      />
                    ) : (
                      <UtensilsCrossed size={22} color="#FF9933" />
                    )}
                  </View>
                  <View style={{ flex: 1 }}>
                    <View style={{ flexDirection: "row", alignItems: "center", gap: 6, marginBottom: 4 }}>
                      <View style={{ width: 8, height: 8, borderRadius: 4, backgroundColor: "#22C55E" }} />
                      <Text style={{ fontFamily: "Manrope_600SemiBold", color: "#22C55E", fontSize: 11, letterSpacing: 0.5, textTransform: "uppercase" }}>
                        In Progress
                      </Text>
                      {activeGroupOrder.isHost && <Crown size={11} color="#FF9933" />}
                    </View>
                    {/* Allow wrapping so long restaurant names don't get
                        truncated — the banner expands vertically instead. */}
                    <Text
                      style={{
                        fontFamily: "BricolageGrotesque_700Bold",
                        color: "#f5f5f5",
                        fontSize: 16,
                        letterSpacing: -0.2,
                        lineHeight: 20,
                      }}
                    >
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

          {/* Live group order rejoin tab — shows when the device is in one
              or more active party sessions. Tap to jump straight back into
              the group order without needing the original invite link. */}
          {activeGroupOrders.length > 0 && (
            <Animated.View
              entering={FadeInDown.duration(360)}
              style={{ paddingHorizontal: 16, paddingTop: 12, paddingBottom: 4, gap: 8 }}
            >
              {activeGroupOrders.map((party) => (
                <Pressable
                  key={party.sessionId}
                  onPress={() => {
                    if (Platform.OS !== "web") Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
                    router.push(`/join/${party.sessionId}` as any);
                  }}
                  style={({ pressed }) => ({
                    flexDirection: "row",
                    alignItems: "center",
                    gap: 12,
                    paddingVertical: 12,
                    paddingHorizontal: 14,
                    borderRadius: 18,
                    backgroundColor: pressed ? "rgba(139,92,246,0.16)" : "rgba(139,92,246,0.10)",
                    borderWidth: 1,
                    borderColor: "rgba(139,92,246,0.35)",
                  })}
                >
                  <View
                    style={{
                      width: 40,
                      height: 40,
                      borderRadius: 20,
                      backgroundColor: "rgba(139,92,246,0.18)",
                      alignItems: "center",
                      justifyContent: "center",
                    }}
                  >
                    <Users size={20} color="#C4B5FD" />
                  </View>
                  <View style={{ flex: 1 }}>
                    <Text
                      style={{
                        fontFamily: "BricolageGrotesque_700Bold",
                        color: "#E9E4FF",
                        fontSize: 14,
                        letterSpacing: 0.3,
                        textTransform: "uppercase",
                      }}
                    >
                      Group order in progress
                    </Text>
                    <Text
                      style={{
                        fontFamily: "Manrope_600SemiBold",
                        color: "#f5f5f5",
                        fontSize: 15,
                        marginTop: 2,
                      }}
                      numberOfLines={1}
                    >
                      {party.restaurantName}
                      <Text style={{ color: "#9CA3AF", fontFamily: "Manrope_500Medium" }}>
                        {"  ·  "}
                        {party.memberCount} {party.memberCount === 1 ? "member" : "members"}
                      </Text>
                    </Text>
                  </View>
                  <View
                    style={{
                      paddingHorizontal: 10,
                      paddingVertical: 6,
                      borderRadius: 999,
                      backgroundColor: "rgba(139,92,246,0.2)",
                    }}
                  >
                    <Text
                      style={{
                        fontFamily: "Manrope_700Bold",
                        color: "#E9E4FF",
                        fontSize: 12,
                        letterSpacing: 0.3,
                      }}
                    >
                      Rejoin
                    </Text>
                  </View>
                </Pressable>
              ))}
            </Animated.View>
          )}

          {/* Live order tracker — directly above Trending (swipe left → remove to hide) */}
          {liveOrderTrack &&
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
                  {liveOrderTrack.status === "cancelled" ? (
                    <View
                      style={{
                        borderRadius: 20,
                        borderWidth: 1.5,
                        borderColor: "rgba(239,68,68,0.45)",
                        backgroundColor: "rgba(239,68,68,0.12)",
                        padding: 16,
                        flexDirection: "row",
                        alignItems: "center",
                        gap: 14,
                      }}
                    >
                      <View
                        style={{
                          width: 48,
                          height: 48,
                          borderRadius: 24,
                          borderWidth: 2,
                          borderColor: "rgba(239,68,68,0.5)",
                          backgroundColor: "rgba(239,68,68,0.2)",
                          alignItems: "center",
                          justifyContent: "center",
                        }}
                      >
                        <AlertTriangle size={21} color="#FCA5A5" />
                      </View>
                      <View style={{ flex: 1 }}>
                        <Text
                          style={{
                            fontFamily: "Manrope_700Bold",
                            color: "#FCA5A5",
                            fontSize: 11,
                            letterSpacing: 0.5,
                            textTransform: "uppercase",
                            marginBottom: 4,
                          }}
                        >
                          Live order cancelled
                        </Text>
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
                        <Text
                          style={{
                            fontFamily: "Manrope_500Medium",
                            color: "#d4d4d4",
                            fontSize: 12,
                            marginTop: 3,
                          }}
                          numberOfLines={1}
                        >
                          Tap to view details in My Orders
                        </Text>
                      </View>
                      <Pressable
                        onPress={(e) => {
                          e.stopPropagation();
                          if (Platform.OS !== "web") Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
                          dismissLiveOrderBanner(liveOrderTrack.id);
                        }}
                        style={{
                          width: 38,
                          height: 38,
                          borderRadius: 19,
                          borderWidth: 1,
                          borderColor: "#EF4444",
                          backgroundColor: "rgba(239,68,68,0.35)",
                          alignItems: "center",
                          justifyContent: "center",
                        }}
                      >
                        <Trash2 size={16} color="#FEE2E2" />
                      </Pressable>
                    </View>
                  ) : (
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
                  {/* No chevron — the X cancel button already anchors the
                      right edge; a second right-arrow was redundant. */}
                  {/* Cancel button — top-right icon, only meaningful for
                      not-yet-prepared orders. Paid-card orders go through the
                      "Contact the restaurant" prompt instead. */}
                  {(liveOrderTrack.status === "pending" ||
                    liveOrderTrack.status === "pending_payment") && (
                    <Pressable
                      onPress={(e) => {
                        e.stopPropagation();
                        void handleCancelLiveOrder(
                          liveOrderTrack.id,
                          liveOrderTrack.restaurantName
                        );
                      }}
                      hitSlop={10}
                      style={{
                        position: "absolute",
                        top: 8,
                        right: 10,
                        width: 26,
                        height: 26,
                        borderRadius: 13,
                        borderWidth: 1,
                        borderColor: "rgba(239,68,68,0.45)",
                        backgroundColor: "rgba(239,68,68,0.15)",
                        alignItems: "center",
                        justifyContent: "center",
                      }}
                      accessibilityLabel="Cancel order"
                    >
                      <X size={14} color="#FCA5A5" strokeWidth={2.5} />
                    </Pressable>
                  )}
                  </Animated.View>
                  )}
                </Pressable>
              </Swipeable>
              </Animated.View>
            </Animated.View>
          )}

          {/* Additional active orders beyond the primary banner */}
          {additionalActiveOrderCount > 0 && (
            <Pressable
              onPress={() => {
                if (Platform.OS !== "web") Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
                router.push("/my-orders" as any);
              }}
              style={{
                marginHorizontal: 16,
                marginTop: 6,
                marginBottom: 4,
                backgroundColor: "rgba(255,153,51,0.08)",
                borderRadius: 14,
                borderWidth: 1,
                borderColor: "rgba(255,153,51,0.25)",
                paddingHorizontal: 14,
                paddingVertical: 10,
                flexDirection: "row",
                alignItems: "center",
                justifyContent: "space-between",
              }}
            >
              <View style={{ flexDirection: "row", alignItems: "center", gap: 8 }}>
                <ShoppingCart size={14} color="#FF9933" />
                <Text style={{ fontFamily: "Manrope_600SemiBold", color: "#FF9933", fontSize: 13 }}>
                  +{additionalActiveOrderCount} more active order{additionalActiveOrderCount > 1 ? "s" : ""}
                </Text>
              </View>
              <ChevronRight size={16} color="#FF9933" />
            </Pressable>
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
                  No restaurants to show right now.
                 </Text>
               </View>
             </Animated.View>
          )}

          {trendingRestaurants.length > 0 && (
            <>
              <Animated.View entering={FadeInDown.delay(100).duration(500)}>
                <View className="px-5 mb-1">
                  <View className="flex-row items-center justify-between mb-1">
                    <Text
                      style={{
                        fontFamily: "BricolageGrotesque_700Bold",
                        color: colors.textSecondary,
                        fontSize: 22,
                        letterSpacing: -0.3,
                      }}
                    >
                      Trending Now
                    </Text>
                    <Pressable
                      onPress={() => openDiscoverSection("trending")}
                      style={{
                        width: 36,
                        height: 36,
                        borderRadius: 18,
                        backgroundColor: "#262629",
                        borderWidth: 1,
                        borderColor: "#3d3d40",
                        alignItems: "center",
                        justifyContent: "center",
                      }}
                    >
                      <ChevronRight size={18} color={colors.text} />
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
            <Animated.View entering={FadeInDown.delay(320).duration(420)} exiting={FadeOutDown.duration(320)}>
              <View className="px-5 mt-8 mb-4">
                <View className="flex-row items-center justify-between mb-1">
                  <Text
                    style={{
                      fontFamily: "BricolageGrotesque_700Bold",
                      color: colors.textSecondary,
                      fontSize: 22,
                      letterSpacing: -0.3,
                    }}
                  >
                    Favorites
                  </Text>
                  <Pressable
                    onPress={() => openDiscoverSection("favorites")}
                    style={{
                      width: 36,
                      height: 36,
                      borderRadius: 18,
                      backgroundColor: "#262629",
                      borderWidth: 1,
                      borderColor: "#3d3d40",
                      alignItems: "center",
                      justifyContent: "center",
                    }}
                  >
                    <ChevronRight size={18} color={colors.text} />
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
                  Your saved spots, sorted by wait time
                </Text>
              </View>
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
            </Animated.View>
          )}

          {/* Recently Viewed Section */}
          {recentlyViewedRestaurants.length > 0 && (
            <Animated.View entering={FadeInDown.delay(340).duration(420)} exiting={FadeOutDown.duration(320)}>
              <View className="px-5 mt-8 mb-4">
                <View className="flex-row items-center justify-between mb-1">
                  <Text
                    style={{
                      fontFamily: "BricolageGrotesque_700Bold",
                      color: colors.textSecondary,
                      fontSize: 22,
                      letterSpacing: -0.3,
                    }}
                  >
                    Recently Viewed
                  </Text>
                  <Pressable
                    onPress={() => openDiscoverSection("recently-viewed")}
                    style={{
                      width: 36,
                      height: 36,
                      borderRadius: 18,
                      backgroundColor: "#262629",
                      borderWidth: 1,
                      borderColor: "#3d3d40",
                      alignItems: "center",
                      justifyContent: "center",
                    }}
                  >
                    <ChevronRight size={18} color={colors.text} />
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
                  Restaurants you opened recently
                </Text>
              </View>
              <FlatList
                horizontal
                data={recentlyViewedRestaurants}
                keyExtractor={(r) => `recent-${r.id}`}
                showsHorizontalScrollIndicator={false}
                contentContainerStyle={{ paddingHorizontal: 20, paddingBottom: 4 }}
                decelerationRate="fast"
                snapToInterval={212}
                snapToAlignment="start"
                removeClippedSubviews={false}
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
            </Animated.View>
          )}

          {/* Filter Section */}
          {(nearbyRestaurants.length > 0 || activeFilter !== "all") && (
            <>
              <View className="mt-8 mb-4">
                <View className="px-5 mb-3">
                  <View style={{ flexDirection: "row", alignItems: "center", justifyContent: "space-between" }}>
                    <Text
                      style={{
                        fontFamily: "BricolageGrotesque_700Bold",
                        color: colors.textSecondary,
                        fontSize: 22,
                        letterSpacing: -0.3,
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
                        backgroundColor: "#262629",
                        borderWidth: 1,
                        borderColor: "#3d3d40",
                        alignItems: "center",
                        justifyContent: "center",
                      }}
                    >
                      <ChevronRight size={18} color={colors.text} />
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
                    <Text
                      style={{
                        fontFamily: "BricolageGrotesque_700Bold",
                        color: colors.textSecondary,
                        fontSize: 22,
                        letterSpacing: -0.3,
                      }}
                    >
                      Quick Bites
                    </Text>
                    <Pressable
                      onPress={() => openDiscoverSection("quick-bites")}
                      style={{
                        width: 36,
                        height: 36,
                        borderRadius: 18,
                        backgroundColor: "#262629",
                        borderWidth: 1,
                        borderColor: "#3d3d40",
                        alignItems: "center",
                        justifyContent: "center",
                      }}
                    >
                      <ChevronRight size={18} color={colors.text} />
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
                  <Text style={{ fontFamily: "BricolageGrotesque_700Bold", color: colors.textSecondary, fontSize: 22, letterSpacing: -0.3, marginBottom: 4 }}>
                    Order Again
                  </Text>
                  <Text style={{ fontFamily: "Manrope_500Medium", color: "#999999", fontSize: 14, marginTop: 2 }}>
                    Your go-to spots
                  </Text>
                </View>
                <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={{ paddingHorizontal: 20, gap: 12, paddingBottom: 4 }}>
                  {orderAgainRestaurants.slice(0, 6).map((restaurant) => {
                    const lastOrder = personalization.lastOrderByRestaurant[restaurant.id];
                    const leadItemImage =
                      lastOrder?.items?.find((entry) => !!entry.imageUrl)?.imageUrl ??
                      lastOrder?.items?.[0]?.imageUrl ??
                      null;
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
                          backgroundColor: colors.homeSurface,
                          borderRadius: 18,
                          borderWidth: 1,
                          borderColor: restaurant.waitStatus === 'darkgrey' ? "#2a2a2e" : colors.homeBorder,
                          width: 212,
                          opacity: restaurant.waitStatus === 'darkgrey' ? 0.7 : 1,
                          flexDirection: "column",
                          justifyContent: "space-between",
                          minHeight: 186,
                          overflow: "hidden",
                        }}
                      >
                        {leadItemImage ? (
                          <Image
                            source={{ uri: leadItemImage }}
                            resizeMode="cover"
                            style={{
                              width: "100%",
                              height: 88,
                              backgroundColor: "#1f1f1f",
                            }}
                          />
                        ) : (
                          <View
                            style={{
                              width: "100%",
                              height: 88,
                              backgroundColor: "#1b1b1b",
                              alignItems: "center",
                              justifyContent: "center",
                              gap: 4,
                            }}
                          >
                            <Camera size={22} color="#7a7a7a" />
                            <Text style={{ fontFamily: "Manrope_700Bold", color: "#8a8a8a", fontSize: 11 }}>
                              No image available
                            </Text>
                          </View>
                        )}
                        <View style={{ paddingHorizontal: 12, paddingTop: 10 }}>
                          <Text style={{ fontFamily: "BricolageGrotesque_700Bold", color: restaurant.waitStatus === 'darkgrey' ? "#555" : "#f5f5f5", fontSize: 15 }} numberOfLines={1}>
                            {restaurant.name}
                          </Text>
                        </View>
                        <View style={{ paddingHorizontal: 12, marginTop: 4 }}>
                          {lastOrder?.items?.length > 0 ? (
                            <View style={{ marginBottom: 0 }}>
                              {lastOrder.items.slice(0, 2).map((item, idx) => {
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
                        <View style={{ flexDirection: "row", alignItems: "center", justifyContent: "space-between", marginTop: 8, paddingHorizontal: 12, paddingBottom: 12 }}>
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
                              <Text style={{ fontFamily: "Manrope_700Bold", color: "#FF9933", fontSize: 11 }}>Reorder</Text>
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
                  <Text style={{ fontFamily: "BricolageGrotesque_700Bold", color: colors.textSecondary, fontSize: 22, letterSpacing: -0.3, marginBottom: 4 }}>
                    You May Like
                  </Text>
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

        </View>
        </TabScreenEntrance>

        {showDiscoverFeedLoading && (
          <LoadingBlurOverlay />
        )}

        {/* Search Overlay */}
        {showSearch && <SearchOverlay onClose={() => setShowSearch(false)} />}
      </SafeAreaView>
    </View>
  );
}
