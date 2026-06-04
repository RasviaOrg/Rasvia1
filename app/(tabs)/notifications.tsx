import React, { useCallback, useEffect, useRef, useState } from "react";
import {
  View,
  Text,
  ScrollView,
  Pressable,
  Platform,
  Image,
  RefreshControl,
  Animated as RNAnimated,
} from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";
import { useRouter, useFocusEffect } from "expo-router";
import {
  Bell,
  BellRing,
  Clock,
  Users,
  CheckCircle2,
  Utensils,
  MapPin,
  ChevronRight,
  Trash2,
  AlertCircle,
  X,
  UtensilsCrossed,
  ShoppingCart,
  CheckCheck,
  XCircle,
  Camera,
} from "lucide-react-native";
import { APP_BOTTOM_NAV_HEIGHT, APP_BOTTOM_NAV_OFFSET } from "@/components/AppBottomNav";
import { TabScreenEntrance } from "@/components/TabScreenEntrance";
import Animated, {
  FadeInDown,
  FadeOut,
  LinearTransition,
} from "react-native-reanimated";
import { Swipeable } from "react-native-gesture-handler";
import * as Haptics from "expo-haptics";
import {
  useNotifications,
  type NotificationEvent,
  type ActiveWaitlistEntry,
} from "@/lib/notifications-context";
import { useAppTheme } from "@/lib/app-theme";
import { useAuth } from "@/lib/auth-context";
import { LoadingBlurOverlay } from "@/components/LoadingBlurOverlay";

// ==========================================
// RELATIVE TIME HELPER
// ==========================================

function timeAgo(isoString: string): string {
  const now = Date.now();
  const then = new Date(isoString).getTime();
  const diffMs = now - then;

  if (diffMs < 60_000) return "just now";
  if (diffMs < 3_600_000) {
    const mins = Math.floor(diffMs / 60_000);
    return `${mins} min ago`;
  }
  if (diffMs < 86_400_000) {
    const hrs = Math.floor(diffMs / 3_600_000);
    return `${hrs}h ago`;
  }

  // Check if yesterday (same calendar day as yesterday)
  const thenDate = new Date(then);
  const todayStart = new Date();
  todayStart.setHours(0, 0, 0, 0);
  const yesterdayStart = new Date(todayStart);
  yesterdayStart.setDate(yesterdayStart.getDate() - 1);
  if (thenDate >= yesterdayStart && thenDate < todayStart) return "Yesterday";

  // Older — show 3-letter day name
  return thenDate.toLocaleDateString("en-US", { weekday: "short" });
}

function formatJoinTime(isoString: string): string {
  return new Date(isoString).toLocaleTimeString("en-US", {
    hour: "numeric",
    minute: "2-digit",
    hour12: true,
  });
}

function buildEventHeadline(event: NotificationEvent, fallbackLabel: string): string {
  const trimmed = event.message?.trim();
  if (trimmed) return trimmed;
  return fallbackLabel;
}

function buildEventSubtitle(event: NotificationEvent): string {
  const r = event.restaurantName?.trim() || "this restaurant";
  const party =
    event.partySize > 0
      ? `Party of ${event.partySize}`
      : "Your party";
  switch (event.type) {
    case "joined":
      return `${party} is on the waitlist at ${r}. We'll notify you when your table is ready.`;
    case "table_ready":
      return `Your table at ${r} is ready. Check in with the host so they can seat you.`;
    case "seated":
      return `You've been seated at ${r}. We hope you enjoy your meal.`;
    case "left":
      return `You left the waitlist at ${r}. Join again anytime from the restaurant page.`;
    case "removed":
      return `You were removed from the waitlist at ${r}. Contact the restaurant if this wasn't expected.`;
    case "group_created":
      return `You're hosting a group order at ${r}. Share the invite so everyone can add items to one cart.`;
    case "group_joined":
      return `You're in a group order at ${r}. Open the session to browse the menu and add dishes.`;
    case "group_item_added":
      return `Someone updated the shared cart at ${r}. Review items before the host checks out.`;
    case "group_submitted":
      return `The group order at ${r} was submitted. Check the restaurant page for confirmation or pickup details.`;
    case "group_ended":
      return `The group order at ${r} has ended. Start a new session when you're ready to order together again.`;
    case "group_removed":
      return `You were removed from the group order at ${r}. Contact staff if this was unexpected.`;
    case "group_cancelled": {
      const reason = String(event.metadata?.cancellationReason ?? event.message ?? "").trim();
      const refunded = Number(event.metadata?.refunded ?? 0);
      const failed = Number(event.metadata?.failed ?? 0);
      const parts = [event.message?.trim() || `The group order at ${r} was cancelled.`];
      if (refunded > 0) {
        parts.push(` ${refunded} payment refund${refunded === 1 ? "" : "s"} processed.`);
      }
      if (failed > 0) {
        parts.push(` ${failed} refund${failed === 1 ? "" : "s"} could not be completed automatically.`);
      }
      if (!event.message?.includes("Reason:") && reason && !parts[0].includes(reason)) {
        parts.push(` Reason: ${reason}`);
      }
      return parts.join("");
    }
    case "order_placed":
      return `Your order at ${r} is in. Track status and receipts anytime in My orders.`;
    case "review_report_submitted":
      return "Thanks for flagging a review. Our team will review it and follow up if needed.";
    case "review_report_new":
      return `A diner reported a review for ${r}. Open owner tools to review and respond.`;
    case "review_report_declined":
      return `We reviewed the report for ${r} and didn't remove the review. Check your dashboard for details.`;
    case "review_report_deleted":
      return `The reported review for ${r} has been closed or removed.`;
    case "menu_image_submitted":
      return `Your menu photo for ${r} was sent for review. We'll let you know when it's approved or needs changes.`;
    case "menu_image_request_new":
      return `A new menu photo was submitted for ${r}. Approve or decline it from restaurant settings.`;
    case "menu_image_approved":
      return `Your menu photo for ${r} is live. Diners will see the updated images on your page.`;
    case "menu_image_rejected":
      return `Your menu photo for ${r} wasn't approved. Try a clearer image that follows our guidelines.`;
    default:
      return "";
  }
}

// ==========================================
// STATUS CONFIG
// ==========================================

const STATUS_CONFIG: Record<
  string,
  { label: string; color: string; bg: string; pulse: boolean }
> = {
  waiting: {
    label: "In Queue",
    color: "#FF9933",
    bg: "rgba(255,153,51,0.12)",
    pulse: false,
  },
  notified: {
    label: "Table Ready!",
    color: "#22C55E",
    bg: "rgba(34,197,94,0.12)",
    pulse: true,
  },
  seated: {
    label: "Enjoy Your Meal!",
    color: "#3B82F6",
    bg: "rgba(59,130,246,0.12)",
    pulse: false,
  },
};

const EVENT_CONFIG: Record<
  string,
  {
    label: (r: string) => string;
    color: string;
    icon: React.FC<any>;
  }
> = {
  joined: {
    label: (r) => `Joined ${r}'s waitlist`,
    color: "#3B82F6",
    icon: Users,
  },
  table_ready: {
    label: (r) => `Your table is ready at ${r}`,
    color: "#22C55E",
    icon: BellRing,
  },
  seated: {
    label: (r) => `You were seated at ${r}`,
    color: "#FF9933",
    icon: Utensils,
  },
  left: {
    label: (r) => `You left ${r}'s waitlist`,
    color: "#EF4444",
    icon: AlertCircle,
  },
  removed: {
    label: (r) => `Removed from ${r}'s waitlist`,
    color: "#EF4444",
    icon: AlertCircle,
  },
  group_created: {
    label: (r) => `You started a group order at ${r}`,
    color: "#FF9933",
    icon: UtensilsCrossed,
  },
  group_joined: {
    label: (r) => `You joined a group order at ${r}`,
    color: "#FF9933",
    icon: Users,
  },
  group_item_added: {
    label: (r) => `New item added to group order at ${r}`,
    color: "#3B82F6",
    icon: ShoppingCart,
  },
  group_submitted: {
    label: (r) => `Group order submitted at ${r}`,
    color: "#22C55E",
    icon: CheckCheck,
  },
  group_ended: {
    label: (r) => `Group order at ${r} was ended`,
    color: "#EF4444",
    icon: XCircle,
  },
  group_cancelled: {
    label: (r) => `Group order cancelled at ${r}`,
    color: "#EF4444",
    icon: XCircle,
  },
  group_removed: {
    label: (r) => `Removed from group order at ${r}`,
    color: "#EF4444",
    icon: AlertCircle,
  },
  review_report_submitted: {
    label: () => "Review report submitted",
    color: "#3B82F6",
    icon: CheckCheck,
  },
  review_report_new: {
    label: () => "New review report",
    color: "#FF9933",
    icon: AlertCircle,
  },
  review_report_declined: {
    label: () => "Review report declined",
    color: "#EF4444",
    icon: XCircle,
  },
  review_report_deleted: {
    label: () => "Review report closed",
    color: "#22C55E",
    icon: Trash2,
  },
  menu_image_submitted: {
    label: () => "Menu photo request submitted",
    color: "#3B82F6",
    icon: Camera,
  },
  menu_image_request_new: {
    label: () => "New menu photo request",
    color: "#FF9933",
    icon: Camera,
  },
  menu_image_approved: {
    label: () => "Menu photo approved",
    color: "#22C55E",
    icon: CheckCheck,
  },
  menu_image_rejected: {
    label: () => "Menu photo declined",
    color: "#EF4444",
    icon: XCircle,
  },
  order_placed: {
    label: (r) => `Order placed at ${r}`,
    color: "#FF9933",
    icon: ShoppingCart,
  },
};

// ==========================================
// ACTIVE WAITLIST WIDGET
// ==========================================

function WaitlistWidget({
  entry,
  onPress,
  onDismiss,
}: {
  entry: ActiveWaitlistEntry;
  onPress: () => void;
  onDismiss: () => void;
}) {
  const { colors } = useAppTheme();
  const statusCfg = STATUS_CONFIG[entry.status] ?? STATUS_CONFIG.waiting;

  return (
    <Animated.View layout={LinearTransition}>
      <Animated.View entering={FadeInDown.duration(400)}>
      <Pressable
        onPress={onPress}
        style={{
          backgroundColor: colors.card,
          borderRadius: 20,
          borderWidth: 1.5,
          borderColor:
            entry.status === "notified"
              ? "rgba(34,197,94,0.4)"
              : colors.cardBorder,
          overflow: "hidden",
          marginBottom: 12,
          shadowColor: entry.status === "notified" ? "#22C55E" : "#000",
          shadowOffset: { width: 0, height: 4 },
          shadowOpacity: entry.status === "notified" ? 0.2 : 0.12,
          shadowRadius: 12,
          elevation: 4,
        }}
      >
        {/* Header strip */}
        <View
          style={{
            backgroundColor: statusCfg.bg,
            paddingHorizontal: 16,
            paddingVertical: 10,
            flexDirection: "row",
            alignItems: "center",
            justifyContent: "space-between",
          }}
        >
          <View style={{ flexDirection: "row", alignItems: "center", gap: 6 }}>
            {entry.status === "notified" ? (
              <BellRing size={14} color={statusCfg.color} />
            ) : entry.status === "seated" ? (
              <Utensils size={14} color={statusCfg.color} />
            ) : (
              <Clock size={14} color={statusCfg.color} />
            )}
            <Text
              style={{
                fontFamily: "BricolageGrotesque_700Bold",
                color: statusCfg.color,
                fontSize: 12,
                letterSpacing: 0.5,
                textTransform: "uppercase",
              }}
            >
              {statusCfg.label}
            </Text>
          </View>
          <View style={{ flexDirection: "row", alignItems: "center", gap: 10 }}>
            <Text
              style={{
                fontFamily: "Manrope_500Medium",
                color: colors.textMuted,
                fontSize: 11,
              }}
            >
              Joined {formatJoinTime(entry.joinedAt)}
            </Text>
            {/* Dismiss — hides this active waitlist card until the entry ends in-app; persisted per user */}
            <Pressable
              onPress={(e) => {
                e.stopPropagation?.();
                onDismiss();
              }}
              hitSlop={8}
              style={{
                width: 22,
                height: 22,
                borderRadius: 11,
                backgroundColor: colors.pressableBg,
                alignItems: "center",
                justifyContent: "center",
              }}
            >
              <X size={12} color="#999" />
            </Pressable>
          </View>
        </View>

        {/* Main content */}
        <View style={{ padding: 16 }}>
          <View style={{ flexDirection: "row", alignItems: "center", gap: 12 }}>
            {/* Restaurant image */}
            <Image
              source={{ uri: entry.restaurantImage }}
              style={{
                width: 56,
                height: 56,
                borderRadius: 14,
                borderWidth: 1,
                borderColor: colors.cardBorder,
              }}
              resizeMode="cover"
            />

            {/* Info */}
            <View style={{ flex: 1 }}>
              <Text
                numberOfLines={1}
                style={{
                  fontFamily: "BricolageGrotesque_700Bold",
                  color: colors.text,
                  fontSize: 16,
                  letterSpacing: -0.2,
                  marginBottom: 4,
                }}
              >
                {entry.restaurantName}
              </Text>
              {entry.address ? (
                <View
                  style={{
                    flexDirection: "row",
                    alignItems: "center",
                    gap: 4,
                    marginBottom: 4,
                  }}
                >
                  <MapPin size={10} color={colors.iconMuted} />
                  <Text
                    numberOfLines={1}
                    style={{
                      fontFamily: "Manrope_500Medium",
                      color: colors.textMuted,
                      fontSize: 11,
                    }}
                  >
                    {entry.address}
                  </Text>
                </View>
              ) : null}
              <View style={{ flexDirection: "row", alignItems: "center", gap: 8 }}>
                <View
                  style={{
                    flexDirection: "row",
                    alignItems: "center",
                    gap: 3,
                    backgroundColor: colors.pressableBg,
                    paddingHorizontal: 8,
                    paddingVertical: 3,
                    borderRadius: 8,
                  }}
                >
                  <Users size={10} color={colors.iconMuted} />
                  <Text
                    style={{
                      fontFamily: "JetBrainsMono_600SemiBold",
                      color: colors.text,
                      fontSize: 11,
                    }}
                  >
                    {entry.partySize}
                  </Text>
                </View>
                <View
                  style={{
                    flexDirection: "row",
                    alignItems: "center",
                    gap: 3,
                    backgroundColor: colors.pressableBg,
                    paddingHorizontal: 8,
                    paddingVertical: 3,
                    borderRadius: 8,
                  }}
                >
                  <Clock size={10} color={colors.iconMuted} />
                  <Text
                    style={{
                      fontFamily: "JetBrainsMono_600SemiBold",
                      color: colors.text,
                      fontSize: 11,
                    }}
                  >
                    {entry.waitTime} min
                  </Text>
                </View>
              </View>
            </View>

            <ChevronRight size={18} color="#555" />
          </View>

          {/* Queue position bar */}
          {entry.status === "waiting" && entry.position !== null && (
            <View
              style={{
                marginTop: 14,
                backgroundColor: colors.pressableBg,
                borderRadius: 12,
                padding: 12,
                flexDirection: "row",
                alignItems: "center",
                gap: 12,
              }}
            >
              {/* Position number */}
              <View
                style={{
                  width: 42,
                  height: 42,
                  borderRadius: 21,
                  backgroundColor: "rgba(255,153,51,0.12)",
                  borderWidth: 2,
                  borderColor: "#FF9933",
                  alignItems: "center",
                  justifyContent: "center",
                }}
              >
                <Text
                  style={{
                    fontFamily: "BricolageGrotesque_700Bold",
                    color: "#FF9933",
                    fontSize: 18,
                  }}
                >
                  {entry.position}
                </Text>
              </View>

              <View style={{ flex: 1 }}>
                <Text
                  style={{
                    fontFamily: "BricolageGrotesque_700Bold",
                    color: colors.text,
                    fontSize: 14,
                    marginBottom: 2,
                  }}
                >
                  {entry.position === 1
                    ? "You're next!"
                    : `${entry.position - 1} ${entry.position - 1 === 1 ? "party" : "parties"} ahead`}
                </Text>
                <Text
                  style={{
                    fontFamily: "Manrope_500Medium",
                    color: colors.textMuted,
                    fontSize: 12,
                  }}
                >
                  {entry.totalInQueue} total in queue
                </Text>
              </View>

              {/* Mini queue dots */}
              <View
                style={{
                  flexDirection: "row",
                  flexWrap: "wrap",
                  width: 52,
                  gap: 3,
                }}
              >
                {Array.from({ length: Math.min(entry.totalInQueue, 9) }).map(
                  (_, i) => (
                    <View
                      key={i}
                      style={{
                        width: 10,
                        height: 10,
                        borderRadius: 5,
                        backgroundColor:
                          i < (entry.position ?? 1) - 1
                            ? colors.cardBorder
                            : i === (entry.position ?? 1) - 1
                            ? "#FF9933"
                            : colors.pressableBg,
                      }}
                    />
                  )
                )}
              </View>
            </View>
          )}

          {/* Table ready banner */}
          {entry.status === "notified" && (
            <View
              style={{
                marginTop: 14,
                backgroundColor: "rgba(34,197,94,0.1)",
                borderRadius: 12,
                padding: 12,
                borderWidth: 1,
                borderColor: "rgba(34,197,94,0.25)",
                flexDirection: "row",
                alignItems: "center",
                gap: 10,
              }}
            >
              <CheckCircle2 size={20} color="#22C55E" />
              <View style={{ flex: 1 }}>
                <Text
                  style={{
                    fontFamily: "BricolageGrotesque_700Bold",
                    color: "#22C55E",
                    fontSize: 14,
                  }}
                >
                  Your table is ready!
                </Text>
                {entry.notifiedAt && (
                  <Text
                    style={{
                      fontFamily: "Manrope_500Medium",
                      color: "rgba(34,197,94,0.7)",
                      fontSize: 11,
                      marginTop: 1,
                    }}
                  >
                    Notified {timeAgo(entry.notifiedAt)}
                  </Text>
                )}
              </View>
            </View>
          )}

          {/* Seated banner */}
          {entry.status === "seated" && (
            <View
              style={{
                marginTop: 14,
                backgroundColor: "rgba(59,130,246,0.1)",
                borderRadius: 12,
                padding: 12,
                borderWidth: 1,
                borderColor: "rgba(59,130,246,0.25)",
                flexDirection: "row",
                alignItems: "center",
                gap: 10,
              }}
            >
              <Utensils size={20} color="#3B82F6" />
              <View style={{ flex: 1 }}>
                <Text
                  style={{
                    fontFamily: "BricolageGrotesque_700Bold",
                    color: "#3B82F6",
                    fontSize: 14,
                  }}
                >
                  Enjoy your meal!
                </Text>
              </View>
            </View>
          )}
        </View>
      </Pressable>
      </Animated.View>
    </Animated.View>
  );
}

// ==========================================
// NOTIFICATION EVENT ROW
// ==========================================

function NotificationRow({
  event,
  onDismiss,
  onPress,
}: {
  event: NotificationEvent;
  onDismiss: () => void;
  onPress?: () => void;
}) {
  const { colors } = useAppTheme();
  const swipeableRef = useRef<Swipeable>(null);
  const cfg = EVENT_CONFIG[event.type];
  if (!cfg) return null;
  const Icon = cfg.icon;
  const fallbackHeadline = cfg.label(event.restaurantName);
  const headline = buildEventHeadline(event, fallbackHeadline);
  const subtitle = buildEventSubtitle(event);
  const showSubtitle =
    subtitle.length > 0 &&
    subtitle.trim().toLowerCase() !== headline.trim().toLowerCase();

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

  const rowInner = (
    <View
      style={{
        paddingRight: 16,
        paddingTop: 16,
        paddingBottom: 16,
        paddingLeft: 16,
        borderLeftWidth: 0,
        backgroundColor: colors.card,
      }}
    >
      <View style={{ flexDirection: "row", alignItems: "flex-start", gap: 14 }}>
        <View
          style={{
            width: 42,
            height: 42,
            borderRadius: 21,
            backgroundColor: `${cfg.color}22`,
            borderWidth: 1,
            borderColor: `${cfg.color}38`,
            alignItems: "center",
            justifyContent: "center",
            flexShrink: 0,
            marginTop: 1,
          }}
        >
          <Icon size={18} color={cfg.color} strokeWidth={2} />
        </View>

        <View style={{ flex: 1, minWidth: 0 }}>
          <View
            style={{
              flexDirection: "row",
              alignItems: "flex-start",
              justifyContent: "space-between",
              gap: 10,
            }}
          >
            <View style={{ flex: 1, minWidth: 0 }}>
              {event.title ? (
                <Text
                  style={{
                    fontFamily: "Manrope_600SemiBold",
                    color: colors.textMuted,
                    fontSize: 11,
                    textTransform: "uppercase",
                    letterSpacing: 0.9,
                    marginBottom: 5,
                  }}
                  numberOfLines={1}
                >
                  {event.title}
                </Text>
              ) : null}
              <Text
                style={{
                  fontFamily: "Manrope_700Bold",
                  color: colors.text,
                  fontSize: 16,
                  lineHeight: 22,
                }}
                numberOfLines={4}
              >
                {headline}
              </Text>
            </View>
            <View style={{ alignItems: "flex-end", flexShrink: 0, gap: 6 }}>
              <Text
                style={{
                  fontFamily: "Manrope_500Medium",
                  color: "#71717a",
                  fontSize: 11,
                  lineHeight: 14,
                }}
              >
                {timeAgo(event.timestamp)}
              </Text>
            </View>
          </View>

          {showSubtitle ? (
            <Text
              style={{
                fontFamily: "Manrope_500Medium",
                color: colors.textMuted,
                fontSize: 13,
                lineHeight: 19,
                marginTop: 8,
              }}
            >
              {subtitle}
            </Text>
          ) : null}

          {event.partySize > 0 &&
          event.type !== "joined" &&
          event.type !== "table_ready" &&
          event.type !== "seated" ? (
            <View
              style={{
                flexDirection: "row",
                alignItems: "center",
                gap: 5,
                marginTop: 10,
              }}
            >
              <Users size={12} color="#52525b" />
              <Text
                style={{
                  fontFamily: "Manrope_500Medium",
                  color: "#71717a",
                  fontSize: 12,
                }}
              >
                Party of {event.partySize}
              </Text>
            </View>
          ) : null}
        </View>
      </View>
    </View>
  );

  return (
    <Animated.View layout={LinearTransition}>
      <Animated.View
        entering={FadeInDown.duration(350)}
        exiting={FadeOut.duration(250)}
      >
        <Swipeable
          ref={swipeableRef}
          renderRightActions={renderRightActions}
          overshootRight={false}
          friction={2}
        >
          {onPress ? (
            <Pressable
              onPress={() => onPress()}
              style={({ pressed }) => ({ opacity: pressed ? 0.92 : 1 })}
            >
              {rowInner}
            </Pressable>
          ) : (
            rowInner
          )}
        </Swipeable>
      </Animated.View>
    </Animated.View>
  );
}

// ==========================================
// MAIN SCREEN
// ==========================================

export default function NotificationsScreen() {
  const { colors } = useAppTheme();
  const router = useRouter();
  const { session } = useAuth();
  const {
    events,
    activeEntries,
    clearAll,
    markAllRead,
    refreshActive,
    removeEvent,
    dismissEntry,
  } = useNotifications();

  // Mirror the same loading-blur gate the other tabs use.
  // Keep the veil up until the entrance spring (~380 ms) plus one rAF tick.
  const [ready, setReady] = useState(false);
  useEffect(() => {
    const id = setTimeout(() => setReady(true), 420);
    return () => clearTimeout(id);
  }, []);
  const showBlur = !ready && !!session?.user?.id;

  // Mark all notifications as read when the Alerts tab comes into focus.
  // Wrapped in try/catch so any unexpected error can't crash the screen.
  useFocusEffect(
    useCallback(() => {
      try { markAllRead(); } catch {}
    }, [markAllRead])
  );

  const [refreshing, setRefreshing] = React.useState(false);

  const handleRefresh = useCallback(async () => {
    if (Platform.OS !== "web") Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
    setRefreshing(true);
    await refreshActive();
    setRefreshing(false);
  }, [refreshActive]);

  const handleClearAll = () => {
    if (Platform.OS !== "web") Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Medium);
    clearAll();
  };

  // Resolve the deep-link target for an event row. Returning `null` means
  // the row stays non-pressable (e.g. admin-only events that don't make
  // sense to open from a customer view).
  const resolveEventRoute = useCallback((event: NotificationEvent): string | null => {
    const restaurantId = (event.restaurantId ?? "").trim();
    const entryId = (event.entryId ?? "").trim();
    switch (event.type) {
      case "order_placed":
        // Deep link to the user's order list — the relevant order is
        // pinned to the top because it's the most recent.
        return "/my-orders";
      case "table_ready":
      case "joined":
        if (restaurantId && entryId && entryId !== restaurantId) {
          return `/waitlist/${restaurantId}?entry_id=${entryId}&party_size=${event.partySize || 1}`;
        }
        if (restaurantId) return `/restaurant/${restaurantId}`;
        return null;
      case "seated":
      case "left":
      case "removed":
        return restaurantId ? `/restaurant/${restaurantId}` : null;
      case "group_created":
      case "group_joined":
      case "group_item_added":
      case "group_submitted":
      case "group_ended":
      case "group_cancelled":
      case "group_removed":
        return restaurantId ? `/restaurant/${restaurantId}` : null;
      case "menu_image_submitted":
      case "menu_image_request_new":
      case "menu_image_approved":
      case "menu_image_rejected":
        return restaurantId ? `/restaurant/${restaurantId}` : null;
      case "review_report_submitted":
      case "review_report_new":
      case "review_report_declined":
      case "review_report_deleted":
        return restaurantId ? `/restaurant/${restaurantId}` : null;
      default:
        return null;
    }
  }, []);

  const handleEventPress = useCallback((event: NotificationEvent) => {
    const target = resolveEventRoute(event);
    if (!target) return;
    if (Platform.OS !== "web") Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
    router.push(target as any);
  }, [resolveEventRoute, router]);

  const isEmpty = activeEntries.length === 0 && events.length === 0;

  return (
    <View style={{ flex: 1, backgroundColor: colors.homeBg }}>
      <SafeAreaView style={{ flex: 1, backgroundColor: colors.homeBg }} edges={["top"]}>
        <TabScreenEntrance>
        {showBlur && <LoadingBlurOverlay />}
        <View style={{ flex: 1, backgroundColor: colors.homeBg }}>
        {/* Header */}
        <View
          style={{
            flexDirection: "row",
            alignItems: "center",
            justifyContent: "space-between",
            paddingHorizontal: 20,
            paddingTop: 8,
            paddingBottom: 16,
          }}
        >
          <View style={{ flexDirection: "row", alignItems: "center", flex: 1 }}>
            <Text
              style={{
                fontFamily: "BricolageGrotesque_800ExtraBold",
                color: colors.text,
                fontSize: 28,
                letterSpacing: -0.5,
              }}
            >
              Alerts
            </Text>
          </View>

          {(() => {
            const hasContent = events.length > 0 || activeEntries.length > 0;
            return (
              <Pressable
                onPress={hasContent ? handleClearAll : undefined}
                style={{
                  flexDirection: "row",
                  alignItems: "center",
                  gap: 6,
                  paddingHorizontal: 14,
                  paddingVertical: 9,
                  borderRadius: 22,
                  borderWidth: 1,
                  borderColor: "rgba(239, 68, 68, 0.4)",
                  backgroundColor: "rgba(239, 68, 68, 0.1)",
                  opacity: hasContent ? 1 : 0.35,
                }}
              >
                <Trash2 size={14} color="#EF4444" />
                <Text
                  style={{
                    fontFamily: "Manrope_600SemiBold",
                    color: "#F87171",
                    fontSize: 12,
                  }}
                >
                  Clear
                </Text>
              </Pressable>
            );
          })()}
        </View>

        <ScrollView
          showsVerticalScrollIndicator={false}
          scrollEnabled={!isEmpty}
          contentContainerStyle={
            isEmpty
              ? { flexGrow: 1, justifyContent: "center", paddingBottom: APP_BOTTOM_NAV_HEIGHT + 54 + APP_BOTTOM_NAV_OFFSET }
              : { paddingBottom: APP_BOTTOM_NAV_HEIGHT + 54 + APP_BOTTOM_NAV_OFFSET }
          }
          refreshControl={
            <RefreshControl
              refreshing={refreshing}
              onRefresh={handleRefresh}
              tintColor="#FF9933"
            />
          }
        >
          {isEmpty ? (
            /* ====== Empty State ====== */
            <View
              style={{
                flex: 1,
                alignItems: "center",
                justifyContent: "center",
                paddingHorizontal: 40,
              }}
            >
              <Animated.View
                entering={FadeInDown.delay(200).duration(500)}
                style={{ alignItems: "center" }}
              >
                <View
                  style={{
                    width: 120,
                    height: 120,
                    borderRadius: 60,
                    backgroundColor: colors.card,
                    borderWidth: 1,
                    borderColor: colors.cardBorder,
                    alignItems: "center",
                    justifyContent: "center",
                    marginBottom: 24,
                  }}
                >
                  <Bell size={48} color="#71717a" strokeWidth={1.5} />
                </View>
                <Text
                  style={{
                    fontFamily: "BricolageGrotesque_700Bold",
                    color: colors.text,
                    fontSize: 22,
                    textAlign: "center",
                    marginBottom: 8,
                  }}
                >
                  You&apos;re all caught up
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
                  Join a waitlist to track your spot in line, get notified when your
                  table is ready, and see order updates here.
                </Text>
              </Animated.View>
            </View>
          ) : (
            <>
              {/* ====== Active Waitlist Widgets ====== */}
              {activeEntries.length > 0 && (
                <View style={{ paddingHorizontal: 16, paddingTop: 4 }}>
                  <Text
                    style={{
                      fontFamily: "Manrope_600SemiBold",
                      color: "#71717a",
                      fontSize: 11,
                      letterSpacing: 1.1,
                      textTransform: "uppercase",
                      marginBottom: 12,
                    }}
                  >
                    Active waitlists
                  </Text>
                  {activeEntries.map((entry) => (
                    <WaitlistWidget
                      key={entry.entryId}
                      entry={entry}
                      onDismiss={() => {
                        if (Platform.OS !== "web") Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
                        dismissEntry(entry.entryId);
                      }}
                      onPress={() => {
                        if (Platform.OS !== "web") Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
                        if (entry.status === "seated") {
                          router.push(`/restaurant/${entry.restaurantId}` as any);
                        } else {
                          router.push(
                            `/waitlist/${entry.restaurantId}?entry_id=${entry.entryId}&party_size=${entry.partySize}` as any
                          );
                        }
                      }}
                    />
                  ))}
                </View>
              )}

              {/* ====== Notification History ======
                  Previously wrapped every alert inside a single rounded
                  container with `overflow: hidden`, which visually "chopped"
                  rows — icons and content got clipped against the outer
                  radius and the dividers looked crammed. Each row now gets
                  its own self-contained card with breathing room, so icons
                  and text render cleanly on all sides. */}
              {events.length > 0 && (
                <View>
                  <View
                    style={{
                      paddingHorizontal: 16,
                      paddingBottom: 10,
                      paddingTop: 4,
                    }}
                  >
                    <Text
                      style={{
                        fontFamily: "Manrope_600SemiBold",
                        color: "#71717a",
                        fontSize: 11,
                        letterSpacing: 1.1,
                        textTransform: "uppercase",
                      }}
                    >
                      Recent activity
                    </Text>
                  </View>
                  <View
                    style={{
                      paddingHorizontal: 16,
                      gap: 10,
                    }}
                  >
                    {events.map((event) => (
                      // History rows are intentionally non-interactive —
                      // tapping an old alert used to route back to stale
                      // waitlist/order screens. Swipe-to-dismiss still works.
                      <View
                        key={event.id}
                        style={{
                          backgroundColor: colors.card,
                          borderRadius: 18,
                          borderWidth: 1,
                          borderColor: colors.cardBorder,
                          overflow: "hidden",
                        }}
                      >
                        <NotificationRow
                          event={event}
                          onPress={undefined}
                          onDismiss={() => {
                            if (Platform.OS !== "web") Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
                            removeEvent(event.id);
                          }}
                        />
                      </View>
                    ))}
                  </View>
                </View>
              )}
            </>
          )}
        </ScrollView>
        </View>
        </TabScreenEntrance>
      </SafeAreaView>
    </View>
  );
}
