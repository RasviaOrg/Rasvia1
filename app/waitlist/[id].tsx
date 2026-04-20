import React, { useState, useCallback, useEffect, useRef } from "react";
import {
  View,
  Text,
  ScrollView,
  Pressable,
  Alert,
  Platform,
  ActivityIndicator,
  Modal,
  Share,
  TouchableOpacity,
} from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";
import { useLocalSearchParams, useRouter, Stack } from "expo-router";
import { useNotifications } from "@/lib/notifications-context";
import {
  ArrowLeft,
  X,
  MapPin,
  UtensilsCrossed,
  Bell,
  Share2,
  AlertTriangle,
} from "lucide-react-native";
import { isPushEnabled, enablePushNotifications } from "@/lib/push-notifications";
import Animated, {
  FadeIn,
  FadeInDown,
  FadeInUp,
} from "react-native-reanimated";
import * as Haptics from "expo-haptics";
import { WaitlistRing } from "@/components/WaitlistRing";
import { supabase } from "@/lib/supabase";
import {
  type SupabaseRestaurant,
  type UIRestaurant,
  mapSupabaseToUI,
  haversineDistance,
} from "@/lib/restaurant-types";
import { useLocation } from "@/lib/location-context";
import { useAuth } from "@/lib/auth-context";
import * as SecureStore from 'expo-secure-store';

const GROUP_ORDER_WEB_BASE_URL = "https://rasvia.com";

export default function WaitlistStatus() {
  const { id, entry_id, party_size } = useLocalSearchParams<{ id: string; entry_id?: string; party_size?: string }>();
  const router = useRouter();
  const { userCoords } = useLocation();
  const { session } = useAuth();
  const { addEvent, dismissEntry } = useNotifications();

  const currentUserId = session?.user?.id;
  const activeOrderKey = currentUserId
    ? `rasvia_active_group_order_${currentUserId}`
    : null;

  // ==========================================
  // SUPABASE STATE
  // ==========================================
  const [restaurant, setRestaurant] = useState<UIRestaurant | null>(null);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState(false);

  const [position, setPosition] = useState<number | null>(null);
  const [totalInQueue, setTotalInQueue] = useState<number>(0);
  const [showTableReady, setShowTableReady] = useState(false);
  const [showSeated, setShowSeated] = useState(false);
  const [partyOwnerName, setPartyOwnerName] = useState<string>("");
  const myPartySize = party_size ? parseInt(party_size, 10) : 1;

  /** Replica identity may omit `old` on UPDATE — compare to last known state */
  const myEntryStateRef = useRef<{
    status: string;
    notified_at: string | null;
  } | null>(null);
  /** True while we’re applying self-initiated leave — suppresses “removed” modal on cancelled */
  const userLeftVoluntarilyRef = useRef(false);
  /** True for the brief window between tapping Leave and the realtime UPDATE
   *  echo — prevents duplicate "left" haptics/banners from firing. */
  const leavingRef = useRef(false);

  const restaurantIdNum = id ? Number(id) : NaN;

  // ==========================================
  // FETCH FROM SUPABASE
  // ==========================================
  useEffect(() => {
    // Safety timeout: if loading hasn't resolved in 8s, bail out
    const timeout = setTimeout(() => {
      setLoading((prev) => {
        if (prev) {
          setLoadError(true);
          return false;
        }
        return prev;
      });
    }, 8000);

    async function fetchData() {
      try {
        // 1. Fetch the restaurant
        const { data: restData, error: restError } = await supabase
          .from("restaurants")
          .select("*")
          .eq("id", Number(id))
          .single();

        if (restError) {
          console.error("❌ Error fetching restaurant:", restError);
          setLoadError(true);
          setLoading(false);
          return;
        }

        if (restData) {
          const uiRestaurant = mapSupabaseToUI(restData as SupabaseRestaurant, userCoords);
          setRestaurant(uiRestaurant);
        }
      } catch (error) {
        console.error("Error:", error);
        setLoadError(true);
      } finally {
        setLoading(false);
      }
    }

    fetchData();
    fetchPartyOwnerName();
    if (entry_id) {
      fetchPosition(entry_id);
      checkEntryStatus(entry_id);
    }

    // Per-mount suffix prevents "cannot add postgres_changes callbacks ...
    // after subscribe()" when the waitlist screen remounts while the previous
    // channel with the same topic is still joined.
    const topicSuffix = Math.random().toString(36).slice(2, 8);

    // Real-time: restaurant row changes (wait time, etc.)
    const restSub = supabase
      .channel(`waitlist-restaurant:${id}:${topicSuffix}`)
      .on(
        "postgres_changes",
        {
          event: "UPDATE",
          schema: "public",
          table: "restaurants",
          filter: `id=eq.${restaurantIdNum}`,
        },
        (payload) => {
          const updated = mapSupabaseToUI(payload.new as SupabaseRestaurant, userCoords);
          setRestaurant(updated);
        }
      )
      .subscribe();

    // Real-time: waitlist_entries changes → refresh position
    const queueSub = supabase
      .channel(`waitlist-queue:${id}:${topicSuffix}`)
      .on(
        "postgres_changes",
        {
          event: "*",
          schema: "public",
          table: "waitlist_entries",
          filter: `restaurant_id=eq.${restaurantIdNum}`,
        },
        () => {
          if (entry_id) fetchPosition(entry_id);
        }
      )
      .subscribe();

    // Real-time: watch OUR entry for notified_at or seated status
    const notifySub = entry_id
      ? supabase
        .channel(`my-entry:${entry_id}:${topicSuffix}`)
        .on(
          "postgres_changes",
          { event: "UPDATE", schema: "public", table: "waitlist_entries", filter: `id=eq.${entry_id}` },
          (payload) => {
            const row = payload.new as {
              status?: string;
              notified_at?: string | null;
            } | null;
            if (!row) return;
            const prev = myEntryStateRef.current;
            const prevStatus = prev?.status ?? "";
            const prevNotified = prev?.notified_at ?? null;

            if (row.status === "cancelled" || row.status === "removed") {
              if (userLeftVoluntarilyRef.current) {
                userLeftVoluntarilyRef.current = false;
                myEntryStateRef.current = {
                  status: row.status ?? prevStatus,
                  notified_at: row.notified_at ?? prevNotified,
                };
                return;
              }
              if (prevStatus !== "cancelled" && prevStatus !== "removed") {
                setShowRemovedModal(true);
                if (Platform.OS !== "web") {
                  Haptics.notificationAsync(Haptics.NotificationFeedbackType.Error);
                }
              }
              myEntryStateRef.current = {
                status: row.status ?? prevStatus,
                notified_at: row.notified_at ?? prevNotified,
              };
              return;
            }

            if (row.status === "seated" && prevStatus !== "seated") {
              triggerSeated();
            } else if (row.notified_at && !prevNotified) {
              triggerTableReady();
            }

            myEntryStateRef.current = {
              status: row.status ?? prevStatus,
              notified_at: row.notified_at ?? prevNotified,
            };
          }
        )
        .subscribe()
      : null;

    return () => {
      clearTimeout(timeout);
      supabase.removeChannel(restSub);
      supabase.removeChannel(queueSub);
      if (notifySub) supabase.removeChannel(notifySub);
    };
  }, [id, entry_id]);

  async function fetchPartyOwnerName() {
    if (!session?.user?.id) return;
    try {
      const { data } = await supabase
        .from("profiles")
        .select("full_name")
        .eq("id", session.user.id)
        .single();
      if (data?.full_name) setPartyOwnerName(data.full_name);
    } catch {
      // silently ignore
    }
  }

  async function checkEntryStatus(entryId: string) {
    try {
      const { data } = await supabase
        .from("waitlist_entries")
        .select("notified_at, status")
        .eq("id", entryId)
        .single();
      if (data) {
        myEntryStateRef.current = {
          status: data.status ?? "waiting",
          notified_at: data.notified_at ?? null,
        };
      }
      if (data?.status === "removed") {
        setShowRemovedModal(true);
        return;
      }
      if (data?.status === "cancelled") {
        return;
      }
      if (data?.status === "seated") {
        triggerSeated();
      } else if (data?.notified_at) {
        triggerTableReady();
      }
    } catch {
      // silently ignore
    }
  }

  function triggerTableReady() {
    setShowTableReady(true);
    if (Platform.OS !== "web") {
      // Deep, patterned haptic sequence so the user really feels it
      Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Heavy);
      setTimeout(() => Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Heavy), 150);
      setTimeout(() => Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success), 350);
      setTimeout(() => Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Heavy), 600);
      setTimeout(() => Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Heavy), 750);
      setTimeout(() => Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success), 950);
    }
  }

  const seatedTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => {
    return () => {
      if (seatedTimeoutRef.current) clearTimeout(seatedTimeoutRef.current);
    };
  }, []);

  function triggerSeated() {
    setShowTableReady(false);
    setShowSeated(true);
    if (Platform.OS !== "web") {
      Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
      setTimeout(() => Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success), 500);
    }
    seatedTimeoutRef.current = setTimeout(() => router.replace("/"), 4000);
  }

  async function fetchPosition(entryId: string) {
    try {
      // Get our entry's created_at
      const { data: myEntry } = await supabase
        .from("waitlist_entries")
        .select("created_at")
        .eq("id", entryId)
        .single();

      if (!myEntry) return;

      // Count entries ahead of us (earlier created_at, still waiting)
      const { count: ahead } = await supabase
        .from("waitlist_entries")
        .select("*", { count: "exact", head: true })
        .eq("restaurant_id", Number(id))
        .eq("status", "waiting")
        .lt("created_at", myEntry.created_at);

      // Total waiting
      const { count: total } = await supabase
        .from("waitlist_entries")
        .select("*", { count: "exact", head: true })
        .eq("restaurant_id", Number(id))
        .eq("status", "waiting");

      setPosition((ahead ?? 0) + 1);
      setTotalInQueue(total ?? 0);
    } catch {
      // silently ignore
    }
  }

  // Recalculate distance when userCoords arrives after initial fetch
  useEffect(() => {
    if (!userCoords) return;
    setRestaurant((prev) => {
      if (!prev || prev.lat == null || prev.long == null) return prev;
      const dist = haversineDistance(
        userCoords.latitude, userCoords.longitude, prev.lat, prev.long,
      );
      return { ...prev, distance: `${dist.toFixed(1)} mi` };
    });
  }, [userCoords]);


  const handleLeaveQueue = useCallback(async () => {
    if (Platform.OS !== "web") {
      Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Medium);
    }

    // Block leaving if there's an active/in-flight order tied to this entry —
    // otherwise the kitchen keeps making food for a table that no longer
    // exists. The user has to cancel the order first.
    if (entry_id) {
      try {
        const { data: activeOrders } = await supabase
          .from("orders")
          .select("id, status")
          .eq("waitlist_entry_id", entry_id)
          .in("status", ["pending", "pending_payment", "preparing", "ready", "served"]);
        if (activeOrders && activeOrders.length > 0) {
          Alert.alert(
            "Cancel your active order first",
            "You have an active order linked to this waitlist entry. Please cancel it (or let the restaurant know) before leaving the queue.",
            [
              { text: "OK", style: "cancel" },
              {
                text: "Go to order",
                onPress: () => router.push("/my-orders" as any),
              },
            ],
          );
          return;
        }
      } catch {
        // If we can't check (offline / RLS), fall through and let the user
        // leave — worst case the server-side cleanup still runs.
      }
    }

    Alert.alert(
      "Leave Queue",
      "Are you sure you want to leave the waitlist?",
      [
        { text: "Stay", style: "cancel" },
        {
          text: "Leave",
          style: "destructive",
          onPress: async () => {
            if (entry_id) {
              userLeftVoluntarilyRef.current = true;
              // Mark that we're already handling the leave locally so the
              // realtime UPDATE handler doesn't re-fire "left" haptics /
              // banners when the DB echoes the cancellation back to us.
              leavingRef.current = true;
              await supabase
                .from("waitlist_entries")
                .update({ status: "cancelled" })
                .eq("id", entry_id);
              // Add "left" event and remove the active widget
              addEvent({
                type: "left",
                restaurantName: restaurant?.name ?? "Restaurant",
                restaurantId: String(id),
                entryId: entry_id,
                partySize: myPartySize,
                timestamp: new Date().toISOString(),
              });
              dismissEntry(entry_id);
            }
            router.back();
          },
        },
      ]
    );
  }, [router, entry_id, restaurant?.name, id, myPartySize, addEvent, dismissEntry]);

  const [creatingParty, setCreatingParty] = useState(false);
  const [pushActive, setPushActive] = useState(true);
  const [showRemovedModal, setShowRemovedModal] = useState(false);

  // Check push notification status on mount
  useEffect(() => {
    isPushEnabled().then(setPushActive);
  }, []);

  const handleStartGroupOrder = async () => {
    if (Platform.OS !== "web") {
      Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Medium);
    }

    setCreatingParty(true);
    try {
      if (!id) throw new Error("Missing restaurant details");
      const userId = session?.user?.id;
      if (!userId) throw new Error("You must be logged in to hold a party");

      // Check for ANY open session by this user (not just this restaurant)
      const { data: anyOpen } = await supabase
        .from('party_sessions')
        .select('id, restaurants(name)')
        .eq('host_user_id', userId)
        .eq('status', 'open')
        .order('created_at', { ascending: false })
        .limit(1);

      if (anyOpen && anyOpen.length > 0) {
        const existing = anyOpen[0];
        const existingRestName = (existing.restaurants as any)?.name ?? 'another restaurant';
        // If it's the same restaurant, just use that session
        // If different restaurant, warn the user
        const existingForThisRestaurant = anyOpen.find(
          (s: any) => true // we already filtered by host_user_id
        );

        // Check if it's for this specific restaurant
        const { data: sameRest } = await supabase
          .from('party_sessions')
          .select('id')
          .eq('host_user_id', userId)
          .eq('restaurant_id', Number(id))
          .eq('status', 'open')
          .single();

        if (sameRest) {
          // Reuse existing session for this restaurant
          const sessionId = sameRest.id;
          const shareUrl = `${GROUP_ORDER_WEB_BASE_URL}/join?id=${sessionId}`;

          // Store as active (user-scoped)
          if (activeOrderKey) await SecureStore.setItemAsync(activeOrderKey, JSON.stringify({
            sessionId,
            restaurantName: restaurant?.name ?? 'Restaurant',
            isHost: true,
            joinedAt: new Date().toISOString(),
          }));

          setCreatingParty(false);
          // Navigate to menu first, then prompt share
          router.push(`/join/${sessionId}` as any);
          setTimeout(() => {
            Share.share({
              title: 'Join my Group Order',
              message: `I'm holding the table at ${restaurant?.name}! Add your food here: ${shareUrl}`,
              url: shareUrl,
            });
          }, 600);
          return;
        }

        // Different restaurant — offer to cancel existing
        Alert.alert(
          "Active Order Exists",
          `You have an open group order at ${existingRestName}. Cancel it to start a new one here.`,
          [
            { text: "Go to Order", onPress: () => router.push(`/join/${existing.id}` as any) },
            {
              text: "Cancel & Start New",
              style: "destructive",
              onPress: async () => {
                try {
                  await supabase.from('party_items').delete().eq('session_id', existing.id);
                  await supabase.from('party_sessions').update({ status: 'cancelled' }).eq('id', existing.id);
                  if (activeOrderKey) await SecureStore.deleteItemAsync(activeOrderKey);
                  if (Platform.OS !== 'web') Haptics.notificationAsync(Haptics.NotificationFeedbackType.Warning);
                  Alert.alert("Cancelled", "Tap 'Share & Start Group Order' again to start your new group order.");
                } catch {
                  Alert.alert("Error", "Could not cancel the existing order.");
                }
              },
            },
            { text: "Dismiss", style: "cancel" },
          ]
        );
        setCreatingParty(false);
        return;
      }

      // No existing session - create new one
      const { data: newSession, error } = await supabase
        .from('party_sessions')
        .insert({
          restaurant_id: Number(id),
          host_user_id: userId,
          status: 'open'
        })
        .select()
        .single();

      if (error) throw error;

      const shareUrl = `${GROUP_ORDER_WEB_BASE_URL}/join?id=${newSession.id}`;

      if (activeOrderKey) {
        await SecureStore.setItemAsync(activeOrderKey, JSON.stringify({
          sessionId: newSession.id,
          restaurantName: restaurant?.name ?? 'Restaurant',
          isHost: true,
          joinedAt: new Date().toISOString(),
        }));
      }

      addEvent({
        type: "group_created",
        restaurantName: restaurant?.name ?? "Restaurant",
        restaurantId: String(id),
        entryId: newSession.id,
        partySize: myPartySize,
        timestamp: new Date().toISOString(),
      });

      // Navigate to menu first, then prompt share
      router.push(`/join/${newSession.id}` as any);
      setTimeout(() => {
        Share.share({
          title: 'Join my Group Order',
          message: `I'm holding the table at ${restaurant?.name}! Add your food here: ${shareUrl}`,
          url: shareUrl,
        });
      }, 600);

    } catch (err: any) {
      Alert.alert("Error", "Could not start party: " + err.message);
    } finally {
      setCreatingParty(false);
    }
  };

  // ==========================================
  // LOADING STATE
  // ==========================================
  if (loading) {
    return (
      <View className="flex-1 bg-rasvia-black items-center justify-center">
        <ActivityIndicator size="large" color="#FF9933" />
        <Text
          style={{
            fontFamily: "Manrope_500Medium",
            color: "#999999",
            fontSize: 14,
            marginTop: 12,
          }}
        >
          Loading waitlist...
        </Text>
      </View>
    );
  }

  if (loadError || !restaurant) {
    return (
      <View className="flex-1 bg-rasvia-black items-center justify-center" style={{ padding: 32 }}>
        <Text
          style={{
            fontFamily: "BricolageGrotesque_700Bold",
            color: "#f5f5f5",
            fontSize: 20,
            marginBottom: 8,
            textAlign: "center",
          }}
        >
          Could not load waitlist
        </Text>
        <Text
          style={{
            fontFamily: "Manrope_500Medium",
            color: "#999999",
            fontSize: 14,
            textAlign: "center",
            marginBottom: 24,
          }}
        >
          Please check your connection and try again.
        </Text>
        <Pressable
          onPress={() => router.back()}
          style={{
            backgroundColor: "#FF9933",
            borderRadius: 14,
            paddingVertical: 14,
            paddingHorizontal: 32,
          }}
        >
          <Text
            style={{
              fontFamily: "BricolageGrotesque_700Bold",
              color: "#0f0f0f",
              fontSize: 16,
            }}
          >
            Go Back
          </Text>
        </Pressable>
      </View>
    );
  }

  return (
    <View className="flex-1 bg-rasvia-black">
      <Stack.Screen options={{ gestureEnabled: false }} />
      <SafeAreaView className="flex-1" edges={["top"]}>
        {/* Header */}
        <Animated.View
          entering={FadeIn.duration(400)}
          className="flex-row items-center justify-between px-5 pt-2 pb-4"
        >
          <Pressable
            onPress={() => router.back()}
            style={{
              backgroundColor: "#1a1a1a",
              width: 44,
              height: 44,
              borderRadius: 22,
              alignItems: "center",
              justifyContent: "center",
              borderWidth: 1,
              borderColor: "#2a2a2a",
            }}
          >
            <ArrowLeft size={22} color="#f5f5f5" />
          </Pressable>
          <Text
            style={{
              fontFamily: "BricolageGrotesque_700Bold",
              color: "#f5f5f5",
              fontSize: 18,
            }}
          >
            Waitlist Status
          </Text>
          <Pressable
            onPress={handleLeaveQueue}
            style={{
              backgroundColor: "rgba(239, 68, 68, 0.15)",
              width: 44,
              height: 44,
              borderRadius: 22,
              alignItems: "center",
              justifyContent: "center",
              borderWidth: 1,
              borderColor: "rgba(239, 68, 68, 0.2)",
            }}
          >
            <X size={20} color="#EF4444" />
          </Pressable>
        </Animated.View>

        <ScrollView
          showsVerticalScrollIndicator={false}
          contentContainerStyle={{ paddingBottom: 40 }}
        >
          {/* Restaurant Info */}
          <Animated.View
            entering={FadeInDown.delay(100).duration(500)}
            className="px-5 mb-6"
          >
            <Text
              style={{
                fontFamily: "BricolageGrotesque_800ExtraBold",
                color: "#f5f5f5",
                fontSize: 32,
                letterSpacing: -0.5,
              }}
            >
              {restaurant.name}
            </Text>
            <View className="flex-row items-center mt-2">
              <MapPin size={13} color="#999999" />
              <Text
                style={{
                  fontFamily: "Manrope_500Medium",
                  color: "#999999",
                  fontSize: 13,
                  marginLeft: 4,
                }}
              >
                {restaurant.address}
              </Text>
            </View>
            {partyOwnerName !== "" && (
              <View className="flex-row items-center mt-1">
                <UtensilsCrossed size={13} color="#FF9933" />
                <Text
                  style={{
                    fontFamily: "Manrope_600SemiBold",
                    color: "#FF9933",
                    fontSize: 13,
                    marginLeft: 4,
                  }}
                >
                  Party under {partyOwnerName}
                </Text>
              </View>
            )}
          </Animated.View>

          {/* Waitlist Ring */}
          <View className="items-center mb-10">
            <WaitlistRing
              position={position ?? 1}
              totalInQueue={totalInQueue || restaurant.queueLength}
              estimatedMinutes={restaurant.waitTime > 0 ? restaurant.waitTime : 0}
              restaurantName={restaurant.name}
              isTableReady={showTableReady}
            />
          </View>

          {/* Status Cards */}
          <Animated.View
            entering={FadeInUp.delay(400).duration(500)}
            className="px-5 mb-6"
          >
            <View className="flex-row">
              <View
                className="flex-1 mr-2 p-4 rounded-2xl"
                style={{
                  backgroundColor: "#1a1a1a",
                  borderWidth: 1,
                  borderColor: "#2a2a2a",
                }}
              >
                <View className="flex-row items-center mb-2">
                  <UtensilsCrossed size={16} color="#FF9933" />
                  <Text
                    style={{
                      fontFamily: "Manrope_600SemiBold",
                      color: "#999999",
                      fontSize: 12,
                      marginLeft: 6,
                    }}
                  >
                    Party Size
                  </Text>
                </View>
                <Text
                  style={{
                    fontFamily: "JetBrainsMono_600SemiBold",
                    color: "#f5f5f5",
                    fontSize: 28,
                  }}
                >
                  {myPartySize}
                </Text>
                <Text
                  style={{
                    fontFamily: "Manrope_500Medium",
                    color: "#999999",
                    fontSize: 12,
                    marginTop: 2,
                  }}
                >
                  guests
                </Text>
              </View>

              <View
                className="flex-1 ml-2 p-4 rounded-2xl"
                style={{
                  backgroundColor: "#1a1a1a",
                  borderWidth: 1,
                  borderColor: "#2a2a2a",
                }}
              >
                <View className="flex-row items-center mb-2">
                  <Bell size={16} color="#FF9933" />
                  <Text
                    style={{
                      fontFamily: "Manrope_600SemiBold",
                      color: "#999999",
                      fontSize: 12,
                      marginLeft: 6,
                    }}
                  >
                    Notifications
                  </Text>
                </View>
                <Text
                  style={{
                    fontFamily: "JetBrainsMono_600SemiBold",
                    color: pushActive ? "#22C55E" : "#EF4444",
                    fontSize: 16,
                  }}
                >
                  {pushActive ? "Active" : "Inactive"}
                </Text>
                <Text
                  style={{
                    fontFamily: "Manrope_500Medium",
                    color: "#999999",
                    fontSize: 12,
                    marginTop: 2,
                  }}
                >
                  {pushActive ? "We'll ping you" : "You may miss alerts"}
                </Text>
                {!pushActive && (
                  <Pressable
                    onPress={async () => {
                      if (Platform.OS !== 'web') Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Medium);
                      const granted = await enablePushNotifications();
                      setPushActive(granted);
                      if (!granted) {
                        Alert.alert("Notifications Blocked", "Enable notifications in your device settings to receive table-ready alerts.");
                      }
                    }}
                    style={{
                      marginTop: 8,
                      backgroundColor: "rgba(255,153,51,0.15)",
                      borderRadius: 10,
                      paddingHorizontal: 14,
                      paddingVertical: 6,
                      alignSelf: "flex-start",
                      borderWidth: 1,
                      borderColor: "rgba(255,153,51,0.3)",
                    }}
                  >
                    <Text style={{ fontFamily: "Manrope_700Bold", color: "#FF9933", fontSize: 12 }}>Enable Notifications</Text>
                  </Pressable>
                )}
              </View>
            </View>

            {/* Pre-Order from menu (full restaurant menu + checkout happens there) */}
            {entry_id && (
              <Animated.View entering={FadeInDown.delay(200).duration(400)} style={{ marginTop: 8 }}>
                <Text
                  style={{
                    fontFamily: "Manrope_500Medium",
                    color: "#999999",
                    fontSize: 13,
                    lineHeight: 19,
                    marginBottom: 10,
                  }}
                >
                  While you wait, tap below to open this restaurant’s menu—you can browse and pre-order from
                  there so your food is ready when you’re seated.
                </Text>
                <TouchableOpacity
                  onPress={() => {
                    if (Platform.OS !== 'web') Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Medium);
                    router.push(`/restaurant/${id}?waitlist_entry=${entry_id}` as any);
                  }}
                  className="flex-row items-center justify-center py-3 rounded-2xl"
                  style={{
                    backgroundColor: "rgba(255,153,51,0.12)",
                    borderWidth: 1,
                    borderColor: "rgba(255,153,51,0.3)",
                  }}
                >
                  <UtensilsCrossed size={16} color="#FF9933" />
                  <Text
                    style={{
                      fontFamily: "Manrope_700Bold",
                      color: "#FF9933",
                      fontSize: 14,
                      marginLeft: 8,
                    }}
                  >
                    Pre-Order from Menu →
                  </Text>
                </TouchableOpacity>
              </Animated.View>
            )}

            {/* Share & Start Group Order Button */}
            <TouchableOpacity
              onPress={handleStartGroupOrder}
              disabled={creatingParty}
              className="flex-row items-center justify-center mt-3 py-3 rounded-2xl"
              style={{
                backgroundColor: "#1a1a1a",
                borderWidth: 1,
                borderColor: "#2a2a2a",
              }}
            >
              {creatingParty ? (
                <ActivityIndicator color="#FF9933" />
              ) : (
                <>
                  <Share2 size={16} color="#FF9933" />
                  <Text
                    style={{
                      fontFamily: "Manrope_700Bold",
                      color: "#FF9933",
                      fontSize: 14,
                      marginLeft: 8,
                    }}
                  >
                    Share & Start Group Order
                  </Text>
                </>
              )}
            </TouchableOpacity>
          </Animated.View>

        </ScrollView>

        {/* Bottom: quick link to full menu (ordering happens on restaurant screen) */}
        <View
          className="px-5 pt-3 pb-2"
          style={{
            borderTopWidth: 1,
            borderTopColor: "#222222",
            backgroundColor: "#0f0f0f",
          }}
        >
          <SafeAreaView edges={["bottom"]}>
            <Pressable
              onPress={() => {
                if (Platform.OS !== "web") {
                  Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
                }
                router.push(
                  entry_id
                    ? (`/restaurant/${restaurant.id}?waitlist_entry=${entry_id}` as any)
                    : (`/restaurant/${restaurant.id}` as any)
                );
              }}
              className="rounded-2xl py-4 items-center flex-row justify-center"
              style={{
                backgroundColor: "#1a1a1a",
                borderWidth: 1,
                borderColor: "#333333",
              }}
            >
              <UtensilsCrossed size={18} color="#FF9933" />
              <Text
                style={{
                  fontFamily: "BricolageGrotesque_700Bold",
                  color: "#f5f5f5",
                  fontSize: 16,
                  marginLeft: 8,
                }}
              >
                Browse Full Menu
              </Text>
            </Pressable>
          </SafeAreaView>
        </View>
      </SafeAreaView>

      {/* Seated / Enjoy Your Meal screen */}
      <Modal visible={showSeated} transparent animationType="fade" onRequestClose={() => { }}>
        <View
          style={{
            flex: 1,
            backgroundColor: "#0f0f0f",
            alignItems: "center",
            justifyContent: "center",
            padding: 32,
          }}
        >
          <Animated.View entering={FadeInDown.duration(380)} style={{ alignItems: "center" }}>
            <View
              style={{
                width: 100,
                height: 100,
                borderRadius: 50,
                backgroundColor: "rgba(255,153,51,0.15)",
                alignItems: "center",
                justifyContent: "center",
                marginBottom: 28,
                borderWidth: 2,
                borderColor: "rgba(255,153,51,0.4)",
              }}
            >
              <UtensilsCrossed size={44} color="#FF9933" />
            </View>
            <Text
              style={{
                fontFamily: "BricolageGrotesque_800ExtraBold",
                color: "#f5f5f5",
                fontSize: 34,
                textAlign: "center",
                marginBottom: 12,
                letterSpacing: -0.5,
              }}
            >
              Enjoy your meal!
            </Text>
            <Text
              style={{
                fontFamily: "Manrope_500Medium",
                color: "#999999",
                fontSize: 16,
                textAlign: "center",
                lineHeight: 24,
                marginBottom: 8,
              }}
            >
              {partyOwnerName ? `${partyOwnerName}'s party` : "Your party"} has been seated at {restaurant?.name}.
            </Text>
            <Text
              style={{
                fontFamily: "Manrope_400Regular",
                color: "#555",
                fontSize: 13,
                textAlign: "center",
              }}
            >
              Taking you back in a moment…
            </Text>
          </Animated.View>
        </View>
      </Modal>

      {/* Table Ready Notification */}
      <Modal visible={showTableReady} transparent animationType="fade" onRequestClose={() => { }}>
        <View
          style={{
            flex: 1,
            backgroundColor: "rgba(0,0,0,0.85)",
            alignItems: "center",
            justifyContent: "center",
            padding: 28,
          }}
        >
          <Animated.View
            entering={FadeInDown.duration(380)}
            style={{
              backgroundColor: "#1a1a1a",
              borderRadius: 28,
              padding: 32,
              alignItems: "center",
              borderWidth: 1.5,
              borderColor: "#22C55E",
              width: "100%",
              shadowColor: "#22C55E",
              shadowOffset: { width: 0, height: 0 },
              shadowOpacity: 0.4,
              shadowRadius: 24,
              elevation: 20,
            }}
          >
            {/* Pulsing icon */}
            <View
              style={{
                width: 80,
                height: 80,
                borderRadius: 40,
                backgroundColor: "rgba(34,197,94,0.15)",
                alignItems: "center",
                justifyContent: "center",
                marginBottom: 20,
                borderWidth: 2,
                borderColor: "rgba(34,197,94,0.4)",
              }}
            >
              <UtensilsCrossed size={36} color="#22C55E" />
            </View>

            <Text
              style={{
                fontFamily: "BricolageGrotesque_800ExtraBold",
                color: "#f5f5f5",
                fontSize: 28,
                textAlign: "center",
                marginBottom: 8,
              }}
            >
              Your Table is Ready!
            </Text>
            <Text
              style={{
                fontFamily: "Manrope_500Medium",
                color: "#999999",
                fontSize: 15,
                textAlign: "center",
                marginBottom: 32,
                lineHeight: 22,
              }}
            >
              {restaurant?.name} is ready for your party of {myPartySize}. Please head to the host stand.
            </Text>

            <Pressable
              onPress={() => {
                if (Platform.OS !== "web") Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Heavy);
                setShowTableReady(false);
              }}
              style={{
                backgroundColor: "#22C55E",
                borderRadius: 16,
                paddingVertical: 16,
                paddingHorizontal: 32,
                alignItems: "center",
                width: "100%",
              }}
            >
              <Text
                style={{
                  fontFamily: "BricolageGrotesque_700Bold",
                  color: "#0f0f0f",
                  fontSize: 18,
                }}
              >
                I&apos;m on my way! 🙌
              </Text>
            </Pressable>
          </Animated.View>
        </View>
      </Modal>

      <Modal visible={showRemovedModal} transparent animationType="fade">
        <View
          style={{
            flex: 1,
            backgroundColor: "rgba(0,0,0,0.88)",
            justifyContent: "center",
            padding: 24,
          }}
        >
          <View
            style={{
              backgroundColor: "#1a1a1a",
              borderRadius: 22,
              padding: 24,
              borderWidth: 1.5,
              borderColor: "rgba(239,68,68,0.45)",
            }}
          >
            <View style={{ alignItems: "center", marginBottom: 16 }}>
              <AlertTriangle size={48} color="#EF4444" />
            </View>
            <Text
              style={{
                fontFamily: "BricolageGrotesque_800ExtraBold",
                color: "#f5f5f5",
                fontSize: 22,
                textAlign: "center",
                marginBottom: 10,
              }}
            >
              Removed from waitlist
            </Text>
            <Text
              style={{
                fontFamily: "Manrope_500Medium",
                color: "#999",
                fontSize: 15,
                textAlign: "center",
                lineHeight: 22,
                marginBottom: 24,
              }}
            >
              You have been removed from the waitlist. If you believe this was a mistake, contact a staff
              member.
            </Text>
            <Pressable
              onPress={() => {
                setShowRemovedModal(false);
                router.back();
              }}
              style={{
                backgroundColor: "#EF4444",
                borderRadius: 14,
                paddingVertical: 14,
                alignItems: "center",
              }}
            >
              <Text
                style={{
                  fontFamily: "BricolageGrotesque_700Bold",
                  color: "#fff",
                  fontSize: 16,
                }}
              >
                OK
              </Text>
            </Pressable>
          </View>
        </View>
      </Modal>
    </View>
  );
}
