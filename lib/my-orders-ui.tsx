import React, { useEffect } from "react";
import { View, Text } from "react-native";
import {
  Clock,
  ShoppingBag,
  Truck,
  UtensilsCrossed,
  CheckCircle2,
  ClipboardList,
  ChefHat,
  Sparkles,
  XCircle,
} from "lucide-react-native";
import Animated, {
  FadeIn,
  useSharedValue,
  useAnimatedStyle,
  withRepeat,
  withSequence,
  withTiming,
  cancelAnimation,
  Easing,
} from "react-native-reanimated";
import type { OrderStatus, OrderType } from "@/lib/restaurant-types";
import { useAppTheme } from "@/lib/app-theme";

export const STATUS_COLORS: Record<OrderStatus, string> = {
  pending: "#FF9933",
  pending_payment: "#A855F7",
  preparing: "#F59E0B",
  ready: "#22C55E",
  served: "#818CF8",
  completed: "#10B981",
  cancelled: "#EF4444",
};

const FALLBACK_STATUS_COLOR = "#6B7280";

export function getStatusColor(status: string): string {
  return STATUS_COLORS[status as OrderStatus] ?? FALLBACK_STATUS_COLOR;
}

export const ORDER_TYPE_LABELS: Record<OrderType, string> = {
  dine_in: "Dine In",
  pre_order: "Pre-Order",
  takeout: "Takeout",
};

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

function statusToStepIndex(status: OrderStatus): number {
  switch (status) {
    case "pending":
    case "pending_payment":
      return 0;
    case "preparing":
      return 1;
    case "ready":
      return 2;
    case "served":
    case "completed":
      return 3;
    case "cancelled":
      return -1;
    default:
      return 0;
  }
}

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
      withSequence(withTiming(1, { duration: 800 }), withTiming(0.4, { duration: 800 })),
      -1,
      false
    );
    return () => {
      cancelAnimation(scale);
      cancelAnimation(opacity);
    };
  }, [opacity, scale]);

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
      <View style={{ width: 6, height: 6, borderRadius: 3, backgroundColor: color }} />
    </View>
  );
}

export function OrderProgressStepper({
  status,
  large = false,
}: {
  status: OrderStatus;
  large?: boolean;
}) {
  const { colors } = useAppTheme();
  const currentIdx = statusToStepIndex(status);
  const isCancelled = status === "cancelled";
  const activeSize = large ? 46 : 40;
  const idleSize = large ? 36 : 32;

  if (isCancelled) {
    return (
      <View
        style={{
          backgroundColor: "rgba(239,68,68,0.08)",
          borderRadius: large ? 16 : 14,
          borderWidth: 1,
          borderColor: "rgba(239,68,68,0.25)",
          padding: large ? 20 : 16,
          alignItems: "center",
          gap: 8,
        }}
      >
        <XCircle size={large ? 32 : 28} color="#EF4444" />
        <Text
          style={{
            fontFamily: "BricolageGrotesque_700Bold",
            color: "#EF4444",
            fontSize: large ? 18 : 16,
          }}
        >
          Order Cancelled
        </Text>
      </View>
    );
  }

  return (
    <View style={{ paddingVertical: large ? 10 : 8 }}>
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
          const circleSize = isActive ? activeSize : idleSize;
          const bgColor = isCompleted
            ? step.color
            : isActive
              ? `${step.color}25`
              : colors.pressableBg;
          const borderColor = isCompleted
            ? step.color
            : isActive
              ? step.color
              : colors.cardBorder;

          return (
            <React.Fragment key={step.key}>
              {idx > 0 && (
                <View
                  style={{
                    flex: 1,
                    height: large ? 4 : 3,
                    backgroundColor:
                      isCompleted || isActive ? TRACKING_STEPS[idx - 1].color : colors.skeletonLine,
                    borderRadius: 2,
                    marginHorizontal: -2,
                  }}
                />
              )}
              <Animated.View
                entering={FadeIn.delay(idx * 100).duration(400)}
                style={{
                  width: circleSize,
                  height: circleSize,
                  borderRadius: circleSize / 2,
                  backgroundColor: bgColor,
                  borderWidth: isActive ? 2 : 1,
                  borderColor,
                  alignItems: "center",
                  justifyContent: "center",
                  zIndex: 2,
                }}
              >
                {isCompleted ? (
                  <CheckCircle2 size={isActive ? (large ? 22 : 20) : large ? 18 : 16} color="#fff" />
                ) : isActive ? (
                  <PulsingDot color={step.color} />
                ) : (
                  <View style={{ opacity: 0.35 }}>
                    <step.Icon size={isActive ? (large ? 20 : 18) : large ? 16 : 14} color={step.color} />
                  </View>
                )}
              </Animated.View>
            </React.Fragment>
          );
        })}
      </View>
      <View
        style={{
          flexDirection: "row",
          justifyContent: "space-between",
          marginTop: large ? 12 : 10,
        }}
      >
        {TRACKING_STEPS.map((step, idx) => {
          const isCompleted = idx < currentIdx;
          const isActive = idx === currentIdx;
          return (
            <View key={`label-${step.key}`} style={{ width: large ? 68 : 60, alignItems: "center" }}>
              <Text
                style={{
                  fontFamily: isActive ? "BricolageGrotesque_700Bold" : "Manrope_500Medium",
                  fontSize: large ? 12 : 11,
                  color: isActive ? step.color : isCompleted ? colors.textSecondary : colors.textMuted,
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

type StatusIconComponent = React.ComponentType<{ size: number; color: string }>;

export function getStatusPresentation(
  status: OrderStatus,
  orderType: OrderType
): { title: string; subtitle: string; StatusIcon: StatusIconComponent } {
  switch (status) {
    case "pending_payment":
      return {
        title: "Processing payment",
        subtitle: "Your payment is being confirmed. This usually takes just a moment.",
        StatusIcon: Clock,
      };
    case "pending":
      return {
        title: "Order received",
        subtitle: "The restaurant has received your order and will start preparing it shortly.",
        StatusIcon: ClipboardList,
      };
    case "preparing":
      return {
        title: "Being prepared",
        subtitle: "The kitchen is working on your order right now.",
        StatusIcon: ChefHat,
      };
    case "ready":
      return {
        title: orderType === "takeout" ? "Ready for pickup" : "Food is ready",
        subtitle:
          orderType === "takeout"
            ? "Head to the counter to pick up your order."
            : "Your food is on its way to your table.",
        StatusIcon: ShoppingBag,
      };
    case "served":
      return {
        title: "Served",
        subtitle: "Your food has been served. Enjoy!",
        StatusIcon: UtensilsCrossed,
      };
    case "completed":
      return {
        title: "All done",
        subtitle: "Thank you for dining with us. We hope you enjoyed your meal!",
        StatusIcon: CheckCircle2,
      };
    case "cancelled":
      return {
        title: "Order cancelled",
        subtitle: "This order has been cancelled. Contact the restaurant for details.",
        StatusIcon: XCircle,
      };
    default:
      return { title: "Processing", subtitle: "", StatusIcon: ClipboardList };
  }
}

export function orderTypeIcon(orderType: OrderType) {
  return orderType === "takeout" ? Truck : orderType === "pre_order" ? Clock : UtensilsCrossed;
}
