import React, { useState } from "react";
import {
  View,
  Text,
  Pressable,
  Modal,
  Alert,
  ActivityIndicator,
  Platform,
  ScrollView,
  TextInput,
} from "react-native";
import { X, MapPin } from "lucide-react-native";
import * as Haptics from "expo-haptics";
import { supabase } from "@/lib/supabase";

interface AdminRestaurantPanelProps {
  restaurant: { id: string; name: string; waitTime: number; waitStatus: string; isEnabled: boolean };
  isWaitlistOpen: boolean;
  onClose: () => void;
  onUpdated: () => void;
  onAdjustLocation?: () => void;
}

export function AdminRestaurantPanel({
  restaurant,
  isWaitlistOpen,
  onClose,
  onUpdated,
  onAdjustLocation,
}: AdminRestaurantPanelProps) {
  const [enabledLoading, setEnabledLoading] = useState(false);
  const [isEnabled, setIsEnabled] = useState(restaurant.isEnabled);
  const [waitTimeLoading, setWaitTimeLoading] = useState<string | null>(null);
  const [emergencyLoading, setEmergencyLoading] = useState(false);
  const [customWaitTime, setCustomWaitTime] = useState("");

  const restaurantId = Number(restaurant.id);

  const haptic = () => {
    if (Platform.OS !== "web") {
      Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
    }
  };

  const handleEnabledToggle = async () => {
    haptic();
    setEnabledLoading(true);
    try {
      const { error } = await supabase
        .from("restaurants")
        .update({ is_enabled: !isEnabled })
        .eq("id", restaurantId);

      if (error) throw error;
      setIsEnabled(!isEnabled);
      onUpdated();
    } catch (err: any) {
      Alert.alert("Error", err.message || "Failed to update visibility.");
    } finally {
      setEnabledLoading(false);
    }
  };

  const handleWaitTimeOverride = async (minutes: number) => {
    haptic();
    const key = minutes === 999 ? "closed" : minutes === -1 ? "unknown" : `${minutes}`;
    setWaitTimeLoading(key);
    try {
      const { error } = await supabase
        .from("restaurants")
        .update({ current_wait_time: minutes })
        .eq("id", restaurantId);

      if (error) throw error;
      onUpdated();
    } catch (err: any) {
      Alert.alert("Error", (err as Error).message || "Failed to update wait time.");
    } finally {
      setWaitTimeLoading(null);
    }
  };

  const handleCustomWaitTime = async () => {
    const parsed = parseInt(customWaitTime.trim(), 10);
    if (isNaN(parsed) || parsed < 0) {
      Alert.alert("Invalid", "Please enter a valid number of minutes.");
      return;
    }
    haptic();
    setWaitTimeLoading("custom");
    try {
      const { error } = await supabase
        .from("restaurants")
        .update({ current_wait_time: parsed })
        .eq("id", restaurantId);

      if (error) throw error;
      setCustomWaitTime("");
      onUpdated();
    } catch (err: any) {
      Alert.alert("Error", (err as Error).message || "Failed to update wait time.");
    } finally {
      setWaitTimeLoading(null);
    }
  };

  const handleNotAccepting = async () => {
    haptic();
    setEmergencyLoading(true);
    try {
      const { error } = await supabase
        .from("restaurants")
        .update({ is_waitlist_open: false, current_wait_time: 999 })
        .eq("id", restaurantId);

      if (error) throw error;
      onUpdated();
    } catch (err: any) {
      Alert.alert("Error", (err as Error).message || "Failed to update status.");
    } finally {
      setEmergencyLoading(false);
    }
  };

  return (
    <Modal
      visible
      transparent
      animationType="slide"
      onRequestClose={onClose}
    >
      <View
        style={{
          flex: 1,
          backgroundColor: "rgba(0,0,0,0.5)",
          justifyContent: "flex-end",
        }}
      >
        <Pressable style={{ flex: 1 }} onPress={onClose} />
        <View
          style={{
            backgroundColor: "#1a1a1a",
            borderTopLeftRadius: 24,
            borderTopRightRadius: 24,
            padding: 24,
            paddingBottom: Platform.OS === "ios" ? 40 : 24,
            borderWidth: 1,
            borderColor: "#2a2a2a",
            maxHeight: "85%",
          }}
        >
          {/* Header */}
          <View
            style={{
              flexDirection: "row",
              justifyContent: "space-between",
              alignItems: "center",
              marginBottom: 24,
            }}
          >
            <Text
              style={{
                fontFamily: "BricolageGrotesque_700Bold",
                color: "#f5f5f5",
                fontSize: 20,
                flex: 1,
              }}
              numberOfLines={1}
            >
              {restaurant.name}
            </Text>
            <Pressable
              onPress={() => {
                haptic();
                onClose();
              }}
              style={{
                padding: 8,
                marginLeft: 8,
                backgroundColor: "#2a2a2a",
                borderRadius: 12,
              }}
            >
              <X color="#999999" size={22} />
            </Pressable>
          </View>

          <ScrollView showsVerticalScrollIndicator={false}>
            {/* Show Restaurant toggle */}
            <View style={{ marginBottom: 20 }}>
              <Text
                style={{
                  fontFamily: "Manrope_600SemiBold",
                  color: "#999999",
                  fontSize: 12,
                  textTransform: "uppercase",
                  letterSpacing: 1,
                  marginBottom: 10,
                }}
              >
                Visibility
              </Text>
              <Pressable
                onPress={handleEnabledToggle}
                disabled={enabledLoading}
                style={{
                  flexDirection: "row",
                  alignItems: "center",
                  justifyContent: "space-between",
                  backgroundColor: "#0f0f0f",
                  borderRadius: 12,
                  padding: 16,
                  borderWidth: 1,
                  borderColor: "#2a2a2a",
                  opacity: enabledLoading ? 0.7 : 1,
                }}
              >
                <Text
                  style={{
                    fontFamily: "Manrope_500Medium",
                    color: "#f5f5f5",
                    fontSize: 15,
                  }}
                >
                  Show Restaurant
                </Text>
                {enabledLoading ? (
                  <ActivityIndicator size="small" color="#FF9933" />
                ) : (
                  <View
                    style={{
                      width: 48,
                      height: 28,
                      borderRadius: 14,
                      backgroundColor: isEnabled ? "#22C55E" : "#333333",
                      padding: 2,
                      justifyContent: "center",
                    }}
                  >
                    <View
                      style={{
                        width: 24,
                        height: 24,
                        borderRadius: 12,
                        backgroundColor: "#f5f5f5",
                        alignSelf: isEnabled ? "flex-end" : "flex-start",
                      }}
                    />
                  </View>
                )}
              </Pressable>
            </View>

            {/* Location */}
            <View style={{ marginBottom: 20 }}>
              <Text
                style={{
                  fontFamily: "Manrope_600SemiBold",
                  color: "#999999",
                  fontSize: 12,
                  textTransform: "uppercase",
                  letterSpacing: 1,
                  marginBottom: 10,
                }}
              >
                Location
              </Text>
              <Pressable
                onPress={() => {
                  haptic();
                  onAdjustLocation?.();
                }}
                style={{
                  flexDirection: "row",
                  alignItems: "center",
                  backgroundColor: "rgba(168, 85, 247, 0.1)",
                  borderRadius: 12,
                  padding: 16,
                  borderWidth: 1,
                  borderColor: "rgba(168, 85, 247, 0.4)",
                }}
              >
                <MapPin size={16} color="#A855F7" />
                <Text
                  style={{
                    fontFamily: "Manrope_600SemiBold",
                    color: "#A855F7",
                    fontSize: 15,
                    marginLeft: 10,
                  }}
                >
                  Change Location
                </Text>
              </Pressable>
            </View>

            {/* Wait Time Override */}
            <View style={{ marginBottom: 20 }}>
              <Text
                style={{
                  fontFamily: "Manrope_600SemiBold",
                  color: "#999999",
                  fontSize: 12,
                  textTransform: "uppercase",
                  letterSpacing: 1,
                  marginBottom: 10,
                }}
              >
                Wait Time Override
              </Text>
              <View
                style={{
                  flexDirection: "row",
                  flexWrap: "wrap",
                  gap: 10,
                }}
              >
                {[5, 10, 15, 30, 45, 60].map((mins) => {
                  const loading = waitTimeLoading === `${mins}`;
                  return (
                    <Pressable
                      key={mins}
                      onPress={() => handleWaitTimeOverride(mins)}
                      disabled={!!waitTimeLoading}
                      style={{
                        backgroundColor: "#0f0f0f",
                        borderRadius: 20,
                        paddingHorizontal: 18,
                        paddingVertical: 12,
                        borderWidth: 1,
                        borderColor: "#2a2a2a",
                        minWidth: 56,
                        alignItems: "center",
                        opacity: loading ? 0.7 : 1,
                      }}
                    >
                      {loading ? (
                        <ActivityIndicator size="small" color="#FF9933" />
                      ) : (
                        <Text
                          style={{
                            fontFamily: "JetBrainsMono_600SemiBold",
                            color: "#FF9933",
                            fontSize: 14,
                          }}
                        >
                          {mins}m
                        </Text>
                      )}
                    </Pressable>
                  );
                })}

                {/* Unknown button — clears wait time (grey status) */}
                <Pressable
                  onPress={() => handleWaitTimeOverride(-1)}
                  disabled={!!waitTimeLoading}
                  style={{
                    backgroundColor: "#0f0f0f",
                    borderRadius: 20,
                    paddingHorizontal: 18,
                    paddingVertical: 12,
                    borderWidth: 1,
                    borderColor: "#2a2a2a",
                    minWidth: 80,
                    alignItems: "center",
                    opacity: waitTimeLoading === "unknown" ? 0.7 : 1,
                  }}
                >
                  {waitTimeLoading === "unknown" ? (
                    <ActivityIndicator size="small" color="#999999" />
                  ) : (
                    <Text
                      style={{
                        fontFamily: "Manrope_600SemiBold",
                        color: "#999999",
                        fontSize: 13,
                      }}
                    >
                      Unknown
                    </Text>
                  )}
                </Pressable>

                {/* Closed button */}
                <Pressable
                  onPress={() => handleWaitTimeOverride(999)}
                  disabled={!!waitTimeLoading}
                  style={{
                    backgroundColor: "#0f0f0f",
                    borderRadius: 20,
                    paddingHorizontal: 18,
                    paddingVertical: 12,
                    borderWidth: 1,
                    borderColor: "#2a2a2a",
                    minWidth: 70,
                    alignItems: "center",
                    opacity: waitTimeLoading === "closed" ? 0.7 : 1,
                  }}
                >
                  {waitTimeLoading === "closed" ? (
                    <ActivityIndicator size="small" color="#999999" />
                  ) : (
                    <Text
                      style={{
                        fontFamily: "Manrope_600SemiBold",
                        color: "#999999",
                        fontSize: 13,
                      }}
                    >
                      Closed
                    </Text>
                  )}
                </Pressable>
              </View>

              {/* Custom wait time input */}
              <View
                style={{
                  flexDirection: "row",
                  alignItems: "center",
                  marginTop: 12,
                  gap: 10,
                }}
              >
                <TextInput
                  value={customWaitTime}
                  onChangeText={setCustomWaitTime}
                  keyboardType="number-pad"
                  placeholder="Custom minutes…"
                  placeholderTextColor="#555"
                  style={{
                    flex: 1,
                    backgroundColor: "#0f0f0f",
                    borderRadius: 12,
                    borderWidth: 1,
                    borderColor: "#2a2a2a",
                    paddingHorizontal: 14,
                    paddingVertical: 12,
                    color: "#f5f5f5",
                    fontFamily: "JetBrainsMono_600SemiBold",
                    fontSize: 14,
                  }}
                />
                <Pressable
                  onPress={handleCustomWaitTime}
                  disabled={!!waitTimeLoading || customWaitTime.trim() === ""}
                  style={{
                    backgroundColor: "#FF9933",
                    borderRadius: 12,
                    paddingHorizontal: 18,
                    paddingVertical: 12,
                    alignItems: "center",
                    opacity: (!!waitTimeLoading || customWaitTime.trim() === "") ? 0.4 : 1,
                  }}
                >
                  {waitTimeLoading === "custom" ? (
                    <ActivityIndicator size="small" color="#0f0f0f" />
                  ) : (
                    <Text
                      style={{
                        fontFamily: "Manrope_700Bold",
                        color: "#0f0f0f",
                        fontSize: 14,
                      }}
                    >
                      Set
                    </Text>
                  )}
                </Pressable>
              </View>
            </View>

            {/* Emergency: Not Accepting */}
            <View>
              <Text
                style={{
                  fontFamily: "Manrope_600SemiBold",
                  color: "#999999",
                  fontSize: 12,
                  textTransform: "uppercase",
                  letterSpacing: 1,
                  marginBottom: 10,
                }}
              >
                Emergency
              </Text>
              <Pressable
                onPress={handleNotAccepting}
                disabled={emergencyLoading}
                style={{
                  backgroundColor: "rgba(239, 68, 68, 0.15)",
                  borderRadius: 12,
                  padding: 16,
                  borderWidth: 1,
                  borderColor: "#EF4444",
                  alignItems: "center",
                  opacity: emergencyLoading ? 0.7 : 1,
                }}
              >
                {emergencyLoading ? (
                  <ActivityIndicator size="small" color="#EF4444" />
                ) : (
                  <Text
                    style={{
                      fontFamily: "BricolageGrotesque_700Bold",
                      color: "#EF4444",
                      fontSize: 15,
                    }}
                  >
                    Not Accepting Joiners
                  </Text>
                )}
              </Pressable>
            </View>
          </ScrollView>
        </View>
      </View>
    </Modal>
  );
}
