import { useState, useEffect, useRef, useCallback } from "react";
import {
  View,
  Text,
  Pressable,
  ScrollView,
  Share,
  ActivityIndicator,
  Alert,
  Platform,
  TextInput,
  Image,
} from "react-native";
import * as ExpoClipboard from "expo-clipboard";
import { SafeAreaView } from "react-native-safe-area-context";
import { useRouter, useLocalSearchParams } from "expo-router";
import { Stack } from "expo-router";
import {
  ArrowLeft,
  Users,
  ChevronRight,
  Copy,
  Check,
  Share2,
  UtensilsCrossed,
  Search,
  Clock,
  MapPin,
  AlertCircle,
  Crown,
} from "lucide-react-native";
import Animated, { FadeInDown, FadeIn } from "react-native-reanimated";
import * as Haptics from "expo-haptics";
import AsyncStorage from "@react-native-async-storage/async-storage";
import QRCode from "react-native-qrcode-svg";
import { supabase } from "../lib/supabase";
import { useAuth } from "../lib/auth-context";
import { useNotifications } from "../lib/notifications-context";
import { useLocation } from "../lib/location-context";
import { haversineDistance } from "../lib/restaurant-types";
import { useClosedRestaurantIds } from "../hooks/useClosedRestaurantIds";
import { useAdminMode } from "../hooks/useAdminMode";

interface Restaurant {
  id: number;
  name: string;
  cuisine_tags: string[];
  image_url: string | null;
  current_wait_time: number | null;
  lat: number | null;
  long: number | null;
}

type SortOption = "none" | "waitTime" | "distance";

type Step = "select" | "starting" | "created";
const GROUP_ORDER_WEB_BASE_URL = "http://192.168.1.96:5173";

export default function HostPartyScreen() {
  const router = useRouter();
  const { session } = useAuth();
  const { addEvent } = useNotifications();
  const { userCoords } = useLocation();
  const closedRestaurantIds = useClosedRestaurantIds();
  const { restaurantId: paramRestaurantId } = useLocalSearchParams<{ restaurantId?: string }>();
  const { isRestaurantOwner } = useAdminMode();

  // Restaurant owners cannot host or join group orders
  useEffect(() => {
    if (isRestaurantOwner) {
      Alert.alert("Not Available", "Restaurant owners can't participate in group orders.", [
        { text: "OK", onPress: () => { if (router.canGoBack()) router.back(); else router.replace("/"); } },
      ]);
    }
  }, [isRestaurantOwner]);

  const currentUserId = session?.user?.id;
  const activeOrderKey = currentUserId
    ? `rasvia:active_group_order:${currentUserId}`
    : null;

  const [step, setStep] = useState<Step>("select");
  const [restaurants, setRestaurants] = useState<Restaurant[]>([]);
  const [loadingRestaurants, setLoadingRestaurants] = useState(true);
  const [selectedRestaurant, setSelectedRestaurant] =
    useState<Restaurant | null>(null);
  const [sessionId, setSessionId] = useState<string | null>(null);
  const [shareUrl, setShareUrl] = useState<string>("");
  const [copied, setCopied] = useState(false);
  const [search, setSearch] = useState("");
  const [sortBy, setSortBy] = useState<SortOption>("none");
  const [existingSession, setExistingSession] = useState<{
    id: string;
    restaurantName: string;
  } | null>(null);
  const [checkingExisting, setCheckingExisting] = useState(true);
  const autoStartFiredRef = useRef(false);

  useEffect(() => {
    checkExistingSession();
    fetchRestaurants();
  }, []);

  // Auto-start a group order when a restaurantId param is provided
  useEffect(() => {
    if (!paramRestaurantId || autoStartFiredRef.current) return;
    if (!session?.user?.id) return;
    if (checkingExisting) return; // wait until we know if there's an existing session

    autoStartFiredRef.current = true;

    const run = async () => {
      const { data, error } = await supabase
        .from("restaurants")
        .select("id, name, cuisine_tags, image_url, current_wait_time, lat, long")
        .eq("id", paramRestaurantId)
        .single();

      if (error || !data) {
        Alert.alert("Error", "Could not load restaurant info.");
        return;
      }

      const r = data as Restaurant;

      if (closedRestaurantIds.has(String(r.id))) {
        Alert.alert("Restaurant Closed", `${r.name} is currently closed and cannot accept group orders.`);
        return;
      }

      setSelectedRestaurant(r);
      // handleStart reads selectedRestaurant from state, but since we're in an effect,
      // we call the creation logic inline here to avoid stale-closure issues.
      if (existingSession) {
        Alert.alert(
          "Active Order Exists",
          `You already have an open group order at ${existingSession.restaurantName}. Cancel it or go to it first.`,
          [
            { text: "Go to Order", onPress: () => router.push(`/join/${existingSession.id}` as any) },
            { text: "Dismiss", style: "cancel" },
          ]
        );
        return;
      }

      setStep("starting");
      if (Platform.OS !== "web") Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Medium);

      try {
        const { data: sess, error: sessErr } = await supabase
          .from("party_sessions")
          .insert({
            restaurant_id: r.id,
            host_user_id: session!.user.id,
            status: "open",
          })
          .select()
          .single();

        if (sessErr) throw sessErr;

        const url = `${GROUP_ORDER_WEB_BASE_URL}/join?id=${sess.id}`;
        setSessionId(sess.id);
        setShareUrl(url);
        setStep("created");

        if (activeOrderKey) {
          await AsyncStorage.setItem(
            activeOrderKey,
            JSON.stringify({
              sessionId: sess.id,
              restaurantName: r.name,
              isHost: true,
              joinedAt: new Date().toISOString(),
            })
          );
        }

        addEvent({
          type: "group_created",
          restaurantName: r.name,
          restaurantId: String(r.id),
          entryId: sess.id,
          partySize: 1,
          timestamp: new Date().toISOString(),
        });
      } catch (err: any) {
        Alert.alert("Error", err.message);
        setStep("select");
      }
    };

    run();
  }, [paramRestaurantId, session?.user?.id, checkingExisting]);

  const checkExistingSession = async () => {
    setCheckingExisting(true);
    try {
      if (!session?.user?.id) {
        setCheckingExisting(false);
        return;
      }

      // Check for host's own open sessions
      const { data: hostSessions } = await supabase
        .from("party_sessions")
        .select("id, status, restaurants(name)")
        .eq("host_user_id", session.user.id)
        .eq("status", "open")
        .order("created_at", { ascending: false })
        .limit(1);

      if (hostSessions && hostSessions.length > 0) {
        const sess = hostSessions[0];
        setExistingSession({
          id: sess.id,
          restaurantName: (sess.restaurants as any)?.name ?? "Restaurant",
        });
        setCheckingExisting(false);
        return;
      }

      // Check AsyncStorage for guest participation (user-scoped)
      const stored = activeOrderKey ? await AsyncStorage.getItem(activeOrderKey) : null;
      if (stored) {
        const parsed = JSON.parse(stored);
        const { data: sess } = await supabase
          .from("party_sessions")
          .select("id, status, restaurants(name)")
          .eq("id", parsed.sessionId)
          .single();

        if (sess && sess.status === "open") {
          setExistingSession({
            id: sess.id,
            restaurantName:
              (sess.restaurants as any)?.name ?? parsed.restaurantName,
          });
        }
      }
    } catch {
      // Silently ignore
    } finally {
      setCheckingExisting(false);
    }
  };

  const fetchRestaurants = async () => {
    setLoadingRestaurants(true);
    try {
      const { data, error } = await supabase
        .from("restaurants")
        .select(
          "id, name, cuisine_tags, image_url, current_wait_time, lat, long",
        )
        .or("is_enabled.is.null,is_enabled.eq.true")
        .order("name", { ascending: true });
      if (!error && data) {
        setRestaurants(data as Restaurant[]);
      }
    } catch (e) {
      console.error("fetchRestaurants error:", e);
    } finally {
      setLoadingRestaurants(false);
    }
  };

  const getDist = (r: Restaurant): number => {
    if (!userCoords || r.lat == null || r.long == null) return 9999;
    return haversineDistance(
      userCoords.latitude,
      userCoords.longitude,
      r.lat,
      r.long,
    );
  };

  const filteredRestaurants = restaurants
    .filter((r) => {
      const q = (search || "").toLowerCase().trim();
      if (!q) return true;
      const matchName = r.name ? r.name.toLowerCase().includes(q) : false;
      const matchTag = Array.isArray(r.cuisine_tags)
        ? r.cuisine_tags.some(
          (t) => typeof t === "string" && t.toLowerCase().includes(q),
        )
        : false;
      return matchName || matchTag;
    })
    .sort((a, b) => {
      const aIsClosed = closedRestaurantIds.has(String(a.id));
      const bIsClosed = closedRestaurantIds.has(String(b.id));
      // Open restaurants come first
      if (aIsClosed !== bIsClosed) return aIsClosed ? 1 : -1;
      if (sortBy === "waitTime") {
        const aw = a.current_wait_time ?? 9999;
        const bw = b.current_wait_time ?? 9999;
        return aw - bw;
      }
      if (sortBy === "distance") return getDist(a) - getDist(b);
      const nameA = a.name || "";
      const nameB = b.name || "";
      return nameA.localeCompare(nameB);
    });

  const waitLabel = (r: Restaurant): { text: string; color: string } => {
    if (closedRestaurantIds.has(String(r.id))) return { text: "Closed", color: "#888" };
    const wt = r.current_wait_time;
    if (wt === null || wt < 0) return { text: "No wait", color: "#888" };
    if (wt >= 999) return { text: "Closed", color: "#888" };
    if (wt < 15) return { text: `${wt} min`, color: "#22C55E" };
    if (wt < 45) return { text: `${wt} min`, color: "#F59E0B" };
    return { text: `${wt} min`, color: "#EF4444" };
  };

  const handleSelectRestaurant = (r: Restaurant) => {
    if (closedRestaurantIds.has(String(r.id))) {
      Alert.alert("Restaurant Closed", `${r.name} is currently closed and cannot accept group orders.`);
      return;
    }
    if (Platform.OS !== "web")
      Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
    setSelectedRestaurant(r);
  };

  const handleStart = async () => {
    if (!selectedRestaurant) return;
    if (closedRestaurantIds.has(String(selectedRestaurant.id))) {
      Alert.alert("Restaurant Closed", "This restaurant is currently closed.");
      return;
    }
    if (!session?.user?.id) {
      Alert.alert("Error", "You must be logged in to host a party.");
      return;
    }

    if (existingSession) {
      Alert.alert(
        "Active Order Exists",
        `You already have an open group order at ${existingSession.restaurantName}. Cancel it to start a new one.`,
        [
          {
            text: "Go to Order",
            onPress: () =>
              router.push(`/join/${existingSession.id}` as any),
          },
          {
            text: "Cancel & Start New",
            style: "destructive",
            onPress: async () => {
              try {
                await supabase.from("party_items").delete().eq("session_id", existingSession.id);
                await supabase.from("party_sessions").update({ status: "cancelled" }).eq("id", existingSession.id);
                if (activeOrderKey) await AsyncStorage.removeItem(activeOrderKey);
                setExistingSession(null);
                if (Platform.OS !== "web") Haptics.notificationAsync(Haptics.NotificationFeedbackType.Warning);
              } catch {
                Alert.alert("Error", "Could not cancel the existing order.");
              }
            },
          },
          { text: "Dismiss", style: "cancel" },
        ],
      );
      return;
    }

    if (Platform.OS !== "web")
      Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Medium);
    setStep("starting");

    try {
      const { data, error } = await supabase
        .from("party_sessions")
        .insert({
          restaurant_id: selectedRestaurant.id,
          host_user_id: session.user.id,
          status: "open",
        })
        .select()
        .single();

      if (error) throw error;

      const url = `${GROUP_ORDER_WEB_BASE_URL}/join?id=${data.id}`;
      setSessionId(data.id);
      setShareUrl(url);
      setStep("created");

      if (activeOrderKey) {
        await AsyncStorage.setItem(
          activeOrderKey,
          JSON.stringify({
            sessionId: data.id,
            restaurantName: selectedRestaurant.name,
            isHost: true,
            joinedAt: new Date().toISOString(),
          }),
        );
      }

      addEvent({
        type: "group_created",
        restaurantName: selectedRestaurant!.name,
        restaurantId: String(selectedRestaurant!.id),
        entryId: data.id,
        partySize: 1,
        timestamp: new Date().toISOString(),
      });
    } catch (err: any) {
      Alert.alert("Error", err.message);
      setStep("select");
    }
  };

  const handleCopyLink = async () => {
    if (Platform.OS !== "web")
      Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
    if (Platform.OS === "web") {
      await navigator.clipboard?.writeText(shareUrl);
    } else {
      await ExpoClipboard.setStringAsync(shareUrl);
    }
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  };

  const handleShare = async () => {
    if (Platform.OS !== "web")
      Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
    try {
      await Share.share({
        message: `Join my group order at ${selectedRestaurant?.name}! 🍽️\n${shareUrl}`,
        url: shareUrl,
      });
    } catch { }
  };

  const handleJoinAsHost = () => {
    if (!sessionId) return;
    if (Platform.OS !== "web")
      Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Medium);
    router.replace(`/join/${sessionId}` as any);
  };

  const goBack = useCallback(() => {
    if (router.canGoBack()) router.back();
    else router.replace("/");
  }, [router]);

  return (
    <>
      <Stack.Screen
        options={{ headerShown: false, gestureEnabled: step !== "created" }}
      />
      <SafeAreaView
        style={{ flex: 1, backgroundColor: "#0f0f0f" }}
        edges={["top"]}
      >
        {/* Header */}
        <View
          style={{
            flexDirection: "row",
            alignItems: "center",
            paddingHorizontal: 20,
            paddingTop: 4,
            paddingBottom: 12,
            borderBottomWidth: 1,
            borderBottomColor: "#1a1a1a",
          }}
        >
          <Pressable
            onPress={goBack}
            style={{
              width: 40,
              height: 40,
              borderRadius: 20,
              backgroundColor: "#1a1a1a",
              alignItems: "center",
              justifyContent: "center",
              marginRight: 12,
            }}
          >
            <ArrowLeft size={20} color="#f5f5f5" />
          </Pressable>
          <View style={{ flex: 1 }}>
            <Text
              style={{
                fontFamily: "BricolageGrotesque_800ExtraBold",
                color: "#f5f5f5",
                fontSize: 22,
                letterSpacing: -0.3,
              }}
            >
              Group Order
            </Text>
            <Text
              style={{
                fontFamily: "Manrope_500Medium",
                color: "#666",
                fontSize: 13,
                marginTop: 1,
              }}
            >
              {step === "select"
                ? "Choose a restaurant to get started"
                : step === "starting"
                  ? "Setting up your group order…"
                  : `Hosting at ${selectedRestaurant?.name}`}
            </Text>
          </View>
          <UtensilsCrossed size={22} color="#FF9933" />
        </View>

        {/* ── Existing Session Banner ── */}
        {existingSession && step === "select" && (
          <Animated.View entering={FadeInDown.duration(400)} style={{ paddingHorizontal: 16, paddingTop: 12, paddingBottom: 4 }}>
            <View style={{
              backgroundColor: "rgba(255,153,51,0.1)",
              borderRadius: 16,
              borderWidth: 1.5,
              borderColor: "rgba(255,153,51,0.3)",
              padding: 16,
            }}>
              <Pressable
                onPress={() => {
                  if (Platform.OS !== "web") Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Medium);
                  router.push(`/join/${existingSession.id}` as any);
                }}
                style={{ flexDirection: "row", alignItems: "center", gap: 12 }}
              >
                <View style={{
                  width: 40, height: 40, borderRadius: 20,
                  backgroundColor: "rgba(255,153,51,0.2)",
                  borderWidth: 2, borderColor: "#FF9933",
                  alignItems: "center", justifyContent: "center",
                }}>
                  <AlertCircle size={20} color="#FF9933" />
                </View>
                <View style={{ flex: 1 }}>
                  <Text style={{ fontFamily: "BricolageGrotesque_700Bold", color: "#FF9933", fontSize: 14, marginBottom: 2 }}>
                    Active Group Order
                  </Text>
                  <Text style={{ fontFamily: "Manrope_500Medium", color: "#aaa", fontSize: 13 }}>
                    You have an open order at {existingSession.restaurantName}
                  </Text>
                </View>
                <ChevronRight size={18} color="#FF9933" />
              </Pressable>
              <Pressable
                onPress={() => {
                  Alert.alert(
                    "Cancel Existing Order",
                    `This will discard your group order at ${existingSession.restaurantName} and all its items so you can start a new one.`,
                    [
                      { text: "Keep Order", style: "cancel" },
                      {
                        text: "Cancel Order",
                        style: "destructive",
                        onPress: async () => {
                          try {
                            await supabase.from("party_items").delete().eq("session_id", existingSession.id);
                            await supabase.from("party_sessions").update({ status: "cancelled" }).eq("id", existingSession.id);
                            if (activeOrderKey) await AsyncStorage.removeItem(activeOrderKey);
                            setExistingSession(null);
                            if (Platform.OS !== "web") Haptics.notificationAsync(Haptics.NotificationFeedbackType.Warning);
                          } catch {
                            Alert.alert("Error", "Could not cancel the order. Try again.");
                          }
                        },
                      },
                    ]
                  );
                }}
                style={{
                  marginTop: 12,
                  paddingVertical: 10,
                  borderRadius: 12,
                  backgroundColor: "rgba(239,68,68,0.08)",
                  borderWidth: 1,
                  borderColor: "rgba(239,68,68,0.25)",
                  alignItems: "center",
                }}
              >
                <Text style={{ fontFamily: "Manrope_600SemiBold", color: "#EF4444", fontSize: 13 }}>
                  Cancel Existing & Start New
                </Text>
              </Pressable>
            </View>
          </Animated.View>
        )}

        {/* ── STEP: SELECT ── */}
        {step === "select" && (
          <>
            {/* Search bar */}
            <View
              style={{
                flexDirection: "row",
                alignItems: "center",
                marginHorizontal: 16,
                marginTop: 12,
                marginBottom: 8,
                backgroundColor: "#141414",
                borderRadius: 12,
                borderWidth: 1,
                borderColor: "#1e1e1e",
                paddingHorizontal: 12,
                gap: 8,
              }}
            >
              <Search size={16} color="#555" />
              <TextInput
                value={search}
                onChangeText={setSearch}
                placeholder="Search restaurants or cuisine…"
                placeholderTextColor="#444"
                style={{
                  flex: 1,
                  fontFamily: "Manrope_500Medium",
                  color: "#f5f5f5",
                  fontSize: 14,
                  paddingVertical: 12,
                }}
              />
            </View>

            {/* Sort pills */}
            <View
              style={{
                flexDirection: "row",
                paddingHorizontal: 16,
                paddingBottom: 8,
                gap: 8,
              }}
            >
              {(["waitTime", "distance"] as SortOption[]).map((opt) => {
                const active = sortBy === opt;
                const Icon = opt === "waitTime" ? Clock : MapPin;
                const label = opt === "waitTime" ? "Wait Time" : "Distance";
                return (
                  <Pressable
                    key={opt}
                    onPress={() => {
                      if (Platform.OS !== "web") Haptics.selectionAsync();
                      setSortBy(active ? "none" : opt);
                    }}
                    style={{
                      flexDirection: "row",
                      alignItems: "center",
                      gap: 5,
                      backgroundColor: active
                        ? "rgba(255,153,51,0.2)"
                        : "#141414",
                      borderRadius: 20,
                      paddingHorizontal: 14,
                      paddingVertical: 7,
                      borderWidth: 1,
                      borderColor: active ? "#FF9933" : "#2a2a2a",
                    }}
                  >
                    <Icon size={12} color={active ? "#FF9933" : "#999"} />
                    <Text
                      style={{
                        fontFamily: "Manrope_600SemiBold",
                        color: active ? "#FF9933" : "#999",
                        fontSize: 12,
                      }}
                    >
                      {label}
                    </Text>
                  </Pressable>
                );
              })}
            </View>

            <ScrollView
              showsVerticalScrollIndicator={false}
              contentContainerStyle={{ paddingBottom: 120 }}
              keyboardShouldPersistTaps="handled"
            >
              {loadingRestaurants ? (
                <View style={{ paddingTop: 80, alignItems: "center" }}>
                  <ActivityIndicator color="#FF9933" size="large" />
                  <Text
                    style={{
                      fontFamily: "Manrope_500Medium",
                      color: "#666",
                      fontSize: 14,
                      marginTop: 12,
                    }}
                  >
                    Loading restaurants…
                  </Text>
                </View>
              ) : (
                <View style={{ paddingTop: 4 }}>
                  {filteredRestaurants.map((r, i) => {
                    const isSelected = selectedRestaurant?.id === r.id;
                    const wt = waitLabel(r);
                    const isClosed = closedRestaurantIds.has(String(r.id));
                    return (
                      <View
                        key={r.id}
                      >
                        <View style={{ opacity: isClosed ? 0.5 : 1 }}>
                          <Pressable
                            onPress={() => handleSelectRestaurant(r)}
                            disabled={isClosed}
                            style={{
                              flexDirection: "row",
                              alignItems: "center",
                              marginHorizontal: 16,
                              marginVertical: 4,
                              paddingHorizontal: 12,
                              paddingVertical: 10,
                              borderRadius: 14,
                              backgroundColor: isSelected
                                ? "rgba(255,153,51,0.12)"
                                : "#141414",
                              borderWidth: 1,
                              borderColor: isSelected ? "#FF9933" : "#1e1e1e",
                              gap: 12,
                            }}
                          >
                            {/* Restaurant image */}
                            {r.image_url ? (
                              <Image
                                source={{ uri: r.image_url }}
                                style={{
                                  width: 52,
                                  height: 52,
                                  borderRadius: 10,
                                  backgroundColor: "#1e1e1e",
                                }}
                                resizeMode="cover"
                              />
                            ) : (
                              <View
                                style={{
                                  width: 52,
                                  height: 52,
                                  borderRadius: 10,
                                  backgroundColor: "#1e1e1e",
                                  alignItems: "center",
                                  justifyContent: "center",
                                }}
                              >
                                <UtensilsCrossed size={22} color="#333" />
                              </View>
                            )}

                            {/* Name + cuisine */}
                            <View style={{ flex: 1 }}>
                              <Text
                                style={{
                                  fontFamily: "BricolageGrotesque_700Bold",
                                  color: "#f5f5f5",
                                  fontSize: 15,
                                  letterSpacing: -0.2,
                                }}
                                numberOfLines={1}
                              >
                                {r.name}
                              </Text>
                              {r.cuisine_tags?.length > 0 && (
                                <Text
                                  style={{
                                    fontFamily: "Manrope_500Medium",
                                    color: "#666",
                                    fontSize: 12,
                                    marginTop: 2,
                                  }}
                                  numberOfLines={1}
                                >
                                  {r.cuisine_tags.join(" · ")}
                                </Text>
                              )}
                            </View>

                            {/* Wait time */}
                            <View style={{ alignItems: "flex-end", gap: 4 }}>
                              <View
                                style={{
                                  flexDirection: "row",
                                  alignItems: "center",
                                  gap: 4,
                                }}
                              >
                                <Clock size={11} color={wt.color} />
                                <Text
                                  style={{
                                    fontFamily: "Manrope_600SemiBold",
                                    color: wt.color,
                                    fontSize: 12,
                                  }}
                                >
                                  {wt.text}
                                </Text>
                              </View>

                              {/* Check circle */}
                              <View
                                style={{
                                  width: 20,
                                  height: 20,
                                  borderRadius: 10,
                                  borderWidth: 2,
                                  borderColor: isSelected ? "#FF9933" : "#333",
                                  backgroundColor: isSelected
                                    ? "#FF9933"
                                    : "transparent",
                                  alignItems: "center",
                                  justifyContent: "center",
                                }}
                              >
                                {isSelected && (
                                  <Check
                                    size={11}
                                    color="#0f0f0f"
                                    strokeWidth={3}
                                  />
                                )}
                              </View>
                            </View>
                          </Pressable>
                        </View>
                      </View>
                    );
                  })}
                  {filteredRestaurants.length === 0 && !loadingRestaurants && (
                    <View style={{ alignItems: "center", paddingTop: 48 }}>
                      <Text
                        style={{
                          fontFamily: "Manrope_500Medium",
                          color: "#555",
                          fontSize: 14,
                        }}
                      >
                        No restaurants match &quot;{search}&quot;
                      </Text>
                    </View>
                  )}
                </View>
              )}
            </ScrollView>

            {/* Start Button */}
            <View
              style={{
                position: "absolute",
                bottom: 0,
                left: 0,
                right: 0,
                paddingHorizontal: 20,
                paddingBottom: 36,
                paddingTop: 16,
                backgroundColor: "#0f0f0f",
                borderTopWidth: 1,
                borderTopColor: "#1a1a1a",
              }}
            >
              <Pressable
                onPress={handleStart}
                disabled={!selectedRestaurant}
                style={{
                  backgroundColor: selectedRestaurant ? "#FF9933" : "#1a1a1a",
                  borderRadius: 14,
                  paddingVertical: 16,
                  paddingHorizontal: 20,
                  flexDirection: "row",
                  alignItems: "center",
                  justifyContent: "center",
                  gap: 10,
                }}
              >
                <Users
                  size={18}
                  color={selectedRestaurant ? "#0f0f0f" : "#444"}
                  style={{ flexShrink: 0 }}
                />
                <Text
                  style={{
                    fontFamily: "BricolageGrotesque_700Bold",
                    color: selectedRestaurant ? "#0f0f0f" : "#444",
                    fontSize: 17,
                    letterSpacing: -0.2,
                    flexShrink: 1,
                    textAlign: "center",
                  }}
                >
                  {selectedRestaurant
                    ? `Start Group Order at ${selectedRestaurant.name}`
                    : "Select a Restaurant First"}
                </Text>
              </Pressable>
            </View>
          </>
        )}

        {/* ── STEP: STARTING ── */}
        {step === "starting" && (
          <View
            style={{
              flex: 1,
              alignItems: "center",
              justifyContent: "center",
              gap: 16,
            }}
          >
            <ActivityIndicator color="#FF9933" size="large" />
            <Text
              style={{
                fontFamily: "Manrope_500Medium",
                color: "#888",
                fontSize: 15,
              }}
            >
              Creating your group order session…
            </Text>
          </View>
        )}

        {/* ── STEP: CREATED ── */}
        {step === "created" && (
          <Animated.View
            entering={FadeIn.duration(400)}
            style={{ flex: 1, paddingHorizontal: 20, paddingTop: 24 }}
          >
            {/* Success header */}
            <View
              style={{
                backgroundColor: "rgba(255,153,51,0.1)",
                borderRadius: 16,
                padding: 20,
                borderWidth: 1,
                borderColor: "rgba(255,153,51,0.25)",
                marginBottom: 24,
              }}
            >
              <Text
                style={{
                  fontFamily: "BricolageGrotesque_800ExtraBold",
                  color: "#FF9933",
                  fontSize: 20,
                  letterSpacing: -0.3,
                  marginBottom: 6,
                }}
              >
                Group Order Created!
              </Text>
              <Text
                style={{
                  fontFamily: "Manrope_500Medium",
                  color: "#aaa",
                  fontSize: 14,
                  lineHeight: 20,
                }}
              >
                Share the link or scan the QR code below with your group. Everyone can add their own
                items from their phone.
              </Text>
            </View>

            {/* QR code */}
            {shareUrl ? (
              <View
                style={{
                  alignItems: "center",
                  justifyContent: "center",
                  marginBottom: 14,
                }}
              >
                <View
                  style={{
                    backgroundColor: "#ffffff",
                    borderRadius: 14,
                    padding: 12,
                    borderWidth: 1,
                    borderColor: "#2a2a2a",
                  }}
                >
                  <QRCode value={shareUrl} size={148} />
                </View>
              </View>
            ) : null}

            {/* Link card */}
            <Text
              style={{
                fontFamily: "Manrope_600SemiBold",
                color: "#666",
                fontSize: 12,
                letterSpacing: 0.5,
                textTransform: "uppercase",
                marginBottom: 8,
              }}
            >
              Invite Link
            </Text>
            <View
              style={{
                backgroundColor: "#141414",
                borderRadius: 12,
                borderWidth: 1,
                borderColor: "#1e1e1e",
                padding: 14,
                marginBottom: 12,
              }}
            >
              <Text
                style={{
                  fontFamily: "JetBrainsMono_400Regular",
                  color: "#f5f5f5",
                  fontSize: 13,
                  lineHeight: 18,
                }}
                numberOfLines={2}
              >
                {shareUrl}
              </Text>
            </View>

            {/* Action buttons */}
            <View style={{ flexDirection: "row", gap: 10, marginBottom: 20 }}>
              <Pressable
                onPress={handleCopyLink}
                style={{
                  flex: 1,
                  flexDirection: "row",
                  alignItems: "center",
                  justifyContent: "center",
                  gap: 8,
                  backgroundColor: "#141414",
                  borderRadius: 12,
                  paddingVertical: 14,
                  borderWidth: 1,
                  borderColor: copied ? "#FF9933" : "#1e1e1e",
                }}
              >
                {copied ? (
                  <Check size={16} color="#FF9933" />
                ) : (
                  <Copy size={16} color="#f5f5f5" />
                )}
                <Text
                  style={{
                    fontFamily: "Manrope_600SemiBold",
                    color: copied ? "#FF9933" : "#f5f5f5",
                    fontSize: 14,
                  }}
                >
                  {copied ? "Copied!" : "Copy Link"}
                </Text>
              </Pressable>
              <Pressable
                onPress={handleShare}
                style={{
                  flex: 1,
                  flexDirection: "row",
                  alignItems: "center",
                  justifyContent: "center",
                  gap: 8,
                  backgroundColor: "#141414",
                  borderRadius: 12,
                  paddingVertical: 14,
                  borderWidth: 1,
                  borderColor: "#1e1e1e",
                }}
              >
                <Share2 size={16} color="#f5f5f5" />
                <Text
                  style={{
                    fontFamily: "Manrope_600SemiBold",
                    color: "#f5f5f5",
                    fontSize: 14,
                  }}
                >
                  Share
                </Text>
              </Pressable>
            </View>

            {/* Join as host */}
            <Pressable
              onPress={handleJoinAsHost}
              style={{
                backgroundColor: "#FF9933",
                borderRadius: 14,
                paddingVertical: 16,
                alignItems: "center",
                flexDirection: "row",
                justifyContent: "center",
                gap: 8,
              }}
            >
              <Users size={18} color="#0f0f0f" />
              <Text
                style={{
                  fontFamily: "BricolageGrotesque_700Bold",
                  color: "#0f0f0f",
                  fontSize: 17,
                  letterSpacing: -0.2,
                }}
              >
                Join as Host
              </Text>
              <ChevronRight size={18} color="#0f0f0f" />
            </Pressable>

            <Text
              style={{
                fontFamily: "Manrope_500Medium",
                color: "#555",
                fontSize: 12,
                textAlign: "center",
                marginTop: 16,
                lineHeight: 18,
              }}
            >
              You can also share the link first and join later. The session
              stays open until the order is submitted.
            </Text>
          </Animated.View>
        )}
      </SafeAreaView>
    </>
  );
}
