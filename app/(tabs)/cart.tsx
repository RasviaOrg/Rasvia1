import React, { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { View, Text, TextInput, Pressable, Platform, ActivityIndicator, ScrollView, Alert } from "react-native";
import { CachedImage } from "@/components/CachedImage";
import { SafeAreaView } from "react-native-safe-area-context";
import { useFocusEffect, useRouter } from "expo-router";
import * as Haptics from "expo-haptics";
import { Crown, Minus, Plus, ShoppingCart, Trash2, UtensilsCrossed, Truck, Users, X } from "lucide-react-native";
import { APP_BOTTOM_NAV_HEIGHT, APP_BOTTOM_NAV_OFFSET } from "@/components/AppBottomNav";
import { useAppTheme } from "@/lib/app-theme";
import { LoadingBlurOverlay } from "@/components/LoadingBlurOverlay";
import { TabScreenEntrance } from "@/components/TabScreenEntrance";
import { TaxEstimateLine } from "@/components/TaxEstimateLine";
import { formatCentsUsd } from "@/lib/texas-sales-tax-estimate";
import Animated, { FadeInDown, FadeOut } from "react-native-reanimated";
import { useCartTax } from "@/hooks/useCartTax";
import { useAuth } from "@/lib/auth-context";
import {
  fetchUserCartList,
  type UserCartListItem,
  type UserCartOrderType,
  upsertUserCartItem,
} from "@/lib/user-cart";
import { useClosedRestaurantIds } from "@/hooks/useClosedRestaurantIds";
import { resolveJoinSessionIdFromInput } from "@/lib/join-group-from-input";
import { supabase } from "@/lib/supabase";
import { loadActiveParties, removeActiveParty, subscribeActiveParties } from "@/lib/party-active";
import { loadPartyCreds, clearPartyCreds } from "@/lib/party-credentials";
import { canCancelPartySession } from "@/lib/order-cancel";
import { cancelSession, leaveSession } from "@/lib/party-session";
import * as SecureStore from "expo-secure-store";

type ActiveGroupInfo = {
  sessionId: string;
  restaurantName: string;
  restaurantId: number;
  memberCount: number;
  itemCount: number;
  subtotalCents: number;
  isHost: boolean;
  canHostCancel: boolean;
};

type RestaurantCartGroup = {
  /** Composite key — restaurantId + orderType. A user can legitimately have
   *  both a dine-in and takeout cart at the same restaurant; we render them
   *  as two cards so the dining intent is unambiguous on checkout. */
  groupKey: string;
  restaurantId: number;
  restaurantName: string;
  restaurantImage: string | null;
  orderType: UserCartOrderType;
  items: UserCartListItem[];
  subtotal: number;
};

export default function CartScreen() {
  const { colors, isDark } = useAppTheme();
  const router = useRouter();
  const { session } = useAuth();
  const [loading, setLoading] = useState(true);
  const [savingKey, setSavingKey] = useState<string | null>(null);
  const [items, setItems] = useState<UserCartListItem[]>([]);
  // Per-row request-id map so we only roll back if *our* in-flight write is
  // still the latest — rapid taps previously clobbered newer state with a
  // stale snapshot on the first failure.
  const latestReqIdByKey = useRef<Map<string, number>>(new Map());
  const reqCounter = useRef(0);
  const hasCompletedCartLoadRef = useRef(false);
  const [joinGroupInput, setJoinGroupInput] = useState("");
  const [joiningGroup, setJoiningGroup] = useState(false);
  const [activeGroup, setActiveGroup] = useState<ActiveGroupInfo | null>(null);
  const [activeGroupLoading, setActiveGroupLoading] = useState(false);
  const [leavingGroup, setLeavingGroup] = useState(false);

  useEffect(() => {
    hasCompletedCartLoadRef.current = false;
  }, [session?.user?.id]);

  const reloadCart = useCallback(async (mode: "full" | "soft" = "full") => {
    const userId = session?.user?.id;
    if (!userId) {
      setItems([]);
      setLoading(false);
      return;
    }
    const soft = mode === "soft" && hasCompletedCartLoadRef.current;
    try {
      if (!soft) setLoading(true);
      const rows = await fetchUserCartList(userId);
      setItems(rows);
    } finally {
      setLoading(false);
      hasCompletedCartLoadRef.current = true;
    }
  }, [session?.user?.id]);

  useFocusEffect(
    useCallback(() => {
      void reloadCart("soft");
    }, [reloadCart])
  );

  const loadActiveGroup = useCallback(async () => {
    setActiveGroupLoading(true);
    try {
      const ids = await loadActiveParties();
      if (ids.length === 0) { setActiveGroup(null); return; }
      const sessionId = ids[0];
      const creds = await loadPartyCreds(sessionId);
      if (!creds) { await removeActiveParty(sessionId); setActiveGroup(null); return; }

      const [sessRes, memRes, itemRes] = await Promise.all([
        supabase.from('party_sessions').select('restaurant_id, status, submitted_order_id').eq('id', sessionId).maybeSingle(),
        supabase.from('party_members').select('id, role').eq('session_id', sessionId).is('left_at', null),
        supabase.from('party_items').select('quantity, menu_item:menu_items(price)').eq('session_id', sessionId),
      ]);
      if (!sessRes.data) { setActiveGroup(null); return; }
      const status = String(sessRes.data.status ?? '');
      if (status === 'completed' || status === 'cancelled' || status === 'submitted') {
        await removeActiveParty(sessionId);
        setActiveGroup(null);
        return;
      }
      let kitchenOrderStatus: string | null = null;
      const submittedOrderId = (sessRes.data as { submitted_order_id?: number | null }).submitted_order_id;
      if (submittedOrderId != null) {
        const { data: ord } = await supabase.from('orders').select('status').eq('id', submittedOrderId).maybeSingle();
        kitchenOrderStatus = (ord as { status?: string } | null)?.status ?? null;
      } else {
        const { data: ord } = await supabase
          .from('orders')
          .select('status')
          .eq('party_session_id', sessionId)
          .not('status', 'in', '(cancelled,completed)')
          .order('created_at', { ascending: false })
          .limit(1)
          .maybeSingle();
        kitchenOrderStatus = (ord as { status?: string } | null)?.status ?? null;
      }
      const restaurantId = sessRes.data.restaurant_id as number;
      let restaurantName = 'Restaurant';
      try {
        const { data: r } = await supabase.from('restaurants').select('name').eq('id', restaurantId).maybeSingle();
        if ((r as any)?.name) restaurantName = String((r as any).name);
      } catch { /* ignore */ }
      const members = (memRes.data ?? []) as { id: string; role: string }[];
      const isHost = members.some(m => m.id === creds.memberId && m.role === 'host');
      const canHostCancel = isHost && canCancelPartySession(status, kitchenOrderStatus);
      const rawItems = (itemRes.data ?? []) as unknown as { quantity: number | null; menu_item: { price: number } | null }[];
      const itemCount = rawItems.reduce((s, it) => s + (it.quantity ?? 1), 0);
      const subtotalCents = rawItems.reduce((s, it) => {
        const price = Number((it.menu_item as any)?.price ?? 0);
        return s + Math.round(price * 100) * (it.quantity ?? 1);
      }, 0);
      setActiveGroup({
        sessionId,
        restaurantName,
        restaurantId,
        memberCount: members.length,
        itemCount,
        subtotalCents,
        isHost,
        canHostCancel,
      });
    } catch {
      setActiveGroup(null);
    } finally {
      setActiveGroupLoading(false);
    }
  }, []);

  useFocusEffect(useCallback(() => {
    void loadActiveGroup();
    const unsub = subscribeActiveParties(() => { void loadActiveGroup(); });
    return unsub;
  }, [loadActiveGroup]));

  const handleCancelActiveGroup = useCallback(() => {
    if (!activeGroup) return;
    Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Medium);
    Alert.alert('Cancel group order?', 'All members will be removed and any payments refunded.', [
      { text: 'Never mind', style: 'cancel' },
      {
        text: 'Cancel & refund',
        style: 'destructive',
        onPress: async () => {
          const creds = await loadPartyCreds(activeGroup.sessionId);
          if (!creds) return;
          setLeavingGroup(true);
          try {
            await cancelSession(supabase, creds);
            await clearPartyCreds(activeGroup.sessionId);
            await removeActiveParty(activeGroup.sessionId);
            try {
              const k = `rasvia_active_group_order_${session?.user?.id}`;
              const raw = await SecureStore.getItemAsync(k);
              if (raw) {
                const parsed = JSON.parse(raw);
                if (String(parsed?.sessionId ?? '') === activeGroup.sessionId) await SecureStore.deleteItemAsync(k);
              }
            } catch { /* ignore */ }
            setActiveGroup(null);
          } catch (err) {
            Alert.alert('Cancel failed', err instanceof Error ? err.message : 'Try again.');
          } finally {
            setLeavingGroup(false);
          }
        },
      },
    ]);
  }, [activeGroup, session?.user?.id]);

  const handleLeaveActiveGroup = useCallback(() => {
    if (!activeGroup) return;
    Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
    Alert.alert('Leave group order?', 'Your items will be removed if the cart is still open.', [
      { text: 'Stay', style: 'cancel' },
      {
        text: 'Leave',
        style: 'destructive',
        onPress: async () => {
          const creds = await loadPartyCreds(activeGroup.sessionId);
          if (!creds) return;
          setLeavingGroup(true);
          try {
            await leaveSession(supabase, creds);
            await clearPartyCreds(activeGroup.sessionId);
            await removeActiveParty(activeGroup.sessionId);
            setActiveGroup(null);
          } catch {
            /* ignore — session might already be gone */
            setActiveGroup(null);
          } finally {
            setLeavingGroup(false);
          }
        },
      },
    ]);
  }, [activeGroup]);

  const goHome = () => {
    if (Platform.OS !== "web") Haptics.selectionAsync();
    router.navigate("/" as any);
  };

  const handleJoinGroupFromInput = useCallback(async () => {
    const raw = joinGroupInput.trim();
    if (!raw) {
      Alert.alert(
        "Could not open group order",
        "Paste a table link, table code (e.g. from the QR), or a group join link.",
      );
      return;
    }
    setJoiningGroup(true);
    try {
      const sessionId = await resolveJoinSessionIdFromInput(supabase, raw);
      if (!sessionId) {
        Alert.alert(
          "Could not open group order",
          "Paste a full table link (rasvia.com/t/…), the table code, a join link, or a session id.",
        );
        return;
      }
      if (Platform.OS !== "web") Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
      setJoinGroupInput("");
      router.push(`/join/${sessionId}` as any);
    } catch (err) {
      Alert.alert(
        "Could not open table",
        err instanceof Error ? err.message : "Please try again or scan the QR on your table.",
      );
    } finally {
      setJoiningGroup(false);
    }
  }, [joinGroupInput, router]);

  const grouped = useMemo<RestaurantCartGroup[]>(() => {
    const map = new Map<string, RestaurantCartGroup>();
    for (const row of items) {
      const orderType = row.orderType ?? "dine_in";
      const groupKey = `${row.restaurantId}:${orderType}`;
      const existing = map.get(groupKey);
      if (existing) {
        existing.items.push(row);
        existing.subtotal += row.subtotal;
      } else {
        map.set(groupKey, {
          groupKey,
          restaurantId: row.restaurantId,
          restaurantName: row.restaurantName,
          restaurantImage: row.restaurantImage,
          orderType,
          items: [row],
          subtotal: row.subtotal,
        });
      }
    }
    return Array.from(map.values());
  }, [items]);

  const grandTotal = useMemo(
    () => grouped.reduce((sum, group) => sum + group.subtotal, 0),
    [grouped]
  );
  // Pull the "currently closed" set once — used to disable checkout CTAs for
  // restaurants that aren't taking orders right now. Re-evaluates every 60s.
  const closedRestaurantIds = useClosedRestaurantIds();
  const isGroupClosed = useCallback(
    (restaurantId: number) => closedRestaurantIds.has(String(restaurantId)),
    [closedRestaurantIds]
  );
  const openGroups = useMemo(
    () => grouped.filter((g) => !isGroupClosed(g.restaurantId)),
    [grouped, isGroupClosed]
  );
  const cartIsEmpty = grouped.length === 0;
  const anyOpen = openGroups.length > 0;
  const checkoutDisabled = cartIsEmpty || !anyOpen;
  const showCartLoadingBlur = loading && !!session?.user?.id;

  const [groupTaxMap, setGroupTaxMap] = useState<Record<string, number>>({});
  const [groupTaxLoadingMap, setGroupTaxLoadingMap] = useState<Record<string, boolean>>({});

  const handleTaxComputed = useCallback((groupKey: string, taxCents: number) => {
    setGroupTaxMap((prev) => prev[groupKey] === taxCents ? prev : { ...prev, [groupKey]: taxCents });
    setGroupTaxLoadingMap((prev) => prev[groupKey] === false ? prev : { ...prev, [groupKey]: false });
  }, []);

  const handleTaxLoading = useCallback((groupKey: string, isLoading: boolean) => {
    setGroupTaxLoadingMap((prev) => prev[groupKey] === isLoading ? prev : { ...prev, [groupKey]: isLoading });
  }, []);

  const grandTaxLoading = useMemo(
    () => grouped.some((g) => groupTaxLoadingMap[g.groupKey] !== false),
    [grouped, groupTaxLoadingMap],
  );

  const grandTaxCents = useMemo(
    () => grouped.reduce((sum, g) => sum + (groupTaxMap[g.groupKey] ?? 0), 0),
    [grouped, groupTaxMap],
  );

  const grandEstTotalCents = useMemo(() => {
    return grouped.reduce((sum, g) => {
      const tax = groupTaxMap[g.groupKey] ?? 0;
      return sum + Math.round(g.subtotal * 100) + tax;
    }, 0);
  }, [grouped, groupTaxMap]);
  const grandEstTotalLabel = formatCentsUsd(grandEstTotalCents);

  const updateQuantity = useCallback(
    async (row: UserCartListItem, nextQty: number) => {
      const userId = session?.user?.id;
      if (!userId) return;
      const orderType = row.orderType ?? "dine_in";
      const key = `${row.restaurantId}:${row.menuItemId}:${orderType}`;

      // Tag this write so we can ignore its failure if a newer tap supersedes it.
      reqCounter.current += 1;
      const reqId = reqCounter.current;
      latestReqIdByKey.current.set(key, reqId);

      // Remember the pre-tap quantity for targeted rollback (NOT a snapshot of
      // the whole list — that caused a race where a failure would overwrite
      // unrelated rows the user had already updated).
      const previousQty = row.quantity;

      const matchesRow = (p: UserCartListItem) =>
        p.restaurantId === row.restaurantId &&
        p.menuItemId === row.menuItemId &&
        (p.orderType ?? "dine_in") === orderType;
      setItems((prev) =>
        nextQty <= 0
          ? prev.filter((p) => !matchesRow(p))
          : prev.map((p) =>
              matchesRow(p)
                ? {
                    ...p,
                    quantity: nextQty,
                    subtotal: Number((p.unitPrice * nextQty).toFixed(2)),
                  }
                : p
            )
      );
      if (Platform.OS !== "web") Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);

      setSavingKey(key);
      try {
        await upsertUserCartItem({
          userId,
          restaurantId: row.restaurantId,
          menuItemId: row.menuItemId,
          quantity: nextQty,
          orderType,
        });
      } catch (err) {
        // Only revert if we're still the most recent write for this key; a
        // newer tap may have already corrected the row, in which case
        // clobbering it would show the wrong quantity.
        if (latestReqIdByKey.current.get(key) === reqId) {
          setItems((prev) => {
            const exists = prev.some((p) => matchesRow(p));
            if (!exists) {
              // Row was optimistically removed (nextQty <= 0). Put it back.
              return [
                ...prev,
                {
                  ...row,
                  quantity: previousQty,
                  subtotal: Number((row.unitPrice * previousQty).toFixed(2)),
                },
              ];
            }
            return prev.map((p) =>
              matchesRow(p)
                ? {
                    ...p,
                    quantity: previousQty,
                    subtotal: Number((p.unitPrice * previousQty).toFixed(2)),
                  }
                : p,
            );
          });
          Alert.alert(
            "Couldn't update cart",
            err instanceof Error ? err.message : "Please try again.",
          );
        }
      } finally {
        // Only clear the spinner if we're still the latest request.
        if (latestReqIdByKey.current.get(key) === reqId) {
          setSavingKey(null);
        }
      }
    },
    [session?.user?.id]
  );

  const openRestaurant = useCallback(
    (restaurantId: number, orderType?: UserCartOrderType, autoCheckout?: boolean) => {
      const params: Record<string, string> = { id: String(restaurantId) };
      if (orderType) params.cartType = orderType;
      if (autoCheckout) params.autoCheckout = "1";
      router.push({ pathname: "/restaurant/[id]", params } as any);
    },
    [router]
  );

  /**
   * Anchored Checkout CTA behaviour:
   * - 1 restaurant group: deep-link straight into that restaurant page with
   *   `autoCheckout=1` so the CheckoutModal opens as soon as the cart seed is
   *   loaded.
   * - 2+ groups: we can't disambiguate the target, so nudge the user to pick
   *   a specific restaurant card (which also supports autoCheckout).
   */
  const handleCheckoutPress = useCallback(() => {
    if (Platform.OS !== "web") Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
    if (grouped.length === 0) return;

    // If every restaurant in the cart is closed right now, don't pretend we
    // can route anywhere meaningful. Tell the user why and bail.
    if (openGroups.length === 0) {
      Alert.alert(
        "Restaurants are closed",
        "Every restaurant in your cart is currently closed. Check back during their open hours to place an order.",
      );
      return;
    }

    // Only one group is actually orderable → deep-link straight to it.
    if (openGroups.length === 1) {
      const g = openGroups[0];
      openRestaurant(g.restaurantId, g.orderType, true);
      return;
    }

    // Multiple open restaurants — can't disambiguate without input.
    Alert.alert(
      "Pick a restaurant",
      "You have items from multiple restaurants — tap one to check out.",
    );
  }, [grouped, openGroups, openRestaurant]);

  return (
    <View style={{ flex: 1, backgroundColor: colors.background }}>
      <SafeAreaView style={{ flex: 1, paddingHorizontal: 20 }} edges={["top"]}>
        <TabScreenEntrance>
        <View style={{ flex: 1 }}>
        <View
          style={{ flexDirection: "row", alignItems: "center", marginTop: 6, marginBottom: 6 }}
        >
          <Text style={{ fontFamily: "BricolageGrotesque_800ExtraBold", color: colors.text, fontSize: 30 }}>
            Cart
          </Text>
        </View>

        {activeGroupLoading ? (
          <View style={{
            marginBottom: 16,
            borderRadius: 14,
            borderWidth: 1,
            borderColor: isDark ? "rgba(255,153,51,0.28)" : "rgba(194,65,12,0.35)",
            backgroundColor: isDark ? "rgba(255,153,51,0.08)" : "rgba(255,153,51,0.12)",
            padding: 16,
            alignItems: "center",
            justifyContent: "center",
            minHeight: 64,
          }}>
            <ActivityIndicator size="small" color={colors.saffron} />
          </View>
        ) : activeGroup ? (
          /* ── Active group order card ── */
          <Animated.View entering={FadeInDown.duration(300)} exiting={FadeOut.duration(450)} style={{
            marginBottom: 16,
            borderRadius: 14,
            borderWidth: 1.5,
            borderColor: isDark ? "rgba(255,153,51,0.4)" : "rgba(194,65,12,0.45)",
            backgroundColor: isDark ? "rgba(255,153,51,0.1)" : "rgba(255,153,51,0.14)",
            overflow: "hidden",
          }}>
            {/* Header row */}
            <Pressable
              onPress={() => {
                if (Platform.OS !== "web") Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
                router.push(`/join/${activeGroup.sessionId}` as any);
              }}
              style={{ flexDirection: "row", alignItems: "center", gap: 10, padding: 12 }}
            >
              <View style={{
                width: 36,
                height: 36,
                borderRadius: 10,
                backgroundColor: isDark ? "rgba(255,153,51,0.22)" : "rgba(255,153,51,0.26)",
                alignItems: "center",
                justifyContent: "center",
              }}>
                {activeGroup.isHost
                  ? <Crown size={18} color={colors.saffron} />
                  : <Users size={18} color={colors.saffron} />}
              </View>
              <View style={{ flex: 1 }}>
                <Text style={{ fontFamily: "Manrope_700Bold", fontSize: 13, color: colors.text }}>
                  {activeGroup.isHost ? 'Hosting' : 'Group order'} · {activeGroup.restaurantName}
                </Text>
                <Text style={{ fontFamily: "Manrope_500Medium", fontSize: 11, color: colors.textMuted, marginTop: 2 }}>
                  {activeGroup.memberCount} member{activeGroup.memberCount === 1 ? '' : 's'} · {activeGroup.itemCount} item{activeGroup.itemCount === 1 ? '' : 's'} · {formatCentsUsd(activeGroup.subtotalCents)}
                </Text>
              </View>
              <Text style={{ fontFamily: "Manrope_700Bold", fontSize: 12, color: colors.saffron }}>Open →</Text>
            </Pressable>
            {/* Action row */}
            <View style={{
              flexDirection: "row",
              borderTopWidth: 1,
              borderTopColor: isDark ? "rgba(255,153,51,0.2)" : "rgba(194,65,12,0.2)",
              paddingHorizontal: 12,
              paddingVertical: 8,
              gap: 8,
            }}>
              {leavingGroup ? (
                <ActivityIndicator size="small" color={colors.textMuted} style={{ flex: 1 }} />
              ) : activeGroup.isHost && activeGroup.canHostCancel ? (
                <Pressable onPress={handleCancelActiveGroup} style={{
                  flexDirection: "row",
                  alignItems: "center",
                  gap: 4,
                  paddingVertical: 6,
                  paddingHorizontal: 10,
                  borderRadius: 8,
                  backgroundColor: "rgba(239,68,68,0.1)",
                  borderWidth: 1,
                  borderColor: "rgba(239,68,68,0.3)",
                }}>
                  <X size={13} color="#EF4444" />
                  <Text style={{ fontFamily: "Manrope_700Bold", fontSize: 12, color: "#EF4444" }}>Cancel order</Text>
                </Pressable>
              ) : (
                <Pressable onPress={handleLeaveActiveGroup} style={{
                  flexDirection: "row",
                  alignItems: "center",
                  gap: 4,
                  paddingVertical: 6,
                  paddingHorizontal: 10,
                  borderRadius: 8,
                  backgroundColor: colors.backgroundElevated,
                  borderWidth: 1,
                  borderColor: colors.cardBorder,
                }}>
                  <Text style={{ fontFamily: "Manrope_700Bold", fontSize: 12, color: colors.textMuted }}>Leave</Text>
                </Pressable>
              )}
            </View>
          </Animated.View>
        ) : (
          /* ── Join a group order ── */
          <View
            style={{
              marginBottom: 16,
              borderRadius: 14,
              borderWidth: 1,
              borderColor: isDark ? "rgba(255,153,51,0.28)" : "rgba(194,65,12,0.35)",
              backgroundColor: isDark ? "rgba(255,153,51,0.08)" : "rgba(255,153,51,0.12)",
              padding: 12,
              gap: 10,
            }}
          >
            <View style={{ flexDirection: "row", alignItems: "center", gap: 8 }}>
              <View
                style={{
                  width: 28,
                  height: 28,
                  borderRadius: 8,
                  backgroundColor: isDark ? "rgba(255,153,51,0.18)" : "rgba(255,153,51,0.22)",
                  alignItems: "center",
                  justifyContent: "center",
                }}
              >
                <Users size={15} color={colors.saffron} />
              </View>
              <View style={{ flex: 1 }}>
                <Text
                  style={{
                    fontFamily: "Manrope_700Bold",
                    fontSize: 13,
                    color: colors.text,
                  }}
                >
                  Join a group order
                </Text>
                <Text
                  style={{
                    fontFamily: "Manrope_500Medium",
                    fontSize: 11,
                    color: colors.textMuted,
                    marginTop: 2,
                    lineHeight: 15,
                  }}
                >
                  Same as scanning the table QR — paste the link, table code, or join id.
                </Text>
              </View>
            </View>
            <View style={{ flexDirection: "row", alignItems: "center", gap: 8 }}>
              <TextInput
                value={joinGroupInput}
                onChangeText={setJoinGroupInput}
                placeholder="Table link, code, or join id"
                placeholderTextColor={colors.textMuted}
                autoCapitalize="none"
                autoCorrect={false}
                editable={!joiningGroup}
                returnKeyType="go"
                onSubmitEditing={() => void handleJoinGroupFromInput()}
                style={{
                  flex: 1,
                  minWidth: 0,
                  fontFamily: "Manrope_500Medium",
                  fontSize: 14,
                  color: colors.text,
                  backgroundColor: colors.backgroundElevated,
                  borderWidth: 1,
                  borderColor: colors.cardBorder,
                  borderRadius: 10,
                  paddingVertical: Platform.OS === "ios" ? 11 : 9,
                  paddingHorizontal: 12,
                }}
              />
              <Pressable
                onPress={() => void handleJoinGroupFromInput()}
                disabled={joiningGroup}
                style={{
                  backgroundColor: colors.saffron,
                  paddingHorizontal: 16,
                  paddingVertical: Platform.OS === "ios" ? 11 : 10,
                  borderRadius: 10,
                  alignItems: "center",
                  justifyContent: "center",
                  opacity: joiningGroup ? 0.65 : 1,
                }}
              >
                {joiningGroup ? (
                  <ActivityIndicator size="small" color={isDark ? "#0f0f0f" : "#ffffff"} />
                ) : (
                <Text
                  style={{
                    fontFamily: "Manrope_700Bold",
                    fontSize: 13,
                    color: isDark ? "#0f0f0f" : "#ffffff",
                  }}
                >
                  Open
                </Text>
                )}
              </Pressable>
            </View>
          </View>
        )}

        {loading ? (
          <View style={{ flex: 1 }} />
        ) : items.length === 0 ? (
          <Animated.View
            entering={FadeInDown.duration(320)}
            style={{
              flex: 1,
              alignItems: "center",
              justifyContent: "center",
              paddingBottom: APP_BOTTOM_NAV_HEIGHT + 54 + APP_BOTTOM_NAV_OFFSET,
            }}
          >
            <View
              style={{
                width: 120,
                height: 120,
                borderRadius: 60,
                alignItems: "center",
                justifyContent: "center",
                backgroundColor: colors.card,
                borderWidth: 1,
                borderColor: colors.cardBorder,
                marginBottom: 24,
              }}
            >
              <ShoppingCart size={48} color={colors.iconMuted} />
            </View>
            <Text
              style={{
                fontFamily: "BricolageGrotesque_800ExtraBold",
                color: colors.text,
                fontSize: 26,
                textAlign: "center",
                marginBottom: 8,
              }}
            >
              Your cart is empty
            </Text>
            <Text
              style={{
                fontFamily: "Manrope_500Medium",
                color: colors.textMuted,
                fontSize: 14,
                textAlign: "center",
                maxWidth: 280,
                lineHeight: 21,
                marginBottom: 22,
              }}
            >
              Add items to get started.
            </Text>
            <Pressable
              onPress={goHome}
              style={{
                backgroundColor: isDark ? "#FF9933" : colors.card,
                borderRadius: 14,
                paddingHorizontal: 22,
                paddingVertical: 12,
                borderWidth: isDark ? 0 : 1,
                borderColor: isDark ? "transparent" : colors.saffron,
              }}
            >
              <Text
                style={{
                  color: isDark ? "#0f0f0f" : colors.saffron,
                  fontFamily: "Manrope_700Bold",
                  fontSize: 14,
                }}
              >
                Go To Main Menu
              </Text>
            </Pressable>
          </Animated.View>
        ) : (
          <Animated.View
            entering={FadeInDown.duration(250)}
            style={{
              flex: 1,
              paddingBottom: -20 + APP_BOTTOM_NAV_HEIGHT + APP_BOTTOM_NAV_OFFSET
            }}
          >
            <ScrollView
              style={{ flex: 1 }}
              contentContainerStyle={{ gap: 12, paddingBottom: 12 }}
              showsVerticalScrollIndicator={false}
            >
              {grouped.map((group) => (
                <CartGroupCard
                  key={group.groupKey}
                  group={group}
                  isGroupClosed={isGroupClosed}
                  openRestaurant={openRestaurant}
                  savingKey={savingKey}
                  updateQuantity={updateQuantity}
                  onTaxComputed={(cents) => handleTaxComputed(group.groupKey, cents)}
                  onTaxLoading={(isLoading) => handleTaxLoading(group.groupKey, isLoading)}
                />
              ))}
            </ScrollView>

            <View
              style={{
                borderTopWidth: 1,
                borderTopColor: colors.cardBorder,
                backgroundColor: colors.background,
                paddingTop: 16,
                paddingBottom: APP_BOTTOM_NAV_HEIGHT + APP_BOTTOM_NAV_OFFSET + 10,
                flexDirection: "row",
                alignItems: "center",
                justifyContent: "space-between",
                gap: 14,
              }}
            >
              <View style={{ flex: 1 }}>
                <Text style={{ color: colors.textMuted, fontFamily: "Manrope_600SemiBold", fontSize: 12 }}>
                  Total
                </Text>
                <Text style={{ color: "#FF9933", fontFamily: "BricolageGrotesque_800ExtraBold", fontSize: 26 }}>
                  {grandEstTotalLabel}
                </Text>
                <View style={{ flexDirection: "row", alignItems: "center", gap: 4, marginTop: 4 }}>
                  {grandTaxLoading ? (
                    <>
                      <Text style={{ color: colors.textMuted, fontFamily: "Manrope_500Medium", fontSize: 11 }}>
                        Subtotal {formatCentsUsd(Math.round(grandTotal * 100))} + tax
                      </Text>
                      <ActivityIndicator size="small" color={colors.textMuted} style={{ transform: [{ scale: 0.55 }] }} />
                    </>
                  ) : (
                    <Text style={{ color: colors.textMuted, fontFamily: "Manrope_500Medium", fontSize: 11 }}>
                      Subtotal {formatCentsUsd(Math.round(grandTotal * 100))} + {grandTaxCents > 0 ? `${formatCentsUsd(grandTaxCents)} tax` : "tax"}
                    </Text>
                  )}
                </View>
              </View>
              <Pressable
                onPress={handleCheckoutPress}
                accessibilityLabel="Checkout"
                disabled={checkoutDisabled}
                accessibilityState={{ disabled: checkoutDisabled }}
                style={({ pressed }) => ({
                  backgroundColor: checkoutDisabled
                    ? colors.pressableBg
                    : pressed
                    ? "#e88829"
                    : "#FF9933",
                  opacity: checkoutDisabled ? 0.85 : 1,
                  borderRadius: 10,
                  paddingHorizontal: 22,
                  paddingVertical: 14,
                  flexDirection: "row",
                  alignItems: "center",
                  gap: 8,
                  shadowColor: checkoutDisabled ? "transparent" : "#FF9933",
                  shadowOpacity: checkoutDisabled ? 0 : 0.25,
                  shadowOffset: { width: 0, height: 4 },
                  shadowRadius: 12,
                  elevation: checkoutDisabled ? 0 : 4,
                  borderWidth: checkoutDisabled ? 1 : 0,
                  borderColor: checkoutDisabled ? colors.cardBorder : "transparent",
                })}
              >
                <ShoppingCart
                  size={16}
                  color={checkoutDisabled ? colors.textMuted : (isDark ? "#0f0f0f" : "#ffffff")}
                />
                <Text
                  style={{
                    color: checkoutDisabled ? colors.textMuted : (isDark ? "#0f0f0f" : "#ffffff"),
                    fontFamily: "Manrope_700Bold",
                    fontSize: 15,
                    letterSpacing: 0.3,
                  }}
                >
                  {cartIsEmpty ? "Cart empty" : !anyOpen ? "Closed" : "Checkout"}
                </Text>
              </Pressable>
            </View>
          </Animated.View>
        )}
        </View>
        </TabScreenEntrance>

        {showCartLoadingBlur && <LoadingBlurOverlay />}
      </SafeAreaView>
    </View>
  );
}

function CartGroupCard({
  group,
  isGroupClosed,
  openRestaurant,
  savingKey,
  updateQuantity,
  onTaxComputed,
  onTaxLoading,
}: {
  group: RestaurantCartGroup;
  isGroupClosed: (id: number) => boolean;
  openRestaurant: (id: number, type?: UserCartOrderType, autoCheckout?: boolean) => void;
  savingKey: string | null;
  updateQuantity: (row: UserCartListItem, nextQty: number) => Promise<void>;
  onTaxComputed: (cents: number) => void;
  onTaxLoading: (isLoading: boolean) => void;
}) {
  const { colors, isDark } = useAppTheme();
  const isTakeout = group.orderType === "takeout";
  const PillIcon = isTakeout ? Truck : UtensilsCrossed;
  const pillColor = isTakeout ? "#60A5FA" : "#FF9933";
  const groupClosed = isGroupClosed(group.restaurantId);

  const taxItems = useMemo(
    () =>
      group.items.map((r) => ({
        price_cents: Math.round(r.unitPrice * 100),
        quantity: r.quantity,
        stripe_tax_code: r.stripeTaxCode ?? "txcd_40060003",
      })),
    [group.items]
  );
  const { taxCents, loading: taxLoading } = useCartTax(group.restaurantId, taxItems);

  useEffect(() => {
    onTaxLoading(taxLoading);
  }, [taxLoading, onTaxLoading]);

  useEffect(() => {
    if (taxCents !== null) {
      onTaxComputed(taxCents);
    }
  }, [taxCents, onTaxComputed]);

  return (
    <View
      style={{
        backgroundColor: colors.card,
        borderWidth: 1,
        borderColor: colors.cardBorder,
        borderRadius: 16,
        overflow: "hidden",
      }}
    >
      <View
        style={{
          flexDirection: "row",
          alignItems: "center",
          gap: 10,
          paddingHorizontal: 12,
          paddingVertical: 10,
          borderBottomWidth: 1,
          borderBottomColor: colors.cardBorder,
          backgroundColor: colors.backgroundElevated,
        }}
      >
        {group.restaurantImage ? (
          <CachedImage
            source={{ uri: group.restaurantImage }}
            style={{ width: 40, height: 40, borderRadius: 10, backgroundColor: colors.pressableBg }}
            fallback={
              <View
                style={{
                  width: 40,
                  height: 40,
                  borderRadius: 10,
                  backgroundColor: colors.pressableBg,
                  alignItems: "center",
                  justifyContent: "center",
                }}
              >
                <ShoppingCart size={17} color={colors.iconMuted} />
              </View>
            }
          />
        ) : (
          <View
            style={{
              width: 40,
              height: 40,
              borderRadius: 10,
              backgroundColor: colors.pressableBg,
              alignItems: "center",
              justifyContent: "center",
            }}
          >
            <ShoppingCart size={17} color={colors.iconMuted} />
          </View>
        )}
        <View style={{ flex: 1 }}>
          <Text style={{ fontFamily: "Manrope_700Bold", color: colors.text, fontSize: 15 }} numberOfLines={1}>
            {group.restaurantName}
          </Text>
          <View style={{ flexDirection: "row", alignItems: "center", gap: 8, marginTop: 2 }}>
            <View
              style={{
                flexDirection: "row",
                alignItems: "center",
                gap: 4,
                paddingHorizontal: 8,
                paddingVertical: 3,
                borderRadius: 999,
                backgroundColor: `${pillColor}1F`,
                borderWidth: 1,
                borderColor: `${pillColor}55`,
              }}
            >
              <PillIcon size={11} color={pillColor} />
              <Text style={{ fontFamily: "Manrope_700Bold", color: pillColor, fontSize: 10, letterSpacing: 0.4 }}>
                {isTakeout ? "TAKEOUT" : "DINE-IN"}
              </Text>
            </View>
            <View style={{ alignItems: "center", gap: 1 }}>
              <Text style={{ fontFamily: "Manrope_500Medium", color: colors.textMuted, fontSize: 9, letterSpacing: 0.2 }}>
                Subtotal
              </Text>
              <Text style={{ fontFamily: "Manrope_600SemiBold", color: "#FF9933", fontSize: 12 }}>
                ${(group.subtotal || 0).toFixed(2)}
              </Text>
              <View style={{ flexDirection: "row", alignItems: "center", gap: 3 }}>
                {taxLoading ? (
                  <ActivityIndicator size="small" color={colors.textMuted} style={{ transform: [{ scale: 0.55 }] }} />
                ) : taxCents !== null ? (
                  <Text style={{ fontFamily: "Manrope_500Medium", color: colors.textMuted, fontSize: 9 }}>
                    {`+ ${formatCentsUsd(taxCents)} tax`}
                  </Text>
                ) : null}
              </View>
            </View>
          </View>
        </View>
        <View style={{ flexDirection: "row", alignItems: "center", gap: 8 }}>
          <Pressable
            onPress={() => {
              if (groupClosed) {
                Alert.alert(
                  "Closed right now",
                  `${group.restaurantName} isn't taking orders at the moment. Come back during open hours to check out.`,
                );
                return;
              }
              openRestaurant(group.restaurantId, group.orderType, true);
            }}
            hitSlop={6}
            disabled={groupClosed}
            accessibilityState={{ disabled: groupClosed }}
            style={{
              flexDirection: "row",
              alignItems: "center",
              gap: 5,
              paddingHorizontal: 10,
              paddingVertical: 6,
              borderRadius: 10,
              backgroundColor: groupClosed
                ? colors.pressableBg
                : "#FF9933",
              opacity: groupClosed ? 0.7 : 1,
              borderWidth: groupClosed ? 1 : 0,
              borderColor: groupClosed ? colors.cardBorder : "transparent",
            }}
          >
            <ShoppingCart
              size={11}
              color={groupClosed ? colors.textMuted : (isDark ? "#0f0f0f" : "#ffffff")}
            />
            <Text
              style={{
                fontFamily: "Manrope_700Bold",
                color: groupClosed ? colors.textMuted : (isDark ? "#0f0f0f" : "#ffffff"),
                fontSize: 11,
                letterSpacing: 0.3,
              }}
            >
              {groupClosed ? "Closed" : "Checkout"}
            </Text>
          </Pressable>
          <Pressable
            onPress={() => openRestaurant(group.restaurantId, group.orderType)}
            hitSlop={6}
            style={{
              paddingHorizontal: 10,
              paddingVertical: 6,
              borderRadius: 10,
              borderWidth: 1,
              borderColor: colors.cardBorder,
            }}
          >
            <Text style={{ fontFamily: "Manrope_700Bold", color: colors.textMuted, fontSize: 11 }}>
              View
            </Text>
          </Pressable>
        </View>
      </View>

      <View style={{ padding: 10, gap: 8 }}>
        {group.items.map((row) => {
          const key = `${row.restaurantId}:${row.menuItemId}:${group.orderType}`;
          const busy = savingKey === key;
          return (
            <View
              key={key}
              style={{
                borderWidth: 1,
                borderColor: colors.cardBorder,
                borderRadius: 12,
                padding: 10,
                backgroundColor: colors.backgroundElevated,
              }}
            >
              <View style={{ flexDirection: "row", alignItems: "center", gap: 10 }}>
                {row.itemImage ? (
                  <CachedImage
                    source={{ uri: row.itemImage }}
                    style={{ width: 48, height: 48, borderRadius: 10, backgroundColor: colors.pressableBg }}
                    fallback={
                      <View
                        style={{
                          width: 48,
                          height: 48,
                          borderRadius: 10,
                          backgroundColor: colors.pressableBg,
                          alignItems: "center",
                          justifyContent: "center",
                        }}
                      >
                        <ShoppingCart size={18} color={colors.iconMuted} />
                      </View>
                    }
                  />
                ) : (
                  <View
                    style={{
                      width: 48,
                      height: 48,
                      borderRadius: 10,
                      backgroundColor: colors.pressableBg,
                      alignItems: "center",
                      justifyContent: "center",
                    }}
                  >
                    <ShoppingCart size={18} color={colors.iconMuted} />
                  </View>
                )}
                <View style={{ flex: 1 }}>
                  <Text style={{ fontFamily: "Manrope_700Bold", color: colors.text, fontSize: 14 }} numberOfLines={2}>
                    {row.itemName}
                  </Text>
                  <Text style={{ fontFamily: "Manrope_500Medium", color: colors.textMuted, fontSize: 12 }}>
                    ${row.unitPrice.toFixed(2)} each
                  </Text>
                </View>
                <Text style={{ fontFamily: "Manrope_700Bold", color: "#FF9933", fontSize: 14 }}>
                  ${row.subtotal.toFixed(2)}
                </Text>
              </View>

              <View style={{ marginTop: 10, flexDirection: "row", justifyContent: "space-between", alignItems: "center" }}>
                <View style={{ flexDirection: "row", alignItems: "center", gap: 8 }}>
                  <Pressable
                    disabled={busy}
                    onPress={() => {
                      if (row.quantity <= 1) {
                        Alert.alert(
                          "Remove Item",
                          `Remove ${row.itemName} from your cart?`,
                          [
                            { text: "Keep", style: "cancel" },
                            {
                              text: "Remove",
                              style: "destructive",
                              onPress: () => { void updateQuantity(row, 0); },
                            },
                          ]
                        );
                        return;
                      }
                      void updateQuantity(row, row.quantity - 1);
                    }}
                    style={{
                      width: 30,
                      height: 30,
                      borderRadius: 15,
                      backgroundColor: colors.pressableBg,
                      borderWidth: 1,
                      borderColor: colors.cardBorder,
                      alignItems: "center",
                      justifyContent: "center",
                      opacity: busy ? 0.5 : 1,
                    }}
                  >
                    <Minus size={14} color={colors.textSecondary} />
                  </Pressable>
                  <Text style={{ minWidth: 18, textAlign: "center", fontFamily: "Manrope_700Bold", color: colors.text }}>
                    {row.quantity}
                  </Text>
                  <Pressable
                    disabled={busy}
                    onPress={() => void updateQuantity(row, row.quantity + 1)}
                    style={{
                      width: 30,
                      height: 30,
                      borderRadius: 15,
                      backgroundColor: colors.pressableBg,
                      borderWidth: 1,
                      borderColor: colors.cardBorder,
                      alignItems: "center",
                      justifyContent: "center",
                      opacity: busy ? 0.5 : 1,
                    }}
                  >
                    <Plus size={14} color={colors.textSecondary} />
                  </Pressable>
                </View>
                <Pressable
                  disabled={busy}
                  onPress={() => {
                    Alert.alert(
                      "Remove Item",
                      `Remove ${row.itemName} from your cart?`,
                      [
                        { text: "Keep", style: "cancel" },
                        {
                          text: "Remove",
                          style: "destructive",
                          onPress: () => { void updateQuantity(row, 0); },
                        },
                      ]
                    );
                  }}
                  style={{
                    width: 30,
                    height: 30,
                    borderRadius: 15,
                    backgroundColor: "rgba(239,68,68,0.12)",
                    borderWidth: 1,
                    borderColor: "rgba(239,68,68,0.4)",
                    alignItems: "center",
                    justifyContent: "center",
                    opacity: busy ? 0.5 : 1,
                  }}
                >
                  {busy ? <ActivityIndicator size="small" color="#fca5a5" /> : <Trash2 size={14} color="#fca5a5" />}
                </Pressable>
              </View>
            </View>
          );
        })}
      </View>
    </View>
  );
}
