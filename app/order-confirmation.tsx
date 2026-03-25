import React, { useEffect, useState } from "react";
import {
    View,
    Text,
    Pressable,
    Platform,
    ScrollView,
    ActivityIndicator,
} from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";
import { useLocalSearchParams, useRouter } from "expo-router";
import {
    CheckCircle2,
    ShoppingBag,
    Truck,
    UtensilsCrossed,
    Clock,
    ChevronRight,
    MapPin,
    ArrowLeft,
} from "lucide-react-native";
import Animated, { FadeIn, FadeInDown } from "react-native-reanimated";
import * as Haptics from "expo-haptics";
import { supabase } from "@/lib/supabase";
import { useAuth } from "@/lib/auth-context";

interface OrderItem {
    id: number;
    name: string;
    price: number;
    quantity: number;
    is_vegetarian: boolean;
}

export default function OrderConfirmationScreen() {
    const router = useRouter();
    const { session } = useAuth();
    const params = useLocalSearchParams<{
        order_id?: string;
        restaurant_name?: string;
        order_type?: string;
        total?: string;
        party_session_id?: string;
    }>();

    const [loading, setLoading] = useState(true);
    const [order, setOrder] = useState<any>(null);
    const [items, setItems] = useState<OrderItem[]>([]);

    const orderId = params.order_id;
    const restaurantName = params.restaurant_name || "Restaurant";
    const orderType = params.order_type || "dine_in";
    const total = params.total ? parseFloat(params.total) : 0;

    useEffect(() => {
        if (Platform.OS !== "web") {
            Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
            setTimeout(() => Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Heavy), 200);
        }
    }, []);

    // Fetch order details from Supabase
    useEffect(() => {
        const fetchOrder = async () => {
            if (!orderId) {
                setLoading(false);
                return;
            }

            try {
                const { data: orderData } = await supabase
                    .from("orders")
                    .select("*, order_items(*), restaurants(name, image_url)")
                    .eq("id", Number(orderId))
                    .single();

                if (orderData) {
                    setOrder(orderData);
                    setItems(orderData.order_items || []);
                }
            } catch (e) {
                console.error("Error fetching order:", e);
            } finally {
                setLoading(false);
            }
        };

        fetchOrder();
    }, [orderId]);

    const handleGoHome = () => {
        if (Platform.OS !== "web") Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
        router.replace("/");
    };

    const handleViewOrders = () => {
        if (Platform.OS !== "web") Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
        router.replace("/my-orders");
    };

    const displayTotal = order?.subtotal ? Number(order.subtotal) : total;
    const displayType = order?.order_type || orderType;
    const displayRestaurant = (order?.restaurants as any)?.name || restaurantName;

    const TypeIcon = displayType === "takeout" ? Truck
        : displayType === "pre_order" ? Clock
            : UtensilsCrossed;

    const typeLabel = displayType === "takeout" ? "Takeout"
        : displayType === "pre_order" ? "Pre-Order"
            : "Dine In";

    return (
        <View style={{ flex: 1, backgroundColor: "#0f0f0f" }}>
            <SafeAreaView style={{ flex: 1 }} edges={["top", "bottom"]}>
                {/* Header */}
                <View style={{ flexDirection: "row", alignItems: "center", paddingHorizontal: 20, paddingTop: 8, paddingBottom: 8 }}>
                    <Pressable
                        onPress={handleGoHome}
                        style={{
                            backgroundColor: "#1a1a1a",
                            width: 40,
                            height: 40,
                            borderRadius: 20,
                            alignItems: "center",
                            justifyContent: "center",
                            borderWidth: 1,
                            borderColor: "#2a2a2a",
                        }}
                    >
                        <ArrowLeft size={20} color="#f5f5f5" />
                    </Pressable>
                </View>

                <ScrollView
                    showsVerticalScrollIndicator={false}
                    contentContainerStyle={{ paddingBottom: 40 }}
                >
                    {/* Success Hero */}
                    <Animated.View
                        entering={FadeIn.duration(600)}
                        style={{ alignItems: "center", paddingTop: 24, paddingBottom: 32, paddingHorizontal: 24 }}
                    >
                        <View
                            style={{
                                width: 88,
                                height: 88,
                                borderRadius: 44,
                                backgroundColor: "rgba(34,197,94,0.12)",
                                borderWidth: 2,
                                borderColor: "rgba(34,197,94,0.4)",
                                alignItems: "center",
                                justifyContent: "center",
                                marginBottom: 20,
                            }}
                        >
                            <CheckCircle2 size={44} color="#22C55E" />
                        </View>
                        <Text
                            style={{
                                fontFamily: "BricolageGrotesque_800ExtraBold",
                                color: "#f5f5f5",
                                fontSize: 28,
                                textAlign: "center",
                                marginBottom: 8,
                                letterSpacing: -0.5,
                            }}
                        >
                            Payment Successful!
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
                            Your payment of{" "}
                            <Text style={{ fontFamily: "JetBrainsMono_600SemiBold", color: "#22C55E" }}>
                                ${displayTotal.toFixed(2)}
                            </Text>
                            {" "}to {displayRestaurant} was confirmed.
                        </Text>
                    </Animated.View>

                    <View style={{ paddingHorizontal: 20 }}>
                        {/* Order Type & Instructions */}
                        <Animated.View
                            entering={FadeInDown.delay(100).duration(500)}
                            style={{
                                backgroundColor: "#1a1a1a",
                                borderRadius: 20,
                                borderWidth: 1,
                                borderColor: "#2a2a2a",
                                padding: 20,
                                marginBottom: 14,
                            }}
                        >
                            <View style={{ flexDirection: "row", alignItems: "center", gap: 12, marginBottom: 14 }}>
                                <View
                                    style={{
                                        width: 44,
                                        height: 44,
                                        borderRadius: 22,
                                        backgroundColor: "rgba(255,153,51,0.12)",
                                        alignItems: "center",
                                        justifyContent: "center",
                                        borderWidth: 1,
                                        borderColor: "rgba(255,153,51,0.3)",
                                    }}
                                >
                                    <TypeIcon size={22} color="#FF9933" />
                                </View>
                                <View style={{ flex: 1 }}>
                                    <Text style={{ fontFamily: "BricolageGrotesque_700Bold", color: "#f5f5f5", fontSize: 17 }}>
                                        {typeLabel} Order
                                    </Text>
                                    <Text style={{ fontFamily: "Manrope_500Medium", color: "#777", fontSize: 13, marginTop: 2 }}>
                                        {displayRestaurant}
                                    </Text>
                                </View>
                            </View>

                            {/* Instructions Card */}
                            {displayType === "takeout" ? (
                                <View
                                    style={{
                                        backgroundColor: "rgba(255,153,51,0.08)",
                                        borderRadius: 14,
                                        borderWidth: 1,
                                        borderColor: "rgba(255,153,51,0.2)",
                                        padding: 16,
                                    }}
                                >
                                    <View style={{ flexDirection: "row", alignItems: "center", gap: 8, marginBottom: 8 }}>
                                        <MapPin size={15} color="#FF9933" />
                                        <Text style={{ fontFamily: "Manrope_700Bold", color: "#FF9933", fontSize: 14 }}>
                                            Pickup Instructions
                                        </Text>
                                    </View>
                                    <Text style={{ fontFamily: "Manrope_500Medium", color: "#ccc", fontSize: 13, lineHeight: 20 }}>
                                        Your order is being prepared. You&apos;ll be notified when it&apos;s ready for pickup. Head to the counter to collect your order. 🛍️
                                    </Text>
                                </View>
                            ) : (
                                <View
                                    style={{
                                        backgroundColor: "rgba(129,140,248,0.08)",
                                        borderRadius: 14,
                                        borderWidth: 1,
                                        borderColor: "rgba(129,140,248,0.2)",
                                        padding: 16,
                                    }}
                                >
                                    <View style={{ flexDirection: "row", alignItems: "center", gap: 8, marginBottom: 8 }}>
                                        <UtensilsCrossed size={15} color="#818CF8" />
                                        <Text style={{ fontFamily: "Manrope_700Bold", color: "#818CF8", fontSize: 14 }}>
                                            Seating Info
                                        </Text>
                                    </View>
                                    <Text style={{ fontFamily: "Manrope_500Medium", color: "#ccc", fontSize: 13, lineHeight: 20 }}>
                                        Your order has been sent to the kitchen. You&apos;ll be seated shortly — your food will arrive at your table. Enjoy your meal! 🍽️
                                    </Text>
                                </View>
                            )}
                        </Animated.View>

                        {/* Order Details */}
                        <Animated.View
                            entering={FadeInDown.delay(200).duration(500)}
                            style={{
                                backgroundColor: "#1a1a1a",
                                borderRadius: 20,
                                borderWidth: 1,
                                borderColor: "#2a2a2a",
                                padding: 20,
                                marginBottom: 14,
                            }}
                        >
                            <View style={{ flexDirection: "row", justifyContent: "space-between", alignItems: "center", marginBottom: 14 }}>
                                <Text style={{ fontFamily: "BricolageGrotesque_700Bold", color: "#f5f5f5", fontSize: 16 }}>
                                    Order Summary
                                </Text>
                                {orderId && (
                                    <Text style={{ fontFamily: "JetBrainsMono_600SemiBold", color: "#555", fontSize: 11 }}>
                                        #{orderId}
                                    </Text>
                                )}
                            </View>

                            {loading ? (
                                <ActivityIndicator color="#FF9933" style={{ paddingVertical: 20 }} />
                            ) : items.length > 0 ? (
                                items.map((item, idx) => (
                                    <View
                                        key={item.id || idx}
                                        style={{
                                            flexDirection: "row",
                                            justifyContent: "space-between",
                                            alignItems: "center",
                                            paddingVertical: 10,
                                            borderTopWidth: idx > 0 ? 1 : 0,
                                            borderTopColor: "#262626",
                                        }}
                                    >
                                        <View style={{ flex: 1 }}>
                                            <Text
                                                style={{ fontFamily: "Manrope_600SemiBold", color: "#f5f5f5", fontSize: 14 }}
                                                numberOfLines={1}
                                            >
                                                {item.quantity > 1 ? `${item.quantity}× ` : ""}{item.name}
                                            </Text>
                                        </View>
                                        <Text style={{ fontFamily: "JetBrainsMono_600SemiBold", color: "#999", fontSize: 13 }}>
                                            ${(Number(item.price) * item.quantity).toFixed(2)}
                                        </Text>
                                    </View>
                                ))
                            ) : (
                                <Text style={{ fontFamily: "Manrope_500Medium", color: "#666", fontSize: 13, textAlign: "center", paddingVertical: 12 }}>
                                    {orderId ? "Loading items…" : "Order details will appear in My Orders."}
                                </Text>
                            )}

                            {/* Total */}
                            <View
                                style={{
                                    flexDirection: "row",
                                    justifyContent: "space-between",
                                    alignItems: "center",
                                    paddingTop: 14,
                                    marginTop: 4,
                                    borderTopWidth: 1,
                                    borderTopColor: "#333",
                                }}
                            >
                                <Text style={{ fontFamily: "BricolageGrotesque_700Bold", color: "#f5f5f5", fontSize: 16 }}>
                                    Total Paid
                                </Text>
                                <Text style={{ fontFamily: "BricolageGrotesque_800ExtraBold", color: "#22C55E", fontSize: 20 }}>
                                    ${displayTotal.toFixed(2)}
                                </Text>
                            </View>

                            {/* Payment method badge */}
                            <View
                                style={{
                                    flexDirection: "row",
                                    alignItems: "center",
                                    gap: 6,
                                    backgroundColor: "rgba(34,197,94,0.08)",
                                    borderRadius: 10,
                                    paddingHorizontal: 10,
                                    paddingVertical: 6,
                                    marginTop: 12,
                                    alignSelf: "flex-start",
                                    borderWidth: 1,
                                    borderColor: "rgba(34,197,94,0.2)",
                                }}
                            >
                                <CheckCircle2 size={12} color="#22C55E" />
                                <Text style={{ fontFamily: "Manrope_600SemiBold", color: "#22C55E", fontSize: 12 }}>
                                    Paid with Card
                                </Text>
                            </View>
                        </Animated.View>

                        {/* Action Buttons */}
                        <Animated.View entering={FadeInDown.delay(300).duration(500)} style={{ gap: 10, marginTop: 8 }}>
                            <Pressable
                                onPress={handleViewOrders}
                                style={{
                                    backgroundColor: "#1a1a1a",
                                    borderRadius: 16,
                                    paddingVertical: 16,
                                    flexDirection: "row",
                                    alignItems: "center",
                                    justifyContent: "center",
                                    gap: 10,
                                    borderWidth: 1,
                                    borderColor: "#2a2a2a",
                                }}
                            >
                                <ShoppingBag size={18} color="#FF9933" />
                                <Text style={{ fontFamily: "BricolageGrotesque_700Bold", color: "#f5f5f5", fontSize: 16 }}>
                                    View My Orders
                                </Text>
                                <ChevronRight size={16} color="#666" />
                            </Pressable>

                            <Pressable
                                onPress={handleGoHome}
                                style={{
                                    backgroundColor: "#FF9933",
                                    borderRadius: 16,
                                    paddingVertical: 17,
                                    alignItems: "center",
                                    justifyContent: "center",
                                    shadowColor: "#FF9933",
                                    shadowOffset: { width: 0, height: 4 },
                                    shadowOpacity: 0.3,
                                    shadowRadius: 12,
                                    elevation: 8,
                                }}
                            >
                                <Text style={{ fontFamily: "BricolageGrotesque_700Bold", color: "#0f0f0f", fontSize: 17 }}>
                                    Done
                                </Text>
                            </Pressable>
                        </Animated.View>
                    </View>
                </ScrollView>
            </SafeAreaView>
        </View>
    );
}
