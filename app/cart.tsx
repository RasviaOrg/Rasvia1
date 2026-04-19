import React, { useCallback, useMemo, useRef, useState } from "react";
import { View, Text, Pressable, Platform, ActivityIndicator, Image, ScrollView, Alert } from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";
import { useFocusEffect, useRouter } from "expo-router";
import * as Haptics from "expo-haptics";
import { Minus, Plus, ShoppingCart, Trash2 } from "lucide-react-native";
import { APP_BOTTOM_NAV_HEIGHT, APP_BOTTOM_NAV_OFFSET } from "@/components/AppBottomNav";
import Animated, { FadeIn, FadeInDown } from "react-native-reanimated";
import { useAuth } from "@/lib/auth-context";
import { fetchUserCartList, type UserCartListItem, upsertUserCartItem } from "@/lib/user-cart";

type RestaurantCartGroup = {
  restaurantId: number;
  restaurantName: string;
  restaurantImage: string | null;
  items: UserCartListItem[];
  subtotal: number;
};

export default function CartScreen() {
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

  const reloadCart = useCallback(async () => {
    const userId = session?.user?.id;
    if (!userId) {
      setItems([]);
      setLoading(false);
      return;
    }
    try {
      setLoading(true);
      const rows = await fetchUserCartList(userId);
      setItems(rows);
    } finally {
      setLoading(false);
    }
  }, [session?.user?.id]);

  useFocusEffect(
    useCallback(() => {
      void reloadCart();
    }, [reloadCart])
  );

  const goHome = () => {
    if (Platform.OS !== "web") Haptics.selectionAsync();
    router.replace("/" as any);
  };

  const grouped = useMemo<RestaurantCartGroup[]>(() => {
    const map = new Map<number, RestaurantCartGroup>();
    for (const row of items) {
      const existing = map.get(row.restaurantId);
      if (existing) {
        existing.items.push(row);
        existing.subtotal += row.subtotal;
      } else {
        map.set(row.restaurantId, {
          restaurantId: row.restaurantId,
          restaurantName: row.restaurantName,
          restaurantImage: row.restaurantImage,
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

  const updateQuantity = useCallback(
    async (row: UserCartListItem, nextQty: number) => {
      const userId = session?.user?.id;
      if (!userId) return;
      const key = `${row.restaurantId}:${row.menuItemId}`;

      // Tag this write so we can ignore its failure if a newer tap supersedes it.
      reqCounter.current += 1;
      const reqId = reqCounter.current;
      latestReqIdByKey.current.set(key, reqId);

      // Remember the pre-tap quantity for targeted rollback (NOT a snapshot of
      // the whole list — that caused a race where a failure would overwrite
      // unrelated rows the user had already updated).
      const previousQty = row.quantity;

      setItems((prev) =>
        nextQty <= 0
          ? prev.filter((p) => !(p.restaurantId === row.restaurantId && p.menuItemId === row.menuItemId))
          : prev.map((p) =>
              p.restaurantId === row.restaurantId && p.menuItemId === row.menuItemId
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
        });
      } catch (err) {
        // Only revert if we're still the most recent write for this key; a
        // newer tap may have already corrected the row, in which case
        // clobbering it would show the wrong quantity.
        if (latestReqIdByKey.current.get(key) === reqId) {
          setItems((prev) => {
            const exists = prev.some(
              (p) => p.restaurantId === row.restaurantId && p.menuItemId === row.menuItemId,
            );
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
              p.restaurantId === row.restaurantId && p.menuItemId === row.menuItemId
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
    (restaurantId: number) => {
      router.push({ pathname: "/restaurant/[id]", params: { id: String(restaurantId) } } as any);
    },
    [router]
  );

  return (
    <View className="flex-1 bg-rasvia-black">
      <SafeAreaView className="flex-1 px-5" edges={["top"]}>
        <Animated.View
          entering={FadeIn.duration(260)}
          style={{ flexDirection: "row", alignItems: "center", marginTop: 6, marginBottom: 14 }}
        >
          <Text style={{ fontFamily: "BricolageGrotesque_800ExtraBold", color: "#f5f5f5", fontSize: 30 }}>
            Cart
          </Text>
        </Animated.View>

        {loading ? (
          <View
            style={{
              flex: 1,
              alignItems: "center",
              justifyContent: "center",
              paddingBottom: APP_BOTTOM_NAV_HEIGHT + 54 + APP_BOTTOM_NAV_OFFSET,
            }}
          >
            <ActivityIndicator size="large" color="#FF9933" />
          </View>
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
              {grouped.map((group) => (
                <View
                  key={group.restaurantId}
                  style={{
                    backgroundColor: "#141414",
                    borderWidth: 1,
                    borderColor: "#2a2a2a",
                    borderRadius: 16,
                    overflow: "hidden",
                  }}
                >
                  <Pressable
                    onPress={() => openRestaurant(group.restaurantId)}
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
                      <Text style={{ fontFamily: "Manrope_600SemiBold", color: "#FF9933", fontSize: 12 }}>
                        ${(group.subtotal || 0).toFixed(2)}
                      </Text>
                    </View>
                    <Text style={{ fontFamily: "Manrope_700Bold", color: "#9a9a9a", fontSize: 12 }}>
                      View
                    </Text>
                  </Pressable>

                  <View style={{ padding: 10, gap: 8 }}>
                    {group.items.map((row) => {
                      const key = `${row.restaurantId}:${row.menuItemId}`;
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
              ))}
            </ScrollView>

            <View
              style={{
                borderTopWidth: 1,
                borderTopColor: "#2a2a2a",
                backgroundColor: "#0f0f0f",
                paddingTop: 20, // shift footer content down by ~10px
                paddingBottom: APP_BOTTOM_NAV_HEIGHT + APP_BOTTOM_NAV_OFFSET + 10,
              }}
            >
              <Text style={{ color: "#9a9a9a", fontFamily: "Manrope_600SemiBold", fontSize: 12 }}>
                Grand Total
              </Text>
              <Text style={{ color: "#FF9933", fontFamily: "BricolageGrotesque_800ExtraBold", fontSize: 26 }}>
                ${grandTotal.toFixed(2)}
              </Text>
            </View>
          </Animated.View>
        )}
      </SafeAreaView>
    </View>
  );
}
