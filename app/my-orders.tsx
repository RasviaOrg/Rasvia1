import React, { useState, useEffect, useCallback, useRef, useMemo } from "react";
import {
  View,
  Text,
  Pressable,
  ScrollView,
  Platform,
  RefreshControl,
  Animated as RNAnimated,
} from "react-native";
import { Swipeable } from "react-native-gesture-handler";
import { SafeAreaView } from "react-native-safe-area-context";
import { useRouter } from "expo-router";
import { ArrowLeft, Clock, Flame, Trash2 } from "lucide-react-native";
import Animated, {
  FadeIn,
  FadeInDown,
  FadeOut,
  useSharedValue,
  useAnimatedStyle,
  withRepeat,
  withSequence,
  withTiming,
} from "react-native-reanimated";
import * as Haptics from "expo-haptics";
import * as SecureStore from 'expo-secure-store';
import { supabase } from "@/lib/supabase";
import { useAuth } from "@/lib/auth-context";
import {
  type SupabaseOrder,
  type OrderStatus,
  mapOrderToUI,
  type UIOrder,
} from "@/lib/restaurant-types";
import { APP_BOTTOM_NAV_HEIGHT, APP_BOTTOM_NAV_OFFSET } from "@/components/AppBottomNav";
import { useAppTheme } from "@/lib/app-theme";
import {
  getStatusColor,
  getStatusPresentation,
  ORDER_TYPE_LABELS,
  orderTypeIcon,
} from "@/lib/my-orders-ui";
import { OrderDetailModal } from "@/components/OrderDetailModal";

const DISMISSED_ORDERS_KEY = "rasvia_my-orders-dismissed_v1";

const ONE_DAY_MS = 24 * 60 * 60 * 1000;

/** Swipe away past orders anytime; hide stale “active” rows after 24h; block swipe on active orders from the last 24h */
function canSwipeDismiss(order: UIOrder): boolean {
  if (order.status === "completed" || order.status === "cancelled") return true;
  const active: OrderStatus[] = ["pending", "pending_payment", "preparing", "ready", "served"];
  if (!active.includes(order.status)) return true;
  const age = Date.now() - new Date(order.createdAt).getTime();
  return age >= ONE_DAY_MS;
}

function SwipeableOrderRow({
  order,
  children,
  onDismiss,
}: {
  order: UIOrder;
  children: React.ReactNode;
  onDismiss: () => void;
}) {
  const { colors } = useAppTheme();
  const swipeableRef = useRef<Swipeable>(null);

  if (!canSwipeDismiss(order)) {
    return <>{children}</>;
  }

  const renderRightActions = (
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
            swipeableRef.current?.close();
            onDismiss();
          }}
          style={{
            width: 44,
            height: 44,
            borderRadius: 22,
            backgroundColor: `${colors.card}`,
            borderWidth: 1,
            borderColor: "rgba(239,68,68,0.45)",
            alignItems: "center",
            justifyContent: "center",
          }}
        >
          <Trash2 size={18} color="#EF4444" />
        </Pressable>
      </RNAnimated.View>
    );
  };

  return (
    <Swipeable
      ref={swipeableRef}
      renderRightActions={renderRightActions}
      overshootRight={false}
      friction={2}
    >
      {children}
    </Swipeable>
  );
}

function OrderRowWithExit({ children }: { children: React.ReactNode }) {
  return <Animated.View exiting={FadeOut.duration(320)}>{children}</Animated.View>;
}

// ─────────────────────── Active Order Card (preview → detail modal) ───────────

function ActiveOrderCard({
  order,
  index,
  onPress,
}: {
  order: UIOrder;
  index: number;
  onPress: () => void;
}) {
  const { colors, isDark } = useAppTheme();
  const { title: statusTitle, StatusIcon } = getStatusPresentation(order.status, order.orderType);
  const isLive = order.status !== "completed" && order.status !== "cancelled";
  const statusColor = getStatusColor(order.status);
  const TypeIcon = orderTypeIcon(order.orderType);

  return (
    <Animated.View entering={FadeInDown.delay(80 + index * 60).duration(500).springify()}>
      <Pressable
        onPress={() => {
          if (Platform.OS !== "web") Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
          onPress();
        }}
        style={{
          backgroundColor: colors.card,
          borderRadius: 22,
          borderWidth: 1,
          borderColor: isLive ? `${statusColor}40` : colors.cardBorder,
          marginBottom: 16,
          overflow: "hidden",
        }}
      >
        {isLive && (
          <View
            style={{
              height: 3,
              backgroundColor: statusColor,
              borderTopLeftRadius: 22,
              borderTopRightRadius: 22,
            }}
          />
        )}

        <View style={{ height: 96, position: "relative", overflow: "hidden" }}>
          <View
            style={{
              width: "100%",
              height: "100%",
              backgroundColor: `${statusColor}28`,
            }}
          />
          <View
            style={{
              position: "absolute",
              top: 0,
              left: 0,
              right: 0,
              bottom: 0,
              alignItems: "center",
              justifyContent: "center",
            }}
          >
            <StatusIcon size={32} color={statusColor} />
          </View>
          <View
            style={{
              position: "absolute",
              top: 12,
              left: 14,
              backgroundColor: isDark ? "rgba(0,0,0,0.65)" : "rgba(255,255,255,0.94)",
              borderRadius: 8,
              paddingHorizontal: 10,
              paddingVertical: 5,
              borderWidth: 1,
              borderColor: isDark ? "rgba(255,255,255,0.12)" : "rgba(0,0,0,0.08)",
            }}
          >
            <Text style={{ fontFamily: "JetBrainsMono_600SemiBold", color: "#FF9933", fontSize: 14 }}>
              ${order.subtotal.toFixed(2)}
            </Text>
          </View>
          <View
            style={{
              position: "absolute",
              bottom: 10,
              left: 14,
              flexDirection: "row",
              alignItems: "center",
              gap: 6,
            }}
          >
            <View
              style={{
                flexDirection: "row",
                alignItems: "center",
                gap: 4,
                backgroundColor: isDark ? "rgba(0,0,0,0.5)" : "rgba(255,255,255,0.9)",
                borderRadius: 999,
                paddingHorizontal: 10,
                paddingVertical: 4,
                borderWidth: 1,
                borderColor: isDark ? "rgba(255,255,255,0.12)" : "rgba(0,0,0,0.08)",
              }}
            >
              <TypeIcon size={12} color={statusColor} />
              <Text style={{ fontFamily: "Manrope_700Bold", color: statusColor, fontSize: 11 }}>
                {ORDER_TYPE_LABELS[order.orderType]}
              </Text>
            </View>
          </View>
        </View>

        <View style={{ paddingHorizontal: 18, paddingTop: 14, paddingBottom: 16 }}>
          <Text
            style={{
              fontFamily: "BricolageGrotesque_800ExtraBold",
              color: colors.text,
              fontSize: 22,
              letterSpacing: -0.3,
              marginBottom: 6,
            }}
            numberOfLines={1}
          >
            {order.restaurantName}
          </Text>
          <Text
            style={{
              fontFamily: "BricolageGrotesque_700Bold",
              color: statusColor,
              fontSize: 15,
              marginBottom: 6,
            }}
          >
            {statusTitle}
          </Text>
          <Text
            style={{
              fontFamily: "Manrope_500Medium",
              color: colors.textMuted,
              fontSize: 13,
              lineHeight: 19,
            }}
            numberOfLines={2}
          >
            {order.items.map((i) => `${i.quantity}× ${i.name}`).join(", ")}
          </Text>
        </View>
      </Pressable>
    </Animated.View>
  );
}

// ─────────────────────── Past Order Card (compact) ───────────────────────────

function PastOrderCard({
  order,
  index,
  onPress,
}: {
  order: UIOrder;
  index: number;
  onPress: () => void;
}) {
  const { colors } = useAppTheme();
  const statusColor = getStatusColor(order.status);
  const TypeIcon = orderTypeIcon(order.orderType);

  const formatDate = (dateString: string) => {
    const date = new Date(dateString);
    return date.toLocaleDateString("en-US", {
      month: "short",
      day: "numeric",
      year: "numeric",
    });
  };

  return (
    <Animated.View entering={FadeInDown.delay(60 + index * 40).duration(400)}>
      <Pressable
        onPress={() => {
          if (Platform.OS !== "web") Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
          onPress();
        }}
        style={{
          backgroundColor: colors.card,
          borderRadius: 16,
          borderWidth: 1,
          borderColor: colors.cardBorder,
          padding: 14,
          marginBottom: 10,
        }}
      >
        {/* Header */}
        <View
          style={{
            flexDirection: "row",
            justifyContent: "space-between",
            alignItems: "flex-start",
            marginBottom: 6,
          }}
        >
          <View style={{ flex: 1 }}>
            <Text
              style={{
                fontFamily: "BricolageGrotesque_700Bold",
                color: colors.text,
                fontSize: 16,
              }}
              numberOfLines={1}
            >
              {order.restaurantName}
            </Text>
            <View
              style={{ flexDirection: "row", alignItems: "center", gap: 5, marginTop: 3 }}
            >
              <Clock size={10} color={colors.textMuted} />
              <Text
                style={{
                  fontFamily: "Manrope_500Medium",
                  color: colors.textMuted,
                  fontSize: 11,
                }}
              >
                {formatDate(order.createdAt)}
              </Text>
            </View>
          </View>
          <Text
            style={{
              fontFamily: "BricolageGrotesque_700Bold",
              color: colors.textSecondary,
              fontSize: 16,
            }}
          >
            ${order.subtotal.toFixed(2)}
          </Text>
        </View>

        {/* Items */}
        <Text
          style={{
            fontFamily: "Manrope_500Medium",
            color: colors.textMuted,
            fontSize: 12,
            marginBottom: 8,
          }}
          numberOfLines={1}
        >
          {order.items.map((i) => `${i.quantity}× ${i.name}`).join(", ")}
        </Text>

        {/* Footer */}
        <View
          style={{
            flexDirection: "row",
            alignItems: "center",
            justifyContent: "space-between",
          }}
        >
          <View
            style={{
              flexDirection: "row",
              alignItems: "center",
              gap: 5,
              backgroundColor: colors.backgroundElevated,
              paddingHorizontal: 8,
              paddingVertical: 4,
              borderRadius: 8,
              borderWidth: 1,
              borderColor: colors.cardBorder,
            }}
          >
            <TypeIcon size={11} color={colors.textMuted} />
            <Text
              style={{
                fontFamily: "Manrope_600SemiBold",
                color: colors.textMuted,
                fontSize: 11,
              }}
            >
              {ORDER_TYPE_LABELS[order.orderType]}
            </Text>
          </View>
          <View
            style={{
              backgroundColor: `${statusColor}15`,
              paddingHorizontal: 8,
              paddingVertical: 4,
              borderRadius: 8,
              borderWidth: 1,
              borderColor: `${statusColor}30`,
            }}
          >
            <Text
              style={{
                fontFamily: "Manrope_700Bold",
                color: statusColor,
                fontSize: 10,
                textTransform: "uppercase",
              }}
            >
              {order.status}
            </Text>
          </View>
        </View>
      </Pressable>
    </Animated.View>
  );
}

function MyOrdersLoadingSkeleton() {
  const { colors } = useAppTheme();
  const pulse = useSharedValue(0.28);
  useEffect(() => {
    pulse.value = withRepeat(withTiming(0.52, { duration: 720 }), -1, true);
  }, [pulse]);
  const pulseStyle = useAnimatedStyle(() => ({ opacity: pulse.value }));
  const rows = useMemo(() => [0, 1, 2, 3], []);

  return (
    <ScrollView
      showsVerticalScrollIndicator={false}
      contentContainerStyle={{
        paddingBottom: APP_BOTTOM_NAV_HEIGHT + APP_BOTTOM_NAV_OFFSET + 32,
        paddingHorizontal: 20,
      }}
    >
      {rows.map((i) => (
        <Animated.View
          key={i}
          entering={FadeInDown.delay(44 + i * 62).duration(430)}
        >
          <View
            style={{
              backgroundColor: colors.card,
              borderRadius: 16,
              borderWidth: 1,
              borderColor: colors.cardBorder,
              padding: 16,
              marginBottom: 14,
            }}
          >
            <View
              style={{
                flexDirection: "row",
                justifyContent: "space-between",
                alignItems: "center",
                marginBottom: 14,
              }}
            >
              <Animated.View
                style={[
                  { height: 14, width: "42%", borderRadius: 6, backgroundColor: colors.skeletonLine },
                  pulseStyle,
                ]}
              />
              <Animated.View
                style={[
                  { height: 26, width: 76, borderRadius: 8, backgroundColor: colors.skeletonLine },
                  pulseStyle,
                ]}
              />
            </View>
            <Animated.View
              style={[
                { height: 20, width: "58%", borderRadius: 8, backgroundColor: colors.skeletonLine, marginBottom: 12 },
                pulseStyle,
              ]}
            />
            <Animated.View
              style={[
                { height: 14, width: "88%", borderRadius: 6, backgroundColor: colors.skeletonLine, marginBottom: 8 },
                pulseStyle,
              ]}
            />
            <Animated.View
              style={[
                { height: 14, width: "52%", borderRadius: 6, backgroundColor: colors.skeletonLine },
                pulseStyle,
              ]}
            />
          </View>
        </Animated.View>
      ))}
    </ScrollView>
  );
}

// ─────────────────────── Main Screen ─────────────────────────────────────────

export default function MyOrdersScreen() {
  const { colors } = useAppTheme();
  const router = useRouter();
  const { session } = useAuth();
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [orders, setOrders] = useState<UIOrder[]>([]);
  const [dismissedIds, setDismissedIds] = useState<Set<string>>(() => new Set());
  const [detailOrder, setDetailOrder] = useState<UIOrder | null>(null);

  useEffect(() => {
    (async () => {
      try {
        const raw = await SecureStore.getItemAsync(DISMISSED_ORDERS_KEY);
        if (raw) setDismissedIds(new Set(JSON.parse(raw) as string[]));
      } catch {
        /* ignore */
      }
    })();
  }, []);

  const dismissOrder = useCallback((id: string) => {
    setDismissedIds((prev) => {
      const next = new Set(prev).add(id);
      void SecureStore.setItemAsync(DISMISSED_ORDERS_KEY, JSON.stringify([...next]));
      return next;
    });
  }, []);

  const visibleOrders = orders.filter((o) => !dismissedIds.has(o.id));

  useEffect(() => {
    if (!detailOrder) return;
    const fresh = orders.find((o) => o.id === detailOrder.id);
    if (fresh) setDetailOrder(fresh);
  }, [orders, detailOrder?.id]);

  const fetchOrders = useCallback(async () => {
    if (!session?.user?.id) {
      setLoading(false);
      setRefreshing(false);
      return;
    }

    try {
      const { data, error } = await supabase
        .from("orders")
        .select(`
          *,
          restaurants ( name, image_url ),
          order_items ( * )
        `)
        .eq("created_by", session.user.id)
        .order("created_at", { ascending: false });

      if (error) throw error;

      const mapped = (data as SupabaseOrder[]).map(mapOrderToUI);
      setOrders(mapped);
    } catch (e) {
      console.error("Error fetching orders:", e);
    } finally {
      setLoading(false);
      setRefreshing(false);
    }
  }, [session?.user?.id]);

  // Initial fetch
  useEffect(() => {
    fetchOrders();
  }, [fetchOrders]);

  // ── Real-time subscription for live order updates ──
  useEffect(() => {
    if (!session?.user?.id) return;

    // Per-mount random suffix avoids "cannot add postgres_changes callbacks ...
    // after subscribe()" when the screen remounts (nav back, fast refresh)
    // before the previous channel's removeChannel has fully settled.
    const topicSuffix = Math.random().toString(36).slice(2, 8);
    const channel = supabase
      .channel(`my-orders-live:${topicSuffix}`)
      .on(
        "postgres_changes",
        {
          event: "*",
          schema: "public",
          table: "orders",
          filter: `created_by=eq.${session.user.id}`,
        },
        (payload) => {
          // When an order is updated, refresh the list
          // We could do optimistic updates here, but a full refresh
          // ensures consistency and is fast enough
          fetchOrders();

          // Haptic feedback when status changes
          if (Platform.OS !== "web") {
            const newStatus = (payload.new as any)?.status;
            if (newStatus === "ready" || newStatus === "served") {
              Haptics.notificationAsync(
                Haptics.NotificationFeedbackType.Success
              );
            } else if (newStatus === "preparing") {
              Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Medium);
            }
          }
        }
      )
      .subscribe();

    return () => {
      supabase.removeChannel(channel);
    };
  }, [session?.user?.id, fetchOrders]);

  const onRefresh = useCallback(() => {
    if (Platform.OS !== "web")
      Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
    setRefreshing(true);
    fetchOrders();
  }, [fetchOrders]);

  // Split into active vs past
  // Keep recently completed/served orders in active so user sees the "Done" step
  const DONE_VISIBLE_MS = 15 * 60 * 1000; // 15 minutes
  const now = Date.now();
  const activeOrders = visibleOrders.filter((o) => {
    if (o.status === "cancelled") return false;
    if (o.status === "completed") {
      // Show completed orders in active section for 15 min so user sees the Done step
      const closedTime = o.closedAt ? new Date(o.closedAt).getTime() : 0;
      const createdTime = new Date(o.createdAt).getTime();
      const refTime = closedTime || createdTime;
      return now - refTime < DONE_VISIBLE_MS;
    }
    return true; // active, preparing, ready, served all stay in active
  });
  const pastOrders = visibleOrders.filter(
    (o) =>
      (o.status === "completed" && !activeOrders.some((a) => a.id === o.id)) ||
      o.status === "cancelled"
  );

  return (
    <View style={{ flex: 1, backgroundColor: colors.background }}>
      <SafeAreaView style={{ flex: 1 }} edges={["top"]}>
        {/* Header */}
        <Animated.View
          entering={FadeIn.duration(400)}
          style={{
            flexDirection: "row",
            alignItems: "center",
            paddingHorizontal: 20,
            paddingTop: 8,
            paddingBottom: 16,
          }}
        >
          <Pressable
            onPress={() => {
              if (Platform.OS !== "web")
                Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
              router.back();
            }}
            style={{
              backgroundColor: colors.pressableBg,
              width: 44,
              height: 44,
              borderRadius: 22,
              alignItems: "center",
              justifyContent: "center",
              borderWidth: 1,
              borderColor: colors.cardBorder,
              marginRight: 16,
            }}
          >
            <ArrowLeft size={22} color={colors.text} />
          </Pressable>
          <View style={{ flex: 1 }}>
            <Text
            style={{
              fontFamily: "BricolageGrotesque_800ExtraBold",
              color: colors.text,
              fontSize: 28,
              letterSpacing: -0.5,
            }}
          >
            My Orders
          </Text>
          </View>
          {activeOrders.length > 0 && (
            <Animated.View
              entering={FadeIn.duration(300)}
              style={{
                backgroundColor: "rgba(255,153,51,0.15)",
                paddingHorizontal: 10,
                paddingVertical: 5,
                borderRadius: 12,
                borderWidth: 1,
                borderColor: "rgba(255,153,51,0.3)",
                flexDirection: "row",
                alignItems: "center",
                gap: 4,
              }}
            >
              <Flame size={12} color="#FF9933" />
              <Text
                style={{
                  fontFamily: "Manrope_700Bold",
                  color: "#FF9933",
                  fontSize: 12,
                }}
              >
                {activeOrders.length} Live
              </Text>
            </Animated.View>
          )}
        </Animated.View>

        {loading ? (
          <MyOrdersLoadingSkeleton />
        ) : (
          <ScrollView
            showsVerticalScrollIndicator={false}
            contentContainerStyle={{ paddingBottom: APP_BOTTOM_NAV_HEIGHT + APP_BOTTOM_NAV_OFFSET + 32, paddingHorizontal: 20 }}
            refreshControl={
              <RefreshControl
                refreshing={refreshing}
                onRefresh={onRefresh}
                tintColor="#FF9933"
              />
            }
          >
            {visibleOrders.length === 0 ? (
              /* ── Empty State ── */
              <Animated.View
                entering={FadeInDown.delay(100).duration(500)}
                style={{
                  alignItems: "center",
                  justifyContent: "center",
                  marginTop: 60,
                }}
              >
                <View
                  style={{
                    width: 80,
                    height: 80,
                    borderRadius: 40,
                    backgroundColor: colors.card,
                    alignItems: "center",
                    justifyContent: "center",
                    marginBottom: 16,
                    borderWidth: 1,
                    borderColor: colors.cardBorder,
                  }}
                >
                  <ShoppingBag size={32} color={colors.iconMuted} />
                </View>
                <Text
                  style={{
                    fontFamily: "BricolageGrotesque_700Bold",
                    color: colors.text,
                    fontSize: 20,
                    marginBottom: 8,
                  }}
                >
                  No orders yet
                </Text>
                <Text
                  style={{
                    fontFamily: "Manrope_500Medium",
                    color: colors.textMuted,
                    fontSize: 15,
                    textAlign: "center",
                    lineHeight: 22,
                  }}
                >
                  Your dine-in, takeout, and pre-orders{"\n"}will appear here.
                </Text>
                <Pressable
                  onPress={() => {
                    if (Platform.OS !== "web") Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
                    router.push("/");
                  }}
                  style={{
                    marginTop: 24,
                    backgroundColor: "#FF9933",
                    paddingHorizontal: 24,
                    paddingVertical: 14,
                    borderRadius: 14,
                    shadowColor: "#FF9933",
                    shadowOffset: { width: 0, height: 4 },
                    shadowOpacity: 0.3,
                    shadowRadius: 12,
                    elevation: 8,
                  }}
                >
                  <Text
                    style={{
                      fontFamily: "BricolageGrotesque_700Bold",
                      color: "#0f0f0f",
                      fontSize: 16,
                    }}
                  >
                    Browse Restaurants
                  </Text>
                </Pressable>
              </Animated.View>
            ) : (
              <>
                {/* ── Active Orders Section ── */}
                {activeOrders.length > 0 && (
                  <View style={{ marginBottom: 24 }}>
                    <Animated.View
                      entering={FadeIn.duration(300)}
                      style={{
                        flexDirection: "row",
                        alignItems: "center",
                        gap: 8,
                        marginBottom: 14,
                      }}
                    >
                      <View
                        style={{
                          width: 8,
                          height: 8,
                          borderRadius: 4,
                          backgroundColor: "#FF9933",
                        }}
                      />
                      <Text
                        style={{
                          fontFamily: "BricolageGrotesque_700Bold",
                          color: colors.text,
                          fontSize: 18,
                          letterSpacing: -0.3,
                        }}
                      >
                        Active Orders
                      </Text>
                    </Animated.View>
                    {activeOrders.map((order, idx) => (
                      <OrderRowWithExit key={order.id}>
                        <SwipeableOrderRow
                          order={order}
                          onDismiss={() => dismissOrder(order.id)}
                        >
                          <ActiveOrderCard
                            order={order}
                            index={idx}
                            onPress={() => setDetailOrder(order)}
                          />
                        </SwipeableOrderRow>
                      </OrderRowWithExit>
                    ))}
                  </View>
                )}

                {/* ── Past Orders Section ── */}
                {pastOrders.length > 0 && (
                  <View>
                    <Animated.View
                      entering={FadeIn.delay(200).duration(300)}
                      style={{
                        flexDirection: "row",
                        alignItems: "center",
                        gap: 8,
                        marginBottom: 14,
                      }}
                    >
                      <Clock size={14} color={colors.textMuted} />
                      <Text
                        style={{
                          fontFamily: "BricolageGrotesque_700Bold",
                          color: colors.textSecondary,
                          fontSize: 16,
                          letterSpacing: -0.3,
                        }}
                      >
                        Past Orders
                      </Text>
                      <Text
                        style={{
                          fontFamily: "Manrope_500Medium",
                          color: colors.textMuted,
                          fontSize: 12,
                        }}
                      >
                        ({pastOrders.length})
                      </Text>
                    </Animated.View>
                    {pastOrders.map((order, idx) => (
                      <OrderRowWithExit key={order.id}>
                        <SwipeableOrderRow
                          order={order}
                          onDismiss={() => dismissOrder(order.id)}
                        >
                          <PastOrderCard
                            order={order}
                            index={idx}
                            onPress={() => setDetailOrder(order)}
                          />
                        </SwipeableOrderRow>
                      </OrderRowWithExit>
                    ))}
                  </View>
                )}
              </>
            )}
          </ScrollView>
        )}
      </SafeAreaView>

      {detailOrder && (
        <OrderDetailModal
          order={detailOrder}
          onClose={() => setDetailOrder(null)}
          onCancelled={fetchOrders}
        />
      )}
    </View>
  );
}
