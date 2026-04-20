import React, { useState, useCallback, useEffect } from "react";
import {
    View,
    Text,
    Pressable,
    Modal,
    ScrollView,
    TextInput,
    Alert,
    ActivityIndicator,
    Platform,
    KeyboardAvoidingView,
} from "react-native";
import * as WebBrowser from "expo-web-browser";
import * as Linking from "expo-linking";
import { useRouter } from "expo-router";
import {
    X,
    UtensilsCrossed,
    ShoppingBag,
    Clock,
    Truck,
    Minus,
    Plus,
    ChevronRight,
    CheckCircle2,
    Leaf,
    CreditCard,
    Wallet,
} from "lucide-react-native";
import Animated, { FadeIn, FadeInDown } from "react-native-reanimated";
import * as Haptics from "expo-haptics";
import { supabase } from "@/lib/supabase";
import { useAuth } from "@/lib/auth-context";
import { useNotifications } from "@/lib/notifications-context";
import { isInvalidJwtEdgeFunctionError, parseEdgeFunctionError } from "@/lib/edge-function-error";
import { withTimeout } from "@/lib/with-timeout";
import { getCheckoutUrlOrThrow } from "@/lib/checkout-response";
import type { CartItem } from "@/data/mockData";
import type { OrderType } from "@/lib/restaurant-types";

interface CheckoutModalProps {
    visible: boolean;
    restaurantId: string;
    restaurantName: string;
    cartItems: CartItem[];
    onClose: () => void;
    onOrderPlaced: (orderId: string, orderType: OrderType) => void;
    onUpdateQuantity: (itemId: string, delta: number) => void;
    /** Pre-select the order type (e.g. 'takeout' from the picker) */
    initialOrderType?: 'dine_in' | 'takeout';
    /** Lock the order type — show read-only pill instead of toggle */
    lockOrderType?: boolean;
    /** Callback to close modal so user can add items from the menu */
    onAddMoreItems?: () => void;
    /** If customer is already on the waitlist — makes it a pre_order silently */
    waitlistEntryId?: string;
    /** If customer is already seated */
    isSeated?: boolean;
    existingOrderId?: string;
    /** Pre-fill customer name (e.g. from profiles table) */
    initialCustomerName?: string;
}

const PAYMENT_REQUEST_TIMEOUT_MS = 15000;

const S = {
    card: {
        backgroundColor: "#1a1a1a",
        borderWidth: 1,
        borderColor: "#2a2a2a",
        borderRadius: 16,
        padding: 16,
        marginBottom: 12,
    } as const,
    label: {
        fontFamily: "Manrope_600SemiBold",
        color: "#999",
        fontSize: 12,
        marginBottom: 6,
        textTransform: "uppercase" as const,
        letterSpacing: 0.5,
    },
    chip: (active: boolean, color = "#FF9933"): object => ({
        paddingHorizontal: 14,
        paddingVertical: 9,
        borderRadius: 20,
        borderWidth: 1,
        backgroundColor: active ? `${color}22` : "#0f0f0f",
        borderColor: active ? color : "#2a2a2a",
        marginRight: 8,
    }),
    chipText: (active: boolean, color = "#FF9933") => ({
        fontFamily: active ? "Manrope_700Bold" : "Manrope_500Medium",
        fontSize: 13,
        color: active ? color : "#777",
    }),
};

export function CheckoutModal({
    visible,
    restaurantId,
    restaurantName,
    cartItems,
    onClose,
    onOrderPlaced,
    onUpdateQuantity,
    initialOrderType,
    lockOrderType,
    onAddMoreItems,
    waitlistEntryId,
    isSeated = false,
    existingOrderId,
    initialCustomerName,
}: CheckoutModalProps) {
  const { session } = useAuth();
  const { addEvent } = useNotifications();
  const router = useRouter();

    // If we have a waitlist entry it's a silent pre_order; otherwise use initialOrderType or dine_in.
    const defaultType: OrderType = waitlistEntryId
        ? "pre_order"
        : (initialOrderType ?? "dine_in");

    const [orderType, setOrderType] = useState<OrderType>(defaultType);

    // Sync orderType and customerName when the modal opens
    useEffect(() => {
        if (visible) {
            const newType: OrderType = waitlistEntryId
                ? "pre_order"
                : (initialOrderType ?? "dine_in");
            setOrderType(newType);
            if (!customerName.trim()) {
                const fallback =
                    session?.user?.user_metadata?.full_name ||
                    session?.user?.user_metadata?.name ||
                    initialCustomerName ||
                    "";
                if (fallback) setCustomerName(fallback);
            }
        }
    }, [visible, initialOrderType, waitlistEntryId]);
    const [customerName, setCustomerName] = useState(initialCustomerName || "");
    const [tableNumber, setTableNumber] = useState("");
    const [notes, setNotes] = useState("");
    const [placing, setPlacing] = useState(false);
    const [done, setDone] = useState(false);
    const [placedOrderId, setPlacedOrderId] = useState<string | null>(null);
    const [paymentMethod, setPaymentMethod] = useState<'cash' | 'card'>('cash');
    const [hasStripe, setHasStripe] = useState(false);
    const [stripeAccountId, setStripeAccountId] = useState<string | null>(null);

    // Takeout orders are cash-only by policy — pickup happens at the
    // counter so the customer hands payment over there. We force cash
    // whenever the order type is takeout to avoid customers reaching
    // the Stripe sheet for a payment we don't want to process online.
    const lockToCash = orderType === 'takeout';
    useEffect(() => {
        if (lockToCash && paymentMethod !== 'cash') {
            setPaymentMethod('cash');
        }
    }, [lockToCash, paymentMethod]);

    const subtotal = cartItems.reduce((s, i) => s + i.price * i.quantity, 0);

    const reset = useCallback(() => {
        setOrderType(defaultType);
        setCustomerName(
            session?.user?.user_metadata?.full_name ||
            session?.user?.user_metadata?.name ||
            initialCustomerName ||
            ""
        );
        setTableNumber("");
        setNotes("");
        setPlacing(false);
        setDone(false);
        setPlacedOrderId(null);
        setPaymentMethod('cash');
    }, [defaultType, session, initialCustomerName]);

    const handleClose = () => {
        reset();
        onClose();
    };

    // Fetch the restaurant's Stripe account when the modal opens
    useEffect(() => {
        if (!visible || !restaurantId) return;
        let cancelled = false;
        (async () => {
            try {
                const { data } = await supabase
                    .from('restaurants')
                    .select('stripe_account_id')
                    .eq('id', Number(restaurantId))
                    .maybeSingle();
                if (cancelled) return;
                if (data?.stripe_account_id) {
                    setHasStripe(true);
                    setStripeAccountId(data.stripe_account_id);
                } else {
                    setHasStripe(false);
                    setStripeAccountId(null);
                    setPaymentMethod('cash');
                }
            } catch {
                if (cancelled) return;
                setHasStripe(false);
                setStripeAccountId(null);
                setPaymentMethod('cash');
            }
        })();
        return () => { cancelled = true; };
    }, [visible, restaurantId]);

    // Deep link handler for card payment redirect
    useEffect(() => {
        if (!visible || paymentMethod !== 'card') return;

        const handleUrl = (event: { url: string }) => {
            const { path, queryParams } = Linking.parse(event.url);
            if (path === 'order-confirmation') {
                try { WebBrowser.dismissBrowser(); } catch { }
                const params = queryParams as any;
                setDone(true);
                setPlacedOrderId(params?.order_id || null);
                if (Platform.OS !== 'web') Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
                onOrderPlaced(params?.order_id || '', orderType);
            } else if (path === 'checkout/cancel') {
                try { WebBrowser.dismissBrowser(); } catch { }
                setPlacing(false);
                if (Platform.OS !== 'web') Haptics.notificationAsync(Haptics.NotificationFeedbackType.Warning);
                Alert.alert('Payment Cancelled', 'Your payment was not processed. No charges were made.');
            } else if (path === 'checkout/error') {
                try { WebBrowser.dismissBrowser(); } catch { }
                setPlacing(false);
                if (Platform.OS !== 'web') Haptics.notificationAsync(Haptics.NotificationFeedbackType.Error);
                Alert.alert('Payment Error', 'Something went wrong. Please try again.');
            }
        };

        const subscription = Linking.addEventListener('url', handleUrl);
        return () => subscription.remove();
    }, [visible, paymentMethod, orderType, onOrderPlaced]);

    const handlePlaceOrder = async () => {
        if (placing) return;
        if (cartItems.length === 0) {
            Alert.alert("Empty Cart", "Add some items before placing an order.");
            return;
        }
        if (!session?.user?.id) {
            Alert.alert("Sign In Required", "Please sign in to place an order.");
            return;
        }

        if (Platform.OS !== "web") Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Heavy);
        setPlacing(true);

        try {
            // ── Card Payment Flow ──
            if (paymentMethod === 'card' && stripeAccountId) {
                const cartMeta = cartItems.map((i) => ({
                    name: i.name,
                    price: i.price,
                    quantity: i.quantity,
                    menu_item_id: Number(i.id),
                    is_vegetarian: i.isVegetarian ?? false,
                    added_by: customerName.trim() || '',
                }));

                const isWeb = Platform.OS === ('web' as any);
                const returnUrlBase = isWeb
                    ? window.location.origin
                    : Linking.createURL('');

                const requestBody = {
                    restaurant_id: Number(restaurantId),
                    amount: subtotal,
                    cart_items: cartMeta,
                    restaurant_name: restaurantName,
                    customer_name: customerName.trim(),
                    order_type: orderType,
                    return_url_base: returnUrlBase,
                };
                const invokeCreateCheckout = (authToken: string) =>
                    withTimeout(
                        supabase.functions.invoke(
                            "create-checkout",
                            {
                                body: requestBody,
                                headers: {
                                    Authorization: `Bearer ${authToken}`,
                                },
                            }
                        ),
                        PAYMENT_REQUEST_TIMEOUT_MS,
                        "Request timed out while creating checkout. Please try again."
                    );

                const { data: sessionData, error: sessionErr } = await withTimeout(
                    supabase.auth.getSession(),
                    PAYMENT_REQUEST_TIMEOUT_MS,
                    "Request timed out while validating your session. Please reopen the app and try again."
                );
                const accessToken = sessionData?.session?.access_token;
                if (sessionErr || !accessToken) {
                    throw new Error("Authentication session unavailable. Please reopen the app and try again.");
                }

                let { data: fnData, error: fnError } = await invokeCreateCheckout(accessToken);

                if (fnError) {
                    const fnErrorDetails = await parseEdgeFunctionError(fnError);
                    if (isInvalidJwtEdgeFunctionError(fnErrorDetails)) {
                        const { data: sessionData, error: sessionErr } = await withTimeout(
                            supabase.auth.getSession(),
                            PAYMENT_REQUEST_TIMEOUT_MS,
                            "Request timed out while validating your session. Please reopen the app and try again."
                        );
                        const retryToken = sessionData?.session?.access_token;
                        if (sessionErr || !retryToken) {
                            throw new Error('Authentication session unavailable. Please reopen the app and try again.');
                        }

                        const retryResult = await invokeCreateCheckout(retryToken);
                        fnData = retryResult.data;
                        fnError = retryResult.error;
                    }
                }

                if (fnError) throw fnError;
                if (fnData?.error) {
                    const inlineErr = new Error(String(fnData.error)) as Error & { code?: string; title?: string };
                    if (fnData.code) inlineErr.code = String(fnData.code);
                    if (fnData.title) inlineErr.title = String(fnData.title);
                    throw inlineErr;
                }

                const checkoutUrl = getCheckoutUrlOrThrow(fnData);

                if (isWeb) {
                    // Standard redirect for Web instances (PWA / browser)
                    // Stripe natively handles redirecting back using the provided return_url_base
                    window.location.href = checkoutUrl;
                    return;
                }

                // Avoid button-lock if auth session never resolves.
                setPlacing(false);

                // Native flow using Expo WebBrowser
                const result = await WebBrowser.openAuthSessionAsync(
                    checkoutUrl,
                    returnUrlBase
                );

                if (result.type === 'success' && result.url) {
                    const rawUrl = result.url;
                    // Parse query params robustly
                    const qIndex = rawUrl.indexOf('?');
                    const qString = qIndex >= 0 ? rawUrl.slice(qIndex + 1) : '';
                    const sp = new URLSearchParams(qString);
                    const params = {
                        order_id: sp.get('order_id') || '',
                        restaurant_name: sp.get('restaurant_name') || restaurantName,
                        order_type: sp.get('order_type') || orderType,
                        total: sp.get('total') || subtotal.toFixed(2),
                        party_session_id: sp.get('party_session_id') || '',
                    };

                    if (rawUrl.includes('order-confirmation') || sp.get('checkout_status') === 'success') {
                        if (Platform.OS !== 'web') Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
                        void addEvent({
                          type: "order_placed",
                          restaurantName: restaurantName || "Restaurant",
                          restaurantId: String(restaurantId),
                          entryId: params.order_id || `checkout-${Date.now()}`,
                          partySize: 1,
                          timestamp: new Date().toISOString(),
                          title: "Order Alert",
                          message: `Order placed at ${restaurantName || "Restaurant"}`,
                          metadata: { status: "pending" },
                        });
                        onClose();
                        reset();
                        onOrderPlaced(params.order_id, orderType);
                        setTimeout(() => {
                            router.push({
                                pathname: '/order-confirmation' as any,
                                params,
                            });
                        }, 150);
                        return;
                    } else if (rawUrl.includes('checkout/cancel')) {
                        if (Platform.OS !== 'web') Haptics.notificationAsync(Haptics.NotificationFeedbackType.Warning);
                        Alert.alert('Payment Cancelled', 'Your payment was not processed. No charges were made.');
                    } else if (rawUrl.includes('checkout/error')) {
                        if (Platform.OS !== 'web') Haptics.notificationAsync(Haptics.NotificationFeedbackType.Error);
                        Alert.alert('Payment Error', 'Something went wrong. Please try again.');
                    } else {
                        // Unknown redirect — log and show alert for debugging
                        console.warn('[CheckoutModal] Unknown redirect URL');
                        Alert.alert('Payment Issue', 'We received an unexpected response. Please check your order status or try again.');
                    }
                }
                // User dismissed the browser manually or result.type === 'cancel'
                setPlacing(false);
                return;
            }

            // ── Cash Payment Flow (existing) ──
            let orderId: string;

            if (existingOrderId) {
                orderId = existingOrderId;
                const newItems = cartItems.map((i) => ({
                    order_id: Number(existingOrderId),
                    menu_item_id: Number(i.id),
                    name: i.name,
                    price: i.price,
                    quantity: i.quantity,
                    is_vegetarian: i.isVegetarian,
                }));
                const { error: itemsErr } = await supabase.from("order_items").insert(newItems);
                if (itemsErr) throw itemsErr;

                const { data: allItems } = await supabase
                    .from("order_items")
                    .select("price, quantity")
                    .eq("order_id", Number(existingOrderId));
                const newSubtotal = (allItems || []).reduce(
                    (s: number, i: any) => s + Number(i.price) * i.quantity,
                    0
                );
                const { error: updErr } = await supabase
                    .from("orders")
                    .update({ subtotal: newSubtotal })
                    .eq("id", Number(existingOrderId));
                if (updErr) throw updErr;
            } else {
                const { data: orderData, error: orderErr } = await supabase
                    .from("orders")
                    .insert({
                        restaurant_id: Number(restaurantId),
                        table_number: null,
                        party_size: 1,
                        order_type: orderType,
                        status:
                            orderType === "takeout"
                                ? "preparing"
                                : "pending",
                        meal_period: "dinner",
                        subtotal,
                        tip_amount: 0,
                        payment_method: "cash",
                        notes: notes.trim() || null,
                        waitlist_entry_id: waitlistEntryId || null,
                        customer_name: customerName.trim() || null,
                        created_by: session.user.id,
                    })
                    .select("id")
                    .single();

                if (orderErr) throw orderErr;
                orderId = orderData.id.toString();

                const items = cartItems.map((i) => ({
                    order_id: orderData.id,
                    menu_item_id: Number(i.id),
                    name: i.name,
                    price: i.price,
                    quantity: i.quantity,
                    is_vegetarian: i.isVegetarian,
                }));
                const { error: itemsErr } = await supabase.from("order_items").insert(items);
                if (itemsErr) throw itemsErr;
            }

            if (Platform.OS !== "web") Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
            setPlacedOrderId(orderId);
            setDone(true);
            void addEvent({
                type: "order_placed",
                restaurantName: restaurantName || "Restaurant",
                restaurantId: String(restaurantId),
                entryId: orderId,
                partySize: 1,
                timestamp: new Date().toISOString(),
                title: "Order Alert",
                message: `Order placed at ${restaurantName || "Restaurant"}`,
                metadata: { status: "pending" },
            });
            onOrderPlaced(orderId, orderType);
        } catch (err: unknown) {
            const parsedError = await parseEdgeFunctionError(
                err,
                "Could not place your order. Please try again."
            );
            console.error("Order placement error:", parsedError.message);
            const alertTitle = parsedError.title
                || (parsedError.code === "restaurant_not_linked" ? "Checkout unavailable" : "Error");
            Alert.alert(alertTitle, parsedError.message);
        } finally {
            setPlacing(false);
        }
    };

    // ────────────────────────────────────────────────────────────
    // SUCCESS SCREEN
    // ────────────────────────────────────────────────────────────
    if (done) {
        return (
            <Modal visible={visible} transparent animationType="fade" onRequestClose={handleClose}>
                <View style={{ flex: 1, backgroundColor: "rgba(0,0,0,0.7)", justifyContent: "center", alignItems: "center", padding: 24 }}>
                    <Animated.View
                        entering={FadeIn.duration(400)}
                        style={{ backgroundColor: "#1a1a1a", borderRadius: 24, padding: 32, alignItems: "center", width: "100%", borderWidth: 1, borderColor: "#2a2a2a" }}
                    >
                        <CheckCircle2 size={56} color="#22C55E" style={{ marginBottom: 16 }} />
                        <Text style={{ fontFamily: "BricolageGrotesque_800ExtraBold", color: "#f5f5f5", fontSize: 26, marginBottom: 8, textAlign: "center" }}>
                            Order sent
                        </Text>
                        <Text style={{ fontFamily: "Manrope_500Medium", color: "#999", fontSize: 15, textAlign: "center", marginBottom: 4 }}>
                            {orderType === "takeout"
                                ? `${restaurantName} received your order and is preparing it.`
                                : orderType === "pre_order"
                                    ? `Your pre-order at ${restaurantName} is confirmed — it'll arrive with your table.`
                                    : `${restaurantName} has your order and the kitchen is on it.`}
                        </Text>
                        {orderType === "takeout" && (
                            <View style={{ backgroundColor: "rgba(255,153,51,0.1)", borderRadius: 12, padding: 12, marginTop: 12, borderWidth: 1, borderColor: "rgba(255,153,51,0.2)", width: "100%" }}>
                                <Text style={{ fontFamily: "Manrope_600SemiBold", color: "#FF9933", fontSize: 13, textAlign: "center" }}>
                                    You&apos;ll be notified when your order is ready for pickup 🛍️
                                </Text>
                            </View>
                        )}
                        <Text style={{ fontFamily: "JetBrainsMono_600SemiBold", color: "#555", fontSize: 12, marginTop: 16 }}>
                            Order #{placedOrderId}
                        </Text>
                        <Pressable
                            onPress={handleClose}
                            style={{ marginTop: 24, backgroundColor: "#FF9933", borderRadius: 14, paddingVertical: 14, paddingHorizontal: 32 }}
                        >
                            <Text style={{ fontFamily: "BricolageGrotesque_700Bold", color: "#0f0f0f", fontSize: 17 }}>Done</Text>
                        </Pressable>
                    </Animated.View>
                </View>
            </Modal>
        );
    }

    // ────────────────────────────────────────────────────────────
    // MAIN CHECKOUT SHEET
    // ────────────────────────────────────────────────────────────
    // Only show dine_in and takeout as user choices. pre_order is transparent (set via waitlistEntryId).
    const orderTypeOptions: { key: OrderType; label: string; icon: any; desc: string }[] = [
        { key: "dine_in", label: "Dine In", icon: UtensilsCrossed, desc: "At your table" },
        { key: "takeout", label: "Takeout", icon: Truck, desc: "Ready for pickup" },
    ];

    return (
        <Modal visible={visible} transparent animationType="slide" onRequestClose={handleClose}>
            <KeyboardAvoidingView style={{ flex: 1 }} behavior={Platform.OS === "ios" ? "padding" : undefined}>
                <View style={{ flex: 1, backgroundColor: "rgba(0,0,0,0.6)", justifyContent: "flex-end" }}>
                    <Pressable style={{ flex: 1 }} onPress={handleClose} />

                    <View
                        style={{
                            backgroundColor: "#0f0f0f",
                            borderTopLeftRadius: 28,
                            borderTopRightRadius: 28,
                            maxHeight: "92%",
                            borderTopWidth: 1,
                            borderTopColor: "#2a2a2a",
                        }}
                    >
                        {/* Handle */}
                        <View style={{ alignItems: "center", paddingTop: 12 }}>
                            <View style={{ width: 40, height: 4, borderRadius: 2, backgroundColor: "#2a2a2a" }} />
                        </View>

                        {/* Header */}
                        <View style={{ flexDirection: "row", alignItems: "center", justifyContent: "space-between", paddingHorizontal: 20, paddingVertical: 16 }}>
                            <View>
                                <Text style={{ fontFamily: "BricolageGrotesque_800ExtraBold", color: "#f5f5f5", fontSize: 24 }}>
                                    {existingOrderId ? "Add to Order" : "Checkout"}
                                </Text>
                                <Text style={{ fontFamily: "Manrope_500Medium", color: "#777", fontSize: 13, marginTop: 2 }}>
                                    {restaurantName}
                                </Text>
                            </View>
                            <Pressable onPress={handleClose} style={{ backgroundColor: "#1a1a1a", width: 38, height: 38, borderRadius: 19, alignItems: "center", justifyContent: "center", borderWidth: 1, borderColor: "#2a2a2a" }}>
                                <X size={18} color="#f5f5f5" />
                            </Pressable>
                        </View>

                        <ScrollView showsVerticalScrollIndicator={false} contentContainerStyle={{ padding: 20, paddingTop: 0, paddingBottom: 40 }}>

                            {/* ── Order Type ── */}
                            {!existingOrderId && (
                                <Animated.View entering={FadeInDown.delay(50).duration(400)} style={S.card}>
                                    <Text style={S.label}>Order Type</Text>
                                    {lockOrderType ? (
                                        /* Read-only pill when order type was pre-selected */
                                        <View style={{ flexDirection: "row", alignItems: "center", backgroundColor: "rgba(255,153,51,0.12)", borderRadius: 14, padding: 14, borderWidth: 1.5, borderColor: "#FF9933" }}>
                                            {orderType === "takeout" ? <Truck size={20} color="#FF9933" /> : <UtensilsCrossed size={20} color="#FF9933" />}
                                            <View style={{ marginLeft: 12 }}>
                                                <Text style={{ fontFamily: "BricolageGrotesque_700Bold", color: "#f5f5f5", fontSize: 16 }}>
                                                    {orderType === "takeout" ? "Takeout" : "Dine In"}
                                                </Text>
                                                <Text style={{ fontFamily: "Manrope_500Medium", color: "#FF9933", fontSize: 12, marginTop: 2 }}>
                                                    {orderType === "takeout" ? "Ready for pickup" : "At your table"}
                                                </Text>
                                            </View>
                                        </View>
                                    ) : (
                                        <View style={{ flexDirection: "row" }}>
                                            {orderTypeOptions.map(({ key, label, icon: Icon, desc }) => {
                                                const active = orderType === key;
                                                return (
                                                    <Pressable
                                                        key={key}
                                                        onPress={() => {
                                                            if (Platform.OS !== "web") Haptics.selectionAsync();
                                                            setOrderType(key);
                                                        }}
                                                        style={{
                                                            flex: 1,
                                                            marginRight: key !== "takeout" ? 8 : 0,
                                                            backgroundColor: active ? "rgba(255,153,51,0.12)" : "#0f0f0f",
                                                            borderRadius: 14,
                                                            borderWidth: 1.5,
                                                            borderColor: active ? "#FF9933" : "#2a2a2a",
                                                            padding: 12,
                                                            alignItems: "center",
                                                        }}
                                                    >
                                                        <Icon size={20} color={active ? "#FF9933" : "#666"} />
                                                        <Text style={{ fontFamily: "Manrope_700Bold", color: active ? "#FF9933" : "#f5f5f5", fontSize: 12, marginTop: 6 }}>{label}</Text>
                                                        <Text style={{ fontFamily: "Manrope_500Medium", color: "#666", fontSize: 10, marginTop: 2, textAlign: "center" }}>{desc}</Text>
                                                    </Pressable>
                                                );
                                            })}
                                        </View>
                                    )}
                                </Animated.View>
                            )}

                            {/* ── Customer Name ── */}
                            {!existingOrderId && (
                                <Animated.View entering={FadeInDown.delay(70).duration(400)} style={S.card}>
                                    <Text style={S.label}>Your Name</Text>
                                    <TextInput
                                        value={customerName}
                                        onChangeText={setCustomerName}
                                        placeholder="e.g. John Doe"
                                        placeholderTextColor="#555"
                                        style={{
                                            backgroundColor: "#0f0f0f",
                                            borderRadius: 12,
                                            borderWidth: 1,
                                            borderColor: customerName ? "#FF9933" : "#2a2a2a",
                                            paddingHorizontal: 14,
                                            paddingVertical: 12,
                                            color: "#f5f5f5",
                                            fontFamily: "Manrope_600SemiBold",
                                            fontSize: 15,
                                        }}
                                    />
                                </Animated.View>
                            )}

                            {/* ── Cart Items ── */}
                            <Animated.View entering={FadeInDown.delay(120).duration(400)} style={S.card}>
                                <Text style={S.label}>Your Items ({cartItems.reduce((s, i) => s + i.quantity, 0)})</Text>
                                {cartItems.length === 0 ? (
                                    <Pressable
                                        onPress={() => { if (Platform.OS !== "web") Haptics.selectionAsync(); onAddMoreItems?.(); }}
                                        style={{ alignItems: "center", paddingVertical: 20, backgroundColor: "#0f0f0f", borderRadius: 12, borderWidth: 1, borderColor: "#2a2a2a" }}
                                    >
                                        <Plus size={20} color="#FF9933" />
                                        <Text style={{ fontFamily: "Manrope_700Bold", color: "#FF9933", fontSize: 14, marginTop: 8 }}>Browse Menu & Add Items</Text>
                                        <Text style={{ fontFamily: "Manrope_500Medium", color: "#666", fontSize: 12, marginTop: 4 }}>Your cart is empty</Text>
                                    </Pressable>
                                ) : (
                                    cartItems.map((item, idx) => (
                                        <View
                                            key={item.id}
                                            style={{
                                                flexDirection: "row",
                                                alignItems: "center",
                                                paddingVertical: 10,
                                                borderBottomWidth: idx < cartItems.length - 1 ? 1 : 0,
                                                borderBottomColor: "#222",
                                            }}
                                        >
                                            <View style={{ flex: 1 }}>
                                                <View style={{ flexDirection: "row", alignItems: "center", gap: 6 }}>
                                                    <Text style={{ fontFamily: "Manrope_700Bold", color: "#f5f5f5", fontSize: 14, flex: 1 }} numberOfLines={1}>
                                                        {item.name}
                                                    </Text>
                                                    {item.isVegetarian && <Leaf size={12} color="#22C55E" />}
                                                </View>
                                                <Text style={{ fontFamily: "JetBrainsMono_600SemiBold", color: "#FF9933", fontSize: 13, marginTop: 2 }}>
                                                    ${(item.price * item.quantity).toFixed(2)}
                                                </Text>
                                            </View>
                                            {/* Quantity controls */}
                                            <View style={{ flexDirection: "row", alignItems: "center", backgroundColor: "#262626", borderRadius: 20, paddingHorizontal: 4, borderWidth: 1, borderColor: "#333" }}>
                                                <Pressable onPress={() => { if (Platform.OS !== "web") Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light); onUpdateQuantity(item.id, -1); }} style={{ padding: 7 }}>
                                                    <Minus size={13} color="#f5f5f5" />
                                                </Pressable>
                                                <Text style={{ fontFamily: "JetBrainsMono_600SemiBold", color: "#f5f5f5", fontSize: 13, minWidth: 22, textAlign: "center" }}>{item.quantity}</Text>
                                                <Pressable onPress={() => { if (Platform.OS !== "web") Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light); onUpdateQuantity(item.id, 1); }} style={{ padding: 7 }}>
                                                    <Plus size={13} color="#f5f5f5" />
                                                </Pressable>
                                            </View>
                                        </View>
                                    ))
                                )}
                            </Animated.View>

                            {/* ── Notes ── */}
                            <Animated.View entering={FadeInDown.delay(140).duration(400)} style={S.card}>
                                <Text style={S.label}>Special Instructions (optional)</Text>
                                <TextInput
                                    value={notes}
                                    onChangeText={setNotes}
                                    placeholder="Allergies, preferences, requests..."
                                    placeholderTextColor="#555"
                                    multiline
                                    numberOfLines={3}
                                    style={{
                                        backgroundColor: "#0f0f0f",
                                        borderRadius: 12,
                                        borderWidth: 1,
                                        borderColor: notes ? "#FF9933" : "#2a2a2a",
                                        paddingHorizontal: 14,
                                        paddingVertical: 12,
                                        color: "#f5f5f5",
                                        fontFamily: "Manrope_500Medium",
                                        fontSize: 14,
                                        minHeight: 72,
                                        textAlignVertical: "top",
                                    }}
                                />
                            </Animated.View>

                            {/* ── Summary ── */}
                            <Animated.View entering={FadeInDown.delay(160).duration(400)} style={{ ...S.card, marginBottom: 20 }}>
                                <View style={{ flexDirection: "row", justifyContent: "space-between", marginBottom: 8 }}>
                                    <Text style={{ fontFamily: "Manrope_600SemiBold", color: "#999", fontSize: 14 }}>Subtotal</Text>
                                    <Text style={{ fontFamily: "JetBrainsMono_600SemiBold", color: "#f5f5f5", fontSize: 16 }}>${subtotal.toFixed(2)}</Text>
                                </View>
                                <View style={{ marginTop: 4 }}>
                                    <Text style={{ ...S.label, marginBottom: 8 }}>Payment Method</Text>
                                    <View style={{ flexDirection: "row", gap: 8 }}>
                                        <Pressable
                                            onPress={() => {
                                                if (Platform.OS !== "web") Haptics.selectionAsync();
                                                setPaymentMethod('cash');
                                            }}
                                            style={{
                                                flex: 1,
                                                flexDirection: "row",
                                                alignItems: "center",
                                                justifyContent: "center",
                                                gap: 8,
                                                paddingVertical: 12,
                                                borderRadius: 12,
                                                borderWidth: 1.5,
                                                backgroundColor: paymentMethod === 'cash' ? 'rgba(34,197,94,0.12)' : '#0f0f0f',
                                                borderColor: paymentMethod === 'cash' ? '#22C55E' : '#2a2a2a',
                                            }}
                                        >
                                            <Wallet size={16} color={paymentMethod === 'cash' ? '#22C55E' : '#666'} />
                                            <Text style={{ fontFamily: paymentMethod === 'cash' ? 'Manrope_700Bold' : 'Manrope_500Medium', color: paymentMethod === 'cash' ? '#22C55E' : '#777', fontSize: 14 }}>
                                                Cash
                                            </Text>
                                        </Pressable>
                                        <Pressable
                                            onPress={() => {
                                                if (lockToCash) {
                                                    Alert.alert('Cash Only', 'Takeout orders are paid in cash at the counter when you pick up.');
                                                    return;
                                                }
                                                if (!hasStripe) {
                                                    Alert.alert('Card Not Available', 'This restaurant does not accept card payments yet.');
                                                    return;
                                                }
                                                if (Platform.OS !== "web") Haptics.selectionAsync();
                                                setPaymentMethod('card');
                                            }}
                                            style={{
                                                flex: 1,
                                                flexDirection: "row",
                                                alignItems: "center",
                                                justifyContent: "center",
                                                gap: 8,
                                                paddingVertical: 12,
                                                borderRadius: 12,
                                                borderWidth: 1.5,
                                                backgroundColor: paymentMethod === 'card' ? 'rgba(129,140,248,0.12)' : '#0f0f0f',
                                                borderColor: paymentMethod === 'card' ? '#818CF8' : '#2a2a2a',
                                                opacity: lockToCash || !hasStripe ? 0.5 : 1,
                                            }}
                                        >
                                            <CreditCard size={16} color={paymentMethod === 'card' ? '#818CF8' : '#666'} />
                                            <Text style={{ fontFamily: paymentMethod === 'card' ? 'Manrope_700Bold' : 'Manrope_500Medium', color: paymentMethod === 'card' ? '#818CF8' : '#777', fontSize: 14 }}>
                                                Card
                                            </Text>
                                        </Pressable>
                                    </View>
                                    {lockToCash && (
                                        <Text style={{ fontFamily: "Manrope_500Medium", color: "#888", fontSize: 12, marginTop: 8 }}>
                                            Takeout orders are paid in cash when you pick up.
                                        </Text>
                                    )}
                                </View>
                            </Animated.View>

                            {/* ── Place Order Button ── */}
                            <Pressable
                                onPress={handlePlaceOrder}
                                disabled={placing || cartItems.length === 0 || (!existingOrderId && !customerName.trim())}
                                style={{
                                    backgroundColor: (cartItems.length === 0 || (!existingOrderId && !customerName.trim())) ? "#333" : "#FF9933",
                                    borderRadius: 18,
                                    paddingVertical: 17,
                                    alignItems: "center",
                                    flexDirection: "row",
                                    justifyContent: "center",
                                    gap: 10,
                                    opacity: placing ? 0.8 : 1,
                                    shadowColor: "#FF9933",
                                    shadowOffset: { width: 0, height: 4 },
                                    shadowOpacity: cartItems.length > 0 ? 0.3 : 0,
                                    shadowRadius: 12,
                                    elevation: cartItems.length > 0 ? 8 : 0,
                                }}
                            >
                                {placing ? (
                                    <ActivityIndicator color="#0f0f0f" />
                                ) : (
                                    <>
                                        {paymentMethod === 'card'
                                            ? <CreditCard size={18} color="#0f0f0f" />
                                            : orderType === "takeout"
                                                ? <Truck size={18} color="#0f0f0f" />
                                                : orderType === "pre_order"
                                                    ? <Clock size={18} color="#0f0f0f" />
                                                    : <ShoppingBag size={18} color="#0f0f0f" />}
                                        <Text style={{ fontFamily: "BricolageGrotesque_700Bold", color: "#0f0f0f", fontSize: 17 }}>
                                            {existingOrderId
                                                ? `Add Items · $${subtotal.toFixed(2)}`
                                                : paymentMethod === 'card'
                                                    ? `Pay with Card · $${subtotal.toFixed(2)}`
                                                    : orderType === "takeout"
                                                        ? `Place Takeout · $${subtotal.toFixed(2)}`
                                                        : orderType === "pre_order"
                                                            ? `Pre-Order · $${subtotal.toFixed(2)}`
                                                            : `Place Order · $${subtotal.toFixed(2)}`}
                                        </Text>
                                    </>
                                )}
                            </Pressable>
                        </ScrollView>
                    </View>
                </View>
            </KeyboardAvoidingView>
        </Modal>
    );
}
