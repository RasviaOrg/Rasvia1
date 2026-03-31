import React, { useState, useCallback, useEffect, useRef } from "react";
import {
    View,
    Text,
    ScrollView,
    Pressable,
    ActivityIndicator,
    RefreshControl,
    Alert,
    Modal,
    TextInput,
    KeyboardAvoidingView,
    Platform,
    StyleSheet,
} from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";
import {
    Clock,
    Users,
    ShoppingBag,
    ChevronRight,
    TrendingUp,
    Minus,
    Plus,
    X,
    DollarSign,
    BarChart3,
    Settings,
} from "lucide-react-native";
import { RestaurantEditModal } from "@/components/RestaurantEditModal";
import * as Haptics from "expo-haptics";
import { useRouter } from "expo-router";
import { supabase } from "@/lib/supabase";
import { useAdminMode } from "@/hooks/useAdminMode";
import { getRestaurantStatus, subscribeDebugTimeChanges } from "@/lib/restaurant-hours";
import type { RestaurantStatusResult, RestaurantHour } from "@/lib/restaurant-hours";

// ── Types ────────────────────────────────────────────────────────────────────
type RestaurantInfo = {
    id: number;
    name: string;
    current_wait_time: number;
    waitlist_open: boolean;
    is_enabled: boolean;
};

type Order = {
    id: number;
    customer_name: string | null;
    status: string;
    subtotal: number;
    created_at: string;
    order_type: string;
    items?: OrderItem[];
};

type OrderItem = {
    id: number;
    name: string;
    quantity: number;
    price: number;
};

// ── Constants ────────────────────────────────────────────────────────────────
const ORANGE = "#FF9933";
const CARD: object = {
    backgroundColor: "#1a1a1a",
    borderWidth: 1,
    borderColor: "#2a2a2a",
    borderRadius: 16,
};

// ── Helpers ──────────────────────────────────────────────────────────────────
function getWaitColor(mins: number) {
    if (mins <= 0) return "#22C55E";
    if (mins < 15) return "#22C55E";
    if (mins < 45) return "#F59E0B";
    return "#EF4444";
}

function statusColor(status: string) {
    switch (status) {
        case "pending":
        case "active": return ORANGE;
        case "preparing": return "#F59E0B";
        case "ready": return "#22C55E";
        case "served":
        case "completed": return "#6B7280";
        case "cancelled": return "#EF4444";
        default: return "#999";
    }
}

function formatOrderType(type: string) {
    return type.replace(/_/g, " ").replace(/\b\w/g, (c) => c.toUpperCase());
}

const ownerOrderListRowStyles = StyleSheet.create({
    pressable: {
        alignSelf: "stretch",
        width: "100%",
    },
    pressablePressed: {
        backgroundColor: "rgba(255,255,255,0.05)",
    },
    inner: {
        flexDirection: "row",
        alignItems: "center",
        direction: "ltr",
        width: "100%",
        paddingVertical: 12,
        paddingLeft: 16,
        paddingRight: 14,
        borderBottomWidth: StyleSheet.hairlineWidth,
        borderBottomColor: "#2a2a2a",
    },
    innerLast: {
        borderBottomWidth: 0,
    },
    leftCol: {
        flex: 1,
        minWidth: 0,
        marginRight: 12,
        justifyContent: "center",
    },
    name: {
        fontFamily: "Manrope_600SemiBold",
        fontSize: 15,
        lineHeight: 20,
        color: "#f5f5f5",
    },
    meta: {
        fontFamily: "Manrope_500Medium",
        fontSize: 12,
        lineHeight: 16,
        color: "#9ca3af",
        marginTop: 3,
    },
    rightCol: {
        flexDirection: "row",
        alignItems: "center",
        flexShrink: 0,
        justifyContent: "flex-end",
    },
    pill: {
        borderRadius: 999,
        paddingHorizontal: 10,
        paddingVertical: 5,
        borderWidth: StyleSheet.hairlineWidth,
        maxWidth: 120,
    },
    pillText: {
        fontFamily: "Manrope_700Bold",
        fontSize: 10,
        lineHeight: 13,
        letterSpacing: 0.35,
    },
});

/** Shared list row: stacked name + meta (left); status pill + chevron (right), vertically centered with text block. */
function OrderListRow({
    order,
    isLast,
    onPress,
}: {
    order: Order;
    isLast: boolean;
    onPress: () => void;
}) {
    const sc = statusColor(order.status);
    const typePrice = `${formatOrderType(order.order_type)} · $${(order.subtotal ?? 0).toFixed(2)}`;
    const androidText = Platform.OS === "android" ? { includeFontPadding: false } : undefined;
    return (
        <Pressable
            onPress={onPress}
            style={({ pressed }) => [
                ownerOrderListRowStyles.pressable,
                pressed && ownerOrderListRowStyles.pressablePressed,
            ]}
        >
            <View style={[ownerOrderListRowStyles.inner, isLast && ownerOrderListRowStyles.innerLast]}>
                <View style={ownerOrderListRowStyles.leftCol}>
                    <Text
                        style={[ownerOrderListRowStyles.name, androidText]}
                        numberOfLines={1}
                        ellipsizeMode="tail"
                    >
                        {order.customer_name || `Order #${order.id}`}
                    </Text>
                    <Text
                        style={[ownerOrderListRowStyles.meta, androidText]}
                        numberOfLines={1}
                        ellipsizeMode="tail"
                    >
                        {typePrice}
                    </Text>
                </View>
                <View style={ownerOrderListRowStyles.rightCol}>
                    <View
                        style={[
                            ownerOrderListRowStyles.pill,
                            {
                                backgroundColor: `${sc}22`,
                                borderColor: `${sc}55`,
                            },
                        ]}
                    >
                        <Text
                            style={[ownerOrderListRowStyles.pillText, { color: sc }]}
                            numberOfLines={1}
                        >
                            {order.status.toUpperCase()}
                        </Text>
                    </View>
                    <View style={{ marginLeft: 6 }}>
                        <ChevronRight size={18} color="#777" />
                    </View>
                </View>
            </View>
        </Pressable>
    );
}

function todayStart() {
    const d = new Date();
    d.setHours(0, 0, 0, 0);
    return d.toISOString();
}

// ── Timings banner ───────────────────────────────────────────────────────────
function TimingsBanner({
    statusResult,
    onSettingsPress,
}: {
    statusResult: RestaurantStatusResult | null;
    onSettingsPress: () => void;
}) {
    if (!statusResult) return null;
    const { status, label } = statusResult;

    const bgColor = status === "open"
        ? "rgba(34,197,94,0.08)"
        : status === "opening_soon" || status === "closing_soon"
            ? "rgba(245,158,11,0.08)"
            : "rgba(239,68,68,0.08)";

    const textColor = status === "open"
        ? "#22C55E"
        : status === "opening_soon" || status === "closing_soon"
            ? "#F59E0B"
            : "#EF4444";

    return (
        <View style={{
            backgroundColor: bgColor,
            borderWidth: 1,
            borderColor: textColor + "30",
            borderRadius: 12,
            paddingHorizontal: 14,
            paddingVertical: 10,
            marginBottom: 20,
            flexDirection: "row",
            alignItems: "center",
            gap: 8,
        }}>
            <Clock size={14} color={textColor} />
            <Text style={{ fontFamily: "Manrope_600SemiBold", fontSize: 13, color: textColor, flex: 1 }}>
                {label}
            </Text>
            <Pressable
                onPress={() => {
                    if (Platform.OS !== "web") Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
                    onSettingsPress();
                }}
                hitSlop={10}
                style={({ pressed }) => ({ opacity: pressed ? 0.5 : 1, padding: 4 })}
            >
                <Settings size={15} color="#FF9933" />
            </Pressable>
        </View>
    );
}

// ── Order Detail Modal ───────────────────────────────────────────────────────
function OrderDetailModal({ order, onClose }: { order: Order; onClose: () => void }) {
    const [items, setItems] = useState<OrderItem[]>(order.items ?? []);
    const [loadingItems, setLoadingItems] = useState(!order.items);

    useEffect(() => {
        if (order.items) return;
        supabase
            .from("order_items")
            .select("id, name, quantity, price")
            .eq("order_id", order.id)
            .then(({ data }) => {
                setItems((data as OrderItem[]) ?? []);
                setLoadingItems(false);
            });
    }, [order.id, order.items]);

    return (
        <Modal visible animationType="slide" presentationStyle="pageSheet" onRequestClose={onClose}>
            <SafeAreaView style={{ flex: 1, backgroundColor: "#0f0f0f" }} edges={["top", "bottom"]}>
                <View style={{
                    flexDirection: "row", alignItems: "center", justifyContent: "space-between",
                    paddingHorizontal: 20, paddingVertical: 16,
                    borderBottomWidth: 1, borderBottomColor: "#2a2a2a",
                }}>
                    <Text style={{ fontFamily: "BricolageGrotesque_700Bold", fontSize: 18, color: "#f5f5f5" }}>
                        Order #{order.id}
                    </Text>
                    <Pressable onPress={onClose} hitSlop={12} style={({ pressed }) => ({ opacity: pressed ? 0.6 : 1, padding: 6 })}>
                        <X size={22} color="#aaa" />
                    </Pressable>
                </View>
                <ScrollView style={{ flex: 1 }} contentContainerStyle={{ padding: 20 }}>
                    <View style={{ ...CARD, padding: 16, marginBottom: 20 }}>
                        {[
                            ["Customer", order.customer_name || "Guest"],
                            ["Type", formatOrderType(order.order_type)],
                            ["Time", new Date(order.created_at).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" })],
                        ].map(([label, value]) => (
                            <View key={label} style={{ flexDirection: "row", justifyContent: "space-between", marginBottom: 10 }}>
                                <Text style={{ fontFamily: "Manrope_600SemiBold", fontSize: 14, color: "#777" }}>{label}</Text>
                                <Text style={{ fontFamily: "Manrope_600SemiBold", fontSize: 14, color: "#f5f5f5" }}>{value}</Text>
                            </View>
                        ))}
                        <View style={{ flexDirection: "row", justifyContent: "space-between" }}>
                            <Text style={{ fontFamily: "Manrope_600SemiBold", fontSize: 14, color: "#777" }}>Status</Text>
                            <View style={{ backgroundColor: `${statusColor(order.status)}20`, borderRadius: 8, paddingHorizontal: 8, paddingVertical: 3, borderWidth: 1, borderColor: `${statusColor(order.status)}40` }}>
                                <Text style={{ fontFamily: "Manrope_600SemiBold", fontSize: 12, color: statusColor(order.status) }}>
                                    {order.status.toUpperCase()}
                                </Text>
                            </View>
                        </View>
                    </View>

                    <Text style={{ fontFamily: "BricolageGrotesque_700Bold", fontSize: 16, color: "#f5f5f5", marginBottom: 12 }}>Items</Text>
                    <View style={CARD}>
                        {loadingItems ? (
                            <ActivityIndicator size="small" color={ORANGE} style={{ padding: 20 }} />
                        ) : items.length === 0 ? (
                            <Text style={{ fontFamily: "Manrope_500Medium", fontSize: 14, color: "#666", textAlign: "center", padding: 20 }}>No items found</Text>
                        ) : items.map((item, idx) => (
                            <View key={item.id} style={{
                                flexDirection: "row", justifyContent: "space-between", alignItems: "center",
                                paddingVertical: 13, paddingHorizontal: 16,
                                borderBottomWidth: idx < items.length - 1 ? 1 : 0, borderBottomColor: "#252525",
                            }}>
                                <View style={{ flex: 1, marginRight: 12 }}>
                                    <Text style={{ fontFamily: "Manrope_600SemiBold", fontSize: 14, color: "#f5f5f5" }}>{item.name}</Text>
                                    <Text style={{ fontFamily: "Manrope_500Medium", fontSize: 12, color: "#666", marginTop: 2 }}>x{item.quantity}</Text>
                                </View>
                                <Text style={{ fontFamily: "Manrope_600SemiBold", fontSize: 14, color: "#f5f5f5" }}>
                                    ${(item.price * item.quantity).toFixed(2)}
                                </Text>
                            </View>
                        ))}
                    </View>

                    <View style={{ flexDirection: "row", justifyContent: "space-between", alignItems: "center", marginTop: 16, paddingTop: 16, borderTopWidth: 1, borderTopColor: "#2a2a2a" }}>
                        <Text style={{ fontFamily: "BricolageGrotesque_700Bold", fontSize: 16, color: "#f5f5f5" }}>Total</Text>
                        <Text style={{ fontFamily: "BricolageGrotesque_700Bold", fontSize: 18, color: ORANGE }}>
                            ${(order.subtotal ?? 0).toFixed(2)}
                        </Text>
                    </View>
                </ScrollView>
            </SafeAreaView>
        </Modal>
    );
}

// ── All Orders Modal ─────────────────────────────────────────────────────────
function AllOrdersModal({ restaurantId, onClose }: { restaurantId: string; onClose: () => void }) {
    const [orders, setOrders] = useState<Order[]>([]);
    const [loading, setLoading] = useState(true);
    const [selectedOrder, setSelectedOrder] = useState<Order | null>(null);

    useEffect(() => {
        supabase
            .from("orders")
            .select("id, customer_name, status, subtotal, created_at, order_type")
            .eq("restaurant_id", restaurantId)
            .order("created_at", { ascending: false })
            .limit(50)
            .then(({ data }) => { setOrders((data as Order[]) ?? []); setLoading(false); });
    }, [restaurantId]);

    return (
        <Modal visible animationType="slide" presentationStyle="pageSheet" onRequestClose={onClose}>
            <SafeAreaView style={{ flex: 1, backgroundColor: "#0f0f0f" }} edges={["top", "bottom"]}>
                <View style={{
                    flexDirection: "row", alignItems: "center", justifyContent: "space-between",
                    paddingHorizontal: 20, paddingVertical: 16,
                    borderBottomWidth: 1, borderBottomColor: "#2a2a2a",
                }}>
                    <Text style={{ fontFamily: "BricolageGrotesque_700Bold", fontSize: 18, color: "#f5f5f5" }}>All Orders</Text>
                    <Pressable onPress={onClose} hitSlop={12} style={({ pressed }) => ({ opacity: pressed ? 0.6 : 1, padding: 6 })}>
                        <X size={22} color="#aaa" />
                    </Pressable>
                </View>
                {loading ? (
                    <View style={{ flex: 1, alignItems: "center", justifyContent: "center" }}>
                        <ActivityIndicator size="large" color={ORANGE} />
                    </View>
                ) : (
                    <ScrollView style={{ flex: 1 }} contentContainerStyle={{ padding: 20 }}>
                        {orders.length === 0 ? (
                            <Text style={{ fontFamily: "Manrope_500Medium", fontSize: 14, color: "#666", textAlign: "center", marginTop: 40 }}>
                                No orders yet
                            </Text>
                        ) : (
                            <View style={{ ...CARD, width: "100%", overflow: "hidden", paddingVertical: 2 }}>
                                {orders.map((order, index) => (
                                    <OrderListRow
                                        key={order.id}
                                        order={order}
                                        isLast={index === orders.length - 1}
                                        onPress={() => {
                                            if (Platform.OS !== "web") Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
                                            setSelectedOrder(order);
                                        }}
                                    />
                                ))}
                            </View>
                        )}
                    </ScrollView>
                )}
                {selectedOrder && <OrderDetailModal order={selectedOrder} onClose={() => setSelectedOrder(null)} />}
            </SafeAreaView>
        </Modal>
    );
}

// ── Main Export ──────────────────────────────────────────────────────────────
export function OwnerHomeContent({
    refreshing,
    onRefreshSignal,
}: {
    refreshing: boolean;
    onRefreshSignal: () => void;
}) {
    const router = useRouter();
    const { ownedRestaurantId } = useAdminMode();

    const [restaurant, setRestaurant] = useState<RestaurantInfo | null>(null);
    const [recentOrders, setRecentOrders] = useState<Order[]>([]);
    const [queueCount, setQueueCount] = useState<number | null>(null);
    const [todayOrderCount, setTodayOrderCount] = useState<number | null>(null);
    const [todayRevenue, setTodayRevenue] = useState<number | null>(null);
    const [statusResult, setStatusResult] = useState<RestaurantStatusResult | null>(null);
    const [loading, setLoading] = useState(true);

    // Wait time editing
    const [editingWait, setEditingWait] = useState(false);
    const [waitInputVal, setWaitInputVal] = useState("");
    const [savingWait, setSavingWait] = useState(false);
    const waitInputRef = useRef<TextInput>(null);

    // Waitlist toggle
    const [togglingWaitlist, setTogglingWaitlist] = useState(false);

    // Modals
    const [showAllOrders, setShowAllOrders] = useState(false);
    const [selectedOrder, setSelectedOrder] = useState<Order | null>(null);
    const [showHoursSettings, setShowHoursSettings] = useState(false);

    const fetchData = useCallback(async () => {
        if (!ownedRestaurantId) return;
        try {
            const todayDow = new Date().getDay();
            const [restRes, queueRes, recentRes, todayRes, hoursRes] = await Promise.all([
                supabase
                    .from("restaurants")
                    .select("id, name, current_wait_time, waitlist_open, is_enabled")
                    .eq("id", ownedRestaurantId)
                    .single(),
                supabase
                    .from("waitlist_entries")
                    .select("*", { count: "exact", head: true })
                    .eq("restaurant_id", ownedRestaurantId)
                    .eq("status", "waiting"),
                supabase
                    .from("orders")
                    .select("id, customer_name, status, subtotal, created_at, order_type")
                    .eq("restaurant_id", ownedRestaurantId)
                    .order("created_at", { ascending: false })
                    .limit(2),
                supabase
                    .from("orders")
                    .select("id, subtotal")
                    .eq("restaurant_id", ownedRestaurantId)
                    .gte("created_at", todayStart()),
                supabase
                    .from("restaurant_hours")
                    .select("day_of_week, open_time, close_time")
                    .eq("restaurant_id", ownedRestaurantId),
            ]);

            if (restRes.data) setRestaurant(restRes.data as RestaurantInfo);
            setQueueCount(queueRes.count ?? 0);
            setRecentOrders((recentRes.data as Order[]) ?? []);

            const todayOrders = (todayRes.data as { id: number; subtotal: number }[]) ?? [];
            setTodayOrderCount(todayOrders.length);
            setTodayRevenue(todayOrders.reduce((sum, o) => sum + (o.subtotal ?? 0), 0));

            const fetchedHours = (hoursRes.data as RestaurantHour[]) ?? [];
            setStatusResult(getRestaurantStatus(fetchedHours));
        } catch (err: any) {
            console.error("OwnerHomeContent fetch error:", err);
        } finally {
            setLoading(false);
        }
    }, [ownedRestaurantId]);

    useEffect(() => { fetchData(); }, [fetchData]);

    // Recompute timings instantly when admin debug-time override changes.
    useEffect(() => {
        return subscribeDebugTimeChanges(() => {
            fetchData();
        });
    }, [fetchData]);

    // Respond to parent pull-to-refresh signal
    useEffect(() => {
        if (refreshing) fetchData();
    }, [refreshing, fetchData]);

    // ── Wait time ──────────────────────────────────────────────────────────
    const updateWaitTime = useCallback(async (newTime: number) => {
        if (!ownedRestaurantId || !restaurant) return;
        const clamped = Math.max(0, Math.round(newTime));
        setSavingWait(true);
        setRestaurant((prev) => prev ? { ...prev, current_wait_time: clamped } : prev);
        const { error } = await supabase
            .from("restaurants")
            .update({ current_wait_time: clamped })
            .eq("id", ownedRestaurantId);
        if (error) { console.error("Failed to update wait time:", error.message); fetchData(); }
        setSavingWait(false);
    }, [ownedRestaurantId, restaurant, fetchData]);

    const commitWaitEdit = () => {
        const parsed = parseInt(waitInputVal, 10);
        if (!isNaN(parsed)) updateWaitTime(parsed);
        setEditingWait(false);
    };

    /** Waitlist cannot be opened while venue is not operating; closing an open waitlist is still allowed */
    const hoursAllowWaitlist =
        !statusResult ||
        statusResult.status === "open" ||
        statusResult.status === "closing_soon";
    const waitlistToggleDisabled =
        togglingWaitlist ||
        (!!(restaurant && !restaurant.waitlist_open) && !hoursAllowWaitlist);

    // ── Waitlist toggle ────────────────────────────────────────────────────
    const requestToggleWaitlist = () => {
        if (!restaurant) return;
        if (waitlistToggleDisabled) return;
        if (Platform.OS !== "web") Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Medium);
        const willOpen = !restaurant.waitlist_open;
        Alert.alert(
            willOpen ? "Open Waitlist?" : "Close Waitlist?",
            willOpen
                ? "Guests will be able to join the waitlist again."
                : "New guests won't be able to join until you reopen the waitlist.",
            [
                { text: "Cancel", style: "cancel" },
                {
                    text: willOpen ? "Open" : "Close",
                    style: willOpen ? "default" : "destructive",
                    onPress: async () => {
                        if (!ownedRestaurantId) return;
                        setTogglingWaitlist(true);
                        setRestaurant((prev) => prev ? { ...prev, waitlist_open: willOpen } : prev);
                        const { error } = await supabase
                            .from("restaurants")
                            .update({ waitlist_open: willOpen })
                            .eq("id", ownedRestaurantId);
                        if (error) { console.error("Failed to toggle waitlist:", error.message); fetchData(); }
                        setTogglingWaitlist(false);
                        if (Platform.OS !== "web") Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
                    },
                },
            ]
        );
    };

    // ── Loading state ──────────────────────────────────────────────────────
    if (loading) {
        return (
            <View style={{ flex: 1, alignItems: "center", justifyContent: "center" }}>
                <ActivityIndicator size="large" color={ORANGE} />
            </View>
        );
    }

    const waitTime = restaurant?.current_wait_time ?? 0;
    const waitlistOpen = restaurant?.waitlist_open ?? false;
    const waitColor = getWaitColor(waitTime);
    const queueDisabled = !waitlistOpen;

    return (
        <>
            <ScrollView
                style={{ flex: 1 }}
                contentContainerStyle={{ padding: 20, paddingBottom: 60 }}
                showsVerticalScrollIndicator={false}
                refreshControl={
                    <RefreshControl
                        refreshing={refreshing}
                        onRefresh={onRefreshSignal}
                        tintColor={ORANGE}
                        colors={[ORANGE]}
                    />
                }
            >
                {/* ── Restaurant Name ── */}
                <Text style={{
                    fontFamily: "BricolageGrotesque_800ExtraBold",
                    fontSize: 26,
                    color: ORANGE,
                    letterSpacing: -0.3,
                    marginBottom: 16,
                }} numberOfLines={1}>
                    {restaurant?.name ?? ""}
                </Text>

                {/* ── Timings Banner ── */}
                <TimingsBanner
                    statusResult={statusResult}
                    onSettingsPress={() => setShowHoursSettings(true)}
                />

                {/* ── Section 1: Live Queue ── */}
                <View style={{ marginBottom: 20 }}>
                    <View style={{ flexDirection: "row", alignItems: "center", gap: 8, marginBottom: 12 }}>
                        <TrendingUp size={18} color={ORANGE} />
                        <Text style={{ fontFamily: "BricolageGrotesque_700Bold", fontSize: 17, color: "#f5f5f5" }}>
                            Live Queue
                        </Text>
                    </View>

                    <View style={{ ...CARD, padding: 20 }}>
                        {/* Wait time controls — greyed when closed */}
                        <View style={{ marginBottom: 20, opacity: queueDisabled ? 0.45 : 1 }}>
                            <Text style={{ fontFamily: "Manrope_600SemiBold", fontSize: 11, color: "#555", letterSpacing: 0.8, textTransform: "uppercase", textAlign: "center", marginBottom: 12 }}>
                                Wait Time
                            </Text>
                            <View style={{ flexDirection: "row", alignItems: "center", justifyContent: "center", gap: 20 }}>
                                {/* −5 */}
                                <View style={{ alignItems: "center" }}>
                                    <Pressable
                                        onPress={() => {
                                            if (queueDisabled) return;
                                            if (Platform.OS !== "web") Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
                                            updateWaitTime(Math.max(0, waitTime - 5));
                                        }}
                                        style={({ pressed }) => ({
                                            width: 46, height: 46, borderRadius: 23,
                                            backgroundColor: pressed ? "#2a2a2a" : "#1f1f1f",
                                            borderWidth: 1, borderColor: "#333",
                                            alignItems: "center", justifyContent: "center",
                                        })}
                                    >
                                        <Minus size={17} color={queueDisabled ? "#444" : "#aaa"} />
                                    </Pressable>
                                    <Text style={{ fontFamily: "Manrope_500Medium", fontSize: 9, color: queueDisabled ? "#333" : "#555", marginTop: 4 }}>5</Text>
                                </View>

                                {/* Tappable number */}
                                <Pressable
                                    onPress={() => {
                                        if (queueDisabled) return;
                                        if (Platform.OS !== "web") Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
                                        setWaitInputVal(String(waitTime));
                                        setEditingWait(true);
                                        setTimeout(() => waitInputRef.current?.focus(), 50);
                                    }}
                                    style={{ alignItems: "center", minWidth: 100 }}
                                >
                                    {editingWait && !queueDisabled ? (
                                        <KeyboardAvoidingView behavior={Platform.OS === "ios" ? "padding" : undefined}>
                                            <TextInput
                                                ref={waitInputRef}
                                                value={waitInputVal}
                                                onChangeText={setWaitInputVal}
                                                keyboardType="number-pad"
                                                onBlur={commitWaitEdit}
                                                onSubmitEditing={commitWaitEdit}
                                                style={{
                                                    fontFamily: "BricolageGrotesque_800ExtraBold",
                                                    fontSize: 56,
                                                    color: waitColor,
                                                    textAlign: "center",
                                                    minWidth: 100,
                                                    borderBottomWidth: 2,
                                                    borderBottomColor: `${waitColor}50`,
                                                }}
                                            />
                                        </KeyboardAvoidingView>
                                    ) : (
                                        <Text style={{ fontFamily: "BricolageGrotesque_800ExtraBold", fontSize: 56, color: queueDisabled ? "#444" : waitColor }}>
                                            {savingWait ? "…" : waitTime}
                                        </Text>
                                    )}
                                    {/* min label — prominent */}
                                    <Text style={{ fontFamily: "Manrope_700Bold", fontSize: 15, color: queueDisabled ? "#333" : "#888", marginTop: -6, letterSpacing: 0.3 }}>
                                        min
                                    </Text>
                                    {!queueDisabled && (
                                        <Text style={{ fontFamily: "Manrope_500Medium", fontSize: 11, color: "#444", marginTop: 4 }}>
                                            tap to edit
                                        </Text>
                                    )}
                                </Pressable>

                                {/* +5 */}
                                <View style={{ alignItems: "center" }}>
                                    <Pressable
                                        onPress={() => {
                                            if (queueDisabled) return;
                                            if (Platform.OS !== "web") Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
                                            updateWaitTime(waitTime + 5);
                                        }}
                                        style={({ pressed }) => ({
                                            width: 46, height: 46, borderRadius: 23,
                                            backgroundColor: pressed ? "#2a2a2a" : "#1f1f1f",
                                            borderWidth: 1, borderColor: "#333",
                                            alignItems: "center", justifyContent: "center",
                                        })}
                                    >
                                        <Plus size={17} color={queueDisabled ? "#444" : "#aaa"} />
                                    </Pressable>
                                    <Text style={{ fontFamily: "Manrope_500Medium", fontSize: 9, color: queueDisabled ? "#333" : "#555", marginTop: 4 }}>5</Text>
                                </View>
                            </View>
                        </View>

                        {/* Divider */}
                        <View style={{ height: 1, backgroundColor: "#252525", marginBottom: 20 }} />

                        {/* Queue count + Waitlist toggle */}
                        <View style={{ flexDirection: "row", alignItems: "center", justifyContent: "space-between" }}>
                            {/* In Queue */}
                            <View style={{ alignItems: "center", flex: 1 }}>
                                <View style={{ flexDirection: "row", alignItems: "center", gap: 6 }}>
                                    <Users size={16} color={ORANGE} />
                                    <Text style={{ fontFamily: "BricolageGrotesque_700Bold", fontSize: 34, color: ORANGE }}>
                                        {queueCount ?? "—"}
                                    </Text>
                                </View>
                                <Text style={{ fontFamily: "Manrope_500Medium", fontSize: 12, color: "#666", marginTop: 2 }}>
                                    In Queue
                                </Text>
                            </View>

                            {/* Vertical divider */}
                            <View style={{ width: 1, height: 52, backgroundColor: "#252525" }} />

                            {/* Toggle */}
                            <Pressable
                                onPress={requestToggleWaitlist}
                                disabled={waitlistToggleDisabled}
                                style={{ alignItems: "center", flex: 1 }}
                            >
                                <View style={{
                                    paddingHorizontal: 16, paddingVertical: 8, borderRadius: 20,
                                    backgroundColor: waitlistOpen ? "rgba(34,197,94,0.12)" : "rgba(239,68,68,0.12)",
                                    borderWidth: 1,
                                    borderColor: waitlistOpen ? "rgba(34,197,94,0.35)" : "rgba(239,68,68,0.35)",
                                    opacity: waitlistToggleDisabled ? 0.45 : 1,
                                }}>
                                    <Text style={{ fontFamily: "Manrope_700Bold", fontSize: 13, color: waitlistOpen ? "#22C55E" : "#EF4444" }}>
                                        {waitlistOpen ? "● OPEN" : "● CLOSED"}
                                    </Text>
                                </View>
                                <Text style={{ fontFamily: "Manrope_500Medium", fontSize: 11, color: "#555", marginTop: 6, textAlign: "center", paddingHorizontal: 4 }}>
                                    {waitlistToggleDisabled && !waitlistOpen
                                        ? "Open when restaurant is open"
                                        : waitlistOpen
                                            ? "Tap to close"
                                            : "Tap to open"}
                                </Text>
                            </Pressable>
                        </View>
                    </View>
                </View>

                {/* ── Section 2: Today's Pulse ── */}
                <View style={{ marginBottom: 20 }}>
                    <View style={{ flexDirection: "row", alignItems: "center", gap: 8, marginBottom: 12 }}>
                        <BarChart3 size={18} color={ORANGE} />
                        <Text style={{ fontFamily: "BricolageGrotesque_700Bold", fontSize: 17, color: "#f5f5f5" }}>
                            Today's Pulse
                        </Text>
                    </View>
                    <View style={{ flexDirection: "row", gap: 10 }}>
                        <View style={{ ...CARD, flex: 1, padding: 16, alignItems: "center" }}>
                            <ShoppingBag size={17} color={ORANGE} style={{ marginBottom: 8 }} />
                            <Text style={{ fontFamily: "BricolageGrotesque_800ExtraBold", fontSize: 28, color: ORANGE }}>
                                {todayOrderCount ?? "—"}
                            </Text>
                            <Text style={{ fontFamily: "Manrope_500Medium", fontSize: 11, color: "#666", marginTop: 4, textAlign: "center" }}>
                                Orders
                            </Text>
                        </View>
                        <View style={{ ...CARD, flex: 1, padding: 16, alignItems: "center" }}>
                            <DollarSign size={17} color="#22C55E" style={{ marginBottom: 8 }} />
                            <Text style={{ fontFamily: "BricolageGrotesque_800ExtraBold", fontSize: 28, color: "#22C55E" }}>
                                {todayRevenue != null ? `$${todayRevenue.toFixed(0)}` : "—"}
                            </Text>
                            <Text style={{ fontFamily: "Manrope_500Medium", fontSize: 11, color: "#666", marginTop: 4, textAlign: "center" }}>
                                Revenue
                            </Text>
                        </View>
                    </View>
                </View>

                {/* ── Section 3: Recent Orders ── */}
                <View style={{ marginBottom: 20 }}>
                    <View style={{ flexDirection: "row", alignItems: "center", justifyContent: "space-between", marginBottom: 12 }}>
                        <View style={{ flexDirection: "row", alignItems: "center", gap: 8 }}>
                            <ShoppingBag size={18} color={ORANGE} />
                            <Text style={{ fontFamily: "BricolageGrotesque_700Bold", fontSize: 17, color: "#f5f5f5" }}>
                                Recent Orders
                            </Text>
                        </View>
                        <Pressable
                            onPress={() => {
                                if (Platform.OS !== "web") Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
                                setShowAllOrders(true);
                            }}
                            hitSlop={10}
                            style={({ pressed }) => ({ opacity: pressed ? 0.6 : 1 })}
                        >
                            <Text style={{ fontFamily: "Manrope_600SemiBold", fontSize: 13, color: ORANGE }}>See All</Text>
                        </Pressable>
                    </View>

                    <View style={{ ...CARD, width: "100%", overflow: "hidden", paddingVertical: 2 }}>
                        {recentOrders.length === 0 ? (
                            <Text style={{ fontFamily: "Manrope_500Medium", fontSize: 14, color: "#666", textAlign: "center", padding: 24 }}>
                                No orders yet
                            </Text>
                        ) : recentOrders.map((order, index) => (
                            <OrderListRow
                                key={order.id}
                                order={order}
                                isLast={index === recentOrders.length - 1}
                                onPress={() => {
                                    if (Platform.OS !== "web") Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
                                    setSelectedOrder(order);
                                }}
                            />
                        ))}
                    </View>
                </View>
            </ScrollView>

            {/* Modals */}
            {showAllOrders && ownedRestaurantId && (
                <AllOrdersModal restaurantId={ownedRestaurantId} onClose={() => setShowAllOrders(false)} />
            )}
            {selectedOrder && (
                <OrderDetailModal order={selectedOrder} onClose={() => setSelectedOrder(null)} />
            )}
            {showHoursSettings && ownedRestaurantId && (
                <RestaurantEditModal
                    restaurantId={ownedRestaurantId}
                    visible={showHoursSettings}
                    onClose={() => setShowHoursSettings(false)}
                    openHoursOnMount
                    onHoursSaved={fetchData}
                />
            )}
        </>
    );
}
