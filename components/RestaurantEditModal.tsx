import React, { useEffect, useState } from "react";
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
  KeyboardAvoidingView,
} from "react-native";
import { X, Check, MapPin } from "lucide-react-native";
import * as Haptics from "expo-haptics";
import { supabase } from "@/lib/supabase";

interface RestaurantEditModalProps {
  restaurantId: string;
  initial?: {
    name: string;
    address: string;
    description: string;
    cuisine: string; // comma-separated tags
  };
  onClose: () => void;
  onSaved?: (updated: { name: string; address: string; description: string; cuisine: string }) => void;
  onChangeLocation?: () => void;
  onHoursSaved?: () => void;
  openHoursOnMount?: boolean;
}

export function RestaurantEditModal({
  restaurantId,
  initial,
  onClose,
  onSaved,
  onChangeLocation,
  onHoursSaved,
  openHoursOnMount,
}: RestaurantEditModalProps) {
  const [name, setName] = useState(initial?.name ?? "");
  const [address, setAddress] = useState(initial?.address ?? "");
  const [description, setDescription] = useState(initial?.description ?? "");
  const [cuisine, setCuisine] = useState(initial?.cuisine ?? "");
  const [saving, setSaving] = useState(false);
  const [showHoursModal, setShowHoursModal] = useState(false);
  const [hoursLoading, setHoursLoading] = useState(false);
  const [hoursSaving, setHoursSaving] = useState(false);
  const [hoursRows, setHoursRows] = useState<
    Array<{ day: number; open: string; close: string; closed: boolean }>
  >([]);

  const haptic = () => {
    if (Platform.OS !== "web") Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
  };

  const handleSave = async () => {
    if (!name.trim()) {
      Alert.alert("Validation", "Restaurant name is required.");
      return;
    }
    haptic();
    setSaving(true);
    try {
      const cuisineTags = cuisine
        .split(",")
        .map((t) => t.trim())
        .filter(Boolean);

      const { error } = await supabase
        .from("restaurants")
        .update({
          name: name.trim(),
          address: address.trim() || null,
          description: description.trim() || null,
          cuisine_tags: cuisineTags.length > 0 ? cuisineTags : null,
        })
        .eq("id", Number(restaurantId));

      if (error) throw error;

      onSaved?.({
        name: name.trim(),
        address: address.trim(),
        description: description.trim(),
        cuisine: cuisineTags.join(", "),
      });
    } catch (err: any) {
      Alert.alert("Error", err.message || "Failed to save changes.");
    } finally {
      setSaving(false);
    }
  };

  const dayNames = ["Sunday", "Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday"];

  const toHHMM = (value: string | null | undefined, fallback: string) => {
    if (!value) return fallback;
    return value.slice(0, 5);
  };

  const fetchHours = async () => {
    setHoursLoading(true);
    try {
      const { data, error } = await supabase
        .from("restaurant_hours")
        .select("day_of_week, open_time, close_time")
        .eq("restaurant_id", Number(restaurantId))
        .order("day_of_week")
        .order("open_time");
      if (error) throw error;

      const next = Array.from({ length: 7 }).map((_, day) => {
        const row = (data ?? []).find((r: any) => r.day_of_week === day);
        return {
          day,
          open: toHHMM(row?.open_time, "09:00"),
          close: toHHMM(row?.close_time, "21:00"),
          closed: !row,
        };
      });
      setHoursRows(next);
      setShowHoursModal(true);
    } catch (err: any) {
      Alert.alert("Error", err.message || "Failed to load hours.");
    } finally {
      setHoursLoading(false);
    }
  };

  useEffect(() => {
    if (openHoursOnMount) {
      setShowHoursModal(true);
      fetchHours();
    }
    // only trigger when opening this modal variant
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [openHoursOnMount]);

  const closeHoursOverlay = () => {
    if (openHoursOnMount) {
      onClose();
      return;
    }
    setShowHoursModal(false);
  };

  const updateHourRow = (day: number, patch: Partial<{ open: string; close: string; closed: boolean }>) => {
    setHoursRows((prev) =>
      prev.map((r) => (r.day === day ? { ...r, ...patch } : r))
    );
  };

  const toDbTime = (hhmm: string) => `${hhmm}:00`;
  const validHHMM = (value: string) => /^([01]\d|2[0-3]):([0-5]\d)$/.test(value);

  const saveHours = async () => {
    for (const row of hoursRows) {
      if (row.closed) continue;
      if (!validHHMM(row.open) || !validHHMM(row.close)) {
        Alert.alert("Validation", `Invalid time on ${dayNames[row.day]}. Use HH:MM (24-hour).`);
        return;
      }
    }

    setHoursSaving(true);
    try {
      const { error: delError } = await supabase
        .from("restaurant_hours")
        .delete()
        .eq("restaurant_id", Number(restaurantId));
      if (delError) throw delError;

      const toInsert = hoursRows
        .filter((r) => !r.closed)
        .map((r) => ({
          restaurant_id: Number(restaurantId),
          day_of_week: r.day,
          open_time: toDbTime(r.open),
          close_time: toDbTime(r.close),
        }));

      if (toInsert.length > 0) {
        const { error: insError } = await supabase
          .from("restaurant_hours")
          .insert(toInsert);
        if (insError) throw insError;
      }

      closeHoursOverlay();
      Alert.alert("Saved", "Restaurant timings updated.");
      onHoursSaved?.();
    } catch (err: any) {
      Alert.alert("Error", err.message || "Failed to save hours.");
    } finally {
      setHoursSaving(false);
    }
  };

  const inputStyle = {
    backgroundColor: "#0f0f0f",
    borderRadius: 12,
    borderWidth: 1,
    borderColor: "#2a2a2a",
    paddingHorizontal: 14,
    paddingVertical: 12,
    color: "#f5f5f5" as const,
    fontFamily: "Manrope_500Medium",
    fontSize: 15,
  };

  const labelStyle = {
    fontFamily: "Manrope_600SemiBold" as const,
    color: "#999999",
    fontSize: 12,
    textTransform: "uppercase" as const,
    letterSpacing: 1,
    marginBottom: 8,
  };

  const showMainSettingsModal = !openHoursOnMount || !showHoursModal;

  return (
    <>
    <Modal visible={showMainSettingsModal} transparent animationType="slide" onRequestClose={onClose}>
      <KeyboardAvoidingView
        style={{ flex: 1 }}
        behavior={Platform.OS === "ios" ? "padding" : undefined}
      >
        <View style={{ flex: 1, backgroundColor: "rgba(0,0,0,0.5)", justifyContent: "flex-end" }}>
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
              maxHeight: "90%",
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
                }}
              >
                Edit Restaurant
              </Text>
              <Pressable
                onPress={() => { haptic(); onClose(); }}
                style={{ padding: 8, backgroundColor: "#2a2a2a", borderRadius: 12 }}
              >
                <X color="#999999" size={22} />
              </Pressable>
            </View>

            <ScrollView showsVerticalScrollIndicator={false} keyboardShouldPersistTaps="handled">
              {/* Name */}
              <View style={{ marginBottom: 18 }}>
                <Text style={labelStyle}>Name</Text>
                <TextInput
                  value={name}
                  onChangeText={setName}
                  style={inputStyle}
                  placeholder="Restaurant name"
                  placeholderTextColor="#555"
                  autoCorrect={false}
                />
              </View>

              {/* Address */}
              <View style={{ marginBottom: 18 }}>
                <Text style={labelStyle}>Address</Text>
                <TextInput
                  value={address}
                  onChangeText={setAddress}
                  style={inputStyle}
                  placeholder="Full address"
                  placeholderTextColor="#555"
                  autoCorrect={false}
                />
              </View>

              {/* Description */}
              <View style={{ marginBottom: 18 }}>
                <Text style={labelStyle}>Description</Text>
                <TextInput
                  value={description}
                  onChangeText={setDescription}
                  style={[inputStyle, { minHeight: 90, textAlignVertical: "top" }]}
                  placeholder="Short description"
                  placeholderTextColor="#555"
                  multiline
                  numberOfLines={4}
                />
              </View>

              {/* Cuisine */}
              <View style={{ marginBottom: 24 }}>
                <Text style={labelStyle}>Cuisine Tags</Text>
                <TextInput
                  value={cuisine}
                  onChangeText={setCuisine}
                  style={inputStyle}
                  placeholder="e.g. Indian, Curry, Vegetarian"
                  placeholderTextColor="#555"
                  autoCorrect={false}
                />
                <Text
                  style={{
                    fontFamily: "Manrope_500Medium",
                    color: "#555",
                    fontSize: 11,
                    marginTop: 6,
                    marginLeft: 2,
                  }}
                >
                  Separate multiple tags with commas
                </Text>
              </View>

              {/* Save button */}
              <Pressable
                onPress={handleSave}
                disabled={saving}
                style={{
                  backgroundColor: "#FF9933",
                  borderRadius: 14,
                  padding: 16,
                  alignItems: "center",
                  flexDirection: "row",
                  justifyContent: "center",
                  gap: 8,
                  opacity: saving ? 0.7 : 1,
                }}
              >
                {saving ? (
                  <ActivityIndicator size="small" color="#0f0f0f" />
                ) : (
                  <>
                    <Check size={18} color="#0f0f0f" strokeWidth={2.5} />
                    <Text
                      style={{
                        fontFamily: "BricolageGrotesque_700Bold",
                        color: "#0f0f0f",
                        fontSize: 16,
                      }}
                    >
                      Save Changes
                    </Text>
                  </>
                )}
              </Pressable>

              {onChangeLocation && (
                <Pressable
                  onPress={() => {
                    haptic();
                    onChangeLocation();
                  }}
                  style={{
                    marginTop: 12,
                    backgroundColor: "rgba(168, 85, 247, 0.14)",
                    borderRadius: 14,
                    padding: 14,
                    alignItems: "center",
                    flexDirection: "row",
                    justifyContent: "center",
                    gap: 8,
                    borderWidth: 1,
                    borderColor: "rgba(168, 85, 247, 0.45)",
                  }}
                >
                  <MapPin size={17} color="#A855F7" />
                  <Text
                    style={{
                      fontFamily: "BricolageGrotesque_700Bold",
                      color: "#A855F7",
                      fontSize: 15,
                    }}
                  >
                    Change Location
                  </Text>
                </Pressable>
              )}

              <Pressable
                onPress={() => {
                  haptic();
                  fetchHours();
                }}
                disabled={hoursLoading}
                style={{
                  marginTop: 12,
                  backgroundColor: "rgba(255,153,51,0.12)",
                  borderRadius: 14,
                  padding: 14,
                  alignItems: "center",
                  borderWidth: 1,
                  borderColor: "rgba(255,153,51,0.35)",
                  opacity: hoursLoading ? 0.7 : 1,
                }}
              >
                {hoursLoading ? (
                  <ActivityIndicator size="small" color="#FF9933" />
                ) : (
                  <Text style={{ fontFamily: "BricolageGrotesque_700Bold", color: "#FF9933", fontSize: 15 }}>
                    Adjust Timings
                  </Text>
                )}
              </Pressable>
            </ScrollView>
          </View>
        </View>
      </KeyboardAvoidingView>
    </Modal>

    <Modal visible={showHoursModal} transparent animationType="slide" onRequestClose={closeHoursOverlay}>
        <KeyboardAvoidingView style={{ flex: 1 }} behavior={Platform.OS === "ios" ? "padding" : undefined}>
          <View style={{ flex: 1, backgroundColor: "rgba(0,0,0,0.6)", justifyContent: "flex-end" }}>
            <Pressable style={{ flex: 1 }} onPress={closeHoursOverlay} />
            <View
              style={{
                backgroundColor: "#1a1a1a",
                borderTopLeftRadius: 24,
                borderTopRightRadius: 24,
                borderWidth: 1,
                borderColor: "#2a2a2a",
                padding: 20,
                paddingBottom: Platform.OS === "ios" ? 16 : 10,
                maxHeight: "88%",
              }}
            >
              <View style={{ flexDirection: "row", justifyContent: "space-between", alignItems: "center", marginBottom: 12 }}>
                <Text style={{ fontFamily: "BricolageGrotesque_700Bold", color: "#f5f5f5", fontSize: 20 }}>
                  Adjust Timings
                </Text>
                <Pressable onPress={closeHoursOverlay} style={{ padding: 6 }}>
                  <X color="#999999" size={22} />
                </Pressable>
              </View>

              <ScrollView
                showsVerticalScrollIndicator={false}
                contentContainerStyle={{ paddingBottom: 12 }}
              >
                {hoursRows.map((row) => (
                  <View
                    key={row.day}
                    style={{
                      borderWidth: 1,
                      borderColor: "#2a2a2a",
                      borderRadius: 12,
                      backgroundColor: "#101010",
                      padding: 12,
                      marginBottom: 10,
                    }}
                  >
                    <View style={{ flexDirection: "row", justifyContent: "space-between", alignItems: "center", marginBottom: 10 }}>
                      <Text style={{ fontFamily: "Manrope_700Bold", color: "#f5f5f5", fontSize: 14 }}>
                        {dayNames[row.day]}
                      </Text>
                      <Pressable
                        onPress={() => updateHourRow(row.day, { closed: !row.closed })}
                        style={{
                          backgroundColor: row.closed ? "rgba(239,68,68,0.14)" : "rgba(34,197,94,0.14)",
                          borderWidth: 1,
                          borderColor: row.closed ? "rgba(239,68,68,0.4)" : "rgba(34,197,94,0.4)",
                          borderRadius: 999,
                          paddingHorizontal: 10,
                          paddingVertical: 6,
                        }}
                      >
                        <Text style={{ fontFamily: "Manrope_700Bold", color: row.closed ? "#EF4444" : "#22C55E", fontSize: 11 }}>
                          {row.closed ? "Closed" : "Open"}
                        </Text>
                      </Pressable>
                    </View>

                    {!row.closed && (
                      <View style={{ flexDirection: "row", gap: 8 }}>
                        <TextInput
                          value={row.open}
                          onChangeText={(t) => updateHourRow(row.day, { open: t.replace(/[^\d:]/g, "").slice(0, 5) })}
                          placeholder="09:00"
                          placeholderTextColor="#666"
                          style={{
                            flex: 1,
                            backgroundColor: "#0f0f0f",
                            borderColor: "#2a2a2a",
                            borderWidth: 1,
                            borderRadius: 10,
                            paddingHorizontal: 12,
                            paddingVertical: 10,
                            color: "#f5f5f5",
                            fontFamily: "JetBrainsMono_600SemiBold",
                          }}
                        />
                        <TextInput
                          value={row.close}
                          onChangeText={(t) => updateHourRow(row.day, { close: t.replace(/[^\d:]/g, "").slice(0, 5) })}
                          placeholder="21:00"
                          placeholderTextColor="#666"
                          style={{
                            flex: 1,
                            backgroundColor: "#0f0f0f",
                            borderColor: "#2a2a2a",
                            borderWidth: 1,
                            borderRadius: 10,
                            paddingHorizontal: 12,
                            paddingVertical: 10,
                            color: "#f5f5f5",
                            fontFamily: "JetBrainsMono_600SemiBold",
                          }}
                        />
                      </View>
                    )}
                  </View>
                ))}
              </ScrollView>

              <View
                style={{
                  borderTopWidth: 1,
                  borderTopColor: "#2a2a2a",
                  marginHorizontal: -20,
                  marginTop: 6,
                  paddingTop: 12,
                  paddingHorizontal: 20,
                  paddingBottom: Platform.OS === "ios" ? 18 : 10,
                  backgroundColor: "#1a1a1a",
                }}
              >
                <Pressable
                  onPress={saveHours}
                  disabled={hoursSaving}
                  style={{
                    backgroundColor: "#FF9933",
                    borderRadius: 12,
                    paddingVertical: 14,
                    alignItems: "center",
                    opacity: hoursSaving ? 0.75 : 1,
                  }}
                >
                  {hoursSaving ? (
                    <ActivityIndicator size="small" color="#0f0f0f" />
                  ) : (
                    <Text style={{ fontFamily: "BricolageGrotesque_700Bold", color: "#0f0f0f", fontSize: 15 }}>
                      Save Timings
                    </Text>
                  )}
                </Pressable>
              </View>
            </View>
          </View>
        </KeyboardAvoidingView>
      </Modal>
    </>
  );
}
