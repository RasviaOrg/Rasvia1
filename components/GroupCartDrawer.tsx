import React from "react";
import {
  View,
  Text,
  Pressable,
  Image,
  ScrollView,
  Dimensions,
  Platform,
} from "react-native";
import { X, Minus, Plus, Users, Share2, Clock, ShoppingBag } from "lucide-react-native";
import type { CartItem, GroupMember } from "@/data/mockData";
import { resolveStripeProductTaxCode } from "@/lib/restaurant-types";
import * as Haptics from "expo-haptics";
import { useAppTheme } from "@/lib/app-theme";
import { TaxEstimateLine } from "@/components/TaxEstimateLine";
import { formatCentsUsd } from "@/lib/texas-sales-tax-estimate";
import { useCartTax } from "@/hooks/useCartTax";
import Animated, {
  FadeIn,
  FadeInLeft,
  SlideInDown,
  useAnimatedStyle,
  useSharedValue,
  withSpring,
} from "react-native-reanimated";

let SCREEN_HEIGHT = Dimensions.get("window").height;
Dimensions.addEventListener("change", ({ window }) => { SCREEN_HEIGHT = window.height; });



interface GroupCartDrawerProps {
  items: CartItem[];
  members: GroupMember[];
  onClose: () => void;
  onUpdateQuantity: (itemId: string, delta: number) => void;
  onShare: () => void;
  onCheckout: () => void;
  isGroupMode?: boolean;
  isClosed?: boolean;
  /** Restaurant ID needed for the server-side tax quote. */
  restaurantId: number;
}

export function GroupCartDrawer({
  items,
  members,
  onClose,
  onUpdateQuantity,
  onShare,
  onCheckout,
  isGroupMode = false,
  isClosed = false,
  restaurantId,
}: GroupCartDrawerProps) {
  const { colors, isDark } = useAppTheme();
  const totalQuantity = items.reduce((sum, item) => sum + Math.max(0, Number(item.quantity ?? 0)), 0);
  const subtotal = items.reduce((sum, item) => sum + item.price * item.quantity, 0);
  const cartIsEmpty = totalQuantity <= 0 || subtotal <= 0;
  const checkoutDisabled = isClosed || cartIsEmpty;

  const taxItems = React.useMemo(() => {
    return items.map((r) => ({
      price_cents: Math.round(r.price * 100),
      quantity: r.quantity,
      stripe_tax_code: resolveStripeProductTaxCode(r as CartItem),
    }));
  }, [items]);

  const { taxCents, loading: taxLoading } = useCartTax(restaurantId, taxItems);
  
  const estTotalCents = taxCents !== null ? Math.round(subtotal * 100) + taxCents : null;
  const estTotalLabel = estTotalCents !== null ? formatCentsUsd(estTotalCents) : "loading...";

  const checkoutScale = useSharedValue(1);
  const checkoutStyle = useAnimatedStyle(() => ({
    transform: [{ scale: checkoutScale.value }],
  }));

  const handleCheckout = () => {
    if (checkoutDisabled) return;
    if (Platform.OS !== "web") {
      Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Heavy);
    }
    onCheckout();
  };

  return (
    <Animated.View
      entering={SlideInDown.duration(500).springify()}
      style={{
        position: "absolute",
        bottom: 0,
        left: 0,
        right: 0,
        backgroundColor: colors.card,
        borderTopLeftRadius: 28,
        borderTopRightRadius: 28,
        maxHeight: SCREEN_HEIGHT * 0.82,
        shadowColor: "#000",
        shadowOffset: { width: 0, height: -8 },
        shadowOpacity: isDark ? 0.4 : 0.12,
        shadowRadius: 24,
        elevation: 20,
        borderTopWidth: 1,
        borderTopColor: colors.cardBorder,
      }}
    >
      {/* Drag Handle */}
      <View style={{ alignItems: "center", paddingTop: 12, paddingBottom: 8 }}>
        <View style={{ width: 40, height: 4, borderRadius: 2, backgroundColor: colors.cardBorder }} />
      </View>

      {/* Header */}
      <View style={{ flexDirection: "row", alignItems: "center", justifyContent: "space-between", paddingHorizontal: 20, paddingBottom: 16 }}>
        <View>
          <Text style={{ fontFamily: "BricolageGrotesque_800ExtraBold", color: colors.text, fontSize: 22 }}>
            {isGroupMode ? "Group Cart" : "Your Cart"}
          </Text>
          <Text style={{ fontFamily: "Manrope_500Medium", color: colors.textMuted, fontSize: 13, marginTop: 2 }}>
            {isGroupMode
              ? `${items.length} items · ${members.length} members`
              : `${items.length} item${items.length !== 1 ? "s" : ""}`}
          </Text>
        </View>
        <View style={{ flexDirection: "row", alignItems: "center" }}>
          {isGroupMode && (
            <Pressable
              onPress={onShare}
              style={{
                backgroundColor: colors.pressableBg,
                width: 40,
                height: 40,
                borderRadius: 20,
                alignItems: "center",
                justifyContent: "center",
                marginRight: 10,
                borderWidth: 1,
                borderColor: colors.cardBorder,
              }}
            >
              <Share2 size={18} color="#FF9933" />
            </Pressable>
          )}
          <Pressable
            onPress={onClose}
            style={{
              backgroundColor: colors.pressableBg,
              width: 40,
              height: 40,
              borderRadius: 20,
              alignItems: "center",
              justifyContent: "center",
              borderWidth: 1,
              borderColor: colors.cardBorder,
            }}
          >
            <X size={18} color={colors.text} />
          </Pressable>
        </View>
      </View>

      {/* Member Avatars — only in group mode */}
      {isGroupMode && members.length > 0 && (
        <View style={{ paddingHorizontal: 20, paddingBottom: 14 }}>
          <View style={{ flexDirection: "row", alignItems: "center" }}>
            {members.map((member, index) => (
              <Animated.View
                key={member.id}
                entering={FadeInLeft.delay(index * 80).duration(400)}
                style={{ marginRight: -8, zIndex: members.length - index }}
              >
                <Image
                  source={{ uri: member.avatar }}
                  style={{
                    width: 36,
                    height: 36,
                    borderRadius: 18,
                    borderWidth: 2,
                    borderColor: member.color,
                  }}
                />
              </Animated.View>
            ))}
            <View
              style={{
                width: 36,
                height: 36,
                borderRadius: 18,
                backgroundColor: colors.pressableBg,
                borderWidth: 2,
                borderColor: colors.cardBorder,
                alignItems: "center",
                justifyContent: "center",
              }}
            >
              <Users size={14} color={colors.iconMuted} />
            </View>
          </View>
        </View>
      )}

      {/* Items — scrollable, flex to fill remaining space */}
      <ScrollView
        style={{ flex: 1 }}
        contentContainerStyle={{ paddingHorizontal: 20, paddingBottom: 8 }}
        showsVerticalScrollIndicator={false}
        bounces
      >
        {items.map((item, index) => (
          <Animated.View
            key={item.id}
            entering={FadeIn.delay(index * 60).duration(400)}
            style={{
              flexDirection: "row",
              alignItems: "center",
              paddingVertical: 12,
              borderBottomWidth: index < items.length - 1 ? 1 : 0,
              borderBottomColor: colors.cardBorder,
            }}
          >
            <Image
              source={{ uri: item.image }}
              style={{ width: 52, height: 52, borderRadius: 12, backgroundColor: colors.pressableBg }}
            />
            <View style={{ flex: 1, marginLeft: 12 }}>
              <View style={{ flexDirection: "row", alignItems: "center" }}>
                <Text
                  style={{ fontFamily: "Manrope_700Bold", color: colors.text, fontSize: 14, flex: 1 }}
                  numberOfLines={1}
                >
                  {item.name}
                </Text>
                {/* Only show member avatar in group mode */}
                {isGroupMode && item.addedBy && (
                  <Image
                    source={{ uri: item.addedBy.avatar }}
                    style={{
                      width: 22,
                      height: 22,
                      borderRadius: 11,
                      borderWidth: 1.5,
                      borderColor: item.addedBy.color,
                      marginLeft: 6,
                    }}
                  />
                )}
              </View>
              <View style={{ flexDirection: "row", alignItems: "center", justifyContent: "space-between", marginTop: 6 }}>
                <Text style={{ fontFamily: "JetBrainsMono_600SemiBold", color: "#FF9933", fontSize: 13 }}>
                  ${(item.price * item.quantity).toFixed(2)}
                </Text>
                <View style={{ flexDirection: "row", alignItems: "center", backgroundColor: colors.pressableBg, borderRadius: 20, paddingHorizontal: 4, borderWidth: 1, borderColor: colors.cardBorder }}>
                  <Pressable
                    onPress={() => {
                      if (Platform.OS !== "web") Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
                      onUpdateQuantity(item.id, -1);
                    }}
                    style={{ padding: 8 }}
                  >
                    <Minus size={14} color={colors.text} />
                  </Pressable>
                  <Text style={{ fontFamily: "JetBrainsMono_600SemiBold", color: colors.text, fontSize: 13, minWidth: 20, textAlign: "center" }}>
                    {item.quantity}
                  </Text>
                  <Pressable
                    onPress={() => {
                      if (Platform.OS !== "web") Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
                      onUpdateQuantity(item.id, 1);
                    }}
                    style={{ padding: 8 }}
                  >
                    <Plus size={14} color={colors.text} />
                  </Pressable>
                </View>
              </View>
            </View>
          </Animated.View>
        ))}
      </ScrollView>

      {/* Footer */}
      <View style={{ paddingHorizontal: 20, paddingTop: 16, paddingBottom: Platform.OS === "ios" ? 36 : 24, borderTopWidth: 1, borderTopColor: colors.cardBorder }}>
        <Text style={{ fontFamily: "Manrope_600SemiBold", color: colors.textMuted, fontSize: 12, letterSpacing: 0.6, marginBottom: 8 }}>
          Order summary
        </Text>
        <View style={{ marginBottom: 14 }}>
          <TaxEstimateLine
            subtotalDollars={subtotal}
            taxCents={taxCents}
            showSubtotal
            showTotal
            totalHero
          />
        </View>

        <Animated.View style={checkoutStyle}>
          <Pressable
            onPress={handleCheckout}
            disabled={checkoutDisabled}
            onPressIn={() => {
              if (!checkoutDisabled) checkoutScale.value = withSpring(0.96);
            }}
            onPressOut={() => {
              if (!checkoutDisabled) checkoutScale.value = withSpring(1);
            }}
            style={{
              borderRadius: 18,
              paddingVertical: 16,
              alignItems: "center",
              flexDirection: "row",
              justifyContent: "center",
              gap: 8,
              backgroundColor: checkoutDisabled ? colors.backgroundElevated : (isDark ? "#FF9933" : "#fb923c"),
              opacity: checkoutDisabled ? 0.92 : 1,
              shadowColor: checkoutDisabled ? "transparent" : "#FF9933",
              shadowOffset: { width: 0, height: 4 },
              shadowOpacity: checkoutDisabled ? 0 : 0.35,
              shadowRadius: 12,
              elevation: checkoutDisabled ? 0 : 8,
              borderWidth: checkoutDisabled ? 1 : 0,
              borderColor: checkoutDisabled ? colors.cardBorder : "transparent",
            }}
          >
            {checkoutDisabled ? (
              <Clock size={16} color={colors.textMuted} />
            ) : (
              <ShoppingBag size={18} color={isDark ? "#0f0f0f" : "#ffffff"} strokeWidth={2.5} />
            )}
            <Text style={{ fontFamily: "BricolageGrotesque_700Bold", color: checkoutDisabled ? colors.textMuted : (isDark ? "#0f0f0f" : "#ffffff"), fontSize: 17 }}>
              {cartIsEmpty
                ? "Cart empty"
                : isClosed
                ? "Currently Closed"
                : isGroupMode
                ? `Place Group Order · ${estTotalLabel}`
                : `Checkout ${estTotalLabel}`}
            </Text>
          </Pressable>
        </Animated.View>
      </View>
    </Animated.View>
  );
}
