import React, { useState, useCallback, useEffect } from "react";
import {
    View,
    Text,
    ScrollView,
    Pressable,
    ActivityIndicator,
    RefreshControl,
    Alert,
} from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";
import { useRouter } from "expo-router";
import {
    ArrowLeft,
    Store,
    Clock,
    Users,
    ShoppingBag,
    Ban,
    ChevronRight,
    TrendingUp,
} from "lucide-react-native";
import * as Haptics from "expo-haptics";
import { Platform } from "react-native";
import { supabase } from "@/lib/supabase";
import { useAdminMode } from "@/hooks/useAdminMode";

// ── Types ──────────────────────────────────────────────────────────────────
type RestaurantInfo = {
    id: number;
    name: string;
    current_wait_time: number;
    is_waitlist_open: boolean;
    is_enabled: boolean;
};

type RecentOrder = {
    id: number;
    customer_name: string | null;
    status: string;
    subtotal: number;
    created_at: string;
    order_type: string;
};

const CARD = {
    backgroundColor: "#1a1a1a",
    borderWidth: 1,
    borderColor: "#2a2a2a",
    borderRadius: 16,
} as const;

function getWaitColor(mins: number) {
    if (mins < 15) return "#22C55E";
    if (mins < 45) return "#F59E0B";
    return "#EF4444";
}

function statusColor(status: string) {
    switch (status) {
        case "pending":
        case "active": return "#FF9933";  // 'active' kept as fallback for legacy data
        case "preparing": return "#F59E0B";
        case "ready": return "#22C55E";
        case "served":
        case "completed": return "#6B7280";
        case "cancelled": return "#EF4444";
        default: return "#999";
    }
}

// ── Main Screen ─────────────────────────────────────────────────────────────
export default function OwnerDashboardScreen() {
    const router = useRouter();
    const { isRestaurantOwner, ownedRestaurantId, loading: roleLoading } = useAdminMode();

    const [restaurant, setRestaurant] = useState<RestaurantInfo | null>(null);
    const [orders, setOrders] = useState<RecentOrder[]>([]);
    const [queueCount, setQueueCount] = useState<number | null>(null);
    const [loading, setLoading] = useState(true);
    const [refreshing, setRefreshing] = useState(false);

    const fetchData = useCallback(async () => {
        if (!ownedRestaurantId) return;
        try {
            // Fetch restaurant info
            const { data: restData, error: restError } = await supabase
                .from("restaurants")
                .select("id, name, current_wait_time, is_waitlist_open, is_enabled")
                .eq("id", ownedRestaurantId)
                .single();

            if (restError) throw restError;
            setRestaurant(restData as RestaurantInfo);

            // Fetch live queue count
            const { count } = await supabase
                .from("waitlist_entries")
                .select("*", { count: "exact", head: true })
                .eq("restaurant_id", ownedRestaurantId)
                .eq("status", "waiting");
            setQueueCount(count ?? 0);

            // Fetch recent orders (last 20)
            const { data: orderData } = await supabase
                .from("orders")
                .select("id, customer_name, status, subtotal, created_at, order_type")
                .eq("restaurant_id", ownedRestaurantId)
                .order("created_at", { ascending: false })
                .limit(20);
            setOrders((orderData as RecentOrder[]) || []);
        } catch (err: any) {
            console.error("Owner dashboard fetch error:", err);
            Alert.alert("Error", "Could not load dashboard data.");
        } finally {
            setLoading(false);
            setRefreshing(false);
        }
    }, [ownedRestaurantId]);

    useEffect(() => {
        if (isRestaurantOwner && ownedRestaurantId) {
            fetchData();
        } else if (!roleLoading) {
            setLoading(false);
        }
    }, [isRestaurantOwner, ownedRestaurantId, roleLoading, fetchData]);

    const onRefresh = useCallback(() => {
        if (Platform.OS !== "web") Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
        setRefreshing(true);
        fetchData();
    }, [fetchData]);

    // ── Access guard ─────────────────────────────────────────────────────────
    if (!roleLoading && !isRestaurantOwner) {
        return (
            <SafeAreaView style={{ flex: 1, backgroundColor: "#0f0f0f" }} edges={["top"]}>
                <View style={{ flex: 1, alignItems: "center", justifyContent: "center", padding: 24 }}>
                    <Ban size={48} color="#EF4444" style={{ marginBottom: 16 }} />
                    <Text style={{ fontFamily: "BricolageGrotesque_700Bold", fontSize: 22, color: "#f5f5f5", textAlign: "center", marginBottom: 24 }}>
                        Access Denied
                    </Text>
                    <Pressable
                        onPress={() => router.back()}
                        style={{ backgroundColor: "#1a1a1a", borderRadius: 12, paddingVertical: 12, paddingHorizontal: 20, borderWidth: 1, borderColor: "#2a2a2a", flexDirection: "row", alignItems: "center", gap: 8 }}
                    >
                        <ArrowLeft size={20} color="#f5f5f5" />
                        <Text style={{ fontFamily: "Manrope_600SemiBold", fontSize: 16, color: "#f5f5f5" }}>Back</Text>
                    </Pressable>
                </View>
            </SafeAreaView>
        );
    }

    const waitTime = restaurant?.current_wait_time ?? 0;
    const isClosed = waitTime >= 999 || !restaurant?.is_waitlist_open;

    return (
        <SafeAreaView style={{ flex: 1, backgroundColor: "#0f0f0f" }} edges={["top"]}>
            {/* Header */}
            <View style={{
                flexDirection: "row", alignItems: "center", justifyContent: "space-between",
                paddingHorizontal: 20, paddingVertical: 16,
                borderBottomWidth: 1, borderBottomColor: "#2a2a2a",
            }}>
                <Pressable
                    onPress={() => { if (Platform.OS !== "web") Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light); router.back(); }}
                    hitSlop={12}
                    style={({ pressed }) => ({ opacity: pressed ? 0.7 : 1, padding: 8 })}
                >
                    <ArrowLeft size={24} color="#f5f5f5" />
                </Pressable>
                <View style={{ alignItems: "center" }}>
                    <Text style={{ fontFamily: "BricolageGrotesque_800ExtraBold", fontSize: 20, color: "#f5f5f5" }}>
                        Owner Dashboard
                    </Text>
                    {restaurant && (
                        <Text style={{ fontFamily: "Manrope_500Medium", fontSize: 12, color: "#4ADE80", marginTop: 2 }}>
                            {restaurant.name}
                        </Text>
                    )}
                </View>
                <View style={{ width: 40, alignItems: "flex-end" }}>
                    <View style={{ width: 8, height: 8, borderRadius: 4, backgroundColor: "#4ADE80" }} />
                </View>
            </View>

            {loading ? (
                <View style={{ flex: 1, alignItems: "center", justifyContent: "center" }}>
                    <ActivityIndicator size="large" color="#4ADE80" />
                </View>
            ) : (
                <ScrollView
                    style={{ flex: 1 }}
                    contentContainerStyle={{ padding: 20, paddingBottom: 40 }}
                    showsVerticalScrollIndicator={false}
                    refreshControl={<RefreshControl refreshing={refreshing} onRefresh={onRefresh} tintColor="#4ADE80" />}
                >
                    {/* ── Manage Restaurant CTA ── */}
                    {ownedRestaurantId && (
                        <Pressable
                            onPress={() => {
                                if (Platform.OS !== "web") Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
                                router.push(`/restaurant/${ownedRestaurantId}` as any);
                            }}
                            style={({ pressed }) => ({
                                ...CARD,
                                padding: 16,
                                marginBottom: 20,
                                flexDirection: "row",
                                alignItems: "center",
                                justifyContent: "space-between",
                                opacity: pressed ? 0.85 : 1,
                            })}
                        >
                            <View style={{ flexDirection: "row", alignItems: "center", gap: 12 }}>
                                <View style={{ width: 44, height: 44, borderRadius: 22, backgroundColor: "rgba(74,222,128,0.15)", alignItems: "center", justifyContent: "center", borderWidth: 1, borderColor: "rgba(74,222,128,0.3)" }}>
                                    <Store size={20} color="#4ADE80" />
                                </View>
                                <View>
                                    <Text style={{ fontFamily: "BricolageGrotesque_700Bold", fontSize: 16, color: "#f5f5f5" }}>
                                        Manage Restaurant
                                    </Text>
                                    <Text style={{ fontFamily: "Manrope_500Medium", fontSize: 13, color: "#777", marginTop: 2 }}>
                                        Edit menu, hours & wait times
                                    </Text>
                                </View>
                            </View>
                            <ChevronRight size={20} color="#4ADE80" />
                        </Pressable>
                    )}

                    {/* ── Queue Status Card ── */}
                    <View style={{ marginBottom: 20 }}>
                        <View style={{ flexDirection: "row", alignItems: "center", gap: 8, marginBottom: 12 }}>
                            <TrendingUp size={20} color="#4ADE80" />
                            <Text style={{ fontFamily: "BricolageGrotesque_700Bold", fontSize: 18, color: "#f5f5f5" }}>
                                Live Queue Status
                            </Text>
                        </View>
                        <View style={{ ...CARD, padding: 16 }}>
                            <View style={{ flexDirection: "row", justifyContent: "space-between" }}>
                                {/* Wait time */}
                                <View style={{ alignItems: "center", flex: 1 }}>
                                    <View style={{ flexDirection: "row", alignItems: "center", gap: 6 }}>
                                        <Clock size={16} color={isClosed ? "#999" : getWaitColor(waitTime)} />
                                        <Text style={{ fontFamily: "BricolageGrotesque_700Bold", fontSize: 24, color: isClosed ? "#999" : getWaitColor(waitTime) }}>
                                            {isClosed ? "—" : `${waitTime}m`}
                                        </Text>
                                    </View>
                                    <Text style={{ fontFamily: "Manrope_500Medium", fontSize: 12, color: "#666", marginTop: 4 }}>
                                        {isClosed ? "Waitlist Closed" : "Wait Time"}
                                    </Text>
                                </View>

                                <View style={{ width: 1, backgroundColor: "#2a2a2a" }} />

                                {/* Queue count */}
                                <View style={{ alignItems: "center", flex: 1 }}>
                                    <View style={{ flexDirection: "row", alignItems: "center", gap: 6 }}>
                                        <Users size={16} color="#4ADE80" />
                                        <Text style={{ fontFamily: "BricolageGrotesque_700Bold", fontSize: 24, color: "#4ADE80" }}>
                                            {queueCount ?? "—"}
                                        </Text>
                                    </View>
                                    <Text style={{ fontFamily: "Manrope_500Medium", fontSize: 12, color: "#666", marginTop: 4 }}>
                                        In Queue
                                    </Text>
                                </View>

                                <View style={{ width: 1, backgroundColor: "#2a2a2a" }} />

                                {/* Open/Closed status */}
                                <View style={{ alignItems: "center", flex: 1 }}>
                                    <View style={{ backgroundColor: isClosed ? "rgba(239,68,68,0.12)" : "rgba(34,197,94,0.12)", borderRadius: 12, paddingHorizontal: 10, paddingVertical: 4, borderWidth: 1, borderColor: isClosed ? "rgba(239,68,68,0.3)" : "rgba(34,197,94,0.3)" }}>
                                        <Text style={{ fontFamily: "Manrope_600SemiBold", fontSize: 12, color: isClosed ? "#EF4444" : "#22C55E" }}>
                                            {isClosed ? "CLOSED" : "OPEN"}
                                        </Text>
                                    </View>
                                    <Text style={{ fontFamily: "Manrope_500Medium", fontSize: 12, color: "#666", marginTop: 4 }}>
                                        Waitlist
                                    </Text>
                                </View>
                            </View>
                        </View>
                    </View>

                    {/* ── Recent Orders ── */}
                    <View>
                        <View style={{ flexDirection: "row", alignItems: "center", gap: 8, marginBottom: 12 }}>
                            <ShoppingBag size={20} color="#4ADE80" />
                            <Text style={{ fontFamily: "BricolageGrotesque_700Bold", fontSize: 18, color: "#f5f5f5" }}>
                                Recent Orders
                            </Text>
                        </View>
                        <View style={CARD}>
                            {orders.length === 0 ? (
                                <Text style={{ fontFamily: "Manrope_500Medium", fontSize: 14, color: "#999", textAlign: "center", padding: 24 }}>
                                    No orders yet
                                </Text>
                            ) : (
                                orders.map((order, index) => (
                                    <View
                                        key={order.id}
                                        style={{
                                            flexDirection: "row",
                                            justifyContent: "space-between",
                                            alignItems: "center",
                                            paddingVertical: 14,
                                            paddingHorizontal: 16,
                                            borderBottomWidth: index < orders.length - 1 ? 1 : 0,
                                            borderBottomColor: "#2a2a2a",
                                        }}
                                    >
                                        <View style={{ flex: 1 }}>
                                            <Text style={{ fontFamily: "Manrope_600SemiBold", fontSize: 14, color: "#f5f5f5" }} numberOfLines={1}>
                                                {order.customer_name || `Order #${order.id}`}
                                            </Text>
                                            <Text style={{ fontFamily: "Manrope_500Medium", fontSize: 12, color: "#666", marginTop: 2 }}>
                                                {order.order_type.replace(/_/g, " ")} · ${order.subtotal?.toFixed(2)}
                                            </Text>
                                        </View>
                                        <View style={{ backgroundColor: `${statusColor(order.status)}20`, borderRadius: 10, paddingHorizontal: 8, paddingVertical: 3, borderWidth: 1, borderColor: `${statusColor(order.status)}40` }}>
                                            <Text style={{ fontFamily: "Manrope_600SemiBold", fontSize: 11, color: statusColor(order.status) }}>
                                                {order.status.toUpperCase()}
                                            </Text>
                                        </View>
                                    </View>
                                ))
                            )}
                        </View>
                    </View>
                </ScrollView>
            )}
        </SafeAreaView>
    );
}
