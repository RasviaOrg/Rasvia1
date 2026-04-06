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
    FlatList,
} from "react-native";
import DateTimePicker from "@react-native-community/datetimepicker";
import { getStartDate, getEndDate } from "../dateTools";
import { SafeAreaView } from "react-native-safe-area-context";
import {
    Calendar,
    Clock,
    Users,
    ShoppingBag,
    ChevronRight,
    ChevronDown,
    TrendingUp,
    Minus,
    Plus,
    X,
    BarChart3,
    Settings,
    SlidersHorizontal,
} from "lucide-react-native";
import { RestaurantEditModal } from "@/components/RestaurantEditModal";
import * as Haptics from "expo-haptics";
import { useRouter } from "expo-router";
import { supabase } from "@/lib/supabase";
import { useAdminMode } from "@/hooks/useAdminMode";
import {
    getRestaurantStatus,
    subscribeDebugTimeChanges,
    waitlistAllowedBySchedule,
} from "@/lib/restaurant-hours";
import type { RestaurantStatusResult, RestaurantHour } from "@/lib/restaurant-hours";

// ── Types ────────────────────────────────────────────────────────────────────
type RestaurantInfo = {
    id: number;
    name: string;
    current_wait_time: number;
    waitlist_open: boolean;
    is_enabled: boolean;
    waitlist_early_open_enabled?: boolean;
    waitlist_early_open_minutes?: number;
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

type PulseItemBreakdown = {
    name: string;
    quantity: number;
    revenue: number;
    orderCount: number;
    dateOfOrder?: string;
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

function OverallBreakdownModal({ restaurantId, onClose, initialPeriod = "Today" }: { restaurantId: string; onClose: () => void; initialPeriod?: "All" | "Last Month" | "Last Week" | "Today" | "Custom" }) {
    const [period, setPeriod] = useState<"All" | "Last Month" | "Last Week" | "Today" | "Custom">(initialPeriod);
    const [customDate, setCustomDate] = useState<Date>(new Date());
    const [showDatePicker, setShowDatePicker] = useState(false);
    const [orders, setOrders] = useState<Order[]>([]);
    const [items, setItems] = useState<PulseItemBreakdown[]>([]);
    const [loading, setLoading] = useState(true);
    const [viewMode, setViewMode] = useState<"items" | "orders">("items");
    const [itemSort, setItemSort] = useState<"revenue" | "quantity" | "name">("revenue");
    const [orderSort, setOrderSort] = useState<"amount" | "time">("amount");
    const [selectedOrder, setSelectedOrder] = useState<Order | null>(null);

    useEffect(() => {
        const fetchBreakdown = async () => {
            setLoading(true);
            try {
                let query = supabase
                    .from("orders")
                    .select("id, customer_name, status, subtotal, created_at, order_type")
                    .eq("restaurant_id", restaurantId);

                const start = getStartDate(period, customDate);
                const end = getEndDate(period, customDate);

                if (start) query = query.gte("created_at", start);
                if (end) query = query.lte("created_at", end);

                const { data: todayOrdersData } = await query;

                const parsedOrders = ((todayOrdersData as Order[]) ?? []);
                setOrders(parsedOrders);

                if (parsedOrders.length === 0) {
                    setItems([]);
                    return;
                }

                const { data: orderItemsData } = await supabase
                    .from("order_items")
                    .select("order_id, name, quantity, price")
                    .in("order_id", parsedOrders.map((o) => o.id));

                const agg = new Map<string, PulseItemBreakdown>();
                const byOrder = new Map<string, Set<number>>();

                const shouldGroupByDay = period !== "Today" && period !== "Custom";
                const orderDates = new Map<number, string>();
                parsedOrders.forEach((o) => {
                    const d = new Date(o.created_at);
                    if (isNaN(d.getTime())) return;
                    // Provide a nice long date format. Fallbacks for hermes lacking Intl.
                    const month = d.toLocaleString('en-US', { month: 'short' });
                    const day = d.getDate();
                    const year = d.getFullYear();
                    orderDates.set(o.id, `${month} ${day}, ${year}`);
                });

                for (const row of ((orderItemsData as any[]) ?? [])) {
                    const rawName = String(row.name ?? "").trim();
                    if (!rawName) continue;
                    const key = rawName.toLowerCase();
                    const quantity = Number(row.quantity ?? 0);
                    const price = Number(row.price ?? 0);
                    const orderId = Number(row.order_id);

                    const dateStr = orderDates.get(orderId) || "";
                    const loopKey = shouldGroupByDay && dateStr ? `${key}|||${dateStr}` : key;

                    const existing = agg.get(loopKey) ?? {
                        name: rawName,
                        quantity: 0,
                        revenue: 0,
                        orderCount: 0,
                        ...(shouldGroupByDay && dateStr ? { dateOfOrder: dateStr } : {}),
                    };
                    existing.quantity += quantity;
                    existing.revenue += quantity * price;
                    agg.set(loopKey, existing);

                    const seenOrders = byOrder.get(loopKey) ?? new Set<number>();
                    seenOrders.add(orderId);
                    byOrder.set(loopKey, seenOrders);
                }

                const itemList = Array.from(agg.entries()).map(([key, value]) => ({
                    ...value,
                    orderCount: byOrder.get(key)?.size ?? 0,
                }));
                setItems(itemList);
            } finally {
                setLoading(false);
            }
        };

        fetchBreakdown();
    }, [restaurantId, period, customDate]);

    const sortedItems = [...items].sort((a, b) => {
        if (itemSort === "revenue") return b.revenue - a.revenue;
        if (itemSort === "quantity") return b.quantity - a.quantity;
        return a.name.localeCompare(b.name);
    });

    const sortedOrders = [...orders].sort((a, b) => {
        if (orderSort === "amount") return (b.subtotal ?? 0) - (a.subtotal ?? 0);
        return new Date(b.created_at).getTime() - new Date(a.created_at).getTime();
    });

    const totalRevenue = orders.reduce((sum, order) => sum + (order.subtotal ?? 0), 0);
    const totalItems = items.reduce((sum, item) => sum + item.quantity, 0);

    return (
        <Modal visible animationType="slide" presentationStyle="pageSheet" onRequestClose={onClose}>
            <SafeAreaView style={{ flex: 1, backgroundColor: "#0f0f0f" }} edges={["top", "bottom"]}>
                <View style={{
                    flexDirection: "row", alignItems: "center", justifyContent: "space-between",
                    paddingHorizontal: 20, paddingVertical: 16,
                    borderBottomWidth: 1, borderBottomColor: "#2a2a2a",
                }}>
                    <View>
                        <Text style={{ fontFamily: "BricolageGrotesque_700Bold", fontSize: 18, color: "#f5f5f5" }}>
                            Overall Breakdown
                        </Text>
                    </View>
                    <Pressable onPress={onClose} hitSlop={12} style={({ pressed }) => ({ opacity: pressed ? 0.6 : 1, padding: 6 })}>
                        <X size={22} color="#aaa" />
                    </Pressable>
                </View>

                {/* Period Selector Tabs */}
                <View style={{ paddingHorizontal: 20, paddingTop: 16, paddingBottom: 6 }}>
                    <View style={{ flexDirection: "row", flexWrap: "wrap", gap: 8 }}>
                        {(["All", "Last Month", "Last Week", "Today", "Custom"] as const).map((p) => {
                            const isSelected = period === p;
                            return (
                                <Pressable
                                    key={p}
                                    onPress={() => {
                                        if (Platform.OS !== "web") Haptics.selectionAsync();
                                        if (p === "Custom") {
                                            setShowDatePicker(true);
                                        } else {
                                            setShowDatePicker(false);
                                        }
                                        setPeriod(p);
                                    }}
                                    style={{
                                        paddingHorizontal: 16,
                                        paddingVertical: 8,
                                        borderRadius: 999,
                                        backgroundColor: isSelected ? "rgba(255,153,51,0.15)" : "#1a1a1a",
                                        borderWidth: 1,
                                        borderColor: isSelected ? ORANGE : "#2a2a2a",
                                        flexDirection: "row",
                                        alignItems: "center",
                                        gap: 6,
                                    }}
                                >
                                    {p === "Custom" && <Calendar size={14} color={isSelected ? ORANGE : "#888"} />}
                                    <Text style={{
                                        fontFamily: "Manrope_600SemiBold",
                                        fontSize: 13,
                                        color: isSelected ? ORANGE : "#aaa"
                                    }}>
                                        {p === "Custom" && period === "Custom" ? customDate.toLocaleDateString() : p}
                                    </Text>
                                </Pressable>
                            );
                        })}
                    </View>
                </View>

                {showDatePicker && (
                    <View style={{ alignItems: "center", marginVertical: 10 }}>
                        <DateTimePicker
                            value={customDate}
                            mode="date"
                            display={Platform.OS === "ios" ? "inline" : "default"}
                            themeVariant="dark"
                            onChange={(event, date) => {
                                if (Platform.OS === "android") setShowDatePicker(false);
                                if (date) {
                                    setCustomDate(date);
                                    setPeriod("Custom");
                                }
                            }}
                        />
                    </View>
                )}

                {Platform.OS === "ios" && showDatePicker && (
                    <Pressable
                        onPress={() => setShowDatePicker(false)}
                        style={{ alignSelf: "center", paddingVertical: 10, paddingHorizontal: 20, backgroundColor: "#2a2a2a", borderRadius: 8, marginBottom: 10 }}
                    >
                        <Text style={{ color: "#fff", fontFamily: "Manrope_600SemiBold" }}>Done</Text>
                    </Pressable>
                )}
                
                <View style={{ display: "none" }}>
                    <View>
                        <Text style={{ fontFamily: "BricolageGrotesque_700Bold", fontSize: 18, color: "#f5f5f5" }}>
                            Overall Breakdown
                        </Text>
                    </View>
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
                        <View style={{ ...CARD, padding: 16, marginBottom: 14 }}>
                            <View style={{ flexDirection: "row", justifyContent: "space-between" }}>
                                <View>
                                    <Text style={{ fontFamily: "Manrope_500Medium", fontSize: 11, color: "#666" }}>Orders</Text>
                                    <Text style={{ fontFamily: "BricolageGrotesque_800ExtraBold", fontSize: 28, color: ORANGE }}>{orders.length}</Text>
                                </View>
                                <View>
                                    <Text style={{ fontFamily: "Manrope_500Medium", fontSize: 11, color: "#666", textAlign: "right" }}>Revenue</Text>
                                    <Text style={{ fontFamily: "BricolageGrotesque_800ExtraBold", fontSize: 28, color: "#22C55E" }}>
                                        ${totalRevenue.toFixed(0)}
                                    </Text>
                                </View>
                            </View>
                            <Text style={{ fontFamily: "Manrope_500Medium", fontSize: 12, color: "#888", marginTop: 6 }}>
                                {totalItems} items sold
                            </Text>
                        </View>

                        <View style={{ flexDirection: "row", gap: 8, marginBottom: 12 }}>
                            {(["items", "orders"] as const).map((mode) => {
                                const active = viewMode === mode;
                                return (
                                    <Pressable
                                        key={mode}
                                        onPress={() => {
                                            if (Platform.OS !== "web") Haptics.selectionAsync();
                                            setViewMode(mode);
                                        }}
                                        style={{
                                            flex: 1,
                                            borderRadius: 12,
                                            borderWidth: 1,
                                            borderColor: active ? "#FF9933" : "#2a2a2a",
                                            backgroundColor: active ? "rgba(255,153,51,0.14)" : "#141414",
                                            paddingVertical: 10,
                                            alignItems: "center",
                                        }}
                                    >
                                        <Text style={{ fontFamily: "Manrope_700Bold", fontSize: 12, color: active ? "#FF9933" : "#888" }}>
                                            {mode === "items" ? "BY ITEM" : "BY ORDER"}
                                        </Text>
                                    </Pressable>
                                );
                            })}
                        </View>

                        <View style={{ flexDirection: "row", alignItems: "center", gap: 8, marginBottom: 10 }}>
                            <SlidersHorizontal size={14} color="#777" />
                            {viewMode === "items" ? (
                                (["revenue", "quantity", "name"] as const).map((key) => {
                                    const active = itemSort === key;
                                    return (
                                        <Pressable
                                            key={key}
                                            onPress={() => setItemSort(key)}
                                            style={{
                                                borderRadius: 999,
                                                borderWidth: 1,
                                                borderColor: active ? "#FF9933" : "#2a2a2a",
                                                backgroundColor: active ? "rgba(255,153,51,0.12)" : "#141414",
                                                paddingHorizontal: 10,
                                                paddingVertical: 6,
                                            }}
                                        >
                                            <Text style={{ fontFamily: "Manrope_600SemiBold", fontSize: 11, color: active ? "#FF9933" : "#888" }}>
                                                {key === "revenue" ? "Revenue" : key === "quantity" ? "Qty" : "Name"}
                                            </Text>
                                        </Pressable>
                                    );
                                })
                            ) : (
                                (["amount", "time"] as const).map((key) => {
                                    const active = orderSort === key;
                                    return (
                                        <Pressable
                                            key={key}
                                            onPress={() => setOrderSort(key)}
                                            style={{
                                                borderRadius: 999,
                                                borderWidth: 1,
                                                borderColor: active ? "#FF9933" : "#2a2a2a",
                                                backgroundColor: active ? "rgba(255,153,51,0.12)" : "#141414",
                                                paddingHorizontal: 10,
                                                paddingVertical: 6,
                                            }}
                                        >
                                            <Text style={{ fontFamily: "Manrope_600SemiBold", fontSize: 11, color: active ? "#FF9933" : "#888" }}>
                                                {key === "amount" ? "Amount" : "Newest"}
                                            </Text>
                                        </Pressable>
                                    );
                                })
                            )}
                        </View>

                        {viewMode === "items" ? (
                            <View style={{ ...CARD, overflow: "hidden", paddingVertical: 2 }}>
                                {sortedItems.length === 0 ? (
                                    <Text style={{ fontFamily: "Manrope_500Medium", fontSize: 14, color: "#666", textAlign: "center", padding: 24 }}>
                                        No sold items yet today
                                    </Text>
                                ) : sortedItems.map((item, index) => (
                                    <View
                                        key={`${item.name}-${index}`}
                                        style={{
                                            paddingHorizontal: 16,
                                            paddingVertical: 12,
                                            borderBottomWidth: index < sortedItems.length - 1 ? 1 : 0,
                                            borderBottomColor: "#252525",
                                        }}
                                    >
                                        <Text style={{ fontFamily: "Manrope_700Bold", color: "#f5f5f5", fontSize: 14 }}>{item.name}</Text>
                                        <View style={{ flexDirection: "row", justifyContent: "space-between", marginTop: 5 }}>
                                            <View>
                                                <Text style={{ fontFamily: "Manrope_500Medium", color: "#888", fontSize: 12 }}>
                                                    {item.quantity} sold · {item.orderCount} orders
                                                </Text>
                                                {item.dateOfOrder && (
                                                    <Text style={{ fontFamily: "Manrope_500Medium", color: "#888", fontSize: 12, marginTop: 2 }}>
                                                        {item.dateOfOrder}
                                                    </Text>
                                                )}
                                            </View>
                                            <Text style={{ fontFamily: "Manrope_700Bold", color: "#22C55E", fontSize: 13 }}>
                                                ${item.revenue.toFixed(2)}
                                            </Text>
                                        </View>
                                    </View>
                                ))}
                            </View>
                        ) : (
                            <View style={{ ...CARD, overflow: "hidden", paddingVertical: 2 }}>
                                {sortedOrders.length === 0 ? (
                                    <Text style={{ fontFamily: "Manrope_500Medium", fontSize: 14, color: "#666", textAlign: "center", padding: 24 }}>
                                        No qualifying orders yet today
                                    </Text>
                                ) : sortedOrders.map((order, index) => (
                                    <OrderListRow
                                        key={order.id}
                                        order={order}
                                        isLast={index === sortedOrders.length - 1}
                                        onPress={() => setSelectedOrder(order)}
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

function AdminRestaurantPickerModal({
    visible,
    restaurants,
    onClose,
    onSelect,
}: {
    visible: boolean;
    restaurants: { id: number; name: string }[];
    onClose: () => void;
    onSelect: (id: string | null) => void;
}) {
    return (
        <Modal visible={visible} animationType="slide" transparent onRequestClose={onClose}>
            <View style={{ flex: 1, justifyContent: "flex-end" }}>
                <Pressable style={{ flex: 1, backgroundColor: "rgba(0,0,0,0.55)" }} onPress={onClose} />
                <View
                    style={{
                        backgroundColor: "#141414",
                        borderTopLeftRadius: 18,
                        borderTopRightRadius: 18,
                        borderWidth: 1,
                        borderColor: "#2a2a2a",
                        maxHeight: "78%",
                        paddingBottom: Platform.OS === "ios" ? 28 : 16,
                    }}
                >
                    <Text
                        style={{
                            paddingHorizontal: 18,
                            paddingTop: 16,
                            paddingBottom: 8,
                            fontFamily: "Manrope_700Bold",
                            color: "#f5f5f5",
                            fontSize: 17,
                        }}
                    >
                        Select restaurant
                    </Text>
                    <FlatList
                        data={restaurants}
                        keyExtractor={(item) => String(item.id)}
                        keyboardShouldPersistTaps="handled"
                        renderItem={({ item }) => (
                            <Pressable
                                onPress={() => {
                                    if (Platform.OS !== "web") Haptics.selectionAsync();
                                    onSelect(String(item.id));
                                }}
                                style={{
                                    paddingHorizontal: 18,
                                    paddingVertical: 14,
                                    borderBottomWidth: 1,
                                    borderBottomColor: "#252525",
                                }}
                            >
                                <Text style={{ color: "#f5f5f5", fontFamily: "Manrope_600SemiBold", fontSize: 15 }}>
                                    {item.name}
                                </Text>
                                <Text
                                    style={{
                                        color: "#666",
                                        fontSize: 11,
                                        marginTop: 3,
                                        fontFamily: "Manrope_500Medium",
                                    }}
                                >
                                    ID {item.id}
                                </Text>
                            </Pressable>
                        )}
                    />
                    <Pressable
                        onPress={() => {
                            if (Platform.OS !== "web") Haptics.selectionAsync();
                            onSelect(null);
                        }}
                        style={{
                            marginHorizontal: 18,
                            marginTop: 8,
                            paddingVertical: 14,
                            alignItems: "center",
                            borderRadius: 12,
                            backgroundColor: "rgba(239,68,68,0.12)",
                            borderWidth: 1,
                            borderColor: "rgba(239,68,68,0.35)",
                        }}
                    >
                        <Text style={{ fontFamily: "Manrope_600SemiBold", color: "#F87171", fontSize: 14 }}>
                            Clear selection
                        </Text>
                    </Pressable>
                </View>
            </View>
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
    const {
        isAdmin,
        effectiveOwnerRestaurantId,
        setAdminOwnerRestaurantId,
    } = useAdminMode();

    const [restaurant, setRestaurant] = useState<RestaurantInfo | null>(null);
    const [adminRestaurants, setAdminRestaurants] = useState<{ id: number; name: string }[]>([]);
    const [restaurantPickerOpen, setRestaurantPickerOpen] = useState(false);
    const [recentOrders, setRecentOrders] = useState<Order[]>([]);
    const [queueCount, setQueueCount] = useState<number | null>(null);
    const [todayOrderCount, setTodayOrderCount] = useState<number | null>(null);
    const [todayRevenue, setTodayRevenue] = useState<number | null>(null);
    const [statusResult, setStatusResult] = useState<RestaurantStatusResult | null>(null);
    const [restaurantHoursRows, setRestaurantHoursRows] = useState<RestaurantHour[]>([]);
    const [loading, setLoading] = useState(true);
    /** Skip full-screen spinner when re-fetching the same venue (e.g. returning from Discover). */
    const lastLoadedRestaurantIdRef = useRef<string | null>(null);

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
    const [showPulseBreakdown, setShowPulseBreakdown] = useState<false | "All" | "Today">(false);

    useEffect(() => {
        if (!isAdmin) return;
        void supabase
            .from("restaurants")
            .select("id, name")
            .order("name")
            .then(({ data }) => {
                setAdminRestaurants((data as { id: number; name: string }[]) ?? []);
            });
    }, [isAdmin]);

    const fetchData = useCallback(async () => {
        if (!effectiveOwnerRestaurantId) {
            setRestaurant(null);
            setQueueCount(null);
            setRecentOrders([]);
            setTodayOrderCount(null);
            setTodayRevenue(null);
            setRestaurantHoursRows([]);
            setStatusResult(null);
            lastLoadedRestaurantIdRef.current = null;
            setLoading(false);
            return;
        }
        const blockingLoader = lastLoadedRestaurantIdRef.current !== effectiveOwnerRestaurantId;
        if (blockingLoader) setLoading(true);
        try {
            const [restRes, queueRes, recentRes, todayRes, hoursRes] = await Promise.all([
                supabase
                    .from("restaurants")
                    .select(
                        "id, name, current_wait_time, waitlist_open, is_enabled, waitlist_early_open_enabled, waitlist_early_open_minutes",
                    )
                    .eq("id", effectiveOwnerRestaurantId)
                    .single(),
                supabase
                    .from("waitlist_entries")
                    .select("*", { count: "exact", head: true })
                    .eq("restaurant_id", effectiveOwnerRestaurantId)
                    .eq("status", "waiting"),
                supabase
                    .from("orders")
                    .select("id, customer_name, status, subtotal, created_at, order_type")
                    .eq("restaurant_id", effectiveOwnerRestaurantId)
                    .order("created_at", { ascending: false })
                    .limit(2),
                supabase
                    .from("orders")
                    .select("id, subtotal")
                    .eq("restaurant_id", effectiveOwnerRestaurantId)
                    .gte("created_at", todayStart())
                    .neq("status", "cancelled"),
                supabase
                    .from("restaurant_hours")
                    .select("day_of_week, open_time, close_time")
                    .eq("restaurant_id", effectiveOwnerRestaurantId),
            ]);

            if (restRes.data) setRestaurant(restRes.data as RestaurantInfo);
            setQueueCount(queueRes.count ?? 0);
            setRecentOrders((recentRes.data as Order[]) ?? []);

            const todayOrders = (todayRes.data as { id: number; subtotal: number }[]) ?? [];
            setTodayOrderCount(todayOrders.length);
            setTodayRevenue(todayOrders.reduce((sum, o) => sum + (o.subtotal ?? 0), 0));

            const fetchedHours = (hoursRes.data as RestaurantHour[]) ?? [];
            setRestaurantHoursRows(fetchedHours);
            setStatusResult(getRestaurantStatus(fetchedHours));
            lastLoadedRestaurantIdRef.current = effectiveOwnerRestaurantId;
        } catch (err: any) {
            console.error("OwnerHomeContent fetch error:", err);
        } finally {
            setLoading(false);
        }
    }, [effectiveOwnerRestaurantId]);

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
        if (!effectiveOwnerRestaurantId || !restaurant) return;
        const clamped = Math.max(0, Math.round(newTime));
        setSavingWait(true);
        setRestaurant((prev) => prev ? { ...prev, current_wait_time: clamped } : prev);
        const { error } = await supabase
            .from("restaurants")
            .update({ current_wait_time: clamped })
            .eq("id", effectiveOwnerRestaurantId);
        if (error) { console.error("Failed to update wait time:", error.message); fetchData(); }
        setSavingWait(false);
    }, [effectiveOwnerRestaurantId, restaurant, fetchData]);

    const commitWaitEdit = () => {
        const parsed = parseInt(waitInputVal, 10);
        if (!isNaN(parsed)) updateWaitTime(parsed);
        setEditingWait(false);
    };

    /** Waitlist can open when operating, soon, or optional pre-open window */
    const hoursAllowWaitlist =
        !statusResult ||
        waitlistAllowedBySchedule(
            statusResult,
            restaurantHoursRows,
            restaurant?.waitlist_early_open_enabled === true,
            Math.max(0, Math.min(24 * 60, Number(restaurant?.waitlist_early_open_minutes) || 30)),
        );
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
                        if (!effectiveOwnerRestaurantId) return;
                        setTogglingWaitlist(true);
                        setRestaurant((prev) => prev ? { ...prev, waitlist_open: willOpen } : prev);
                        const { error } = await supabase
                            .from("restaurants")
                            .update({ waitlist_open: willOpen })
                            .eq("id", effectiveOwnerRestaurantId);
                        if (error) { console.error("Failed to toggle waitlist:", error.message); fetchData(); }
                        setTogglingWaitlist(false);
                        if (Platform.OS !== "web") Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
                    },
                },
            ]
        );
    };

    const selectedAdminLabel =
        effectiveOwnerRestaurantId &&
        adminRestaurants.find((r) => String(r.id) === effectiveOwnerRestaurantId)?.name;

    // ── Loading / empty (admin must pick a restaurant) ─────────────────────
    if (isAdmin && !effectiveOwnerRestaurantId) {
        return (
            <>
                <View style={{ flex: 1, paddingHorizontal: 20, paddingTop: 16 }}>
                    <Pressable
                        onPress={() => {
                            if (Platform.OS !== "web") Haptics.selectionAsync();
                            setRestaurantPickerOpen(true);
                        }}
                        style={{
                            flexDirection: "row",
                            alignItems: "center",
                            justifyContent: "space-between",
                            backgroundColor: "#161616",
                            borderWidth: 1,
                            borderColor: "#2d2d2d",
                            borderRadius: 14,
                            paddingHorizontal: 16,
                            paddingVertical: 14,
                        }}
                    >
                        <View style={{ flex: 1 }}>
                            <Text style={{ fontSize: 11, color: "#888", fontFamily: "Manrope_600SemiBold" }}>
                                Restaurant
                            </Text>
                            <Text
                                style={{
                                    fontSize: 17,
                                    color: "#f5f5f5",
                                    marginTop: 4,
                                    fontFamily: "Manrope_700Bold",
                                }}
                            >
                                None selected
                            </Text>
                        </View>
                        <ChevronDown size={22} color="#888" />
                    </Pressable>
                    <Text
                        style={{
                            marginTop: 18,
                            textAlign: "center",
                            color: "#666",
                            fontSize: 13,
                            fontFamily: "Manrope_500Medium",
                            lineHeight: 20,
                        }}
                    >
                        Choose a restaurant to load its owner dashboard.
                    </Text>
                </View>
                <AdminRestaurantPickerModal
                    visible={restaurantPickerOpen}
                    restaurants={adminRestaurants}
                    onClose={() => setRestaurantPickerOpen(false)}
                    onSelect={(id) => {
                        setAdminOwnerRestaurantId(id);
                        setRestaurantPickerOpen(false);
                    }}
                />
            </>
        );
    }

    if (!isAdmin && !effectiveOwnerRestaurantId) {
        return (
            <View style={{ flex: 1, justifyContent: "center", paddingHorizontal: 24 }}>
                <Text style={{ color: "#888", textAlign: "center", fontFamily: "Manrope_500Medium", fontSize: 14 }}>
                    No restaurant is linked to your account.
                </Text>
            </View>
        );
    }

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
    // If the restaurant is closed by schedule, treat queue as disabled too
    const restaurantClosed = statusResult?.status === 'closed';
    const queueDisabled = !waitlistOpen || restaurantClosed;

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
                {isAdmin && (
                    <Pressable
                        onPress={() => {
                            if (Platform.OS !== "web") Haptics.selectionAsync();
                            setRestaurantPickerOpen(true);
                        }}
                        style={{
                            flexDirection: "row",
                            alignItems: "center",
                            justifyContent: "space-between",
                            backgroundColor: "#161616",
                            borderWidth: 1,
                            borderColor: "#2d2d2d",
                            borderRadius: 14,
                            paddingHorizontal: 14,
                            paddingVertical: 12,
                            marginBottom: 14,
                        }}
                    >
                        <View style={{ flex: 1 }}>
                            <Text style={{ fontSize: 10, color: "#888", fontFamily: "Manrope_600SemiBold" }}>
                                Admin · Owner Dashboard
                            </Text>
                            <Text
                                style={{
                                    fontSize: 15,
                                    color: "#f5f5f5",
                                    marginTop: 3,
                                    fontFamily: "Manrope_700Bold",
                                }}
                                numberOfLines={1}
                            >
                                {selectedAdminLabel ?? "None selected"}
                            </Text>
                        </View>
                        <ChevronDown size={20} color="#888" />
                    </Pressable>
                )}
                {/* ── Owner Hub Hero ── */}
                <View style={{
                    backgroundColor: "#161616",
                    borderWidth: 1,
                    borderColor: "#2d2d2d",
                    borderRadius: 18,
                    padding: 16,
                    marginBottom: 14,
                }}>
                    <View style={{ flexDirection: "row", justifyContent: "space-between", alignItems: "flex-start", marginBottom: 12 }}>
                        <View style={{ flex: 1, marginRight: 10 }}>
                            <Text style={{
                                fontFamily: "BricolageGrotesque_800ExtraBold",
                                fontSize: 26,
                                color: ORANGE,
                                letterSpacing: -0.3,
                            }} numberOfLines={1}>
                                {restaurant?.name ?? ""}
                            </Text>
                            <Text style={{ fontFamily: "Manrope_500Medium", fontSize: 12, color: "#888", marginTop: 3 }}>
                                Owner Hub
                            </Text>
                        </View>
                        <View style={{
                            backgroundColor: "rgba(255,153,51,0.14)",
                            borderRadius: 999,
                            borderWidth: 1,
                            borderColor: "rgba(255,153,51,0.35)",
                            paddingHorizontal: 10,
                            paddingVertical: 5,
                        }}>
                            <Text style={{ fontFamily: "Manrope_700Bold", fontSize: 10, color: ORANGE, letterSpacing: 0.4 }}>
                                LIVE
                            </Text>
                        </View>
                    </View>

                    <View style={{ flexDirection: "row", gap: 10 }}>
                        <Pressable
                            onPress={() => {
                                if (Platform.OS !== "web") Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
                                setShowHoursSettings(true);
                            }}
                            style={({ pressed }) => ({
                                flex: 1,
                                borderRadius: 12,
                                borderWidth: 1,
                                borderColor: "rgba(255,153,51,0.30)",
                                backgroundColor: "rgba(255,153,51,0.12)",
                                paddingVertical: 11,
                                alignItems: "center",
                                opacity: pressed ? 0.85 : 1,
                            })}
                        >
                            <Text style={{ fontFamily: "Manrope_700Bold", fontSize: 12, color: ORANGE }}>
                                Manage Timings
                            </Text>
                        </Pressable>
                        <Pressable
                            onPress={() => {
                                if (Platform.OS !== "web") Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
                                setShowPulseBreakdown("All");
                            }}
                            style={({ pressed }) => ({
                                flex: 1,
                                borderRadius: 12,
                                borderWidth: 1,
                                borderColor: "rgba(34,197,94,0.30)",
                                backgroundColor: "rgba(34,197,94,0.10)",
                                paddingVertical: 11,
                                alignItems: "center",
                                opacity: pressed ? 0.85 : 1,
                            })}
                        >
                            <Text style={{ fontFamily: "Manrope_700Bold", fontSize: 12, color: "#22C55E" }}>
                                View Breakdown
                            </Text>
                        </Pressable>
                    </View>
                </View>

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
                            <View style={{ alignItems: "center", flex: 1, opacity: restaurantClosed ? 0.4 : 1 }}>
                                <View style={{ flexDirection: "row", alignItems: "center", gap: 6 }}>
                                    <Users size={16} color={restaurantClosed ? "#555" : ORANGE} />
                                    <Text style={{ fontFamily: "BricolageGrotesque_700Bold", fontSize: 34, color: restaurantClosed ? "#444" : ORANGE }}>
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
                                disabled={waitlistToggleDisabled || restaurantClosed}
                                style={{ alignItems: "center", flex: 1, opacity: restaurantClosed ? 0.4 : 1 }}
                            >
                                <View style={{
                                    paddingHorizontal: 16, paddingVertical: 8, borderRadius: 20,
                                    backgroundColor: (waitlistOpen && !restaurantClosed) ? "rgba(34,197,94,0.12)" : "rgba(239,68,68,0.12)",
                                    borderWidth: 1,
                                    borderColor: (waitlistOpen && !restaurantClosed) ? "rgba(34,197,94,0.35)" : "rgba(239,68,68,0.35)",
                                    opacity: waitlistToggleDisabled ? 0.45 : 1,
                                }}>
                                    <Text style={{ fontFamily: "Manrope_700Bold", fontSize: 13, color: (waitlistOpen && !restaurantClosed) ? "#22C55E" : "#EF4444" }}>
                                        {(waitlistOpen && !restaurantClosed) ? "● OPEN" : "● CLOSED"}
                                    </Text>
                                </View>
                                <Text style={{ fontFamily: "Manrope_500Medium", fontSize: 11, color: "#555", marginTop: 6, textAlign: "center", paddingHorizontal: 4 }}>
                                    {restaurantClosed
                                        ? "Restaurant is closed"
                                        : waitlistToggleDisabled && !waitlistOpen
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
                    <View style={{ flexDirection: "row", alignItems: "center", justifyContent: "space-between", marginBottom: 12 }}>
                        <View style={{ flexDirection: "row", alignItems: "center", gap: 8 }}>
                            <BarChart3 size={18} color={ORANGE} />
                            <Text style={{ fontFamily: "BricolageGrotesque_700Bold", fontSize: 17, color: "#f5f5f5" }}>
                                Today's Pulse
                            </Text>
                        </View>
                        <Pressable
                            onPress={() => {
                                if (Platform.OS !== "web") Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
                                setShowPulseBreakdown("Today");
                            }}
                            hitSlop={10}
                            style={({ pressed }) => ({
                                opacity: pressed ? 0.65 : 1,
                                backgroundColor: "rgba(255,153,51,0.15)",
                                borderColor: "rgba(255,153,51,0.35)",
                                borderWidth: 1,
                                borderRadius: 999,
                                paddingHorizontal: 12,
                                paddingVertical: 7,
                                flexDirection: "row",
                                alignItems: "center",
                                gap: 6,
                            })}
                        >
                            <BarChart3 size={13} color={ORANGE} />
                            <Text style={{ fontFamily: "Manrope_700Bold", fontSize: 12, color: ORANGE }}>
                                Breakdown
                            </Text>
                        </Pressable>
                    </View>
                    <View
                        style={{
                            backgroundColor: "#171717",
                            borderWidth: 1,
                            borderColor: "#303030",
                            borderRadius: 18,
                            padding: 16,
                        }}
                    >
                        <View style={{ flexDirection: "row", gap: 10, marginBottom: 6 }}>
                            <View style={{
                                flex: 1,
                                borderRadius: 12,
                                borderWidth: 1,
                                borderColor: "rgba(255,153,51,0.26)",
                                backgroundColor: "rgba(255,153,51,0.08)",
                                paddingVertical: 10,
                                paddingHorizontal: 12,
                            }}>
                                <View style={{ flexDirection: "row", alignItems: "center", gap: 6, marginBottom: 2 }}>
                                    <ShoppingBag size={14} color={ORANGE} />
                                    <Text style={{ fontFamily: "Manrope_600SemiBold", fontSize: 11, color: "#aaa" }}>
                                        Orders
                                    </Text>
                                </View>
                                <Text style={{ fontFamily: "BricolageGrotesque_700Bold", fontSize: 24, color: "#f5f5f5" }}>
                                    {todayOrderCount ?? "—"}
                                </Text>
                            </View>
                            <View style={{
                                flex: 1,
                                borderRadius: 12,
                                borderWidth: 1,
                                borderColor: "rgba(34,197,94,0.26)",
                                backgroundColor: "rgba(34,197,94,0.08)",
                                paddingVertical: 10,
                                paddingHorizontal: 12,
                                alignItems: "flex-end",
                            }}>
                                <Text style={{ fontFamily: "Manrope_600SemiBold", fontSize: 11, color: "#8ad9b0", marginBottom: 2 }}>
                                    Revenue
                                </Text>
                                <Text style={{ fontFamily: "BricolageGrotesque_700Bold", fontSize: 24, color: "#22C55E" }}>
                                    {todayRevenue != null ? `$${todayRevenue.toFixed(0)}` : "—"}
                                </Text>
                            </View>
                        </View>
                        <Pressable
                            onPress={() => {
                                if (Platform.OS !== "web") Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
                                setShowPulseBreakdown("Today");
                            }}
                            style={({ pressed }) => ({
                                marginTop: 24,
                                borderRadius: 12,
                                borderWidth: 1,
                                borderColor: pressed ? "#3f3f3f" : "#2f2f2f",
                                backgroundColor: pressed ? "#1a1a1a" : "#131313",
                                paddingHorizontal: 16,
                                paddingVertical: 14,
                                flexDirection: "row",
                                alignItems: "center",
                                justifyContent: "space-between",
                            })}
                        >
                            <View>
                                <Text style={{ fontFamily: "BricolageGrotesque_700Bold", fontSize: 15, color: "#f5f5f5" }}>
                                    Open combined breakdown
                                </Text>
                                <Text style={{ fontFamily: "Manrope_500Medium", fontSize: 11, color: "#777", marginTop: 4 }}>
                                    Item + order insights in one place
                                </Text>
                            </View>
                            <Text style={{ fontFamily: "Manrope_700Bold", fontSize: 18, color: "#555", lineHeight: 20 }}>›</Text>
                        </Pressable>
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
            {showAllOrders && effectiveOwnerRestaurantId && (
                <AllOrdersModal restaurantId={effectiveOwnerRestaurantId} onClose={() => setShowAllOrders(false)} />
            )}
            {selectedOrder && (
                <OrderDetailModal order={selectedOrder} onClose={() => setSelectedOrder(null)} />
            )}
            {showHoursSettings && effectiveOwnerRestaurantId && (
                <RestaurantEditModal
                    restaurantId={effectiveOwnerRestaurantId}
                    visible={showHoursSettings}
                    onClose={() => setShowHoursSettings(false)}
                    openHoursOnMount
                    onHoursSaved={fetchData}
                />
            )}
            {showPulseBreakdown && effectiveOwnerRestaurantId && (
                <OverallBreakdownModal
                    initialPeriod={showPulseBreakdown === "All" ? "All" : "Today"}
                    restaurantId={effectiveOwnerRestaurantId}
                    onClose={() => setShowPulseBreakdown(false)}
                />
            )}
            {isAdmin && (
                <AdminRestaurantPickerModal
                    visible={restaurantPickerOpen}
                    restaurants={adminRestaurants}
                    onClose={() => setRestaurantPickerOpen(false)}
                    onSelect={(id) => {
                        setAdminOwnerRestaurantId(id);
                        setRestaurantPickerOpen(false);
                    }}
                />
            )}
        </>
    );
}
