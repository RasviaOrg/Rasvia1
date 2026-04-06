import React, { useEffect, useMemo, useState } from "react";
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
  Switch,
} from "react-native";
import { X, Check, MapPin, ChevronLeft, Clock3 } from "lucide-react-native";
import * as Haptics from "expo-haptics";
import { supabase } from "@/lib/supabase";

interface RestaurantEditModalProps {
  restaurantId: string;
  visible?: boolean;
  initial?: {
    name: string;
    address: string;
    description: string;
    cuisine: string;
  };
  onClose: () => void;
  onSaved?: (updated: { name: string; address: string; description: string; cuisine: string }) => void;
  onChangeLocation?: () => void;
  onHoursSaved?: () => void;
  openHoursOnMount?: boolean;
}

type HourRow = { day: number; open: string; close: string; closed: boolean };
type Mode = "details" | "hours";

const DAY_NAMES = ["Sunday", "Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday"];

const toHHMM = (value: string | null | undefined, fallback: string) => {
  if (!value) return fallback;
  return value.slice(0, 5);
};

const toDbTime = (hhmm: string) => `${hhmm}:00`;
const validHHMM = (value: string) => /^([01]\d|2[0-3]):([0-5]\d)$/.test(value);
const normalizeTag = (value: string) => value.trim().toLowerCase();

export function RestaurantEditModal({
  restaurantId,
  visible = true,
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
  const [isHalalTagged, setIsHalalTagged] = useState(true);
  const [isVegetarianTagged, setIsVegetarianTagged] = useState(false);

  const [mode, setMode] = useState<Mode>(openHoursOnMount ? "hours" : "details");
  const [saving, setSaving] = useState(false);
  const [hoursLoading, setHoursLoading] = useState(false);
  const [hoursSaving, setHoursSaving] = useState(false);
  const [hoursRows, setHoursRows] = useState<HourRow[]>([]);
  const [waitlistEarlyEnabled, setWaitlistEarlyEnabled] = useState(false);
  const [waitlistEarlyMinutes, setWaitlistEarlyMinutes] = useState("30");

  const haptic = () => {
    if (Platform.OS !== "web") Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
  };

  useEffect(() => {
    setName(initial?.name ?? "");
    setAddress(initial?.address ?? "");
    setDescription(initial?.description ?? "");
    setCuisine(initial?.cuisine ?? "");
    const parsedTags = (initial?.cuisine ?? "")
      .split(",")
      .map(normalizeTag)
      .filter(Boolean);
    const hasHalal = parsedTags.some((t) => t.includes("halal"));
    const hasVegetarian = parsedTags.some(
      (t) => t.includes("vegetarian") || t.includes("vegan") || t === "veg"
    );
    // Product defaults requested by owner flow.
    setIsHalalTagged(parsedTags.length === 0 ? true : hasHalal);
    setIsVegetarianTagged(hasVegetarian);
  }, [initial]);

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

      const { data: restEarly } = await supabase
        .from("restaurants")
        .select("waitlist_early_open_enabled, waitlist_early_open_minutes")
        .eq("id", Number(restaurantId))
        .maybeSingle();
      setWaitlistEarlyEnabled(restEarly?.waitlist_early_open_enabled === true);
      setWaitlistEarlyMinutes(
        String(
          Math.max(0, Math.min(24 * 60, Number(restEarly?.waitlist_early_open_minutes) || 30)),
        ),
      );

      const next: HourRow[] = Array.from({ length: 7 }).map((_, day) => {
        const row = (data ?? []).find((r: any) => r.day_of_week === day);
        return {
          day,
          open: toHHMM(row?.open_time, "09:00"),
          close: toHHMM(row?.close_time, "21:00"),
          closed: !row,
        };
      });
      setHoursRows(next);
    } catch (err: any) {
      Alert.alert("Error", err.message || "Failed to load hours.");
      setMode("details");
    } finally {
      setHoursLoading(false);
    }
  };

  useEffect(() => {
    if (!visible) return;
    if (openHoursOnMount) {
      setMode("hours");
      fetchHours();
    } else {
      setMode("details");
    }
    // restaurantId change should force fresh hours
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [visible, openHoursOnMount, restaurantId]);

  const handleClose = () => {
    onClose();
  };

  const openHoursEditor = () => {
    haptic();
    setMode("hours");
    fetchHours();
  };

  const backFromHours = () => {
    if (openHoursOnMount) {
      onClose();
      return;
    }
    setMode("details");
  };

  const updateHourRow = (day: number, patch: Partial<HourRow>) => {
    setHoursRows((prev) => prev.map((r) => (r.day === day ? { ...r, ...patch } : r)));
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
      const filteredCustomTags = cuisineTags.filter((tag) => {
        const n = normalizeTag(tag);
        return !(
          n.includes("halal") ||
          n.includes("vegetarian") ||
          n.includes("vegan") ||
          n === "veg"
        );
      });
      const nextTags = [...filteredCustomTags];
      if (isHalalTagged) nextTags.push("halal");
      if (isVegetarianTagged) nextTags.push("vegetarian");
      const dedupedTags = Array.from(
        new Map(nextTags.map((tag) => [normalizeTag(tag), tag.trim()])).values()
      );

      const { error } = await supabase
        .from("restaurants")
        .update({
          name: name.trim(),
          address: address.trim() || null,
          description: description.trim() || null,
          cuisine_tags: dedupedTags.length > 0 ? dedupedTags : null,
        })
        .eq("id", Number(restaurantId));

      if (error) throw error;

      onSaved?.({
        name: name.trim(),
        address: address.trim(),
        description: description.trim(),
        cuisine: dedupedTags.join(", "),
      });
    } catch (err: any) {
      Alert.alert("Error", err.message || "Failed to save changes.");
    } finally {
      setSaving(false);
    }
  };

  const saveHours = async () => {
    for (const row of hoursRows) {
      if (row.closed) continue;
      if (!validHHMM(row.open) || !validHHMM(row.close)) {
        Alert.alert("Validation", `Invalid time on ${DAY_NAMES[row.day]}. Use HH:MM (24-hour).`);
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
        const { error: insError } = await supabase.from("restaurant_hours").insert(toInsert);
        if (insError) throw insError;
      }

      const earlyM = Math.max(0, Math.min(24 * 60, parseInt(waitlistEarlyMinutes.replace(/\D/g, ""), 10) || 0));
      const { error: earlyErr } = await supabase
        .from("restaurants")
        .update({
          waitlist_early_open_enabled: waitlistEarlyEnabled,
          waitlist_early_open_minutes: earlyM,
        })
        .eq("id", Number(restaurantId));
      if (earlyErr) throw earlyErr;

      Alert.alert("Saved", "Restaurant timings updated.");
      onHoursSaved?.();
      if (openHoursOnMount) onClose();
      else setMode("details");
    } catch (err: any) {
      Alert.alert("Error", err.message || "Failed to save hours.");
    } finally {
      setHoursSaving(false);
    }
  };

  const inputStyle = useMemo(
    () => ({
      backgroundColor: "#0f0f0f",
      borderRadius: 12,
      borderWidth: 1,
      borderColor: "#2a2a2a",
      paddingHorizontal: 14,
      paddingVertical: 12,
      color: "#f5f5f5" as const,
      fontFamily: "Manrope_500Medium",
      fontSize: 15,
    }),
    []
  );

  const labelStyle = useMemo(
    () => ({
      fontFamily: "Manrope_600SemiBold" as const,
      color: "#999999",
      fontSize: 12,
      textTransform: "uppercase" as const,
      letterSpacing: 1,
      marginBottom: 8,
    }),
    []
  );

  if (!visible) return null;

  return (
    <Modal visible transparent animationType="slide" onRequestClose={handleClose}>
      <KeyboardAvoidingView style={{ flex: 1 }} behavior={Platform.OS === "ios" ? "padding" : undefined}>
        <View style={{ flex: 1, backgroundColor: "rgba(0,0,0,0.56)", justifyContent: "flex-end" }}>
          <Pressable style={{ flex: 1 }} onPress={handleClose} />
          <View
            style={{
              backgroundColor: "#1a1a1a",
              borderTopLeftRadius: 24,
              borderTopRightRadius: 24,
              borderWidth: 1,
              borderColor: "#2a2a2a",
              paddingHorizontal: 20,
              paddingTop: 18,
              paddingBottom: Platform.OS === "ios" ? 24 : 14,
              maxHeight: "90%",
            }}
          >
            <View
              style={{
                flexDirection: "row",
                justifyContent: "space-between",
                alignItems: "center",
                marginBottom: 12,
              }}
            >
              <View style={{ flexDirection: "row", alignItems: "center", gap: 8 }}>
                {mode === "hours" && !openHoursOnMount && (
                  <Pressable onPress={backFromHours} hitSlop={8} style={{ padding: 4 }}>
                    <ChevronLeft size={20} color="#aaa" />
                  </Pressable>
                )}
                {mode === "hours" && openHoursOnMount && (
                  <Clock3 size={18} color="#FF9933" />
                )}
                <Text style={{ fontFamily: "BricolageGrotesque_700Bold", color: "#f5f5f5", fontSize: 20 }}>
                  {mode === "hours" ? "Restaurant Timings" : "Edit Restaurant"}
                </Text>
              </View>
              <Pressable onPress={mode === "hours" ? backFromHours : handleClose} style={{ padding: 8, backgroundColor: "#2a2a2a", borderRadius: 12 }}>
                <X color="#999999" size={20} />
              </Pressable>
            </View>

            {mode === "details" ? (
              <ScrollView showsVerticalScrollIndicator={false} keyboardShouldPersistTaps="handled">
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
                  <Text style={{ fontFamily: "Manrope_500Medium", color: "#555", fontSize: 11, marginTop: 6, marginLeft: 2 }}>
                    Separate multiple tags with commas
                  </Text>
                </View>
                <View style={{ marginBottom: 22 }}>
                  <Text style={labelStyle}>Dietary Tags</Text>
                  <View style={{ flexDirection: "row", gap: 10 }}>
                    <Pressable
                      onPress={() => {
                        haptic();
                        setIsHalalTagged((prev) => !prev);
                      }}
                      style={{
                        flex: 1,
                        borderRadius: 12,
                        borderWidth: 1,
                        borderColor: isHalalTagged ? "rgba(37,99,235,0.45)" : "#2a2a2a",
                        backgroundColor: isHalalTagged ? "rgba(37,99,235,0.14)" : "#121212",
                        paddingVertical: 12,
                        alignItems: "center",
                      }}
                    >
                      <Text style={{ fontFamily: "Manrope_700Bold", fontSize: 12, color: isHalalTagged ? "#60A5FA" : "#888" }}>
                        HALAL {isHalalTagged ? "ON" : "OFF"}
                      </Text>
                    </Pressable>
                    <Pressable
                      onPress={() => {
                        haptic();
                        setIsVegetarianTagged((prev) => !prev);
                      }}
                      style={{
                        flex: 1,
                        borderRadius: 12,
                        borderWidth: 1,
                        borderColor: isVegetarianTagged ? "rgba(34,197,94,0.45)" : "#2a2a2a",
                        backgroundColor: isVegetarianTagged ? "rgba(34,197,94,0.14)" : "#121212",
                        paddingVertical: 12,
                        alignItems: "center",
                      }}
                    >
                      <Text style={{ fontFamily: "Manrope_700Bold", fontSize: 12, color: isVegetarianTagged ? "#22C55E" : "#888" }}>
                        VEGETARIAN {isVegetarianTagged ? "ON" : "OFF"}
                      </Text>
                    </Pressable>
                  </View>
                </View>

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
                      <Text style={{ fontFamily: "BricolageGrotesque_700Bold", color: "#0f0f0f", fontSize: 16 }}>Save Changes</Text>
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
                      backgroundColor: "rgba(168,85,247,0.14)",
                      borderRadius: 14,
                      padding: 14,
                      alignItems: "center",
                      flexDirection: "row",
                      justifyContent: "center",
                      gap: 8,
                      borderWidth: 1,
                      borderColor: "rgba(168,85,247,0.45)",
                    }}
                  >
                    <MapPin size={17} color="#A855F7" />
                    <Text style={{ fontFamily: "BricolageGrotesque_700Bold", color: "#A855F7", fontSize: 15 }}>
                      Change Location
                    </Text>
                  </Pressable>
                )}

                <Pressable
                  onPress={openHoursEditor}
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
            ) : (
              <>
                <Text style={{ fontFamily: "Manrope_500Medium", color: "#666", fontSize: 13, marginBottom: 12 }}>
                  Set opening and closing hours (24-hour format).
                </Text>
                {hoursLoading ? (
                  <View style={{ paddingVertical: 48, alignItems: "center" }}>
                    <ActivityIndicator size="large" color="#FF9933" />
                  </View>
                ) : (
                  <ScrollView showsVerticalScrollIndicator={false} contentContainerStyle={{ paddingBottom: 10 }}>
                    <View
                      style={{
                        borderWidth: 1,
                        borderColor: "#2a2a2a",
                        borderRadius: 14,
                        padding: 14,
                        marginBottom: 14,
                        backgroundColor: "#111",
                      }}
                    >
                      <View style={{ flexDirection: "row", alignItems: "center", justifyContent: "space-between", gap: 12 }}>
                        <View style={{ flex: 1 }}>
                          <Text style={{ fontFamily: "Manrope_600SemiBold", color: "#e5e5e5", fontSize: 14 }}>
                            Early waitlist window
                          </Text>
                          <Text style={{ fontFamily: "Manrope_500Medium", color: "#666", fontSize: 12, marginTop: 4 }}>
                            Allow opening the waitlist this many minutes before the first scheduled open (same day).
                          </Text>
                        </View>
                        <Switch
                          value={waitlistEarlyEnabled}
                          onValueChange={setWaitlistEarlyEnabled}
                          trackColor={{ false: "#333", true: "rgba(255,153,51,0.45)" }}
                          thumbColor={waitlistEarlyEnabled ? "#FF9933" : "#888"}
                        />
                      </View>
                      {waitlistEarlyEnabled && (
                        <View style={{ marginTop: 12 }}>
                          <Text style={labelStyle}>Minutes before open</Text>
                          <TextInput
                            value={waitlistEarlyMinutes}
                            onChangeText={setWaitlistEarlyMinutes}
                            keyboardType="number-pad"
                            style={inputStyle}
                            placeholder="30"
                            placeholderTextColor="#555"
                          />
                        </View>
                      )}
                    </View>
                    {hoursRows.map((row) => (
                      <View
                        key={row.day}
                        style={{
                          borderWidth: 1,
                          borderColor: row.closed ? "#222" : "#2a2a2a",
                          borderRadius: 14,
                          backgroundColor: row.closed ? "#0d0d0d" : "#111",
                          padding: 14,
                          marginBottom: 8,
                          opacity: row.closed ? 0.72 : 1,
                        }}
                      >
                        <View style={{ flexDirection: "row", justifyContent: "space-between", alignItems: "center", marginBottom: row.closed ? 0 : 12 }}>
                          <Text style={{ fontFamily: "Manrope_700Bold", color: row.closed ? "#666" : "#f5f5f5", fontSize: 15 }}>
                            {DAY_NAMES[row.day]}
                          </Text>
                          <Pressable
                            onPress={() => {
                              haptic();
                              updateHourRow(row.day, { closed: !row.closed });
                            }}
                            style={{
                              backgroundColor: row.closed ? "rgba(239,68,68,0.12)" : "rgba(34,197,94,0.12)",
                              borderWidth: 1,
                              borderColor: row.closed ? "rgba(239,68,68,0.35)" : "rgba(34,197,94,0.35)",
                              borderRadius: 20,
                              paddingHorizontal: 12,
                              paddingVertical: 6,
                            }}
                          >
                            <Text style={{ fontFamily: "Manrope_700Bold", color: row.closed ? "#EF4444" : "#22C55E", fontSize: 11 }}>
                              {row.closed ? "Closed" : "Open"}
                            </Text>
                          </Pressable>
                        </View>

                        {!row.closed && (
                          <View style={{ flexDirection: "row", gap: 10 }}>
                            <View style={{ flex: 1 }}>
                              <Text style={{ fontFamily: "Manrope_600SemiBold", fontSize: 10, color: "#555", letterSpacing: 0.6, textTransform: "uppercase", marginBottom: 6 }}>
                                Opens
                              </Text>
                              <TextInput
                                value={row.open}
                                onChangeText={(t) => updateHourRow(row.day, { open: t.replace(/[^\d:]/g, "").slice(0, 5) })}
                                placeholder="09:00"
                                placeholderTextColor="#444"
                                keyboardType="numbers-and-punctuation"
                                style={{
                                  backgroundColor: "#0a0a0a",
                                  borderColor: "#2a2a2a",
                                  borderWidth: 1,
                                  borderRadius: 10,
                                  paddingHorizontal: 14,
                                  paddingVertical: 11,
                                  color: "#f5f5f5",
                                  fontFamily: "JetBrainsMono_600SemiBold",
                                  fontSize: 16,
                                  textAlign: "center",
                                }}
                              />
                            </View>
                            <View style={{ justifyContent: "flex-end", paddingBottom: 14 }}>
                              <Text style={{ fontFamily: "Manrope_500Medium", color: "#444", fontSize: 13 }}>to</Text>
                            </View>
                            <View style={{ flex: 1 }}>
                              <Text style={{ fontFamily: "Manrope_600SemiBold", fontSize: 10, color: "#555", letterSpacing: 0.6, textTransform: "uppercase", marginBottom: 6 }}>
                                Closes
                              </Text>
                              <TextInput
                                value={row.close}
                                onChangeText={(t) => updateHourRow(row.day, { close: t.replace(/[^\d:]/g, "").slice(0, 5) })}
                                placeholder="21:00"
                                placeholderTextColor="#444"
                                keyboardType="numbers-and-punctuation"
                                style={{
                                  backgroundColor: "#0a0a0a",
                                  borderColor: "#2a2a2a",
                                  borderWidth: 1,
                                  borderRadius: 10,
                                  paddingHorizontal: 14,
                                  paddingVertical: 11,
                                  color: "#f5f5f5",
                                  fontFamily: "JetBrainsMono_600SemiBold",
                                  fontSize: 16,
                                  textAlign: "center",
                                }}
                              />
                            </View>
                          </View>
                        )}
                      </View>
                    ))}
                  </ScrollView>
                )}

                <View
                  style={{
                    borderTopWidth: 1,
                    borderTopColor: "#2a2a2a",
                    marginHorizontal: -20,
                    marginTop: 6,
                    paddingTop: 12,
                    paddingHorizontal: 20,
                    paddingBottom: Platform.OS === "ios" ? 10 : 8,
                    backgroundColor: "#1a1a1a",
                  }}
                >
                  <Pressable
                    onPress={saveHours}
                    disabled={hoursSaving || hoursLoading}
                    style={{
                      backgroundColor: "#FF9933",
                      borderRadius: 14,
                      paddingVertical: 15,
                      alignItems: "center",
                      flexDirection: "row",
                      justifyContent: "center",
                      gap: 8,
                      opacity: hoursSaving || hoursLoading ? 0.75 : 1,
                    }}
                  >
                    {hoursSaving ? (
                      <ActivityIndicator size="small" color="#0f0f0f" />
                    ) : (
                      <>
                        <Check size={18} color="#0f0f0f" strokeWidth={2.5} />
                        <Text style={{ fontFamily: "BricolageGrotesque_700Bold", color: "#0f0f0f", fontSize: 16 }}>
                          Save Timings
                        </Text>
                      </>
                    )}
                  </Pressable>
                </View>
              </>
            )}
          </View>
        </View>
      </KeyboardAvoidingView>
    </Modal>
  );
}
