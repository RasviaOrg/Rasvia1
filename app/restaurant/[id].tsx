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
  Truck,
  UtensilsCrossed,
  Leaf,
  AlertTriangle,
  ShieldCheck,
  ChevronDown,
  ChevronUp,
  LogIn,
} from "lucide-react-native";
import Animated, {
  useAnimatedStyle,
  useSharedValue,
  withSpring,
  useAnimatedScrollHandler,
  interpolate,
  Extrapolation,
  FadeIn,
  FadeOut,
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
  restaurantGroupKey,
} from "@/lib/restaurant-types";
import { useLocation } from "@/lib/location-context";
import { useAuth } from "@/lib/auth-context";
import { useNotifications } from "@/lib/notifications-context";
import { DEFAULT_MENU_TAGS, parseRestaurantMenuTags, normalizeMenuItemTags, type MenuTagConfig } from "@/lib/menu-tags";
import { fetchRestaurantCartRows, upsertUserCartItem } from "@/lib/user-cart";
import {
  groupMembers,
  type CartItem,
  type GroupMember,
} from "@/data/mockData";
import * as SecureStore from 'expo-secure-store';
import * as ExpoClipboard from "expo-clipboard";
import { recordRecentlyViewedRestaurant } from "@/lib/restaurant-media";

let SCREEN_WIDTH = Dimensions.get("window").width;
let SCREEN_HEIGHT = Dimensions.get("window").height;
Dimensions.addEventListener("change", ({ window }) => { SCREEN_WIDTH = window.width; SCREEN_HEIGHT = window.height; });
const HERO_HEIGHT = SCREEN_HEIGHT * 0.42;
const COLLAPSED_HEADER_HEIGHT = 100;
const SCROLL_THRESHOLD = HERO_HEIGHT;
const GROUP_ORDER_WEB_BASE_URL = "https://rasvia.com";
const RESTAURANT_SHARE_WEB_BASE_URL = "https://rasvia.com";

export default function RestaurantDetail() {
  const { id, reorder, waitlist_entry, mode, cartType, scrollTo, autoCheckout } = useLocalSearchParams<{
    id: string;
    reorder?: string;
    waitlist_entry?: string;
    mode?: string;
    /** Optional intent passed from /cart so we open the correct checkout
     *  flavour (dine_in vs takeout) without making the user re-pick. */
    cartType?: string;
    /** Anchor name — currently only "menu" is supported. Fired by the
     *  Takeout "Browse Menu" CTA so the user lands directly in the food
     *  rather than the hero. */
    scrollTo?: string;
    /** "1" means the user tapped Checkout from /cart — open the CheckoutModal
     *  automatically as soon as the cart seed has loaded. */
    autoCheckout?: string;
  }>();
  const waitlistEntryParam =
    typeof waitlist_entry === "string" && waitlist_entry.length > 0 ? waitlist_entry : undefined;
  /** True when the user arrived here from the "no-wait, walk right in" sheet
   *  — the menu is shown in pre-order mode with no backing waitlist row. */
  const walkInPreorderMode = mode === "walk_in_preorder";
  const cartTypeParam: 'dine_in' | 'takeout' | undefined =
    cartType === "takeout" ? "takeout" : cartType === "dine_in" ? "dine_in" : undefined;
  const router = useRouter();
  const insets = useSafeAreaInsets();
  const { userCoords } = useLocation();
  const userCoordsRef = useRef(userCoords);
  useEffect(() => { userCoordsRef.current = userCoords; }, [userCoords]);
  const { isAdmin, isRestaurantOwner, ownedRestaurantId, loading: roleLoading } = useAdminMode();
  // owners can manage their own restaurant (same controls as admin, but scoped)
  const canManage = isAdmin || (isRestaurantOwner && ownedRestaurantId === id);
  const { session } = useAuth();
  useEffect(() => {
    const userId = session?.user?.id;
    const restaurantIdNum = Number(id);
    if (!userId || !Number.isFinite(restaurantIdNum) || restaurantIdNum <= 0) return;
    void recordRecentlyViewedRestaurant(userId, restaurantIdNum);
  }, [session?.user?.id, id]);
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
  const [checkoutOrderType, setCheckoutOrderType] = useState<'dine_in' | 'takeout'>(
    cartTypeParam ?? 'dine_in'
  );
  const [lockCheckoutOrderType, setLockCheckoutOrderType] = useState(false);

  // If the user lands here from /cart with an explicit dining intent, sync
  // the checkout's order type once. Subsequent picker selections still win.
  useEffect(() => {
    if (cartTypeParam) setCheckoutOrderType(cartTypeParam);
  }, [cartTypeParam]);

  // Honor ?scrollTo=menu — request a scroll once the menu section has
  // measured itself. If the layout pass hasn't finished, the onLayout
  // handler below picks up the pending flag and fires it.
  useEffect(() => {
    if (scrollTo !== "menu") return;
    pendingScrollToMenuRef.current = true;
    // Small defer so it fires after the first render / layout pass.
    const t = setTimeout(() => {
      if (menuSectionYRef.current != null) scrollToMenu();
    }, 250);
    return () => clearTimeout(t);
  }, [scrollTo, scrollToMenu]);
  // Whether this restaurant has Stripe Connect set up. Group orders settle
  // via Stripe, so without an account we have to gate the "Group Order"
  // entry-point and tell the user why it's unavailable.
  const [onlinePaymentsEnabled, setOnlinePaymentsEnabled] = useState<boolean | null>(null);

  useEffect(() => {
    if (!id) return;
    let cancelled = false;
    (async () => {
      try {
        const { data } = await supabase
          .from("restaurants")
          .select("stripe_account_id")
          .eq("id", Number(id))
          .maybeSingle();
        if (cancelled) return;
        const acct = (data as any)?.stripe_account_id;
        setOnlinePaymentsEnabled(typeof acct === "string" && acct.length > 0);
      } catch {
        if (!cancelled) setOnlinePaymentsEnabled(false);
      }
    })();
    return () => { cancelled = true; };
  }, [id]);

  const [communityImageTarget, setCommunityImageTarget] = useState<UIMenuItem | null>(null);
  const [acceptCommunityImages, setAcceptCommunityImages] = useState(true);
  // Chain / multi-location picker
  const [chainLocations, setChainLocations] = useState<UIRestaurant[]>([]);
  const [showLocationPicker, setShowLocationPicker] = useState(false);
  // Order type picker (shows before waitlist or takeout checkout)
  const [showOrderTypePicker, setShowOrderTypePicker] = useState(false);

  // Party size + join flow
  const [showPartySizePicker, setShowPartySizePicker] = useState(false);
  const [partySize, setPartySize] = useState(2);
  const [customParty, setCustomParty] = useState("");
  const [joining, setJoining] = useState(false);
  const [partyLeaderName, setPartyLeaderName] = useState("");
  // Replaces the native Alert.alert() when the user would be first in line and
  // the restaurant has no wait — an in-app overlay matches the rest of the
  // app's look and lets us keep the party-picker state machine coherent.
  const [showZeroWaitSheet, setShowZeroWaitSheet] = useState(false);
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
  // Menu tag multi-filter
  type MenuFilter = string;
  const [menuTags, setMenuTags] = useState<MenuTagConfig[]>(DEFAULT_MENU_TAGS);
  const [selectedMenuFilters, setSelectedMenuFilters] = useState<MenuFilter[]>([]);
  const [showTagFilterMenu, setShowTagFilterMenu] = useState(false);
  const [adminBypassComingSoon, setAdminBypassComingSoon] = useState(false);

  useEffect(() => {
    setAdminBypassComingSoon(false);
  }, [id]);
  // User dietary preferences for veg indicator
  const [userDietaryType, setUserDietaryType] = useState("");
  const [userRestrictedDays, setUserRestrictedDays] = useState<string[]>([]);

  const itemMatchesFilter = useCallback((item: UIMenuItem, filter: MenuFilter) => {
    const mealTimes = normalizeMenuItemTags(item.mealTimes ?? [], menuTags);
    return mealTimes.includes(filter);
  }, [menuTags]);

  const hasItemsForFilter = useCallback(
    (filter: MenuFilter) => menu.some((item) => itemMatchesFilter(item, filter)),
    [menu, itemMatchesFilter]
  );

  useEffect(() => {
    setSelectedMenuFilters((prev) => prev.filter((f) => hasItemsForFilter(f)));
  }, [hasItemsForFilter]);


  // Tracks whether the "do I already have an active waitlist entry?" query
  // has settled. We use this to gate the pre-order flow when the screen is
  // opened via `?waitlist_entry=...` so we never render the cart/footer with
  // `existingEntry == null` during the brief window between mount and the
  // entry-query returning (which previously caused crashes when the footer
  // deref'd `existingEntry.id`).
  const [waitlistEntryChecked, setWaitlistEntryChecked] = useState(false);

  // Fetch party leader name + check for existing active entry
  useEffect(() => {
    if (!session?.user?.id) {
      setGlobalWaitlistEntry(null);
      setWaitlistEntryChecked(true);
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
        setWaitlistEntryChecked(true);
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
    // Random topic suffix (see note on `realtimeSuffixRef` below). Even though
    // entry ids are unique, a remount with the same entry would reuse the
    // cached, already-joined channel and throw on `.on()`.
    const topicSuffix = Math.random().toString(36).slice(2, 8);
    const ch = supabase
      .channel(`restaurant-wl-entry:${globalWaitlistEntry.id}:${topicSuffix}`)
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

  // Per-mount random suffix so each mount gets a fresh Supabase realtime
  // channel. Without this, a fast remount (fast refresh, navigating back from
  // /waitlist → this page) can pick up the previous channel before its
  // removeChannel cleanup finished, and calling `.on()` on an already-joined
  // channel throws "cannot add postgres_changes callbacks ... after subscribe()".
  const realtimeSuffixRef = useRef(Math.random().toString(36).slice(2, 8));

  // ==================================================
  // FETCH RESTAURANT & MENU FROM SUPABASE
  // ==================================================
  useEffect(() => {
    if (!id) return;

    fetchRestaurantData();
    fetchMenu();
    fetchQueueCount();
    fetchRestaurantMenuTags();

    const suffix = realtimeSuffixRef.current;

    // Real-time: restaurant row changes
    const restSub = supabase
      .channel(`restaurant:${id}:${suffix}`)
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
      .channel(`queue-count:${id}:${suffix}`)
      .on(
        "postgres_changes",
        { event: "*", schema: "public", table: "waitlist_entries", filter: `restaurant_id=eq.${id}` },
        () => { fetchQueueCount(); }
      )
      .subscribe();

    // Real-time: menu_items changes → refresh menu
    const menuSub = supabase
      .channel(`restaurant-menu:${id}:${suffix}`)
      .on(
        "postgres_changes",
        { event: "*", schema: "public", table: "menu_items", filter: `restaurant_id=eq.${id}` },
        () => { fetchMenu(); }
      )
      .subscribe();

    // Real-time: menu tag changes
    const menuTagSub = supabase
      .channel(`restaurant-menu-tags:${id}:${suffix}`)
      .on(
        "postgres_changes",
        { event: "*", schema: "public", table: "restaurant_menu_tags", filter: `restaurant_id=eq.${id}` },
        () => { fetchRestaurantMenuTags(); }
      )
      .subscribe();

    return () => {
      supabase.removeChannel(restSub);
      supabase.removeChannel(queueSub);
      supabase.removeChannel(menuSub);
      supabase.removeChannel(menuTagSub);
    };
  }, [id]);

  async function fetchRestaurantMenuTags() {
    try {
      const { data, error } = await supabase
        .from("restaurant_menu_tags")
        .select("key, label, color, bg, border, enabled, position")
        .eq("restaurant_id", Number(id))
        .order("position", { ascending: true });
      if (error) throw error;
      const parsed = parseRestaurantMenuTags((data ?? []) as unknown[]);
      setMenuTags(parsed.length > 0 ? parsed : DEFAULT_MENU_TAGS);
    } catch {
      setMenuTags(DEFAULT_MENU_TAGS);
    }
  }

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
        const uiRestaurant = mapSupabaseToUI(data as SupabaseRestaurant, userCoords);
        setRestaurant(uiRestaurant);
        // Fetch live review stats from restaurant_reviews (not the DB rating column)
        const stats = await fetchReviewStats(id);
        setLiveReviewCount(stats.count);
        setLiveAvgRating(stats.average);

        // ── Fetch sibling locations for chains ──────────────────────────────
        const thisBrandKey = restaurantGroupKey(uiRestaurant);
        const { data: allRestaurants } = await supabase
          .from("restaurants")
          .select("id, name, address, lat, long, image_url, current_wait_time, is_waitlist_open, is_enabled, waitlist_open, rating, price_range, cuisine_tags, owner_id, created_at, waitlist_early_open_enabled, waitlist_early_open_minutes, is_coming_soon, chain_group_key")
          .order("name", { ascending: true });
        if (allRestaurants) {
          const siblings = (allRestaurants as SupabaseRestaurant[])
            .map((r) => mapSupabaseToUI(r, userCoords))
            .filter((r) => restaurantGroupKey(r) === thisBrandKey)
            .sort((a, b) => {
              const da = parseFloat((a.distance ?? "").replace(/[^0-9.]/g, "")) || Infinity;
              const db = parseFloat((b.distance ?? "").replace(/[^0-9.]/g, "")) || Infinity;
              return da - db;
            });
          setChainLocations(siblings);
        }
      }

      // Owner-level contribution setting (column may not exist on older DBs; default to true).
      try {
        const { data: contribSettings, error: contribError } = await supabase
          .from("restaurants")
          .select("accept_community_image_contributions")
          .eq("id", Number(id))
          .maybeSingle();
        if (!contribError) {
          setAcceptCommunityImages((contribSettings as any)?.accept_community_image_contributions !== false);
        }
      } catch {
        // noop
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

  // Scroll-to-menu plumbing — used by both the ?scrollTo=menu deep link
  // (e.g. Takeout's "Browse Menu" CTA) and the in-app "Browse Menu & Add
  // Items" button on CheckoutModal. We measure the menu section once it
  // mounts and then animate a smooth scroll to that y offset.
  const scrollViewRef = useRef<any>(null);
  const menuSectionYRef = useRef<number | null>(null);
  const pendingScrollToMenuRef = useRef(false);

  const scrollToMenu = useCallback(() => {
    const node = scrollViewRef.current;
    const y = menuSectionYRef.current;
    if (!node) return;
    if (y == null) {
      // Menu hasn't laid out yet (still loading); flag to fire on layout.
      pendingScrollToMenuRef.current = true;
      return;
    }
    try {
      // Subtract the sticky header height so the section title isn't hidden.
      const target = Math.max(0, y - 24);
      if (typeof node.scrollTo === "function") {
        node.scrollTo({ y: target, animated: true });
      } else if (typeof node.getNode === "function") {
        node.getNode().scrollTo({ y: target, animated: true });
      }
    } catch {
      // Best-effort — scrolling is non-critical UX glue.
    }
  }, []);

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
        let next: CartItem[] = [];
        if (existing) {
          next = prev.map((ci) =>
            ci.id === item.id ? { ...ci, quantity: ci.quantity + 1 } : ci
          );
        } else {
          next = [
            ...prev,
            { ...item, quantity: 1, addedBy: localGroupMembers[0] },
          ];
        }
        const nextQuantity = next.find((ci) => ci.id === item.id)?.quantity ?? 1;
        const restaurantId = Number(id);
        const menuItemId = Number(item.id);
        const userId = session?.user?.id;
        if (userId && Number.isFinite(restaurantId) && Number.isFinite(menuItemId)) {
          void upsertUserCartItem({
            userId,
            restaurantId,
            menuItemId,
            quantity: nextQuantity,
            orderType: checkoutOrderType,
          }).catch(() => {
            // Non-blocking; UI remains responsive even if persistence fails.
          });
        }
        return next;
      });
      setSelectedItem(null);
    },
    [id, localGroupMembers, session?.user?.id, checkoutOrderType]
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
        const next = updated.filter((ci) => ci.quantity > 0);
        const restaurantId = Number(id);
        const menuItemId = Number(itemId);
        const userId = session?.user?.id;
        if (userId && Number.isFinite(restaurantId) && Number.isFinite(menuItemId)) {
          const nextQuantity = next.find((ci) => Number(ci.id) === menuItemId)?.quantity ?? 0;
          void upsertUserCartItem({
            userId,
            restaurantId,
            menuItemId,
            quantity: nextQuantity,
            orderType: checkoutOrderType,
          }).catch(() => {
            // Non-blocking persistence.
          });
        }
        return next;
      });
    },
    [id, session?.user?.id, checkoutOrderType]
  );

  useEffect(() => {
    let active = true;
    const loadRestaurantCart = async () => {
      const userId = session?.user?.id;
      const restaurantId = Number(id);
      if (!userId || !Number.isFinite(restaurantId) || menu.length === 0) return;
      try {
        const rows = await fetchRestaurantCartRows(userId, restaurantId);
        if (!active) return;
        const byId = new Map(menu.map((m) => [Number(m.id), m]));
        const restored: CartItem[] = [];
        for (const row of rows) {
          const match = byId.get(Number(row.menu_item_id));
          if (!match) continue;
          restored.push({
            ...match,
            quantity: Math.max(1, Number(row.quantity ?? 1)),
            addedBy: localGroupMembers[0],
          });
        }
        setCartItems(restored);
      } catch {
        // keep current in-memory cart
      }
    };
    void loadRestaurantCart();
    return () => {
      active = false;
    };
  }, [id, menu, localGroupMembers, session?.user?.id]);

  // Auto-open the CheckoutModal when the user arrived from /cart with
  // `autoCheckout=1`. We wait for `cartItems` to hydrate (at least one item)
  // so the modal opens with its seed row already populated. Once fired, we
  // clear the param via `router.setParams` so a normal back-and-forth doesn't
  // re-trigger on every remount.
  const autoCheckoutFiredRef = useRef(false);
  useEffect(() => {
    if (autoCheckout !== "1") return;
    if (autoCheckoutFiredRef.current) return;
    if (!restaurant) return;
    if (cartItems.length === 0) return;
    autoCheckoutFiredRef.current = true;
    setShowCheckout(true);
    try {
      router.setParams({ autoCheckout: undefined } as any);
    } catch {
      // setParams can throw on older expo-router builds — safe to ignore; the
      // fired ref already prevents re-entry.
    }
  }, [autoCheckout, cartItems.length, restaurant, router]);

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
      let maxWaitlistSize = 15;
      let activeCount: number | null = null;

      const { data: capacityData, error: capacityErr } = await supabase.rpc(
        "get_waitlist_capacity_snapshot",
        { p_restaurant_id: Number(restaurant?.id) }
      );

      if (!capacityErr && capacityData) {
        const row = Array.isArray(capacityData) ? capacityData[0] : capacityData;
        maxWaitlistSize = Math.max(1, Math.min(200, Number((row as any)?.max_waitlist_size) || 15));
        activeCount = Number((row as any)?.active_count ?? 0);
      } else {
        const [{ data: restData, error: restErr }, { count, error: countErr }] = await Promise.all([
          supabase
            .from("restaurants")
            .select("max_waitlist_size")
            .eq("id", Number(restaurant?.id))
            .maybeSingle(),
          supabase
            .from("waitlist_entries")
            .select("id", { count: "exact", head: true })
            .eq("restaurant_id", Number(restaurant?.id))
            .in("status", ["waiting", "notified"]),
        ]);
        if (restErr) throw restErr;
        if (countErr) throw countErr;
        maxWaitlistSize = Math.max(1, Math.min(200, Number(restData?.max_waitlist_size) || 15));
        activeCount = count ?? 0;
      }

      if ((activeCount ?? 0) >= maxWaitlistSize) {
        Alert.alert(
          "Waitlist Full",
          "This waitlist is currently full. Please call the restaurant directly for the latest availability."
        );
        return;
      }

      // ── Zero-wait branch ───────────────────────────────────────────────
      // If the user would be first in line AND the venue's current wait
      // time is at or below zero, there's no need to create a waitlist row
      // at all — they can just walk in. Surface a confirmation so the user
      // can either start a walk-in pre-order (same restaurant page, but in
      // `walk_in_preorder` mode with no waitlist entry backing it) or
      // dismiss and physically head over.
      const currentWaitTime = Number(restaurant?.waitTime ?? 0);
      const wouldBeFirstInLine = (activeCount ?? 0) === 0;
      if (wouldBeFirstInLine && currentWaitTime <= 0) {
        setShowPartySizePicker(false);
        setJoining(false);
        // Swap the native Alert for an in-app overlay. We defer the flag flip
        // a tick so the party-size sheet has time to close, otherwise the two
        // modals would animate simultaneously on iOS.
        setTimeout(() => {
          setShowZeroWaitSheet(true);
        }, 150);
        return;
      }

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
      const text = String(err?.message || err?.details || err?.hint || "").toUpperCase();
      if (text.includes("WAITLIST_FULL") || text.includes("WAITLIST IS CURRENTLY FULL")) {
        Alert.alert(
          "Waitlist Full",
          "This waitlist is currently full. Please call the restaurant directly for the latest availability."
        );
      } else {
        Alert.alert("Error", err.message || "Could not join waitlist.");
      }
    } finally {
      setJoining(false);
    }
  }, [partySize, customParty, session, partyLeaderName, restaurant?.id, restaurant?.waitTime, restaurant?.name, router, addEvent, refreshActive]);

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
  // Gate on `waitlistEntryChecked` so we don't flicker the wrong footer UI
  // between mount and the entry-query settling — that race previously
  // produced a first-interaction crash when the user tapped the pre-order
  // footer before `existingEntry` had populated.
  const checkoutFromWaitlist =
    !!waitlistEntryParam &&
    waitlistEntryChecked &&
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

  // If the screen was opened from the user's own waitlist alert
  // (`?waitlist_entry=...`) we must not mount the full restaurant tree until
  // the matching entry row has been confirmed. Mounting early with a stale
  // `existingEntry = null` previously caused the footer to crash when the
  // user tapped it before the entry query finished.
  if (waitlistEntryParam && !waitlistEntryChecked) {
    return (
      <View className="flex-1 bg-rasvia-black items-center justify-center">
        <Text style={{ color: '#999999', fontFamily: 'Manrope_500Medium' }}>
          Loading your order…
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
                {chainLocations.length > 1 ? (
                  /* Location switcher pill in collapsed header */
                  <Pressable
                    onPress={() => {
                      if (Platform.OS !== "web") Haptics.selectionAsync();
                      setShowLocationPicker(true);
                    }}
                    style={{
                      flexDirection: "row",
                      alignItems: "center",
                      backgroundColor: "rgba(255,153,51,0.12)",
                      borderRadius: 8,
                      paddingHorizontal: 7,
                      paddingVertical: 3,
                      gap: 4,
                      borderWidth: 1,
                      borderColor: "rgba(255,153,51,0.3)",
                    }}
                  >
                    <MapPin size={9} color="#FF9933" />
                    <Text
                      numberOfLines={1}
                      style={{
                        fontFamily: "Manrope_600SemiBold",
                        color: "#FF9933",
                        fontSize: 10,
                        maxWidth: 120,
                      }}
                    >
                      {chainLocations.length} locations
                    </Text>
                    <ChevronDown size={9} color="#FF9933" />
                  </Pressable>
                ) : (
                  restaurant.tags.filter((t) => t.trim().toLowerCase() !== "indian").slice(0, 2).map((tag) => (
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
                  ))
                )}
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
        ref={scrollViewRef}
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

              {/* Location switcher chip — only shown for chains */}
              {chainLocations.length > 1 && (
                <Pressable
                  onPress={() => {
                    if (Platform.OS !== "web") Haptics.selectionAsync();
                    setShowLocationPicker(true);
                  }}
                  style={{
                    flexDirection: "row",
                    alignItems: "center",
                    alignSelf: "flex-start",
                    marginTop: 10,
                    backgroundColor: "rgba(15,15,15,0.72)",
                    borderRadius: 20,
                    borderWidth: 1,
                    borderColor: "rgba(255,153,51,0.45)",
                    paddingHorizontal: 12,
                    paddingVertical: 7,
                    gap: 6,
                  }}
                >
                  <MapPin size={12} color="#FF9933" />
                  <Text
                    numberOfLines={1}
                    style={{
                      fontFamily: "Manrope_600SemiBold",
                      color: "#f5f5f5",
                      fontSize: 12,
                      maxWidth: 200,
                    }}
                  >
                    {restaurant.address}
                  </Text>
                  <ChevronDown size={12} color="#FF9933" />
                </Pressable>
              )}
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
        <View
          onLayout={(e) => {
            menuSectionYRef.current = e.nativeEvent.layout.y;
            if (pendingScrollToMenuRef.current) {
              pendingScrollToMenuRef.current = false;
              // Defer one frame so the parent layout has stabilized.
              requestAnimationFrame(scrollToMenu);
            }
          }}
        >
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

          {/* Menu tag multi-select dropdown */}
          <View style={{ paddingHorizontal: 16, marginBottom: 12 }}>
            {(() => {
              const selectedTagNames = selectedMenuFilters
                .map((key) => menuTags.find((tag) => tag.key === key)?.label?.trim())
                .filter((label): label is string => Boolean(label));
              const dropdownLabel =
                selectedTagNames.length === 0
                  ? "All Menu Items"
                  : selectedTagNames.join(", ");
              return (
            <Pressable
              onPress={() => {
                if (Platform.OS !== "web") Haptics.selectionAsync();
                setShowTagFilterMenu((v) => !v);
              }}
              style={{
                backgroundColor: "#161616",
                borderRadius: 12,
                borderWidth: 1,
                borderColor: "rgba(255,153,51,0.25)",
                paddingHorizontal: 12,
                paddingVertical: 10,
                flexDirection: "row",
                alignItems: "center",
                justifyContent: "space-between",
              }}
            >
              <Text
                numberOfLines={1}
                style={{ color: "#f5f5f5", fontFamily: "Manrope_700Bold", fontSize: 13, flex: 1, marginRight: 10 }}
              >
                {dropdownLabel}
              </Text>
              {showTagFilterMenu ? <ChevronUp size={15} color="#FF9933" /> : <ChevronDown size={15} color="#FF9933" />}
            </Pressable>
              );
            })()}

            {showTagFilterMenu && (
              <View
                style={{
                  marginTop: 8,
                  backgroundColor: "#141414",
                  borderRadius: 12,
                  borderWidth: 1,
                  borderColor: "#2a2a2a",
                  padding: 10,
                  gap: 8,
                }}
              >
                <Pressable
                  onPress={() => setSelectedMenuFilters([])}
                  style={{
                    borderRadius: 999,
                    paddingHorizontal: 12,
                    paddingVertical: 8,
                    alignSelf: "flex-start",
                    backgroundColor: selectedMenuFilters.length === 0 ? "rgba(255,153,51,0.14)" : "#1b1b1b",
                    borderWidth: 1,
                    borderColor: selectedMenuFilters.length === 0 ? "rgba(255,153,51,0.35)" : "#2a2a2a",
                  }}
                >
                  <Text style={{ color: selectedMenuFilters.length === 0 ? "#FF9933" : "#9a9a9a", fontFamily: "Manrope_700Bold", fontSize: 12 }}>
                    All Menu Items
                  </Text>
                </Pressable>
                <View style={{ flexDirection: "row", flexWrap: "wrap", gap: 8 }}>
                  {menuTags
                    .filter((tag) => tag.enabled !== false)
                    .map((tag) => {
                      const isActive = selectedMenuFilters.includes(tag.key);
                      const disabled = !hasItemsForFilter(tag.key);
                      return (
                        <Pressable
                          key={tag.key}
                          disabled={disabled}
                          onPress={() => {
                            if (disabled) return;
                            setSelectedMenuFilters((prev) =>
                              prev.includes(tag.key) ? prev.filter((k) => k !== tag.key) : [...prev, tag.key]
                            );
                          }}
                          style={{
                            borderRadius: 999,
                            borderWidth: 1,
                            borderColor: disabled ? "#242424" : (isActive ? tag.border : "#2f2f2f"),
                            backgroundColor: disabled ? "#151515" : (isActive ? tag.bg : "#121212"),
                            paddingHorizontal: 11,
                            paddingVertical: 8,
                            opacity: disabled ? 0.5 : 1,
                          }}
                        >
                          <Text style={{ fontFamily: isActive ? "Manrope_700Bold" : "Manrope_600SemiBold", color: disabled ? "#575757" : (isActive ? tag.color : "#999"), fontSize: 12 }}>
                            {tag.label}
                          </Text>
                        </Pressable>
                      );
                    })}
                </View>
              </View>
            )}
          </View>

          <View className="px-4">
            <MenuEditor
              menu={menu.filter(m => {
                if (selectedMenuFilters.length === 0) return true; // no selection = show everything
                return selectedMenuFilters.some((filter) => itemMatchesFilter(m, filter));
              })}
              setMenu={setMenu}
              onMenuTagsChange={setMenuTags}
              onItemPress={(item) => {
                if (Platform.OS !== "web") Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
                setSelectedItem(item);
              }}
              onQuickAdd={(item) => handleAddToCart(item)}
              restaurantId={id}
              onContributeImage={acceptCommunityImages ? (item) => setCommunityImageTarget(item) : undefined}
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
          showContributeImage={acceptCommunityImages && !selectedItem.hasOfficialImage && !selectedItem.communityImageCredit}
          onContributeImage={() => {
            if (!acceptCommunityImages) return;
            setCommunityImageTarget(selectedItem);
          }}
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
        menuTags={menuTags}
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
        onAddMoreItems={() => {
          // Close the checkout sheet *and* immediately scroll to the menu so
          // the user sees the items without having to swipe past the hero.
          setShowCheckout(false);
          // Defer slightly so the modal close animation doesn't fight the
          // scroll offset change.
          setTimeout(() => scrollToMenu(), 320);
        }}
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
            }
          }
        }}
      />

      {/* ── Order Type Picker (Takeout vs Dine In) ──
          The backdrop fades in independently so only the bottom sheet slides
          up from the bottom — previously the whole modal (including the dim
          backdrop) slid up which looked jarring. */}
      <Modal
        visible={showOrderTypePicker}
        transparent
        animationType="none"
        onRequestClose={() => setShowOrderTypePicker(false)}
      >
        <View style={{ flex: 1, justifyContent: "flex-end" }}>
          <Animated.View
            entering={FadeIn.duration(200)}
            exiting={FadeOut.duration(150)}
            style={{
              position: "absolute",
              top: 0,
              left: 0,
              right: 0,
              bottom: 0,
              backgroundColor: "rgba(0,0,0,0.6)",
            }}
          >
            <Pressable style={{ flex: 1 }} onPress={() => setShowOrderTypePicker(false)} />
          </Animated.View>
          <Animated.View
            // Fade the sheet in alongside the backdrop — no slide — so the
            // overlay simply materializes instead of animating from the
            // bottom edge.
            entering={FadeIn.duration(200)}
            exiting={FadeOut.duration(150)}
            style={{
              backgroundColor: "#1a1a1a",
              borderTopLeftRadius: 28,
              borderTopRightRadius: 28,
              padding: 28,
              paddingBottom: Platform.OS === "ios" ? 44 : 28,
              borderWidth: 1,
              borderColor: "#2a2a2a",
            }}
          >
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
                // Walk-in pre-order: the user already confirmed they're going
                // straight in (no waitlist needed), so skip the party-size
                // picker and open dine-in checkout directly.
                if (walkInPreorderMode) {
                  setCheckoutOrderType("dine_in");
                  setLockCheckoutOrderType(true);
                  setShowCheckout(true);
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
                  {walkInPreorderMode
                    ? "Pre-order now — walk right in"
                    : `Join the waitlist · ${restaurant?.waitTime != null && restaurant.waitTime > 0 ? `${restaurant.waitTime} min wait` : "No wait"}`}
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

            {/* Group Order — disabled when the restaurant either has no
                Stripe account configured (group orders are paid online) or
                is currently closed. */}
            {(() => {
              const noOnlinePayments = onlinePaymentsEnabled === false;
              const groupDisabled = isClosed || noOnlinePayments;
              const groupSubtitle = isClosed
                ? "Unavailable while closed"
                : noOnlinePayments
                  ? "Online payments aren’t enabled here"
                  : "Order together with friends";
              return (
            <Pressable
              onPress={() => {
                if (isClosed) {
                  Alert.alert("Restaurant Closed", "Group orders are not available while the restaurant is closed.");
                  return;
                }
                if (noOnlinePayments) {
                  Alert.alert(
                    "Group orders unavailable",
                    `${restaurant?.name ?? "This restaurant"} hasn’t enabled online payments yet, so group ordering isn’t available. Try again later or pay in-person at the restaurant.`,
                  );
                  return;
                }
                if (Platform.OS !== "web") Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Medium);
                setShowOrderTypePicker(false);
                router.push(`/host_party?restaurantId=${restaurant?.id}` as any);
              }}
              style={{
                backgroundColor: groupDisabled ? "#141414" : "rgba(139,92,246,0.08)",
                borderRadius: 18,
                padding: 20,
                flexDirection: "row",
                alignItems: "center",
                borderWidth: 1.5,
                borderColor: groupDisabled ? "#1e1e1e" : "rgba(139,92,246,0.25)",
                opacity: groupDisabled ? 0.55 : 1,
              }}
            >
              <View style={{ width: 46, height: 46, borderRadius: 23, backgroundColor: groupDisabled ? "#1a1a1a" : "rgba(139,92,246,0.12)", alignItems: "center", justifyContent: "center", marginRight: 14 }}>
                <Users size={22} color={groupDisabled ? "#555" : "#8B5CF6"} />
              </View>
              <View style={{ flex: 1 }}>
                <Text style={{ fontFamily: "BricolageGrotesque_700Bold", color: groupDisabled ? "#666" : "#f5f5f5", fontSize: 18 }}>Group Order</Text>
                <Text style={{ fontFamily: "Manrope_500Medium", color: "#777", fontSize: 13, marginTop: 2 }}>
                  {groupSubtitle}
                </Text>
              </View>
            </Pressable>
              );
            })()}
          </Animated.View>
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

      {/* In-app "No wait right now" sheet. Replaces the native Alert — fits
          the app's dark theme, uses the same bottom-sheet visual language as
          the party-size picker, and lets us tie the "browse menu" tap into
          walk-in preorder mode without a second native dialog. */}
      <Modal
        visible={showZeroWaitSheet}
        transparent
        animationType="fade"
        onRequestClose={() => setShowZeroWaitSheet(false)}
      >
        <View
          style={{
            flex: 1,
            backgroundColor: "rgba(0,0,0,0.65)",
            justifyContent: "flex-end",
          }}
        >
          <Pressable
            style={{ flex: 1 }}
            onPress={() => setShowZeroWaitSheet(false)}
            accessibilityLabel="Dismiss"
          />
          <View
            style={{
              backgroundColor: "#141414",
              borderTopLeftRadius: 28,
              borderTopRightRadius: 28,
              padding: 24,
              paddingBottom: Platform.OS === "ios" ? 40 : 24,
              borderWidth: 1,
              borderColor: "#2a2a2a",
              gap: 14,
            }}
          >
            <View
              style={{
                width: 40,
                height: 4,
                borderRadius: 2,
                backgroundColor: "#333",
                alignSelf: "center",
                marginBottom: 4,
              }}
            />
            <View
              style={{
                flexDirection: "row",
                alignItems: "center",
                gap: 10,
                marginBottom: 2,
              }}
            >
              <View
                style={{
                  width: 36,
                  height: 36,
                  borderRadius: 18,
                  backgroundColor: "rgba(34,197,94,0.15)",
                  borderWidth: 1,
                  borderColor: "rgba(34,197,94,0.45)",
                  alignItems: "center",
                  justifyContent: "center",
                }}
              >
                <LogIn size={18} color="#4ade80" />
              </View>
              <Text
                style={{
                  fontFamily: "BricolageGrotesque_700Bold",
                  color: "#f5f5f5",
                  fontSize: 20,
                  flex: 1,
                }}
              >
                No wait time right now
              </Text>
            </View>
            <Text
              style={{
                fontFamily: "Manrope_500Medium",
                color: "#b5b5b5",
                fontSize: 14,
                lineHeight: 20,
              }}
            >
              You can walk right in. Want to browse the menu and pre-order
              before you get there, or just head over?
            </Text>
            {/* Browse menu — same shape as Walk right in but orange text */}
            <Pressable
              onPress={() => {
                if (Platform.OS !== "web") Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Medium);
                setShowZeroWaitSheet(false);
                router.replace(
                  `/restaurant/${restaurant?.id}?mode=walk_in_preorder` as any,
                );
              }}
              style={({ pressed }) => ({
                borderRadius: 14,
                paddingVertical: 14,
                alignItems: "center",
                borderWidth: 1,
                borderColor: pressed ? "#FF993366" : "#FF993344",
                backgroundColor: pressed ? "#222" : "#1a1a1a",
                marginTop: 6,
              })}
            >
              <Text
                style={{
                  fontFamily: "Manrope_700Bold",
                  color: "#FF9933",
                  fontSize: 15,
                }}
              >
                Browse menu & pre-order
              </Text>
            </Pressable>
            {/* Walk right in — solid border, white text */}
            <Pressable
              onPress={() => {
                if (Platform.OS !== "web") Haptics.selectionAsync();
                setShowZeroWaitSheet(false);
              }}
              style={({ pressed }) => ({
                borderRadius: 14,
                paddingVertical: 14,
                alignItems: "center",
                borderWidth: 1,
                borderColor: pressed ? "#444" : "#2a2a2a",
                backgroundColor: pressed ? "#222" : "#1a1a1a",
              })}
            >
              <Text
                style={{
                  fontFamily: "Manrope_700Bold",
                  color: "#e5e5e5",
                  fontSize: 15,
                }}
              >
                Walk right in
              </Text>
            </Pressable>
          </View>
        </View>
      </Modal>

      {showEditModal && restaurant && (
        <RestaurantEditModal
          restaurantId={restaurant.id}
          initial={{
            name: restaurant.name,
            address: restaurant.address,
            description: restaurant.description,
            cuisine: restaurant.tags.join(", "),
            chainGroupKey: restaurant.chainGroupKey ?? "",
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
                  chainGroupKey: updated.chainGroupKey ?? null,
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

      {/* ── Location Picker Modal (chain restaurants) ─────────────────────── */}
      {chainLocations.length > 1 && (
        <Modal
          visible={showLocationPicker}
          transparent
          animationType="slide"
          onRequestClose={() => setShowLocationPicker(false)}
        >
          <Pressable
            style={{ flex: 1, backgroundColor: "rgba(0,0,0,0.6)", justifyContent: "flex-end" }}
            onPress={() => setShowLocationPicker(false)}
          >
            <Pressable onPress={(e) => e.stopPropagation?.()}>
              <View
                style={{
                  backgroundColor: "#141414",
                  borderTopLeftRadius: 28,
                  borderTopRightRadius: 28,
                  borderWidth: 1,
                  borderColor: "#2a2a2a",
                  paddingBottom: insets.bottom + 16,
                }}
              >
                {/* Handle */}
                <View style={{ alignItems: "center", paddingTop: 14, paddingBottom: 4 }}>
                  <View style={{ width: 40, height: 4, borderRadius: 2, backgroundColor: "#333" }} />
                </View>

                {/* Header */}
                <View style={{ paddingHorizontal: 20, paddingVertical: 12 }}>
                  <Text style={{ fontFamily: "BricolageGrotesque_700Bold", color: "#f5f5f5", fontSize: 20, letterSpacing: -0.3 }}>
                    {restaurant.name
                      .toLowerCase()
                      .replace(/[-–—(|,].*/g, "")
                      .split(" ")
                      .map((w) => w.charAt(0).toUpperCase() + w.slice(1))
                      .join(" ")} Locations
                  </Text>
                  <Text style={{ fontFamily: "Manrope_500Medium", color: "#777", fontSize: 13, marginTop: 3 }}>
                    {chainLocations.length} locations · sorted by distance
                  </Text>
                </View>

                <View style={{ height: 1, backgroundColor: "#222", marginHorizontal: 20, marginBottom: 8 }} />

                {/* Location list */}
                {chainLocations.map((loc) => {
                  const isCurrent = loc.id === restaurant.id;
                  return (
                    <Pressable
                      key={loc.id}
                      onPress={() => {
                        setShowLocationPicker(false);
                        if (!isCurrent) {
                          if (Platform.OS !== "web") Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
                          router.replace(`/restaurant/${loc.id}` as any);
                        }
                      }}
                      style={{
                        flexDirection: "row",
                        alignItems: "center",
                        marginHorizontal: 16,
                        marginBottom: 8,
                        padding: 14,
                        borderRadius: 16,
                        backgroundColor: isCurrent ? "rgba(255,153,51,0.1)" : "#1a1a1a",
                        borderWidth: 1.5,
                        borderColor: isCurrent ? "rgba(255,153,51,0.45)" : "#242424",
                      }}
                    >
                      <Image
                        source={{ uri: loc.image }}
                        style={{ width: 52, height: 52, borderRadius: 12, borderWidth: 1, borderColor: "#2a2a2a" }}
                        resizeMode="cover"
                      />
                      <View style={{ flex: 1, marginLeft: 14 }}>
                        <View style={{ flexDirection: "row", alignItems: "center", marginBottom: 3 }}>
                          {isCurrent && (
                            <View style={{ backgroundColor: "rgba(255,153,51,0.2)", borderRadius: 6, paddingHorizontal: 7, paddingVertical: 2, marginRight: 8 }}>
                              <Text style={{ fontFamily: "Manrope_700Bold", color: "#FF9933", fontSize: 9 }}>CURRENT</Text>
                            </View>
                          )}
                          <Text numberOfLines={1} style={{ fontFamily: "BricolageGrotesque_700Bold", color: "#f5f5f5", fontSize: 15, flex: 1, letterSpacing: -0.2 }}>
                            {loc.name}
                          </Text>
                        </View>
                        <View style={{ flexDirection: "row", alignItems: "center" }}>
                          <MapPin size={11} color="#888" />
                          <Text numberOfLines={1} style={{ fontFamily: "Manrope_500Medium", color: "#888", fontSize: 12, marginLeft: 5, flex: 1 }}>
                            {loc.address}
                          </Text>
                        </View>
                      </View>
                      <View style={{ alignItems: "flex-end", marginLeft: 10 }}>
                        <Text style={{ fontFamily: "Manrope_600SemiBold", color: "#aaa", fontSize: 12 }}>
                          {loc.distance}
                        </Text>
                        {!isCurrent && (
                          <ChevronDown size={14} color="#555" style={{ marginTop: 4, transform: [{ rotate: "-90deg" }] }} />
                        )}
                      </View>
                    </Pressable>
                  );
                })}
              </View>
            </Pressable>
          </Pressable>
        </Modal>
      )}
    </View>
  );
}
