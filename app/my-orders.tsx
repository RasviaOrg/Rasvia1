import React, { useState, useEffect, useCallback, useRef } from "react";
import {
  View,
  Text,
  Pressable,
  ScrollView,
  Platform,
  ActivityIndicator,
  RefreshControl,
  Animated as RNAnimated,
} from "react-native";
import { Swipeable } from "react-native-gesture-handler";
import { SafeAreaView } from "react-native-safe-area-context";
import { useRouter } from "expo-router";
import {
  ArrowLeft,
  Clock,
  ShoppingBag,
  Truck,
  UtensilsCrossed,
  CheckCircle2,
  ClipboardList,
  ChefHat,
  Sparkles,
  XCircle,
  Flame,
  Trash2,
} from "lucide-react-native";
import Animated, {
  FadeIn,
  FadeInDown,
  FadeOut,
  useSharedValue,
  useAnimatedStyle,
  withRepeat,
  withSequence,
  withTiming,
  withSpring,
  Easing,
  cancelAnimation,
} from "react-native-reanimated";
import * as Haptics from "expo-haptics";
import * as SecureStore from 'expo-secure-store';
import { supabase } from "@/lib/supabase";
import { useAuth } from "@/lib/auth-context";
import {
  type SupabaseOrder,
  type OrderStatus,
  type OrderType,
  mapOrderToUI,
  type UIOrder,
} from "@/lib/restaurant-types";

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

// ────────────────────────────────── Constants ──────────────────────────────────

const STATUS_COLORS: Record<OrderStatus, string> = {
  pending: "#FF9933",
  pending_payment: "#A855F7",
  preparing: "#F59E0B",
  ready: "#22C55E",
  served: "#818CF8",
  completed: "#10B981",
  cancelled: "#EF4444",
};

const FALLBACK_STATUS_COLOR = "#6B7280";
function getStatusColor(status: string): string {
  return STATUS_COLORS[status as OrderStatus] ?? FALLBACK_STATUS_COLOR;
}

const ORDER_TYPE_LABELS: Record<OrderType, string> = {
  dine_in: "Dine In",
  pre_order: "Pre-Order",
  takeout: "Takeout",
};

// The visual steps a consumer cares about
type TrackingStep = "received" | "preparing" | "ready" | "completed";

const TRACKING_STEPS: {
  key: TrackingStep;
  label: string;
  Icon: React.ComponentType<{ size: number; color: string }>;
  color: string;
}[] = [
    { key: "received", label: "Received", Icon: ClipboardList, color: "#FF9933" },
    { key: "preparing", label: "Preparing", Icon: ChefHat, color: "#F59E0B" },
    { key: "ready", label: "Ready", Icon: ShoppingBag, color: "#22C55E" },
    { key: "completed", label: "Done", Icon: Sparkles, color: "#10B981" },
  ];

/** Map the database status to our simplified tracking step index */
function statusToStepIndex(status: OrderStatus): number {
  switch (status) {
    case "pending":
    case "pending_payment":
      return 0; // received
    case "preparing":
      return 1;
    case "ready":
      return 2;
    case "served":
      return 3; // served = food at your table = done from diner's POV
    case "completed":
      return 3;
    case "cancelled":
      return -1;
    default:
      return 0;
  }
}

// ─────────────────────────── Pulsing Dot Component ───────────────────────────

function PulsingDot({ color }: { color: string }) {
  const scale = useSharedValue(1);
  const opacity = useSharedValue(0.6);

  useEffect(() => {
    scale.value = withRepeat(
      withSequence(
        withTiming(1.5, { duration: 800, easing: Easing.out(Easing.ease) }),
        withTiming(1, { duration: 800, easing: Easing.in(Easing.ease) })
      ),
      -1,
      false
    );
    opacity.value = withRepeat(
      withSequence(
        withTiming(1, { duration: 800 }),
        withTiming(0.4, { duration: 800 })
      ),
      -1,
      false
    );
    return () => {
      cancelAnimation(scale);
      cancelAnimation(opacity);
    };
  }, []);

  const animStyle = useAnimatedStyle(() => ({
    transform: [{ scale: scale.value }],
    opacity: opacity.value,
  }));

  return (
    <View style={{ width: 12, height: 12, alignItems: "center", justifyContent: "center" }}>
      <Animated.View
        style={[
          {
            width: 12,
            height: 12,
            borderRadius: 6,
            backgroundColor: color,
            position: "absolute",
          },
          animStyle,
        ]}
      />
      <View
        style={{
          width: 6,
          height: 6,
          borderRadius: 3,
          backgroundColor: color,
        }}
      />
    </View>
  );
}

// ─────────────────────────── Progress Stepper ────────────────────────────────

function OrderProgressStepper({ status }: { status: OrderStatus }) {
  const currentIdx = statusToStepIndex(status);
  const isCancelled = status === "cancelled";

  if (isCancelled) {
    return (
      <View
        style={{
          backgroundColor: "rgba(239,68,68,0.08)",
          borderRadius: 14,
          borderWidth: 1,
          borderColor: "rgba(239,68,68,0.25)",
          padding: 16,
          alignItems: "center",
          gap: 6,
        }}
      >
        <XCircle size={28} color="#EF4444" />
        <Text
          style={{
            fontFamily: "BricolageGrotesque_700Bold",
            color: "#EF4444",
            fontSize: 16,
          }}
        >
          Order Cancelled
        </Text>
      </View>
    );
  }

  return (
    <View style={{ paddingVertical: 8 }}>
      {/* Step circles and connecting lines */}
      <View
        style={{
          flexDirection: "row",
          alignItems: "center",
          justifyContent: "space-between",
          paddingHorizontal: 8,
        }}
      >
        {TRACKING_STEPS.map((step, idx) => {
          const isCompleted = idx < currentIdx;
          const isActive = idx === currentIdx;
          const isFuture = idx > currentIdx;

          const circleSize = isActive ? 40 : 32;
          const bgColor = isCompleted
            ? step.color
            : isActive
              ? `${step.color}25`
              : "#1a1a1a";
          const borderColor = isCompleted
            ? step.color
            : isActive
              ? step.color
              : "#2a2a2a";

          return (
            <React.Fragment key={step.key}>
              {/* Connecting line before this step (skip for first) */}
              {idx > 0 && (
                <View
                  style={{
                    flex: 1,
                    height: 3,
                    backgroundColor: isCompleted || isActive ? TRACKING_STEPS[idx - 1].color : "#222",
                    borderRadius: 2,
                    marginHorizontal: -2,
                  }}
                />
              )}

              {/* Step circle */}
              <Animated.View
                entering={FadeIn.delay(idx * 100).duration(400)}
                style={{
                  width: circleSize,
                  height: circleSize,
                  borderRadius: circleSize / 2,
                  backgroundColor: bgColor,
                  borderWidth: isActive ? 2 : 1,
                  borderColor: borderColor,
                  alignItems: "center",
                  justifyContent: "center",
                  zIndex: 2,
                }}
              >
                {isCompleted ? (
                  <CheckCircle2 size={isActive ? 20 : 16} color="#fff" />
                ) : isActive ? (
                  <PulsingDot color={step.color} />
                ) : (
                  <View style={{ opacity: 0.35 }}>
                    <step.Icon
                      size={isActive ? 18 : 14}
                      color={step.color}
                    />
                  </View>
                )}
              </Animated.View>
            </React.Fragment>
          );
        })}
      </View>

      {/* Labels row */}
      <View
        style={{
          flexDirection: "row",
          justifyContent: "space-between",
          paddingHorizontal: 0,
          marginTop: 10,
        }}
      >
        {TRACKING_STEPS.map((step, idx) => {
          const isCompleted = idx < currentIdx;
          const isActive = idx === currentIdx;
          return (
            <View
              key={`label-${step.key}`}
              style={{
                width: 60,
                alignItems: "center",
              }}
            >
              <Text
                style={{
                  fontFamily: isActive
                    ? "BricolageGrotesque_700Bold"
                    : "Manrope_500Medium",
                  fontSize: 11,
                  color: isActive
                    ? step.color
                    : isCompleted
                      ? "#888"
                      : "#444",
                  textAlign: "center",
                }}
              >
                {step.label}
              </Text>
            </View>
          );
        })}
      </View>
    </View>
  );
}

// ─────────────────────────── Status Message ──────────────────────────────────

function getStatusMessage(
  status: OrderStatus,
  orderType: OrderType
): { title: string; subtitle: string } {
  switch (status) {
    case "pending_payment":
      return {
        title: "Processing Payment...",
        subtitle: "Your payment is being confirmed. This usually takes just a moment.",
      };
    case "pending":
      return {
        title: "Order Received!",
        subtitle: "The restaurant has received your order and will start preparing it shortly.",
      };
    case "preparing":
      return {
        title: "Being Prepared 👨‍🍳",
        subtitle: "The kitchen is working on your order right now.",
      };
    case "ready":
      return {
        title: orderType === "takeout" ? "Ready for Pickup! 🛍️" : "Food is Ready! 🍽️",
        subtitle:
          orderType === "takeout"
            ? "Head to the counter to pick up your order."
            : "Your food is on its way to your table.",
      };
    case "served":
      return {
        title: "Served! 🍽️ Enjoy!",
        subtitle: "Your food has been served. Bon appétit!",
      };
    case "completed":
      return {
        title: "All Done! 🎉",
        subtitle: "Thank you for dining with us. We hope you enjoyed your meal!",
      };
    case "cancelled":
      return {
        title: "Order Cancelled",
        subtitle: "This order has been cancelled. Contact the restaurant for details.",
      };
    default:
      return { title: "Processing", subtitle: "" };
  }
}

// ─────────────────────── Active Order Card ───────────────────────────────────

function ActiveOrderCard({
  order,
  index,
}: {
  order: UIOrder;
  index: number;
}) {
  const router = useRouter();
  const statusMsg = getStatusMessage(order.status, order.orderType);
  const isLive = order.status !== "completed" && order.status !== "cancelled";
  const statusColor = getStatusColor(order.status);

  const TypeIcon =
    order.orderType === "takeout"
      ? Truck
      : order.orderType === "pre_order"
        ? Clock
        : UtensilsCrossed;

  return (
    <Animated.View
      entering={FadeInDown.delay(80 + index * 60).duration(500).springify()}
      style={{
        backgroundColor: "#141414",
        borderRadius: 22,
        borderWidth: 1,
        borderColor: isLive ? `${statusColor}40` : "#2a2a2a",
        marginBottom: 16,
        overflow: "hidden",
      }}
    >
      {/* Glowing top border for active orders */}
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

      <View style={{ padding: 18 }}>
        {/* Header: Restaurant + Price */}
        <View
          style={{
            flexDirection: "row",
            justifyContent: "space-between",
            alignItems: "flex-start",
            marginBottom: 4,
          }}
        >
          <View style={{ flex: 1, marginRight: 12 }}>
            <Text
              style={{
                fontFamily: "BricolageGrotesque_700Bold",
                color: "#f5f5f5",
                fontSize: 20,
                letterSpacing: -0.3,
              }}
              numberOfLines={1}
            >
              {order.restaurantName}
            </Text>
            <View
              style={{
                flexDirection: "row",
                alignItems: "center",
                gap: 6,
                marginTop: 4,
              }}
            >
              <View
                style={{
                  flexDirection: "row",
                  alignItems: "center",
                  gap: 4,
                  backgroundColor: "#1a1a1a",
                  paddingHorizontal: 8,
                  paddingVertical: 3,
                  borderRadius: 8,
                  borderWidth: 1,
                  borderColor: "#2a2a2a",
                }}
              >
                <TypeIcon size={11} color="#777" />
                <Text
                  style={{
                    fontFamily: "Manrope_600SemiBold",
                    color: "#777",
                    fontSize: 11,
                  }}
                >
                  {ORDER_TYPE_LABELS[order.orderType]}
                </Text>
              </View>
              <Text
                style={{
                  fontFamily: "Manrope_500Medium",
                  color: "#555",
                  fontSize: 11,
                }}
              >
                {new Date(order.createdAt).toLocaleTimeString("en-US", {
                  hour: "numeric",
                  minute: "2-digit",
                })}
              </Text>
            </View>
          </View>
          <View style={{ alignItems: "flex-end" }}>
            <Text
              style={{
                fontFamily: "BricolageGrotesque_700Bold",
                color: "#f5f5f5",
                fontSize: 20,
              }}
            >
              ${order.subtotal.toFixed(2)}
            </Text>
            {order.items.length > 0 && (
              <Text
                style={{
                  fontFamily: "Manrope_500Medium",
                  color: "#555",
                  fontSize: 11,
                  marginTop: 2,
                }}
              >
                {order.items.length} item{order.items.length !== 1 ? "s" : ""}
              </Text>
            )}
          </View>
        </View>

        {/* Progress Stepper */}
        <View style={{ marginTop: 12, marginBottom: 8 }}>
          <OrderProgressStepper status={order.status} />
        </View>

        {/* Status message */}
        <View
          style={{
            backgroundColor: `${statusColor}10`,
            borderRadius: 14,
            borderWidth: 1,
            borderColor: `${statusColor}20`,
            padding: 14,
            marginTop: 4,
          }}
        >
          <Text
            style={{
              fontFamily: "BricolageGrotesque_700Bold",
              color: statusColor,
              fontSize: 15,
              marginBottom: 3,
            }}
          >
            {statusMsg.title}
          </Text>
          <Text
            style={{
              fontFamily: "Manrope_500Medium",
              color: "#999",
              fontSize: 13,
              lineHeight: 19,
            }}
          >
            {statusMsg.subtitle}
          </Text>
        </View>

        {/* Items summary */}
        <Text
          style={{
            fontFamily: "Manrope_500Medium",
            color: "#555",
            fontSize: 12,
            marginTop: 12,
          }}
          numberOfLines={2}
        >
          {order.items.map((i) => `${i.quantity}× ${i.name}`).join(", ")}
        </Text>
      </View>
    </Animated.View>
  );
}

// ─────────────────────── Past Order Card (compact) ───────────────────────────

function PastOrderCard({
  order,
  index,
}: {
  order: UIOrder;
  index: number;
}) {
  const statusColor = getStatusColor(order.status);
  const TypeIcon =
    order.orderType === "takeout"
      ? Truck
      : order.orderType === "pre_order"
        ? Clock
        : UtensilsCrossed;

  const formatDate = (dateString: string) => {
    const date = new Date(dateString);
    return date.toLocaleDateString("en-US", {
      month: "short",
      day: "numeric",
      year: "numeric",
    });
  };

  return (
    <Animated.View
      entering={FadeInDown.delay(60 + index * 40).duration(400)}
    >
      <View
        style={{
          backgroundColor: "#141414",
          borderRadius: 16,
          borderWidth: 1,
          borderColor: "#1e1e1e",
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
                color: "#f5f5f5",
                fontSize: 16,
              }}
              numberOfLines={1}
            >
              {order.restaurantName}
            </Text>
            <View
              style={{ flexDirection: "row", alignItems: "center", gap: 5, marginTop: 3 }}
            >
              <Clock size={10} color="#555" />
              <Text
                style={{
                  fontFamily: "Manrope_500Medium",
                  color: "#555",
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
              color: "#ccc",
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
            color: "#555",
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
              backgroundColor: "#0f0f0f",
              paddingHorizontal: 8,
              paddingVertical: 4,
              borderRadius: 8,
              borderWidth: 1,
              borderColor: "#1e1e1e",
            }}
          >
            <TypeIcon size={11} color="#666" />
            <Text
              style={{
                fontFamily: "Manrope_600SemiBold",
                color: "#666",
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
      </View>
    </Animated.View>
  );
}

// ─────────────────────── Main Screen ─────────────────────────────────────────

export default function MyOrdersScreen() {
  const router = useRouter();
  const { session } = useAuth();
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [orders, setOrders] = useState<UIOrder[]>([]);
  const [dismissedIds, setDismissedIds] = useState<Set<string>>(() => new Set());

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

    const channel = supabase
      .channel("my-orders-live")
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
    <View style={{ flex: 1, backgroundColor: "#0f0f0f" }}>
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
              backgroundColor: "#1a1a1a",
              width: 44,
              height: 44,
              borderRadius: 22,
              alignItems: "center",
              justifyContent: "center",
              borderWidth: 1,
              borderColor: "#2a2a2a",
              marginRight: 16,
            }}
          >
            <ArrowLeft size={22} color="#f5f5f5" />
          </Pressable>
          <View style={{ flex: 1 }}>
            <Text
              style={{
                fontFamily: "BricolageGrotesque_800ExtraBold",
                color: "#f5f5f5",
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
          <View
            style={{ flex: 1, alignItems: "center", justifyContent: "center" }}
          >
            <ActivityIndicator color="#FF9933" size="large" />
          </View>
        ) : (
          <ScrollView
            showsVerticalScrollIndicator={false}
            contentContainerStyle={{ paddingBottom: 40, paddingHorizontal: 20 }}
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
                    backgroundColor: "#1a1a1a",
                    alignItems: "center",
                    justifyContent: "center",
                    marginBottom: 16,
                    borderWidth: 1,
                    borderColor: "#2a2a2a",
                  }}
                >
                  <ShoppingBag size={32} color="#666" />
                </View>
                <Text
                  style={{
                    fontFamily: "BricolageGrotesque_700Bold",
                    color: "#f5f5f5",
                    fontSize: 20,
                    marginBottom: 8,
                  }}
                >
                  No orders yet
                </Text>
                <Text
                  style={{
                    fontFamily: "Manrope_500Medium",
                    color: "#999",
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
                          color: "#f5f5f5",
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
                          <ActiveOrderCard order={order} index={idx} />
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
                      <Clock size={14} color="#555" />
                      <Text
                        style={{
                          fontFamily: "BricolageGrotesque_700Bold",
                          color: "#888",
                          fontSize: 16,
                          letterSpacing: -0.3,
                        }}
                      >
                        Past Orders
                      </Text>
                      <Text
                        style={{
                          fontFamily: "Manrope_500Medium",
                          color: "#444",
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
                          <PastOrderCard order={order} index={idx} />
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
    </View>
  );
}
