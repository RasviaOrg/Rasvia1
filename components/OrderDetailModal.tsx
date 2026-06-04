import React, { useCallback, useState } from "react";
import {
  View,
  Text,
  Pressable,
  Platform,
  useWindowDimensions,
  ScrollView,
  ActivityIndicator,
  Alert,
  Linking,
} from "react-native";
import { LinearGradient } from "expo-linear-gradient";
import { X } from "lucide-react-native";
import Animated, { FadeIn, SlideInDown, ZoomIn } from "react-native-reanimated";
import * as Haptics from "expo-haptics";
import { useAppTheme } from "@/lib/app-theme";
import { useLayout } from "@/lib/use-layout";
import type { UIOrder } from "@/lib/restaurant-types";
import {
  getStatusColor,
  getStatusPresentation,
  ORDER_TYPE_LABELS,
  OrderProgressStepper,
  orderTypeIcon,
} from "@/lib/my-orders-ui";
import { cancelOrder, cancelErrorMessage, canSelfCancelOrderStatus } from "@/lib/order-cancel";
import { supabase } from "@/lib/supabase";

interface OrderDetailModalProps {
  order: UIOrder;
  onClose: () => void;
  onCancelled?: () => void;
}

export function OrderDetailModal({ order, onClose, onCancelled }: OrderDetailModalProps) {
  const { colors, isDark } = useAppTheme();
  const { height: SCREEN_HEIGHT, width: SCREEN_WIDTH } = useWindowDimensions();
  const { sizeClass } = useLayout();
  const isExpanded = sizeClass !== "compact";
  const CARD_MAX_WIDTH = 620;
  const heroHeight = isExpanded
    ? Math.min(320, SCREEN_HEIGHT * 0.38)
    : SCREEN_HEIGHT * 0.5;

  const [cancelling, setCancelling] = useState(false);
  const statusColor = getStatusColor(order.status);
  const statusPresentation = getStatusPresentation(order.status, order.orderType);
  const { title: statusTitle, subtitle: statusSubtitle, StatusIcon } = statusPresentation;
  const TypeIcon = orderTypeIcon(order.orderType);
  const isLive = order.status !== "completed" && order.status !== "cancelled";
  const canSelfCancel = canSelfCancelOrderStatus(order.status);

  const handleCancelPress = useCallback(async () => {
    if (Platform.OS !== "web") Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Medium);
    const confirmed = await new Promise<boolean>((resolve) => {
      Alert.alert(
        "Cancel order?",
        `This will cancel your order at ${order.restaurantName}. You can't undo this.`,
        [
          { text: "Keep order", style: "cancel", onPress: () => resolve(false) },
          { text: "Cancel order", style: "destructive", onPress: () => resolve(true) },
        ],
        { cancelable: true, onDismiss: () => resolve(false) }
      );
    });
    if (!confirmed) return;
    setCancelling(true);
    try {
      const result = await cancelOrder(order.id);
      if (result.ok) {
        if (Platform.OS !== "web") Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
        onCancelled?.();
        onClose();
        return;
      }
      if (result.reason === "paid_card") {
        let phone: string | null = null;
        try {
          const { data } = await supabase
            .from("restaurants")
            .select("phone")
            .eq("id", Number(order.restaurantId))
            .maybeSingle();
          const p = (data as { phone?: string } | null)?.phone;
          phone = typeof p === "string" && p.length > 0 ? p : null;
        } catch {
          phone = null;
        }
        const { title, message } = cancelErrorMessage(result.reason, order.restaurantName);
        Alert.alert(
          title,
          message,
          phone
            ? [
                { text: "Not now", style: "cancel" },
                {
                  text: `Call ${order.restaurantName}`,
                  onPress: () => Linking.openURL(`tel:${phone!.replace(/[^0-9+]/g, "")}`),
                },
              ]
            : [{ text: "OK", style: "cancel" }]
        );
        return;
      }
      const { title, message } = cancelErrorMessage(result.reason, order.restaurantName);
      Alert.alert(title, message);
    } finally {
      setCancelling(false);
    }
  }, [onCancelled, onClose, order.id, order.restaurantId, order.restaurantName]);

  const itemsText = order.items.map((i) => `${i.quantity}× ${i.name}`).join("\n");

  return (
    <Animated.View
      entering={FadeIn.duration(300)}
      style={{
        position: "absolute",
        top: 0,
        left: 0,
        right: 0,
        bottom: 0,
        backgroundColor: isDark ? "rgba(0,0,0,0.85)" : "rgba(0,0,0,0.4)",
        zIndex: 100,
        justifyContent: isExpanded ? "center" : "flex-end",
        alignItems: isExpanded ? "center" : "stretch",
      }}
    >
      <Animated.View
        entering={isExpanded ? ZoomIn.duration(280) : SlideInDown.duration(500).springify()}
        style={isExpanded
          ? { width: Math.min(SCREEN_WIDTH * 0.92, CARD_MAX_WIDTH), maxHeight: SCREEN_HEIGHT * 0.9 }
          : { width: "100%" }}
      >
        <View
          style={{
            maxHeight: SCREEN_HEIGHT * 0.9,
            backgroundColor: colors.card,
            borderTopWidth: isExpanded ? 0 : 1,
            borderWidth: isExpanded ? 1 : 0,
            borderColor: colors.cardBorder,
            borderRadius: isExpanded ? 22 : 0,
            borderTopLeftRadius: isExpanded ? 22 : 26,
            borderTopRightRadius: isExpanded ? 22 : 26,
            overflow: "hidden",
          }}
        >
          <ScrollView
            showsVerticalScrollIndicator={false}
            bounces={false}
            contentContainerStyle={{ paddingBottom: 8 }}
          >
            {/* Hero — mirrors FoodDetailModal image area, status-colored */}
            <View style={{ height: heroHeight, position: "relative" }}>
              <LinearGradient
                colors={[`${statusColor}55`, `${statusColor}22`, colors.card]}
                style={{ width: "100%", height: "100%" }}
              />
              <LinearGradient
                colors={
                  isDark
                    ? ["rgba(26,26,26,0.15)", "transparent", "rgba(26,26,26,0.92)"]
                    : ["rgba(255,255,255,0.2)", "transparent", "rgba(0,0,0,0.45)"]
                }
                style={{ position: "absolute", top: 0, left: 0, right: 0, bottom: 0 }}
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
                <StatusIcon size={isExpanded ? 56 : 48} color={statusColor} />
              </View>

              <View
                style={{
                  position: "absolute",
                  top: 18,
                  left: 18,
                  backgroundColor: isDark ? "rgba(0,0,0,0.65)" : "rgba(255,255,255,0.94)",
                  borderRadius: 10,
                  paddingHorizontal: 12,
                  paddingVertical: 6,
                  borderWidth: 1,
                  borderColor: isDark ? "rgba(255,255,255,0.12)" : "rgba(0,0,0,0.08)",
                }}
              >
                <Text style={{ fontFamily: "JetBrainsMono_600SemiBold", color: "#FF9933", fontSize: 17 }}>
                  ${order.subtotal.toFixed(2)}
                </Text>
              </View>

              <Pressable
                onPress={() => {
                  if (Platform.OS !== "web") Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
                  onClose();
                }}
                style={{
                  position: "absolute",
                  top: 18,
                  right: 18,
                  backgroundColor: isDark ? "rgba(15, 15, 15, 0.6)" : "rgba(255,255,255,0.92)",
                  width: 44,
                  height: 44,
                  borderRadius: 22,
                  alignItems: "center",
                  justifyContent: "center",
                  borderWidth: isDark ? 0 : 1,
                  borderColor: "rgba(0,0,0,0.08)",
                }}
              >
                <X size={22} color={colors.text} />
              </Pressable>

              <View
                style={{
                  position: "absolute",
                  bottom: 18,
                  left: 22,
                  flexDirection: "row",
                  alignItems: "center",
                  gap: 8,
                }}
              >
                <View
                  style={{
                    flexDirection: "row",
                    alignItems: "center",
                    gap: 6,
                    backgroundColor: isDark ? "rgba(0,0,0,0.55)" : "rgba(255,255,255,0.9)",
                    borderRadius: 999,
                    paddingHorizontal: 12,
                    paddingVertical: 6,
                    borderWidth: 1,
                    borderColor: isDark ? "rgba(255,255,255,0.15)" : "rgba(0,0,0,0.08)",
                  }}
                >
                  <TypeIcon size={14} color={statusColor} />
                  <Text style={{ fontFamily: "Manrope_700Bold", color: statusColor, fontSize: 13 }}>
                    {ORDER_TYPE_LABELS[order.orderType]}
                  </Text>
                </View>
                <View
                  style={{
                    backgroundColor: `${statusColor}30`,
                    borderRadius: 999,
                    paddingHorizontal: 12,
                    paddingVertical: 6,
                    borderWidth: 1,
                    borderColor: `${statusColor}50`,
                  }}
                >
                  <Text style={{ fontFamily: "Manrope_700Bold", color: statusColor, fontSize: 13 }}>
                    {statusTitle}
                  </Text>
                </View>
              </View>
            </View>

            {/* Content — scaled-up FoodDetailModal typography */}
            <View style={{ paddingHorizontal: 24, paddingTop: 24, paddingBottom: 8 }}>
              <Text
                style={{
                  fontFamily: "BricolageGrotesque_800ExtraBold",
                  color: colors.text,
                  fontSize: 36,
                  lineHeight: 40,
                  letterSpacing: -0.5,
                  marginBottom: 8,
                }}
              >
                {order.restaurantName}
              </Text>

              <Text
                style={{
                  fontFamily: "Manrope_500Medium",
                  color: colors.textMuted,
                  fontSize: 13,
                  marginBottom: 14,
                }}
              >
                {new Date(order.createdAt).toLocaleString("en-US", {
                  weekday: "short",
                  month: "short",
                  day: "numeric",
                  hour: "numeric",
                  minute: "2-digit",
                })}
                {order.items.length > 0
                  ? ` · ${order.items.length} item${order.items.length !== 1 ? "s" : ""}`
                  : ""}
              </Text>

              <View style={{ marginBottom: 18 }}>
                <OrderProgressStepper status={order.status} large />
              </View>

              <View
                style={{
                  backgroundColor: `${statusColor}10`,
                  borderRadius: 16,
                  borderWidth: 1,
                  borderColor: `${statusColor}25`,
                  padding: 18,
                  marginBottom: 18,
                }}
              >
                <View style={{ flexDirection: "row", alignItems: "flex-start", gap: 12 }}>
                  <StatusIcon size={26} color={statusColor} />
                  <View style={{ flex: 1 }}>
                    <Text
                      style={{
                        fontFamily: "BricolageGrotesque_700Bold",
                        color: statusColor,
                        fontSize: 17,
                        marginBottom: 4,
                      }}
                    >
                      {statusTitle}
                    </Text>
                    <Text
                      style={{
                        fontFamily: "Manrope_500Medium",
                        color: colors.textMuted,
                        fontSize: 15,
                        lineHeight: 22,
                      }}
                    >
                      {statusSubtitle}
                    </Text>
                  </View>
                </View>
              </View>

              {itemsText.length > 0 && (
                <>
                  <Text
                    style={{
                      fontFamily: "Manrope_700Bold",
                      color: colors.textSecondary,
                      fontSize: 13,
                      marginBottom: 8,
                      textTransform: "uppercase",
                      letterSpacing: 0.6,
                    }}
                  >
                    Your order
                  </Text>
                  <Text
                    style={{
                      fontFamily: "Manrope_500Medium",
                      color: colors.textMuted,
                      fontSize: 17,
                      lineHeight: 26,
                      marginBottom: 8,
                    }}
                  >
                    {itemsText}
                  </Text>
                </>
              )}

              {isLive && !canSelfCancel && order.status !== "served" && (
                <Text
                  style={{
                    fontFamily: "Manrope_500Medium",
                    color: colors.textMuted,
                    fontSize: 14,
                    marginTop: 8,
                    fontStyle: "italic",
                  }}
                >
                  Need to cancel? Contact the restaurant directly.
                </Text>
              )}
            </View>
          </ScrollView>

          {isLive && canSelfCancel && (
            <View style={{ paddingHorizontal: 24, paddingBottom: 28, paddingTop: 4 }}>
              <Pressable
                onPress={handleCancelPress}
                disabled={cancelling}
                style={{
                  flexDirection: "row",
                  alignItems: "center",
                  justifyContent: "center",
                  gap: 10,
                  paddingVertical: 14,
                  borderRadius: 14,
                  backgroundColor: "rgba(239,68,68,0.08)",
                  borderWidth: 1,
                  borderColor: "rgba(239,68,68,0.35)",
                  opacity: cancelling ? 0.6 : 1,
                }}
              >
                {cancelling ? (
                  <ActivityIndicator color="#EF4444" />
                ) : (
                  <X size={18} color="#EF4444" />
                )}
                <Text style={{ fontFamily: "Manrope_700Bold", fontSize: 14, color: "#EF4444" }}>
                  Cancel order
                </Text>
              </Pressable>
            </View>
          )}
        </View>
      </Animated.View>
    </Animated.View>
  );
}
