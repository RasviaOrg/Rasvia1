import React, { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { View, Text, Pressable, Platform, ActivityIndicator, Image, ScrollView, Alert } from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";
import { useFocusEffect, useRouter } from "expo-router";
import * as Haptics from "expo-haptics";
import { Minus, Plus, ShoppingCart, Trash2, UtensilsCrossed, Truck } from "lucide-react-native";
import { APP_BOTTOM_NAV_HEIGHT, APP_BOTTOM_NAV_OFFSET } from "@/components/AppBottomNav";
import { useAppTheme } from "@/lib/app-theme";
import { LoadingBlurOverlay } from "@/components/LoadingBlurOverlay";
import { TabScreenEntrance } from "@/components/TabScreenEntrance";
import Animated, { FadeInDown } from "react-native-reanimated";
import { useAuth } from "@/lib/auth-context";
import {
  fetchUserCartList,
  type UserCartListItem,
  type UserCartOrderType,
  upsertUserCartItem,
} from "@/lib/user-cart";
import { useClosedRestaurantIds } from "@/hooks/useClosedRestaurantIds";

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
  const { colors } = useAppTheme();
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

  const goHome = () => {
    if (Platform.OS !== "web") Haptics.selectionAsync();
    router.navigate("/" as any);
  };

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
  const anyOpen = openGroups.length > 0;
  const showCartLoadingBlur = loading && !!session?.user?.id;

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
          style={{ flexDirection: "row", alignItems: "center", marginTop: 6, marginBottom: 14 }}
        >
          <Text style={{ fontFamily: "BricolageGrotesque_800ExtraBold", color: colors.text, fontSize: 30 }}>
            Cart
          </Text>
        </View>

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
                backgroundColor: "#1a1a1a",
                borderWidth: 1,
                borderColor: "#2a2a2a",
                marginBottom: 24,
              }}
            >
              <ShoppingCart size={48} color="#666666" />
            </View>
            <Text
              style={{
                fontFamily: "BricolageGrotesque_800ExtraBold",
                color: "#f5f5f5",
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
                color: "#9a9a9a",
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
                backgroundColor: "#FF9933",
                borderRadius: 14,
                paddingHorizontal: 22,
                paddingVertical: 12,
              }}
            >
              <Text style={{ color: "#0f0f0f", fontFamily: "Manrope_700Bold", fontSize: 14 }}>
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
              {grouped.map((group) => {
                const isTakeout = group.orderType === "takeout";
                const PillIcon = isTakeout ? Truck : UtensilsCrossed;
                const pillColor = isTakeout ? "#60A5FA" : "#FF9933";
                const groupClosed = isGroupClosed(group.restaurantId);
                return (
                <View
                  key={group.groupKey}
                  style={{
                    backgroundColor: "#141414",
                    borderWidth: 1,
                    borderColor: "#2a2a2a",
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
                      borderBottomColor: "#242424",
                      backgroundColor: "#181818",
                    }}
                  >
                    {group.restaurantImage ? (
                      <Image
                        source={{ uri: group.restaurantImage }}
                        style={{ width: 40, height: 40, borderRadius: 10, backgroundColor: "#222" }}
                      />
                    ) : (
                      <View
                        style={{
                          width: 40,
                          height: 40,
                          borderRadius: 10,
                          backgroundColor: "#222",
                          alignItems: "center",
                          justifyContent: "center",
                        }}
                      >
                        <ShoppingCart size={17} color="#7a7a7a" />
                      </View>
                    )}
                    <View style={{ flex: 1 }}>
                      <Text style={{ fontFamily: "Manrope_700Bold", color: "#f5f5f5", fontSize: 15 }} numberOfLines={1}>
                        {group.restaurantName}
                      </Text>
                      <View style={{ flexDirection: "row", alignItems: "center", gap: 8, marginTop: 2 }}>
                        {/* Dining intent pill — makes it unambiguous what
                            checkout will be when the user taps through. */}
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
                        <Text style={{ fontFamily: "Manrope_600SemiBold", color: "#FF9933", fontSize: 12 }}>
                          ${(group.subtotal || 0).toFixed(2)}
                        </Text>
                      </View>
                    </View>
                    {/* Inline per-group actions — lets the user go straight
                        to checkout for this specific restaurant+dining-type,
                        or just open the restaurant page to browse. The
                        Checkout chip goes grey and non-interactive when the
                        restaurant is currently closed so the user can't dead-
                        end on a confirmation modal they can't complete. */}
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
                          paddingHorizontal: 10,
                          paddingVertical: 6,
                          borderRadius: 999,
                          backgroundColor: groupClosed ? "#2a2a2a" : "#FF9933",
                          opacity: groupClosed ? 0.7 : 1,
                          borderWidth: groupClosed ? 1 : 0,
                          borderColor: groupClosed ? "#3a3a3a" : "transparent",
                        }}
                      >
                        <Text
                          style={{
                            fontFamily: "Manrope_800ExtraBold",
                            color: groupClosed ? "#6b6b6b" : "#0f0f0f",
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
                          borderRadius: 999,
                          borderWidth: 1,
                          borderColor: "#2a2a2a",
                        }}
                      >
                        <Text style={{ fontFamily: "Manrope_700Bold", color: "#9a9a9a", fontSize: 11 }}>
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
                            borderColor: "#2a2a2a",
                            borderRadius: 12,
                            padding: 10,
                            backgroundColor: "#1a1a1a",
                          }}
                        >
                          <View style={{ flexDirection: "row", alignItems: "center", gap: 10 }}>
                            {row.itemImage ? (
                              <Image
                                source={{ uri: row.itemImage }}
                                style={{ width: 48, height: 48, borderRadius: 10, backgroundColor: "#222" }}
                              />
                            ) : (
                              <View
                                style={{
                                  width: 48,
                                  height: 48,
                                  borderRadius: 10,
                                  backgroundColor: "#222",
                                  alignItems: "center",
                                  justifyContent: "center",
                                }}
                              >
                                <ShoppingCart size={18} color="#757575" />
                              </View>
                            )}
                            <View style={{ flex: 1 }}>
                              <Text style={{ fontFamily: "Manrope_700Bold", color: "#f5f5f5", fontSize: 14 }} numberOfLines={2}>
                                {row.itemName}
                              </Text>
                              <Text style={{ fontFamily: "Manrope_500Medium", color: "#a0a0a0", fontSize: 12 }}>
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
                                  backgroundColor: "#222",
                                  borderWidth: 1,
                                  borderColor: "#333",
                                  alignItems: "center",
                                  justifyContent: "center",
                                  opacity: busy ? 0.5 : 1,
                                }}
                              >
                                <Minus size={14} color="#c6c6c6" />
                              </Pressable>
                              <Text style={{ minWidth: 18, textAlign: "center", fontFamily: "Manrope_700Bold", color: "#f5f5f5" }}>
                                {row.quantity}
                              </Text>
                              <Pressable
                                disabled={busy}
                                onPress={() => void updateQuantity(row, row.quantity + 1)}
                                style={{
                                  width: 30,
                                  height: 30,
                                  borderRadius: 15,
                                  backgroundColor: "#222",
                                  borderWidth: 1,
                                  borderColor: "#333",
                                  alignItems: "center",
                                  justifyContent: "center",
                                  opacity: busy ? 0.5 : 1,
                                }}
                              >
                                <Plus size={14} color="#c6c6c6" />
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
              })}
            </ScrollView>

            <View
              style={{
                borderTopWidth: 1,
                borderTopColor: "#2a2a2a",
                backgroundColor: "#0f0f0f",
                paddingTop: 16,
                paddingBottom: APP_BOTTOM_NAV_HEIGHT + APP_BOTTOM_NAV_OFFSET + 10,
                flexDirection: "row",
                alignItems: "center",
                justifyContent: "space-between",
                gap: 14,
              }}
            >
              <View style={{ flex: 1 }}>
                <Text style={{ color: "#9a9a9a", fontFamily: "Manrope_600SemiBold", fontSize: 12 }}>
                  Grand Total
                </Text>
                <Text style={{ color: "#FF9933", fontFamily: "BricolageGrotesque_800ExtraBold", fontSize: 26 }}>
                  ${grandTotal.toFixed(2)}
                </Text>
              </View>
              <Pressable
                onPress={handleCheckoutPress}
                accessibilityLabel="Checkout"
                disabled={!anyOpen}
                accessibilityState={{ disabled: !anyOpen }}
                style={({ pressed }) => ({
                  backgroundColor: !anyOpen
                    ? "#2a2a2a"
                    : pressed
                    ? "#e88829"
                    : "#FF9933",
                  opacity: !anyOpen ? 0.85 : 1,
                  borderRadius: 14,
                  paddingHorizontal: 22,
                  paddingVertical: 14,
                  flexDirection: "row",
                  alignItems: "center",
                  gap: 8,
                  shadowColor: !anyOpen ? "transparent" : "#FF9933",
                  shadowOpacity: !anyOpen ? 0 : 0.25,
                  shadowOffset: { width: 0, height: 4 },
                  shadowRadius: 12,
                  elevation: !anyOpen ? 0 : 4,
                  borderWidth: !anyOpen ? 1 : 0,
                  borderColor: !anyOpen ? "#3a3a3a" : "transparent",
                })}
              >
                <ShoppingCart size={16} color={!anyOpen ? "#6b6b6b" : "#0f0f0f"} />
                <Text
                  style={{
                    color: !anyOpen ? "#6b6b6b" : "#0f0f0f",
                    fontFamily: "Manrope_800ExtraBold",
                    fontSize: 15,
                    letterSpacing: 0.3,
                  }}
                >
                  {!anyOpen ? "Closed" : "Checkout"}
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
