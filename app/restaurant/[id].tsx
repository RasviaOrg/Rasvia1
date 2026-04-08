import React, { useState, useCallback, useEffect, useRef, useMemo } from "react";
import {
  View,
  Text,
  Image,
  Pressable,
  Dimensions,
  Alert,
  Platform,
  Modal,
  TextInput,
  KeyboardAvoidingView,
  ActivityIndicator,
  Share,
  RefreshControl,
} from "react-native";
import { SafeAreaView, useSafeAreaInsets } from "react-native-safe-area-context";
import { useLocalSearchParams, useRouter, useFocusEffect } from "expo-router";
import { LinearGradient } from "expo-linear-gradient";
import {
  ArrowLeft,
  Star,
  MapPin,
  Clock,
  Users,
  Heart,
  Share2,
  ShoppingBag,
  Settings,
  Coffee,
  Sun,
  Moon,
  Sparkles as SparklesIcon,
  Truck,
  UtensilsCrossed,
  Leaf,
  AlertTriangle,
  ShieldCheck,
} from "lucide-react-native";
import Animated, {
  useAnimatedStyle,
  useSharedValue,
  withSpring,
  useAnimatedScrollHandler,
  interpolate,
  Extrapolation,
} from "react-native-reanimated";
import * as Haptics from "expo-haptics";
import { WaitBadge } from "@/components/WaitBadge";
import { MenuGridItem } from "@/components/MenuGridItem";
import { MenuEditor } from "@/components/MenuEditor";
import { CommunityImageModal } from "@/components/CommunityImageModal";
import { FoodDetailModal } from "@/components/FoodDetailModal";
import { MenuItemDetailSettingsModal } from "@/components/MenuItemDetailSettingsModal";
import { GroupCartDrawer } from "@/components/GroupCartDrawer";
import { CheckoutModal } from "@/components/CheckoutModal";
import { HoursStatusBadge } from "@/components/HoursStatusBadge";
import { RestaurantEditModal } from "@/components/RestaurantEditModal";
import { ReviewsModal } from "@/components/ReviewsModal";
import { fetchReviewStats } from "@/lib/review-stats";
import { useAdminMode } from "@/hooks/useAdminMode";
import { useRestaurantHours } from "@/hooks/useRestaurantHours";
import { waitlistAllowedBySchedule } from "@/lib/restaurant-hours";
import { supabase } from "@/lib/supabase";
import {
  type SupabaseRestaurant,
  type UIRestaurant,
  type SupabaseMenuItem,
  type UIMenuItem,
  mapSupabaseToUI,
  mapMenuItemToUI,
  haversineDistance,
  parseFavorites,
} from "@/lib/restaurant-types";
import { useLocation } from "@/lib/location-context";
import { useAuth } from "@/lib/auth-context";
import { useNotifications } from "@/lib/notifications-context";
import {
  groupMembers,
  type CartItem,
  type GroupMember,
} from "@/data/mockData";
import * as SecureStore from 'expo-secure-store';
import * as ExpoClipboard from "expo-clipboard";

let SCREEN_WIDTH = Dimensions.get("window").width;
let SCREEN_HEIGHT = Dimensions.get("window").height;
Dimensions.addEventListener("change", ({ window }) => { SCREEN_WIDTH = window.width; SCREEN_HEIGHT = window.height; });
const HERO_HEIGHT = SCREEN_HEIGHT * 0.42;
const COLLAPSED_HEADER_HEIGHT = 100;
const SCROLL_THRESHOLD = HERO_HEIGHT;
const GROUP_ORDER_WEB_BASE_URL = "https://rasvia.com";
const RESTAURANT_SHARE_WEB_BASE_URL = "https://rasvia.com";

export default function RestaurantDetail() {
  const { id, reorder, waitlist_entry } = useLocalSearchParams<{
    id: string;
    reorder?: string;
    waitlist_entry?: string;
  }>();
  const waitlistEntryParam =
    typeof waitlist_entry === "string" && waitlist_entry.length > 0 ? waitlist_entry : undefined;
  const router = useRouter();
  const insets = useSafeAreaInsets();
  const { userCoords } = useLocation();
  const userCoordsRef = useRef(userCoords);
  useEffect(() => { userCoordsRef.current = userCoords; }, [userCoords]);
  const { isAdmin, isRestaurantOwner, ownedRestaurantId, loading: roleLoading } = useAdminMode();
  // owners can manage their own restaurant (same controls as admin, but scoped)
  const canManage = isAdmin || (isRestaurantOwner && ownedRestaurantId === id);
  const { session } = useAuth();
  const ownerRoleResolved = !roleLoading;
  const { addEvent, refreshActive } = useNotifications();
  const { statusResult: hoursStatus, hours: restaurantHours, refetch: refetchRestaurantHours } = useRestaurantHours(id);

  // Resolved member list: override "You" avatar with real profile pic when available
  const [userAvatarUrl, setUserAvatarUrl] = useState<string | null>(null);
  const localGroupMembers = React.useMemo<GroupMember[]>(() => [
    { ...groupMembers[0], avatar: userAvatarUrl ?? groupMembers[0].avatar },
    ...groupMembers.slice(1),
  ], [userAvatarUrl]);

  // ==================================================
  // STATE MANAGEMENT - Supabase Data
  // ==================================================
  const [restaurant, setRestaurant] = useState<UIRestaurant | null>(null);
  const [menu, setMenu] = useState<UIMenuItem[]>([]);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);

  const [selectedItem, setSelectedItem] = useState<UIMenuItem | null>(null);
  const [showSelectedItemSettings, setShowSelectedItemSettings] = useState(false);
  const [cartItems, setCartItems] = useState<CartItem[]>([]);
  const [showCart, setShowCart] = useState(false);
  const reorderSeeded = useRef(false);
  const [isFavorited, setIsFavorited] = useState(false);
  const [showEditModal, setShowEditModal] = useState(false);
  const [openHoursEditorOnOpen, setOpenHoursEditorOnOpen] = useState(false);
  const [showReviews, setShowReviews] = useState(false);
  // Live review stats from restaurant_reviews (not the legacy DB rating column)
  const [liveReviewCount, setLiveReviewCount] = useState<number | null>(null);
  const [liveAvgRating, setLiveAvgRating] = useState<number | null>(null);
  const handleReviewsStatsChanged = useCallback((count: number, avg: number) => {
    setLiveReviewCount(count);
    setLiveAvgRating(avg);
  }, []);
  const [showCheckout, setShowCheckout] = useState(false);
  const [checkoutOrderType, setCheckoutOrderType] = useState<'dine_in' | 'takeout'>('dine_in');
  const [lockCheckoutOrderType, setLockCheckoutOrderType] = useState(false);
  const [communityImageTarget, setCommunityImageTarget] = useState<UIMenuItem | null>(null);
  // Order type picker (shows before waitlist or takeout checkout)
  const [showOrderTypePicker, setShowOrderTypePicker] = useState(false);

  // Party size + join flow
  const [showPartySizePicker, setShowPartySizePicker] = useState(false);
  const [partySize, setPartySize] = useState(2);
  const [customParty, setCustomParty] = useState("");
  const [joining, setJoining] = useState(false);
  const [partyLeaderName, setPartyLeaderName] = useState("");
  /** User may only have one waiting entry — track it globally so other restaurants can grey out Order. */
  const [globalWaitlistEntry, setGlobalWaitlistEntry] = useState<{
    id: string;
    party_size: number;
    restaurant_id: number;
  } | null>(null);

  const existingEntry = useMemo(() => {
    if (!globalWaitlistEntry || Number(globalWaitlistEntry.restaurant_id) !== Number(id)) return null;
    return { id: globalWaitlistEntry.id, party_size: globalWaitlistEntry.party_size };
  }, [globalWaitlistEntry, id]);

  // Live queue count from waitlist_entries
  const [liveQueueCount, setLiveQueueCount] = useState<number | null>(null);
  // Active group session for this restaurant (if any)
  const [hasActiveGroupSession, setHasActiveGroupSession] = useState(false);
  // Menu category multi-filter
  type MenuFilter = "all" | "breakfast" | "lunch" | "dinner" | "specials";
  const [selectedMenuFilters, setSelectedMenuFilters] = useState<MenuFilter[]>([]);
  const [adminBypassComingSoon, setAdminBypassComingSoon] = useState(false);

  useEffect(() => {
    setAdminBypassComingSoon(false);
  }, [id]);
  // User dietary preferences for veg indicator
  const [userDietaryType, setUserDietaryType] = useState("");
  const [userRestrictedDays, setUserRestrictedDays] = useState<string[]>([]);

  const itemMatchesFilter = useCallback((item: UIMenuItem, filter: MenuFilter) => {
    const mealTimes = item.mealTimes ?? [];
    if (filter === "all") {
      return mealTimes.includes("all") || mealTimes.includes("all_day");
    }
    if (filter === "specials") {
      return mealTimes.includes("specials") || mealTimes.includes("special");
    }
    return mealTimes.includes(filter);
  }, []);

  const hasItemsForFilter = useCallback(
    (filter: MenuFilter) => menu.some((item) => itemMatchesFilter(item, filter)),
    [menu, itemMatchesFilter]
  );

  useEffect(() => {
    setSelectedMenuFilters((prev) => prev.filter((f) => hasItemsForFilter(f)));
  }, [hasItemsForFilter]);


  // Fetch party leader name + check for existing active entry
  useEffect(() => {
    if (!session?.user?.id) {
      setGlobalWaitlistEntry(null);
      return;
    }

    supabase
      .from("profiles")
      .select("full_name, dietary_type, restricted_days, avatar_url")
      .eq("id", session.user.id)
      .single()
      .then(({ data }) => {
        if (data?.full_name) setPartyLeaderName(data.full_name);
        if (data?.dietary_type) setUserDietaryType(data.dietary_type);
        if (data?.restricted_days) setUserRestrictedDays(data.restricted_days as string[]);
        if ((data as any)?.avatar_url) setUserAvatarUrl((data as any).avatar_url);
      });

    supabase
      .from("waitlist_entries")
      .select("id, party_size, restaurant_id")
      .eq("user_id", session.user.id)
      .eq("status", "waiting")
      .limit(1)
      .then(({ data }) => {
        const row = data?.[0];
        if (row) {
          setGlobalWaitlistEntry({
            id: row.id,
            party_size: row.party_size,
            restaurant_id: row.restaurant_id,
          });
        } else {
          setGlobalWaitlistEntry(null);
        }
      });
  }, [session?.user?.id]);

  // Check for an active group session for this restaurant on mount
  useEffect(() => {
    if (!session?.user?.id) return;
    const key = `rasvia_active_group_order_${session.user.id}`;
    SecureStore.getItemAsync(key).then((raw) => {
      if (!raw) return;
      try {
        const stored = JSON.parse(raw);
        // Verify the party session still exists and is open
        supabase
          .from("party_sessions")
          .select("id, restaurant_id, status")
          .eq("id", stored.sessionId)
          .eq("status", "open")
          .single()
          .then(({ data }) => {
            setHasActiveGroupSession(!!data && String(data.restaurant_id) === String(id));
          });
      } catch {
        // corrupt data, ignore
      }
    });
  }, [session?.user?.id, id]);

  // Re-validate existing entry when screen regains focus (e.g. returning from waitlist)
  useFocusEffect(
    useCallback(() => {
      if (!globalWaitlistEntry?.id) return;
      supabase
        .from("waitlist_entries")
        .select("status")
        .eq("id", globalWaitlistEntry.id)
        .single()
        .then(({ data }) => {
          if (!data || data.status !== "waiting") {
            setGlobalWaitlistEntry(null);
          }
        });
    }, [globalWaitlistEntry?.id])
  );

  // Realtime: waitlist entry no longer active (staff cancel/remove) — clear local state (no system alert)
  useEffect(() => {
    if (!globalWaitlistEntry?.id) return;
    const ch = supabase
      .channel(`restaurant-wl-entry:${globalWaitlistEntry.id}`)
      .on(
        "postgres_changes",
        {
          event: "UPDATE",
          schema: "public",
          table: "waitlist_entries",
          filter: `id=eq.${globalWaitlistEntry.id}`,
        },
        (payload) => {
          const s = (payload.new as { status?: string })?.status;
          if (s === "cancelled" || s === "removed") {
            setGlobalWaitlistEntry(null);
          }
        }
      )
      .subscribe();
    return () => {
      supabase.removeChannel(ch);
    };
  }, [globalWaitlistEntry?.id]);

  // ==================================================
  // FETCH RESTAURANT & MENU FROM SUPABASE
  // ==================================================
  useEffect(() => {
    if (!id) return;

    fetchRestaurantData();
    fetchMenu();
    fetchQueueCount();

    // Real-time: restaurant row changes
    const restSub = supabase
      .channel(`restaurant:${id}`)
      .on(
        "postgres_changes",
        { event: "UPDATE", schema: "public", table: "restaurants", filter: `id=eq.${id}` },
        (payload) => {
          const next = payload.new as SupabaseRestaurant;
          setRestaurant((prev) => {
            const mapped = mapSupabaseToUI(next, userCoordsRef.current ?? undefined);
            // Preserve computed distance if userCoords unavailable
            if (!userCoordsRef.current && prev?.distance) {
              return { ...mapped, distance: prev.distance };
            }
            return mapped;
          });
        }
      )
      .subscribe();

    // Real-time: waitlist_entries changes → refresh queue count
    const queueSub = supabase
      .channel(`queue-count:${id}`)
      .on(
        "postgres_changes",
        { event: "*", schema: "public", table: "waitlist_entries", filter: `restaurant_id=eq.${id}` },
        () => { fetchQueueCount(); }
      )
      .subscribe();

    // Real-time: menu_items changes → refresh menu
    const menuSub = supabase
      .channel(`restaurant-menu:${id}`)
      .on(
        "postgres_changes",
        { event: "*", schema: "public", table: "menu_items", filter: `restaurant_id=eq.${id}` },
        () => { fetchMenu(); }
      )
      .subscribe();

    return () => {
      supabase.removeChannel(restSub);
      supabase.removeChannel(queueSub);
      supabase.removeChannel(menuSub);
    };
  }, [id]);

  async function fetchQueueCount() {
    try {
      const { count } = await supabase
        .from("waitlist_entries")
        .select("*", { count: "exact", head: true })
        .eq("restaurant_id", Number(id))
        .eq("status", "waiting");
      setLiveQueueCount(count ?? 0);
    } catch {
      // silently ignore — fall back to calculated value
    }
  }

  async function fetchRestaurantData() {
    try {
      const { data, error } = await supabase
        .from('restaurants')
        .select('*')
        .eq('id', id)
        .single();

      if (error) throw error;
      if (data) {
        setRestaurant(mapSupabaseToUI(data as SupabaseRestaurant, userCoords));
        // Fetch live review stats from restaurant_reviews (not the DB rating column)
        const stats = await fetchReviewStats(id);
        setLiveReviewCount(stats.count);
        setLiveAvgRating(stats.average);
      }

      // Check if this restaurant is favorited by the current user
      if (session?.user?.id) {
        const { data: profileData } = await supabase
          .from("profiles")
          .select("favorite_restaurants")
          .eq("id", session.user.id)
          .single();

        if (profileData && profileData.favorite_restaurants) {
          const arr = parseFavorites(profileData.favorite_restaurants);
          setIsFavorited(arr.includes(Number(id)));
        }
      }
    } catch (error) {
      console.error('Error fetching restaurant:', error);
    } finally {
      setLoading(false);
    }
  }

  async function fetchMenu() {
    try {
      const { data, error } = await supabase
        .from('menu_items')
        .select('*')
        .eq('restaurant_id', id);

      if (error) throw error;
      if (data) {
        const uiMenuItems = data.map(item => mapMenuItemToUI(item as SupabaseMenuItem));
        const sortByImageFirst = (items: UIMenuItem[]) =>
          items
            .map((item, idx) => ({ item, idx }))
            .sort((a, b) => {
              const aHas = !!a.item.image?.trim();
              const bHas = !!b.item.image?.trim();
              if (aHas === bHas) return a.idx - b.idx; // stable for equal groups
              return aHas ? -1 : 1; // images first
            })
            .map((x) => x.item);

        // Overlay approved community image credits (and fallback image where needed)
        try {
          const { data: communityImgs } = await supabase
            .from('community_menu_images')
            .select('menu_item_id, image_url, submitter_name, created_at')
            .eq('restaurant_id', Number(id))
            .eq('status', 'approved')
            .order('created_at', { ascending: false });

          if (communityImgs && communityImgs.length > 0) {
            const latestByMenuItem = new Map<string, { image_url: string | null; submitter_name: string | null }>();
            for (const row of communityImgs as {
              menu_item_id: number;
              image_url: string | null;
              submitter_name: string | null;
              created_at: string;
            }[]) {
              const key = String(row.menu_item_id);
              if (!latestByMenuItem.has(key)) {
                latestByMenuItem.set(key, {
                  image_url: row.image_url,
                  submitter_name: row.submitter_name,
                });
              }
            }

            const merged = uiMenuItems.map((item) => {
              const ci = latestByMenuItem.get(item.id);
              if (!ci) return item;

              const raw = String(ci.image_url ?? "").trim();
              const communityImageUrl =
                raw.length === 0
                  ? ""
                  : /^https?:\/\//i.test(raw)
                    ? raw
                    : supabase.storage.from("community-images").getPublicUrl(raw).data.publicUrl;
              const itemImage = String(item.image ?? "").trim();
              const imageMatchesCommunity =
                itemImage.length > 0 &&
                communityImageUrl.length > 0 &&
                itemImage === communityImageUrl;

              return {
                ...item,
                image: itemImage.length > 0 ? itemImage : communityImageUrl,
                communityImageCredit:
                  !ci.submitter_name
                    ? null
                    : itemImage.length === 0 || imageMatchesCommunity
                      ? ci.submitter_name
                      : null,
              };
            });
            setMenu(sortByImageFirst(merged));
            return;
          }
        } catch {
          // community_menu_images table may not exist yet — silently skip
        }

        setMenu(sortByImageFirst(uiMenuItems));
      }
    } catch (error) {
      console.error('Error fetching menu:', error);
    }
  }

  async function handleRefresh() {
    if (!id) return;
    if (Platform.OS !== "web") Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
    setRefreshing(true);
    try {
      await Promise.all([
        fetchRestaurantData(),
        fetchMenu(),
        fetchQueueCount(),
        refetchRestaurantHours(),
      ]);
    } finally {
      setRefreshing(false);
    }
  }

  // Seed cart from a previous order when navigated with ?reorder=<orderId>
  useEffect(() => {
    if (!reorder || reorderSeeded.current || menu.length === 0) return;
    reorderSeeded.current = true;
    (async () => {
      try {
        const { data } = await supabase
          .from("order_items")
          .select("menu_item_id, quantity")
          .eq("order_id", reorder);
        if (!data || data.length === 0) return;
        const itemsToAdd: CartItem[] = [];
        for (const row of data as { menu_item_id: number; quantity: number }[]) {
          const menuItem = menu.find((m) => m.id === String(row.menu_item_id));
          if (menuItem) {
            itemsToAdd.push({ ...menuItem, quantity: row.quantity, addedBy: localGroupMembers[0] });
          }
        }
        if (itemsToAdd.length > 0) {
          setCartItems(itemsToAdd);
          if (Platform.OS !== "web") Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
        }
      } catch (err) {
        console.error("Reorder fetch error:", err);
      }
    })();
  }, [reorder, menu, localGroupMembers]);

  // Recalculate distance when userCoords arrives after initial fetch
  useEffect(() => {
    if (!userCoords) return;
    setRestaurant((prev) => {
      if (!prev || prev.lat == null || prev.long == null) return prev;
      const dist = haversineDistance(
        userCoords.latitude, userCoords.longitude, prev.lat, prev.long,
      );
      return { ...prev, distance: `${dist.toFixed(1)} mi` };
    });
  }, [userCoords]);

  // ==================================================
  // SCROLL ANIMATIONS (Friend's UI improvement)
  // ==================================================
  const scrollY = useSharedValue(0);

  const scrollHandler = useAnimatedScrollHandler({
    onScroll: (event) => {
      scrollY.value = event.contentOffset.y;
    },
  });

  // Hero: fixed height container, image fades out on scroll (no parallax shift)
  const heroInnerStyle = useAnimatedStyle(() => {
    const opacity = interpolate(
      scrollY.value,
      [0, SCROLL_THRESHOLD * 0.6],
      [1, 0],
      Extrapolation.CLAMP,
    );
    return { opacity };
  });

  // Collapsed header fades in
  const collapsedHeaderStyle = useAnimatedStyle(() => {
    const opacity = interpolate(
      scrollY.value,
      [SCROLL_THRESHOLD * 0.45, SCROLL_THRESHOLD * 0.78],
      [0, 1],
      Extrapolation.CLAMP,
    );
    const translateY = interpolate(
      scrollY.value,
      [SCROLL_THRESHOLD * 0.45, SCROLL_THRESHOLD * 0.78],
      [-10, 0],
      Extrapolation.CLAMP,
    );
    return {
      opacity,
      transform: [{ translateY }],
    };
  });

  // Hero content (name/tags) fades out on scroll
  const heroContentStyle = useAnimatedStyle(() => {
    const opacity = interpolate(
      scrollY.value,
      [0, SCROLL_THRESHOLD * 0.4],
      [1, 0],
      Extrapolation.CLAMP,
    );
    const translateY = interpolate(
      scrollY.value,
      [0, SCROLL_THRESHOLD * 0.4],
      [0, -20],
      Extrapolation.CLAMP,
    );
    return {
      opacity,
      transform: [{ translateY }],
    };
  });

  const handleAddToCart = useCallback(
    (item: UIMenuItem) => {
      if (Platform.OS !== "web") {
        Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
      }
      setCartItems((prev) => {
        const existing = prev.find((ci) => ci.id === item.id);
        if (existing) {
          return prev.map((ci) =>
            ci.id === item.id ? { ...ci, quantity: ci.quantity + 1 } : ci
          );
        }
        return [
          ...prev,
          { ...item, quantity: 1, addedBy: localGroupMembers[0] },
        ];
      });
      setSelectedItem(null);
    },
    []
  );

  const handleUpdateQuantity = useCallback(
    (itemId: string, delta: number) => {
      if (Platform.OS !== "web") {
        Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
      }
      setCartItems((prev) => {
        const updated = prev.map((ci) =>
          ci.id === itemId
            ? { ...ci, quantity: Math.max(0, ci.quantity + delta) }
            : ci
        );
        return updated.filter((ci) => ci.quantity > 0);
      });
    },
    []
  );

  const handleJoinWaitlist = useCallback(() => {
    if (Platform.OS !== "web") Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Heavy);
    // Always show Dine In / Takeout / Group Order — even if already on the waitlist (Dine In handles that path).
    setShowOrderTypePicker(true);
  }, []);

  const handleConfirmJoin = useCallback(async () => {
    const size = customParty.trim() !== "" ? parseInt(customParty, 10) : partySize;
    if (isNaN(size) || size < 1) {
      Alert.alert("Invalid", "Please enter a valid party size.");
      return;
    }
    if (!session?.user?.id) {
      Alert.alert("Not signed in", "Please sign in to join a waitlist.");
      return;
    }
    if (Platform.OS !== "web") Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Heavy);
    setJoining(true);
    try {
      const { data, error } = await supabase
        .from("waitlist_entries")
        .insert({
          restaurant_id: Number(restaurant?.id),
          user_id: session.user.id,
          party_size: size,
          party_leader_name: partyLeaderName || null,
          status: "waiting",
        })
        .select("id, created_at")
        .single();

      if (error) throw error;
      setGlobalWaitlistEntry({
        id: data.id,
        party_size: size,
        restaurant_id: Number(restaurant?.id),
      });
      setShowPartySizePicker(false);

      // Record "joined" notification event and refresh active entries
      addEvent({
        type: "joined",
        restaurantName: restaurant?.name ?? "Restaurant",
        restaurantId: String(restaurant?.id),
        entryId: data.id,
        partySize: size,
        timestamp: new Date().toISOString(),
      });
      refreshActive();

      router.push(`/waitlist/${restaurant?.id}?entry_id=${data.id}&party_size=${size}` as any);
    } catch (err: any) {
      Alert.alert("Error", err.message || "Could not join waitlist.");
    } finally {
      setJoining(false);
    }
  }, [partySize, customParty, session, partyLeaderName, restaurant?.id, router]);

  const handleToggleFavorite = useCallback(async () => {
    if (Platform.OS !== "web") {
      Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Medium);
    }

    if (!session?.user?.id) {
      Alert.alert("Sign In Required", "You must be signed in to favorite restaurants.");
      return;
    }

    const newFavoritedState = !isFavorited;
    setIsFavorited(newFavoritedState); // Optimistic generic update

    try {
      // First, get current favorites
      const { data: profileData, error: fetchError } = await supabase
        .from("profiles")
        .select("favorite_restaurants")
        .eq("id", session.user.id)
        .single();

      if (fetchError) throw fetchError;

      let currentFavorites = parseFavorites(profileData?.favorite_restaurants);

      if (newFavoritedState) {
        // Add if not present
        if (!currentFavorites.includes(Number(id))) {
          currentFavorites.push(Number(id));
        }
      } else {
        // Remove if present
        currentFavorites = currentFavorites.filter(favId => favId !== Number(id));
      }

      const { error: updateError } = await supabase
        .from("profiles")
        .update({ favorite_restaurants: currentFavorites })
        .eq("id", session.user.id);

      if (updateError) throw updateError;
    } catch (error) {
      console.error("Error toggling favorite:", error);
      // Revert optimistic update
      setIsFavorited(!newFavoritedState);
      Alert.alert("Error", "Could not update favorites. Please try again.");
    }
  }, [isFavorited, session, id]);

  const joinBtnScale = useSharedValue(1);
  const joinBtnStyle = useAnimatedStyle(() => ({
    transform: [{ scale: joinBtnScale.value }],
  }));

  const handleShare = useCallback(async () => {
    if (!restaurant) return;
    if (Platform.OS !== "web") Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
    try {
      const shareUrl = `${RESTAURANT_SHARE_WEB_BASE_URL}/share?restaurantId=${restaurant.id}`;
      await Share.share({
        title: restaurant.name,
        message: `Order from ${restaurant.name} on Rasvia!\n${shareUrl}`,
        url: shareUrl,
      });
    } catch {
      // user dismissed or share failed — silently ignore
    }
  }, [restaurant]);

  const isClosedByHours =
    hoursStatus?.status === "closed" ||
    hoursStatus?.status === "opening_soon";
  const isClosed =
    restaurant?.waitStatus === "darkgrey" ||
    isClosedByHours;
  const noWait = restaurant?.waitTime != null && restaurant.waitTime < 0;
  const waitlistClosed = restaurant?.waitlistOpen === false;

  const venueEmergencyClosed = restaurant?.waitStatus === "darkgrey";
  const scheduleAllowsWaitlist = waitlistAllowedBySchedule(
    hoursStatus,
    restaurantHours,
    restaurant?.waitlistEarlyOpenEnabled ?? false,
    restaurant?.waitlistEarlyOpenMinutes ?? 30,
  );
  /** Blocks the primary footer action when hours/emergency would block ordering or waitlist join */
  const footerClosedForWaitlistFlow =
    venueEmergencyClosed || (isClosedByHours && !scheduleAllowsWaitlist);

  /** Grey dine-in-only checkout only when opened from the waitlist screen (or equivalent URL with matching entry). */
  const checkoutFromWaitlist =
    !!waitlistEntryParam &&
    !!existingEntry &&
    existingEntry.id === waitlistEntryParam &&
    !isClosed &&
    !waitlistClosed;

  const waitlistAtOtherRestaurant =
    !!globalWaitlistEntry &&
    Number(globalWaitlistEntry.restaurant_id) !== Number(id);

  const showCheckWaitlistStatus =
    !checkoutFromWaitlist &&
    !!existingEntry &&
    !waitlistAtOtherRestaurant;

  const canSubmitWaitlistCheckout =
    checkoutFromWaitlist && cartItems.length > 0;

  const footerPrimaryDisabled = checkoutFromWaitlist
    ? !canSubmitWaitlistCheckout
    : !ownerRoleResolved ||
      (footerClosedForWaitlistFlow || noWait || waitlistClosed) ||
      waitlistAtOtherRestaurant;

  // Show loading or error state
  if (!restaurant) {
    return (
      <View className="flex-1 bg-rasvia-black items-center justify-center">
        <Text style={{ color: '#999999', fontFamily: 'Manrope_500Medium' }}>
          {loading ? 'Loading...' : 'Restaurant not found'}
        </Text>
      </View>
    );
  }

  // ── Coming Soon gate (all users; admins can bypass into menu) ────────────
  if (restaurant.isComingSoon && (!isAdmin || !adminBypassComingSoon)) {
    return (
      <View style={{ flex: 1, backgroundColor: "#0f0f0f" }}>
        {/* Hero image with dark overlay */}
        <View style={{ height: HERO_HEIGHT, position: "relative" }}>
          <Image
            source={{ uri: restaurant.image }}
            style={{ width: "100%", height: "100%", position: "absolute" }}
            resizeMode="cover"
          />
          <LinearGradient
            colors={["rgba(15,15,15,0.45)", "rgba(15,15,15,0.85)", "rgba(15,15,15,1)"]}
            locations={[0, 0.55, 1]}
            style={{ position: "absolute", top: 0, left: 0, right: 0, bottom: 0 }}
          />
          <SafeAreaView edges={["top"]} style={{ position: "absolute", top: 0, left: 0, right: 0 }}>
            <View style={{ flexDirection: "row", alignItems: "center", justifyContent: "space-between", paddingHorizontal: 16, paddingTop: 8 }}>
              <Pressable
                onPress={() => router.back()}
                style={{
                  backgroundColor: "rgba(15,15,15,0.6)",
                  width: 44, height: 44, borderRadius: 22,
                  alignItems: "center", justifyContent: "center",
                  borderWidth: 1, borderColor: "rgba(255,255,255,0.08)",
                }}
              >
                <ArrowLeft size={22} color="#f5f5f5" />
              </Pressable>
            </View>
          </SafeAreaView>
        </View>

        {/* Coming Soon content */}
        <View style={{ flex: 1, alignItems: "center", paddingHorizontal: 32, paddingTop: 40 }}>
          <View
            style={{
              backgroundColor: "rgba(255,153,51,0.12)",
              borderWidth: 1.5,
              borderColor: "rgba(255,153,51,0.5)",
              borderRadius: 28,
              paddingHorizontal: 18,
              paddingVertical: 8,
              flexDirection: "row",
              alignItems: "center",
              gap: 7,
              marginBottom: 20,
            }}
          >
            <AlertTriangle size={15} color="#FF9933" />
            <Text style={{ fontFamily: "Manrope_700Bold", color: "#FF9933", fontSize: 13, letterSpacing: 0.4 }}>
              Coming Soon
            </Text>
          </View>

          <Text
            style={{
              fontFamily: "BricolageGrotesque_800ExtraBold",
              color: "#f5f5f5",
              fontSize: 32,
              textAlign: "center",
              letterSpacing: -0.5,
              marginBottom: 12,
            }}
          >
            {restaurant.name}
          </Text>

          <Text
            style={{
              fontFamily: "Manrope_500Medium",
              color: "#888",
              fontSize: 15,
              textAlign: "center",
              lineHeight: 22,
              marginBottom: 36,
            }}
          >
            This restaurant is not yet officially on Rasvia.{"\n"}
            Check back soon — we&apos;re working on it!
          </Text>

          <View style={{ flexDirection: "row", alignItems: "center", gap: 10 }}>
            <Pressable
              onPress={() => router.back()}
              style={{
                backgroundColor: "#FF9933",
                borderRadius: 16,
                paddingHorizontal: 24,
                paddingVertical: 14,
              }}
            >
              <Text style={{ fontFamily: "Manrope_700Bold", color: "#0f0f0f", fontSize: 15 }}>
                Go Back
              </Text>
            </Pressable>
            {isAdmin && (
              <Pressable
                onPress={() => setAdminBypassComingSoon(true)}
                style={{
                  backgroundColor: "rgba(148,163,184,0.15)",
                  borderRadius: 16,
                  borderWidth: 1,
                  borderColor: "rgba(148,163,184,0.45)",
                  paddingHorizontal: 18,
                  paddingVertical: 14,
                }}
              >
                <Text style={{ fontFamily: "Manrope_700Bold", color: "#CBD5E1", fontSize: 14 }}>
                  View Menu (Admin)
                </Text>
              </Pressable>
            )}
          </View>
        </View>
      </View>
    );
  }

  return (
    <View className="flex-1 bg-rasvia-black">
      {/* Collapsed Sticky Header */}
      <Animated.View
        style={[
          collapsedHeaderStyle,
          {
            position: "absolute",
            top: 0,
            left: 0,
            right: 0,
            zIndex: 100,
            backgroundColor: "rgba(15, 15, 15, 0.97)",
            borderBottomWidth: 1,
            borderBottomColor: "#222222",
          },
        ]}
      >
        <SafeAreaView edges={["top"]}>
          <View
            style={{
              flexDirection: "row",
              alignItems: "center",
              paddingHorizontal: 16,
              paddingVertical: 10,
            }}
          >
            <Pressable
              onPress={() => {
                if (Platform.OS !== "web") {
                  Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
                }
                router.back();
              }}
              style={{
                width: 38,
                height: 38,
                borderRadius: 19,
                alignItems: "center",
                justifyContent: "center",
                backgroundColor: "#1a1a1a",
                borderWidth: 1,
                borderColor: "#2a2a2a",
              }}
            >
              <ArrowLeft size={20} color="#f5f5f5" />
            </Pressable>

            <Image
              source={{ uri: restaurant.image }}
              style={{
                width: 40,
                height: 40,
                borderRadius: 10,
                marginLeft: 12,
                borderWidth: 1,
                borderColor: "#2a2a2a",
              }}
              resizeMode="cover"
            />

            <View style={{ flex: 1, marginLeft: 12 }}>
              <Text
                numberOfLines={1}
                style={{
                  fontFamily: "BricolageGrotesque_700Bold",
                  color: "#f5f5f5",
                  fontSize: 17,
                  letterSpacing: -0.3,
                }}
              >
                {restaurant.name}
              </Text>
              <View style={{ flexDirection: "row", alignItems: "center", marginTop: 2 }}>
                {restaurant.tags.filter((t) => t.trim().toLowerCase() !== "indian").slice(0, 2).map((tag) => (
                  <View
                    key={tag}
                    style={{
                      backgroundColor: "rgba(255, 153, 51, 0.15)",
                      borderRadius: 10,
                      paddingHorizontal: 6,
                      paddingVertical: 1,
                      marginRight: 4,
                    }}
                  >
                    <Text
                      style={{
                        fontFamily: "Manrope_500Medium",
                        color: "#FF9933",
                        fontSize: 9,
                      }}
                    >
                      {tag}
                    </Text>
                  </View>
                ))}
              </View>
            </View>

            <View style={{ flexDirection: "row", alignItems: "center" }}>
              {canManage && (
                <Pressable
                  onPress={() => {
                    if (Platform.OS !== "web") Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
                    setShowEditModal(true);
                  }}
                  style={{
                    width: 34,
                    height: 34,
                    borderRadius: 17,
                    alignItems: "center",
                    justifyContent: "center",
                    backgroundColor: "#1a1a1a",
                    borderWidth: 1,
                    borderColor: isAdmin ? "rgba(255,153,51,0.4)" : "rgba(74,222,128,0.4)",
                    marginRight: 6,
                  }}
                >
                  <Settings size={16} color={isAdmin ? "#FF9933" : "#4ADE80"} />
                </Pressable>
              )}
              <Pressable
                onPress={handleToggleFavorite}
                style={{
                  width: 34,
                  height: 34,
                  borderRadius: 17,
                  alignItems: "center",
                  justifyContent: "center",
                  backgroundColor: "#1a1a1a",
                  borderWidth: 1,
                  borderColor: "#2a2a2a",
                  marginRight: 6,
                }}
              >
                <Heart
                  size={16}
                  color={isFavorited ? "#EF4444" : "#f5f5f5"}
                  fill={isFavorited ? "#EF4444" : "transparent"}
                />
              </Pressable>
              <Pressable
                onPress={handleShare}
                style={{
                  width: 34,
                  height: 34,
                  borderRadius: 17,
                  alignItems: "center",
                  justifyContent: "center",
                  backgroundColor: "#1a1a1a",
                  borderWidth: 1,
                  borderColor: "#2a2a2a",
                }}
              >
                <Share2 size={16} color="#f5f5f5" />
              </Pressable>
            </View>
          </View>
        </SafeAreaView>
      </Animated.View>

      {/* Main ScrollView */}
      <Animated.ScrollView
        onScroll={scrollHandler}
        scrollEventThrottle={16}
        showsVerticalScrollIndicator={false}
        contentContainerStyle={{ paddingBottom: 120 }}
        refreshControl={
          <RefreshControl
            refreshing={refreshing}
            onRefresh={handleRefresh}
            tintColor="#FF9933"
            colors={["#FF9933"]}
            progressBackgroundColor="#18181b"
            progressViewOffset={
              Platform.OS === "ios" ? insets.top + 110 : insets.top + 64
            }
          />
        }
      >
        {/* Hero — fixed height container, content parallaxes inside; rounded top matches card UI */}
        <View
          style={{
            height: HERO_HEIGHT,
            overflow: "hidden",
            borderTopLeftRadius: 20,
            borderTopRightRadius: 20,
          }}
        >
          <Animated.View
            style={[heroInnerStyle, { position: "absolute", top: 0, left: 0, right: 0, height: HERO_HEIGHT }]}
          >
            <Image
              source={{ uri: restaurant.image }}
              style={{ width: "100%", height: HERO_HEIGHT, position: "absolute", top: 0, left: 0, right: 0 }}
              resizeMode="cover"
            />
            <LinearGradient
              colors={[
                "rgba(15,15,15,0.5)",
                "transparent",
                "rgba(15,15,15,0.7)",
                "rgba(15,15,15,1)",
              ]}
              locations={[0, 0.3, 0.7, 1]}
              style={{
                position: "absolute",
                top: 0,
                left: 0,
                right: 0,
                bottom: 0,
              }}
            />

            {/* Top Nav over hero */}
            <SafeAreaView edges={["top"]} className="absolute top-0 left-0 right-0">
              <View className="flex-row items-center justify-between px-5 pt-2">
                <Pressable
                  onPress={() => {
                    if (Platform.OS !== "web") {
                      Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
                    }
                    router.back();
                  }}
                  style={{
                    backgroundColor: "rgba(15, 15, 15, 0.6)",
                    width: 44,
                    height: 44,
                    borderRadius: 22,
                    alignItems: "center",
                    justifyContent: "center",
                    borderWidth: 1,
                    borderColor: "rgba(255,255,255,0.08)",
                  }}
                >
                  <ArrowLeft size={22} color="#f5f5f5" />
                </Pressable>
                <View className="flex-row">
                  {canManage && (
                    <Pressable
                      className="mr-2"
                      onPress={() => {
                        if (Platform.OS !== "web") Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
                        setShowEditModal(true);
                      }}
                      style={{
                        backgroundColor: "rgba(15, 15, 15, 0.6)",
                        width: 44,
                        height: 44,
                        borderRadius: 22,
                        alignItems: "center",
                        justifyContent: "center",
                        borderWidth: 1,
                        borderColor: isAdmin ? "rgba(255,153,51,0.4)" : "rgba(74,222,128,0.4)",
                      }}
                    >
                      <Settings size={20} color={isAdmin ? "#FF9933" : "#4ADE80"} />
                    </Pressable>
                  )}
                  <Pressable
                    className="mr-2"
                    onPress={handleToggleFavorite}
                    style={{
                      backgroundColor: "rgba(15, 15, 15, 0.6)",
                      width: 44,
                      height: 44,
                      borderRadius: 22,
                      alignItems: "center",
                      justifyContent: "center",
                      borderWidth: 1,
                      borderColor: "rgba(255,255,255,0.08)",
                    }}
                  >
                    <Heart
                      size={20}
                      color={isFavorited ? "#EF4444" : "#f5f5f5"}
                      fill={isFavorited ? "#EF4444" : "transparent"}
                    />
                  </Pressable>
                  <Pressable
                    onPress={handleShare}
                    style={{
                      backgroundColor: "rgba(15, 15, 15, 0.6)",
                      width: 44,
                      height: 44,
                      borderRadius: 22,
                      alignItems: "center",
                      justifyContent: "center",
                      borderWidth: 1,
                      borderColor: "rgba(255,255,255,0.08)",
                    }}
                  >
                    <Share2 size={20} color="#f5f5f5" />
                  </Pressable>
                </View>
              </View>
            </SafeAreaView>

            {/* Bottom Content on Image */}
            <Animated.View
              style={[heroContentStyle, { position: "absolute", bottom: 0, left: 0, right: 0, paddingHorizontal: 20, paddingBottom: 8 }]}
            >
              <View className="flex-row items-center mb-2">
                {restaurant.tags.filter((t) => t.trim().toLowerCase() !== "indian").map((tag) => (
                  <View
                    key={tag}
                    className="rounded-full px-2.5 py-0.5 mr-2"
                    style={{
                      backgroundColor: "rgba(255, 153, 51, 0.35)",
                      borderWidth: 1,
                      borderColor: "rgba(255, 153, 51, 0.5)",
                    }}
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
                  fontSize: 40,
                  lineHeight: 44,
                  letterSpacing: -0.5,
                }}
              >
                {restaurant.name}
              </Text>
            </Animated.View>
          </Animated.View>
        </View>

        {/* Info Section */}
        <View className="px-5 pt-3 pb-4">
          {/* Stats Row — 3 equal separate rounded rectangles */}
          <View style={{ flexDirection: "row", gap: 8 }}>

            {/* ── Rating / Reviews (fully tappable) ── */}
            <Pressable
              onPress={() => {
                Haptics.selectionAsync();
                setShowReviews(true);
              }}
              style={{
                flex: 1,
                alignItems: "center",
                paddingVertical: 14,
                backgroundColor: "#1a1a1a",
                borderRadius: 16,
                borderWidth: 2,
                borderColor: "rgba(255, 153, 51, 0.55)",
              }}
            >
              <View style={{ flexDirection: "row", alignItems: "center" }}>
                <Star size={13} color="#FF9933" fill="#FF9933" />
                <Text
                  style={{
                    fontFamily: "JetBrainsMono_600SemiBold",
                    color: "#f5f5f5",
                    fontSize: 16,
                    marginLeft: 4,
                  }}
                >
                  {liveAvgRating === null
                    ? "…"
                    : liveAvgRating > 0
                    ? liveAvgRating.toFixed(1)
                    : "—"}
                </Text>
              </View>
              <Text
                style={{
                  fontFamily: "Manrope_500Medium",
                  color: "#FF9933",
                  fontSize: 11,
                  marginTop: 3,
                }}
              >
                {liveReviewCount === null
                  ? "…"
                  : `${liveReviewCount.toLocaleString()} review${liveReviewCount !== 1 ? "s" : ""}`}
              </Text>
            </Pressable>

            {/* ── Wait time ── */}
            <View
              style={{
                flex: 1,
                alignItems: "center",
                justifyContent: "center",
                paddingVertical: 14,
                backgroundColor: "#1a1a1a",
                borderRadius: 16,
                borderWidth: 1,
                borderColor: "#2a2a2a",
              }}
            >
              {isClosed || waitlistClosed ? (
                <>
                  <View style={{ flexDirection: "row", alignItems: "center", justifyContent: "center" }}>
                    <Clock size={13} color="#999999" />
                    <Text
                      style={{
                        fontFamily: "JetBrainsMono_600SemiBold",
                        color: "#999999",
                        fontSize: 16,
                        marginLeft: 4,
                      }}
                    >
                      —
                    </Text>
                  </View>
                  <Text style={{ fontFamily: "Manrope_500Medium", color: "#999999", fontSize: 11, marginTop: 3 }}>
                    closed
                  </Text>
                </>
              ) : (
                <>
                  <View
                    style={{
                      flexDirection: "row",
                      alignItems: "center",
                      justifyContent: "center",
                    }}
                  >
                    <Clock size={13} color="#FF9933" />
                    <View style={{ marginLeft: 4 }}>
                      <WaitBadge
                        waitTime={restaurant.waitTime}
                        status={restaurant.waitStatus}
                        size="sm"
                      />
                    </View>
                  </View>
                  <Text
                    style={{
                      fontFamily: "Manrope_500Medium",
                      color: "#999999",
                      fontSize: 11,
                      marginTop: 3,
                      textAlign: "center",
                    }}
                  >
                    wait time
                  </Text>
                </>
              )}
            </View>

            {/* ── In queue ── */}
            <View
              style={{
                flex: 1,
                alignItems: "center",
                paddingVertical: 14,
                backgroundColor: "#1a1a1a",
                borderRadius: 16,
                borderWidth: 1,
                borderColor: "#2a2a2a",
              }}
            >
              <View style={{ flexDirection: "row", alignItems: "center" }}>
                <Users size={13} color="#FF9933" />
                <Text
                  style={{
                    fontFamily: "JetBrainsMono_600SemiBold",
                    color: "#f5f5f5",
                    fontSize: 16,
                    marginLeft: 4,
                  }}
                >
                  {liveQueueCount ?? restaurant.queueLength}
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

          </View>

          {/* Address */}
          <Pressable
            className="flex-row items-center mt-4"
            onPress={() => {
              if (Platform.OS !== "web") {
                Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
              }
              if (restaurant.lat && restaurant.long) {
                router.push(
                  `/map?targetLat=${restaurant.lat}&targetLng=${restaurant.long}&restaurantId=${restaurant.id}` as any
                );
              }
            }}
          >
            <MapPin size={13} color="#999999" />
            <Text
              style={{
                fontFamily: "Manrope_500Medium",
                color: "#999999",
                fontSize: 13,
                marginLeft: 4,
                textDecorationLine: "underline",
              }}
            >
              {restaurant.address} · {restaurant.distance}
            </Text>
          </Pressable>

          {/* Hours status badge — tap to see full schedule */}
          {hoursStatus && (
            <View style={{ marginTop: 8 }}>
              <HoursStatusBadge
                statusResult={hoursStatus}
                hours={restaurantHours}
                size="md"
                onManageHoursPress={
                  canManage
                    ? () => {
                        setOpenHoursEditorOnOpen(true);
                        setShowEditModal(true);
                      }
                    : undefined
                }
              />
            </View>
          )}

          {!waitlistClosed && isClosedByHours && (
              <View
                style={{
                  marginTop: 8,
                  flexDirection: "row",
                  alignItems: "center",
                  gap: 6,
                  alignSelf: "flex-start",
                  backgroundColor: "rgba(255,153,51,0.10)",
                  borderRadius: 10,
                  paddingHorizontal: 10,
                  paddingVertical: 6,
                  borderWidth: 1,
                  borderColor: "rgba(255,153,51,0.35)",
                }}
              >
                <Clock size={12} color="#FF9933" />
                <Text
                  style={{
                    fontFamily: "Manrope_600SemiBold",
                    color: "#FF9933",
                    fontSize: 12,
                  }}
                >
                  Opens soon · Waitlist open
                </Text>
              </View>
            )}

          {/* Veg / Non-Veg + Halal indicators */}
          {(() => {
            const tags = (restaurant?.tags ?? []);
            const lowerTags = tags.map((t) => t.toLowerCase());

            // Vegetarian restaurant detection
            const isVegRestaurant = lowerTags.some(
              (t) => t.includes("vegetarian") || t.includes("vegan")
            );

            // Determine today's day name (CST/CDT)
            const todayName = new Date().toLocaleDateString('en-US', { timeZone: 'America/Chicago', weekday: 'short' });

            // Show veg indicator?
            const isVegUser = userDietaryType === "Vegetarian";
            const isTodayRestrictedDay = userDietaryType === "Non-Veg" && userRestrictedDays.includes(todayName);
            const shouldShowVeg = isVegUser || isTodayRestrictedDay;

            // Halal indicator
            const isHalalUser = userDietaryType === "Halal";
            const hasHalalTag = lowerTags.some((t) => t.includes("halal"));
            const explicitAllHalal = lowerTags.some(
              (t) =>
                t.includes("all halal") ||
                t.includes("100% halal") ||
                t.includes("fully halal") ||
                t.includes("only halal")
            );
            const nonHalalHints = ["non-halal", "non halal", "pork", "alcohol", "wine", "beer"];
            const hasNonHalalHint = lowerTags.some((t) =>
              nonHalalHints.some((hint) => t.includes(hint))
            );
            const shouldShowHalal = isHalalUser;
            const halalSafe = hasHalalTag && !hasNonHalalHint;

            if (!shouldShowVeg && !shouldShowHalal) return null;

            return (
              <>
                {shouldShowVeg && (
                  isVegRestaurant ? (
                    <View style={{
                      flexDirection: "row",
                      alignItems: "center",
                      gap: 5,
                      marginTop: 8,
                      backgroundColor: "rgba(20,184,166,0.08)",
                      borderRadius: 10,
                      paddingHorizontal: 10,
                      paddingVertical: 6,
                      alignSelf: "flex-start",
                      borderWidth: 1,
                      borderColor: "rgba(20,184,166,0.25)",
                    }}>
                      <Leaf size={12} color="#14B8A6" />
                      <Text style={{ fontFamily: "Manrope_600SemiBold", color: "#14B8A6", fontSize: 12 }}>
                        This is a vegetarian restaurant
                      </Text>
                    </View>
                  ) : (
                    <View style={{
                      flexDirection: "row",
                      alignItems: "center",
                      gap: 5,
                      marginTop: 8,
                      backgroundColor: "rgba(245,158,11,0.08)",
                      borderRadius: 10,
                      paddingHorizontal: 10,
                      paddingVertical: 6,
                      alignSelf: "flex-start",
                      borderWidth: 1,
                      borderColor: "rgba(245,158,11,0.25)",
                    }}>
                      <AlertTriangle size={12} color="#F59E0B" />
                      <Text style={{ fontFamily: "Manrope_600SemiBold", color: "#F59E0B", fontSize: 12 }}>
                        This restaurant may contain non-vegetarian items
                      </Text>
                    </View>
                  )
                )}

                {shouldShowHalal && (
                  <View style={{
                    flexDirection: "row",
                    alignItems: "center",
                    gap: 5,
                    marginTop: shouldShowVeg ? 6 : 8,
                    backgroundColor: halalSafe
                      ? (explicitAllHalal ? "rgba(22,163,74,0.10)" : "rgba(37,99,235,0.10)")
                      : "rgba(245,158,11,0.10)",
                    borderRadius: 10,
                    paddingHorizontal: 10,
                    paddingVertical: 6,
                    alignSelf: "flex-start",
                    borderWidth: 1,
                    borderColor: halalSafe
                      ? (explicitAllHalal ? "rgba(22,163,74,0.35)" : "rgba(37,99,235,0.35)")
                      : "rgba(245,158,11,0.35)",
                  }}>
                    <ShieldCheck
                      size={12}
                      color={halalSafe ? (explicitAllHalal ? "#22C55E" : "#60A5FA") : "#F59E0B"}
                    />
                    <Text
                      style={{
                        fontFamily: "Manrope_600SemiBold",
                        color: halalSafe ? (explicitAllHalal ? "#22C55E" : "#60A5FA") : "#F59E0B",
                        fontSize: 12,
                      }}
                    >
                      {halalSafe
                        ? (explicitAllHalal
                          ? "This restaurant is fully halal"
                          : "This restaurant has halal options")
                        : "No halal marker found. Ask staff before ordering."}
                    </Text>
                  </View>
                )}
              </>
            );
          })()}

          {/* Description */}
          <Text
            style={{
              fontFamily: "Manrope_500Medium",
              color: "#777777",
              fontSize: 15,
              lineHeight: 23,
              marginTop: 12,
            }}
          >
            {restaurant.description}
          </Text>
        </View>

        {/* Menu Section */}
        <View>
          <View className="px-5 mt-4 mb-4">
            <Text
              style={{
                fontFamily: "BricolageGrotesque_800ExtraBold",
                color: "#f5f5f5",
                fontSize: 24,
              }}
            >
              Visual Menu
            </Text>
            <Text
              style={{
                fontFamily: "Manrope_500Medium",
                color: "#999999",
                fontSize: 14,
                marginTop: 2,
              }}
            >
              Tap to explore, + to add to cart
            </Text>
          </View>

          {/* ─ Meal-period filter bar ─ */}
          {(() => {
            type FilterDef = { key: MenuFilter; label: string; color: string; bg: string; border: string; icon: any };
            const FILTER_DEFS: FilterDef[] = [
              { key: 'all', label: 'All Day', color: '#38BDF8', bg: 'rgba(56,189,248,0.15)', border: 'rgba(56,189,248,0.45)', icon: null },
              { key: 'breakfast', label: 'Breakfast', color: '#F97316', bg: 'rgba(249,115,22,0.15)', border: 'rgba(249,115,22,0.4)', icon: Coffee },
              { key: 'lunch', label: 'Lunch', color: '#22C55E', bg: 'rgba(34,197,94,0.15)', border: 'rgba(34,197,94,0.4)', icon: Sun },
              { key: 'dinner', label: 'Dinner', color: '#818CF8', bg: 'rgba(129,140,248,0.15)', border: 'rgba(129,140,248,0.4)', icon: Moon },
              { key: 'specials', label: 'Specials', color: '#F59E0B', bg: 'rgba(245,158,11,0.15)', border: 'rgba(245,158,11,0.4)', icon: SparklesIcon },
            ];
            const toggleFilter = (key: MenuFilter, disabled: boolean) => {
              if (disabled) return;
              setSelectedMenuFilters((prev) => {
                // All Day is a distinct mode; toggling it clears meal-period filters.
                if (key === "all") {
                  return prev.includes("all") ? prev.filter((f) => f !== "all") : ["all"];
                }

                let next = prev.filter((f) => f !== "all");
                if (next.includes(key)) {
                  next = next.filter((f) => f !== key);
                } else {
                  next = [...next, key];
                }

                // If breakfast + lunch + dinner are all selected, collapse to All Day.
                if (
                  next.includes("breakfast") &&
                  next.includes("lunch") &&
                  next.includes("dinner")
                ) {
                  return ["all"];
                }

                return next;
              });
            };
            const topRow = FILTER_DEFS.slice(0, 3);
            const bottomRow = FILTER_DEFS.slice(3);

            return (
              <View style={{ paddingHorizontal: 16, marginBottom: 12 }}>
                <View style={{ flexDirection: "row", justifyContent: "space-between", marginBottom: 8 }}>
                  {topRow.map(f => {
                    const isActive = selectedMenuFilters.includes(f.key);
                    const Icon = f.icon;
                    const isDisabled = !hasItemsForFilter(f.key);
                    return (
                      <Pressable
                        key={f.key}
                        disabled={isDisabled}
                        onPress={() => {
                          if (Platform.OS !== 'web') Haptics.selectionAsync();
                          toggleFilter(f.key, isDisabled);
                        }}
                        style={{
                          flexDirection: 'row',
                          alignItems: 'center',
                          justifyContent: "center",
                          gap: 5,
                          width: "31.5%",
                          paddingVertical: 8,
                          borderRadius: 20,
                          backgroundColor: isDisabled ? "#141414" : (isActive ? f.bg : '#1a1a1a'),
                          borderWidth: 1,
                          borderColor: isDisabled ? "#1f1f1f" : (isActive ? f.border : '#2a2a2a'),
                          opacity: isDisabled ? 0.55 : 1,
                        }}
                      >
                        {Icon && <Icon size={12} color={isDisabled ? "#4d4d4d" : (isActive ? f.color : '#666')} />}
                        <Text style={{
                          fontFamily: isActive ? 'Manrope_700Bold' : 'Manrope_500Medium',
                          fontSize: 13,
                          color: isDisabled ? "#575757" : (isActive ? f.color : '#888'),
                        }}>
                          {f.label}
                        </Text>
                      </Pressable>
                    );
                  })}
                </View>
                <View style={{ flexDirection: "row", justifyContent: "center", gap: 10 }}>
                  {bottomRow.map(f => {
                    const isActive = selectedMenuFilters.includes(f.key);
                    const Icon = f.icon;
                    const isDisabled = !hasItemsForFilter(f.key);
                    return (
                      <Pressable
                        key={f.key}
                        disabled={isDisabled}
                        onPress={() => {
                          if (Platform.OS !== 'web') Haptics.selectionAsync();
                          toggleFilter(f.key, isDisabled);
                        }}
                        style={{
                          flexDirection: 'row',
                          alignItems: 'center',
                          justifyContent: "center",
                          gap: 5,
                          width: "31.5%",
                          paddingVertical: 8,
                          borderRadius: 20,
                          backgroundColor: isDisabled ? "#141414" : (isActive ? f.bg : '#1a1a1a'),
                          borderWidth: 1,
                          borderColor: isDisabled ? "#1f1f1f" : (isActive ? f.border : '#2a2a2a'),
                          opacity: isDisabled ? 0.55 : 1,
                        }}
                      >
                        {Icon && <Icon size={12} color={isDisabled ? "#4d4d4d" : (isActive ? f.color : '#666')} />}
                        <Text style={{
                          fontFamily: isActive ? 'Manrope_700Bold' : 'Manrope_500Medium',
                          fontSize: 13,
                          color: isDisabled ? "#575757" : (isActive ? f.color : '#888'),
                        }}>
                          {f.label}
                        </Text>
                      </Pressable>
                    );
                  })}
                </View>
              </View>
            );
          })()}

          <View className="px-4">
            <MenuEditor
              menu={menu.filter(m => {
                if (selectedMenuFilters.length === 0) return true; // no selection = show everything
                return selectedMenuFilters.some((filter) => itemMatchesFilter(m, filter));
              })}
              setMenu={setMenu}
              onItemPress={(item) => {
                if (Platform.OS !== "web") Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
                setSelectedItem(item);
              }}
              onQuickAdd={(item) => handleAddToCart(item)}
              restaurantId={id}
              onContributeImage={(item) => setCommunityImageTarget(item)}
            />
          </View>
        </View>
      </Animated.ScrollView>

      {/* Sticky Footer */}
      <View
        className="absolute bottom-0 left-0 right-0"
        style={{
          backgroundColor: "rgba(15, 15, 15, 0.97)",
          borderTopWidth: 1,
          borderTopColor: "#222222",
        }}
      >
        <SafeAreaView edges={["bottom"]}>
          <View className="flex-row items-center px-5 py-3">
            {cartItems.length > 0 && (
              <Pressable
                onPress={() => {
                  if (Platform.OS !== "web") {
                    Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
                  }
                  setShowCart(true);
                }}
                className="mr-3"
                style={{
                  backgroundColor: "#1a1a1a",
                  width: 52,
                  height: 52,
                  borderRadius: 26,
                  alignItems: "center",
                  justifyContent: "center",
                  borderWidth: 1,
                  borderColor: "#333333",
                  position: "relative",
                }}
              >
                <ShoppingBag size={22} color="#f5f5f5" />
                <View
                  style={{
                    position: "absolute",
                    top: -4,
                    right: -4,
                    backgroundColor: "#FF9933",
                    width: 22,
                    height: 22,
                    borderRadius: 11,
                    alignItems: "center",
                    justifyContent: "center",
                    borderWidth: 2,
                    borderColor: "#0f0f0f",
                  }}
                >
                  <Text
                    style={{
                      fontFamily: "JetBrainsMono_600SemiBold",
                      color: "#0f0f0f",
                      fontSize: 10,
                    }}
                  >
                    {cartItems.reduce((sum, ci) => sum + ci.quantity, 0)}
                  </Text>
                </View>
              </Pressable>
            )}

            <View style={{ flex: 1 }}>
                <Animated.View style={[joinBtnStyle]}>
                  <Pressable
                    onPress={
                      !ownerRoleResolved
                        ? undefined
                        : footerPrimaryDisabled
                          ? undefined
                          : () => {
                              if (checkoutFromWaitlist && canSubmitWaitlistCheckout) {
                                if (Platform.OS !== "web") {
                                  Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Medium);
                                }
                                setCheckoutOrderType("dine_in");
                                setLockCheckoutOrderType(true);
                                setShowCheckout(true);
                                return;
                              }
                              if (showCheckWaitlistStatus && existingEntry) {
                                if (Platform.OS !== "web") {
                                  Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Medium);
                                }
                                router.push(
                                  `/waitlist/${id}?entry_id=${existingEntry.id}&party_size=${existingEntry.party_size}` as any
                                );
                                return;
                              }
                              handleJoinWaitlist();
                            }
                    }
                    disabled={footerPrimaryDisabled}
                    onPressIn={() => {
                      if (!ownerRoleResolved) return;
                      if (
                        checkoutFromWaitlist ||
                        showCheckWaitlistStatus ||
                        (!footerClosedForWaitlistFlow && !noWait && !waitlistClosed)
                      ) {
                        joinBtnScale.value = withSpring(0.95);
                      }
                    }}
                    onPressOut={() => {
                      if (!ownerRoleResolved) return;
                      if (
                        checkoutFromWaitlist ||
                        showCheckWaitlistStatus ||
                        (!footerClosedForWaitlistFlow && !noWait && !waitlistClosed)
                      ) {
                        joinBtnScale.value = withSpring(1);
                      }
                    }}
                    className="rounded-2xl py-4 items-center flex-row justify-center"
                    style={{
                      backgroundColor: !ownerRoleResolved
                        ? "#333333"
                        : footerPrimaryDisabled
                          ? "#333333"
                          : "#FF9933",
                      shadowColor: !ownerRoleResolved
                        ? "transparent"
                        : footerPrimaryDisabled
                          ? "transparent"
                          : "#FF9933",
                      shadowOffset: { width: 0, height: 4 },
                      shadowOpacity: !ownerRoleResolved
                        ? 0
                        : footerPrimaryDisabled
                          ? 0
                          : 0.4,
                      shadowRadius: 16,
                      elevation: !ownerRoleResolved
                        ? 0
                        : footerPrimaryDisabled
                          ? 0
                          : 10,
                    }}
                  >
                    {checkoutFromWaitlist ? (
                      <ShoppingBag
                        size={18}
                        color={
                          !ownerRoleResolved || footerPrimaryDisabled ? "#999999" : "#0f0f0f"
                        }
                        strokeWidth={2.5}
                      />
                    ) : showCheckWaitlistStatus ? (
                      <Users
                        size={18}
                        color={!ownerRoleResolved || footerPrimaryDisabled ? "#999999" : "#0f0f0f"}
                        strokeWidth={2.5}
                      />
                    ) : (
                      <Clock
                        size={18}
                        color={
                          !ownerRoleResolved || footerClosedForWaitlistFlow || waitlistClosed ? "#999999" : "#0f0f0f"
                        }
                        strokeWidth={2.5}
                      />
                    )}
                    <Text
                      style={{
                        fontFamily: "BricolageGrotesque_700Bold",
                        color: !ownerRoleResolved
                          ? "#999999"
                          : footerPrimaryDisabled
                            ? "#999999"
                            : "#0f0f0f",
                        fontSize: 17,
                        marginLeft: 8,
                      }}
                    >
                      {!ownerRoleResolved
                        ? "Loading..."
                        : checkoutFromWaitlist
                          ? "Checkout"
                          : waitlistAtOtherRestaurant
                            ? "Order"
                            : showCheckWaitlistStatus
                              ? "Check waitlist status"
                              : waitlistClosed
                                ? "Waitlist Closed"
                                : footerClosedForWaitlistFlow
                                  ? "Currently Closed"
                                  : "Order"}
                    </Text>
                  </Pressable>
                </Animated.View>
                {waitlistAtOtherRestaurant && (
                  <Text
                    style={{
                      fontFamily: "Manrope_500Medium",
                      color: "#666666",
                      fontSize: 11,
                      textAlign: "center",
                      marginTop: 6,
                      lineHeight: 15,
                    }}
                  >
                    You can only join one waitlist at a time
                  </Text>
                )}
              </View>
            
          </View>
        </SafeAreaView>
      </View>

      {selectedItem && (
        <FoodDetailModal
          item={selectedItem}
          onClose={() => setSelectedItem(null)}
          onAddToCart={() => handleAddToCart(selectedItem)}
          showContributeImage={!selectedItem.hasOfficialImage && !selectedItem.communityImageCredit}
          onContributeImage={() => setCommunityImageTarget(selectedItem)}
          onOpenSettings={
            canManage
              ? () => {
                  setShowSelectedItemSettings(true);
                }
              : undefined
          }
        />
      )}

      <MenuItemDetailSettingsModal
        visible={showSelectedItemSettings}
        item={selectedItem}
        onClose={() => setShowSelectedItemSettings(false)}
        onSaved={(updated) => {
          setMenu((prev) => prev.map((m) => (m.id === updated.id ? updated : m)));
          setSelectedItem(updated);
        }}
        onDeleted={(deletedId) => {
          setMenu((prev) => prev.filter((m) => m.id !== deletedId));
          if (selectedItem?.id === deletedId) {
            setSelectedItem(null);
          }
          setShowSelectedItemSettings(false);
        }}
      />

      {showCart && (
        <GroupCartDrawer
          items={cartItems}
          members={localGroupMembers}
          onClose={() => setShowCart(false)}
          onUpdateQuantity={handleUpdateQuantity}
          isGroupMode={hasActiveGroupSession}
          isClosed={isClosed}
          onCheckout={() => {
            setShowCart(false);
            if (checkoutFromWaitlist) {
              setCheckoutOrderType("dine_in");
              setLockCheckoutOrderType(true);
            } else {
              setLockCheckoutOrderType(false);
            }
            setShowCheckout(true);
          }}
          onShare={async () => {
            if (!session?.user?.id) return;
            const key = `rasvia_active_group_order_${session.user.id}`;
            const raw = await SecureStore.getItemAsync(key);
            if (!raw) {
              Alert.alert("Share Cart", "No active group session found.");
              return;
            }
            try {
              const stored = JSON.parse(raw);
              const sessionId = stored?.sessionId;
              if (!sessionId) {
                Alert.alert("Share Cart", "No active group session found.");
                return;
              }
              const shareUrl = `${GROUP_ORDER_WEB_BASE_URL}/join?id=${sessionId}`;
              if (Platform.OS === "web") {
                await navigator.clipboard?.writeText(shareUrl);
              } else {
                await ExpoClipboard.setStringAsync(shareUrl);
              }
              Alert.alert("Share Cart", "Group link copied to clipboard!");
            } catch {
              Alert.alert("Share Cart", "Could not copy link.");
            }
          }}
        />
      )}

      <CheckoutModal
        visible={showCheckout}
        restaurantId={restaurant?.id ?? ""}
        restaurantName={restaurant?.name ?? ""}
        cartItems={cartItems}
        initialOrderType={checkoutOrderType}
        lockOrderType={lockCheckoutOrderType}
        onAddMoreItems={() => setShowCheckout(false)}
        waitlistEntryId={checkoutFromWaitlist ? existingEntry?.id : undefined}
        onUpdateQuantity={handleUpdateQuantity}
        onClose={() => setShowCheckout(false)}
        initialCustomerName={partyLeaderName}
        onOrderPlaced={(orderId, orderType) => {
          setCartItems([]);
          // Keep modal open so CheckoutModal success screen shows; it closes via onClose when user taps Done
          if (orderType === 'dine_in') {
            if (checkoutFromWaitlist && existingEntry) {
              router.push(`/waitlist/${restaurant?.id}?entry_id=${existingEntry.id}&party_size=${existingEntry.party_size}` as any);
            } else if (!checkoutFromWaitlist) {
              setCustomParty("");
              setShowPartySizePicker(true);
            }
          }
        }}
      />

      {/* ── Order Type Picker (Takeout vs Dine In) ── */}
      <Modal
        visible={showOrderTypePicker}
        transparent
        animationType="slide"
        onRequestClose={() => setShowOrderTypePicker(false)}
      >
        <View style={{ flex: 1, backgroundColor: "rgba(0,0,0,0.6)", justifyContent: "flex-end" }}>
          <Pressable style={{ flex: 1 }} onPress={() => setShowOrderTypePicker(false)} />
          <View style={{
            backgroundColor: "#1a1a1a",
            borderTopLeftRadius: 28,
            borderTopRightRadius: 28,
            padding: 28,
            paddingBottom: Platform.OS === "ios" ? 44 : 28,
            borderWidth: 1,
            borderColor: "#2a2a2a",
          }}>
            <Text style={{ fontFamily: "BricolageGrotesque_800ExtraBold", color: "#f5f5f5", fontSize: 24, marginBottom: 6 }}>
              How would you like to order?
            </Text>
            <Text style={{ fontFamily: "Manrope_500Medium", color: "#777", fontSize: 14, marginBottom: 28 }}>
              at {restaurant?.name}
            </Text>

            {/* Dine In */}
            <Pressable
              onPress={() => {
                if (Platform.OS !== "web") Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Medium);
                setShowOrderTypePicker(false);
                // Already on the waitlist → go to status instead of creating another entry
                if (existingEntry) {
                  router.push(
                    `/waitlist/${restaurant?.id}?entry_id=${existingEntry.id}&party_size=${existingEntry.party_size}` as any
                  );
                  return;
                }
                // Dine In → join waitlist (party size)
                setCustomParty("");
                setShowPartySizePicker(true);
              }}
              style={{
                backgroundColor: "rgba(255,153,51,0.1)",
                borderRadius: 18,
                padding: 20,
                marginBottom: 12,
                flexDirection: "row",
                alignItems: "center",
                borderWidth: 1.5,
                borderColor: "rgba(255,153,51,0.35)",
                opacity: 1,
              }}
            >
              <View style={{ width: 46, height: 46, borderRadius: 23, backgroundColor: "rgba(255,153,51,0.15)", alignItems: "center", justifyContent: "center", marginRight: 14 }}>
                <UtensilsCrossed size={22} color="#FF9933" />
              </View>
              <View style={{ flex: 1 }}>
                <Text style={{ fontFamily: "BricolageGrotesque_700Bold", color: "#f5f5f5", fontSize: 18 }}>Dine In</Text>
                <Text style={{ fontFamily: "Manrope_500Medium", color: "#777", fontSize: 13, marginTop: 2 }}>
                  {`Join the waitlist · ${restaurant?.waitTime != null && restaurant.waitTime > 0 ? `${restaurant.waitTime} min wait` : "No wait"}`}
                </Text>
              </View>
            </Pressable>

            {/* Takeout — Individual */}
            <Pressable
              onPress={() => {
                if (existingEntry) {
                  Alert.alert(
                    "Not available",
                    "Takeout isn't available while you're on the waitlist. Use Checkout to pre-order for your table (dine-in)."
                  );
                  return;
                }
                if (Platform.OS !== "web") Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Medium);
                setShowOrderTypePicker(false);
                setCheckoutOrderType("takeout");
                setLockCheckoutOrderType(true);
                setShowCheckout(true);
              }}
              style={{
                backgroundColor: "rgba(20,184,166,0.08)",
                borderRadius: 18,
                padding: 20,
                marginBottom: 12,
                flexDirection: "row",
                alignItems: "center",
                borderWidth: 1.5,
                borderColor: "rgba(20,184,166,0.25)",
                opacity: 1,
              }}
            >
              <View style={{ width: 46, height: 46, borderRadius: 23, backgroundColor: "rgba(20,184,166,0.12)", alignItems: "center", justifyContent: "center", marginRight: 14 }}>
                <Truck size={22} color="#14B8A6" />
              </View>
              <View style={{ flex: 1 }}>
                <Text style={{ fontFamily: "BricolageGrotesque_700Bold", color: "#f5f5f5", fontSize: 18 }}>Takeout</Text>
                <Text style={{ fontFamily: "Manrope_500Medium", color: "#777", fontSize: 13, marginTop: 2 }}>
                  Pick up your order when ready
                </Text>
              </View>
            </Pressable>

            {/* Group Order */}
            <Pressable
              onPress={() => {
                if (isClosed) {
                  Alert.alert("Restaurant Closed", "Group orders are not available while the restaurant is closed.");
                  return;
                }
                if (Platform.OS !== "web") Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Medium);
                setShowOrderTypePicker(false);
                router.push(`/host_party?restaurantId=${restaurant?.id}` as any);
              }}
              style={{
                backgroundColor: isClosed ? "#141414" : "rgba(139,92,246,0.08)",
                borderRadius: 18,
                padding: 20,
                flexDirection: "row",
                alignItems: "center",
                borderWidth: 1.5,
                borderColor: isClosed ? "#1e1e1e" : "rgba(139,92,246,0.25)",
                opacity: isClosed ? 0.5 : 1,
              }}
            >
              <View style={{ width: 46, height: 46, borderRadius: 23, backgroundColor: isClosed ? "#1a1a1a" : "rgba(139,92,246,0.12)", alignItems: "center", justifyContent: "center", marginRight: 14 }}>
                <Users size={22} color={isClosed ? "#555" : "#8B5CF6"} />
              </View>
              <View style={{ flex: 1 }}>
                <Text style={{ fontFamily: "BricolageGrotesque_700Bold", color: isClosed ? "#666" : "#f5f5f5", fontSize: 18 }}>Group Order</Text>
                <Text style={{ fontFamily: "Manrope_500Medium", color: "#777", fontSize: 13, marginTop: 2 }}>
                  {isClosed ? "Unavailable while closed" : "Order together with friends"}
                </Text>
              </View>
            </Pressable>
          </View>
        </View>
      </Modal>

      {/* Party Size Picker */}
      <Modal visible={showPartySizePicker} transparent animationType="fade" onRequestClose={() => setShowPartySizePicker(false)}>
        <KeyboardAvoidingView style={{ flex: 1 }} behavior={Platform.OS === "ios" ? "padding" : undefined}>
          <View style={{ flex: 1, backgroundColor: "rgba(0,0,0,0.6)", justifyContent: "flex-end" }}>
            <Pressable style={{ flex: 1 }} onPress={() => setShowPartySizePicker(false)} />
            <View style={{
              backgroundColor: "#1a1a1a",
              borderTopLeftRadius: 28,
              borderTopRightRadius: 28,
              padding: 28,
              paddingBottom: Platform.OS === "ios" ? 44 : 28,
              borderWidth: 1,
              borderColor: "#2a2a2a",
            }}>
              <Text style={{ fontFamily: "BricolageGrotesque_700Bold", color: "#f5f5f5", fontSize: 22, marginBottom: 6 }}>
                Party Size
              </Text>
              <Text style={{ fontFamily: "Manrope_500Medium", color: "#999", fontSize: 14, marginBottom: 24 }}>
                How many guests are in your party?
              </Text>

              {/* Quick select 1-5 */}
              <View style={{ flexDirection: "row", gap: 10, marginBottom: 20 }}>
                {[1, 2, 3, 4, 5].map((n) => {
                  const selected = customParty === "" && partySize === n;
                  return (
                    <Pressable
                      key={n}
                      onPress={() => { setPartySize(n); setCustomParty(""); if (Platform.OS !== "web") Haptics.selectionAsync(); }}
                      style={{
                        flex: 1,
                        aspectRatio: 1,
                        borderRadius: 16,
                        alignItems: "center",
                        justifyContent: "center",
                        backgroundColor: selected ? "#FF9933" : "#0f0f0f",
                        borderWidth: 1.5,
                        borderColor: selected ? "#FF9933" : "#2a2a2a",
                      }}
                    >
                      <Text style={{ fontFamily: "BricolageGrotesque_700Bold", color: selected ? "#0f0f0f" : "#f5f5f5", fontSize: 22 }}>
                        {n}
                      </Text>
                    </Pressable>
                  );
                })}
              </View>

              {/* Custom number input */}
              <View style={{ flexDirection: "row", alignItems: "center", gap: 10, marginBottom: 28 }}>
                <TextInput
                  value={customParty}
                  onChangeText={(v) => setCustomParty(v.replace(/[^0-9]/g, ""))}
                  keyboardType="number-pad"
                  placeholder="Larger party? Enter number…"
                  placeholderTextColor="#555"
                  style={{
                    flex: 1,
                    backgroundColor: "#0f0f0f",
                    borderRadius: 12,
                    borderWidth: 1.5,
                    borderColor: customParty !== "" ? "#FF9933" : "#2a2a2a",
                    paddingHorizontal: 14,
                    paddingVertical: 13,
                    color: "#f5f5f5",
                    fontFamily: "JetBrainsMono_600SemiBold",
                    fontSize: 16,
                  }}
                />
              </View>

              {/* Confirm button */}
              <Pressable
                onPress={handleConfirmJoin}
                disabled={joining}
                style={{
                  backgroundColor: "#FF9933",
                  borderRadius: 16,
                  padding: 18,
                  alignItems: "center",
                  opacity: joining ? 0.7 : 1,
                }}
              >
                {joining ? (
                  <ActivityIndicator color="#0f0f0f" />
                ) : (
                  <Text style={{ fontFamily: "BricolageGrotesque_700Bold", color: "#0f0f0f", fontSize: 18 }}>
                    Join Waitlist · {customParty !== "" ? (parseInt(customParty) || "?") : partySize} {(customParty !== "" ? (parseInt(customParty) || 1) : partySize) === 1 ? "guest" : "guests"}
                  </Text>
                )}
              </Pressable>
            </View>
          </View>
        </KeyboardAvoidingView>
      </Modal>

      {showEditModal && restaurant && (
        <RestaurantEditModal
          restaurantId={restaurant.id}
          initial={{
            name: restaurant.name,
            address: restaurant.address,
            description: restaurant.description,
            cuisine: restaurant.tags.join(", "),
          }}
          onClose={() => {
            setShowEditModal(false);
            setOpenHoursEditorOnOpen(false);
          }}
          openHoursOnMount={openHoursEditorOnOpen}
          onChangeLocation={() => {
            setShowEditModal(false);
            setOpenHoursEditorOnOpen(false);
            router.push(
              `/map?restaurantId=${restaurant.id}&targetLat=${restaurant.lat ?? ""}&targetLng=${restaurant.long ?? ""}&adjust=1` as any
            );
          }}
          onHoursSaved={() => {
            refetchRestaurantHours();
          }}
          onSaved={(updated) => {
            setRestaurant((prev) =>
              prev
                ? {
                  ...prev,
                  name: updated.name,
                  address: updated.address,
                  description: updated.description,
                  cuisine: updated.cuisine,
                  tags: updated.cuisine.split(",").map((t) => t.trim()).filter(Boolean),
                }
                : prev
            );
            setShowEditModal(false);
            setOpenHoursEditorOnOpen(false);
            fetchRestaurantData();
          }}
        />
      )}

      {showReviews && restaurant && (
        <ReviewsModal
          visible={showReviews}
          onClose={() => setShowReviews(false)}
          restaurantId={restaurant.id}
          restaurantName={restaurant.name}
          menuItems={menu}
          initialReviewCount={liveReviewCount}
          initialAvgRating={liveAvgRating}
          onReviewsChanged={handleReviewsStatsChanged}
        />
      )}

      {/* Community Image Contribution Modal */}
      <CommunityImageModal
        visible={!!communityImageTarget}
        item={communityImageTarget}
        restaurantId={restaurant.id}
        onClose={() => setCommunityImageTarget(null)}
      />
    </View>
  );
}
