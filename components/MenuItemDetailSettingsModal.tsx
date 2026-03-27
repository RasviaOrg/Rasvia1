import React, { useEffect, useState } from "react";
import {
  Alert,
  KeyboardAvoidingView,
  Modal,
  Platform,
  Pressable,
  ScrollView,
  Text,
  TextInput,
  View,
  ActivityIndicator,
} from "react-native";
import { Camera, Flame, Image as ImageIcon, Leaf, Trash2, X } from "lucide-react-native";
import * as Haptics from "expo-haptics";
import * as ImagePicker from "expo-image-picker";
import { supabase } from "@/lib/supabase";
import type { UIMenuItem } from "@/lib/restaurant-types";

type MealTag = "breakfast" | "lunch" | "dinner" | "specials" | "all_day";
const BASE_MEAL_TAGS: MealTag[] = ["breakfast", "lunch", "dinner"];

function normalizeMealTimes(input: string[] | undefined | null): MealTag[] {
  const mapped = (input ?? [])
    .map((m) => (m === "special" ? "specials" : m))
    .map((m) => (m === "all" ? "all_day" : m))
    .filter((m): m is MealTag => ["breakfast", "lunch", "dinner", "specials", "all_day"].includes(m));
  if (mapped.includes("breakfast") && mapped.includes("lunch") && mapped.includes("dinner")) {
    return ["all_day", ...mapped.filter((m) => !BASE_MEAL_TAGS.includes(m as any))];
  }
  return Array.from(new Set(mapped));
}

function toggleMealTag(current: MealTag[], tag: MealTag): MealTag[] {
  const set = new Set(current);
  if (tag === "all_day") {
    if (set.has("all_day")) set.delete("all_day");
    else {
      set.delete("breakfast");
      set.delete("lunch");
      set.delete("dinner");
      set.add("all_day");
    }
    return Array.from(set);
  }
  if (set.has(tag)) set.delete(tag);
  else set.add(tag);
  set.delete("all_day");
  if (set.has("breakfast") && set.has("lunch") && set.has("dinner")) {
    set.delete("breakfast");
    set.delete("lunch");
    set.delete("dinner");
    set.add("all_day");
  }
  return Array.from(set);
}

function formatMealTimesForDb(value: MealTag[]): string[] {
  return value.map((m) => (m === "specials" ? "specials" : m));
}

async function uploadMenuImage(itemId: string, uri: string): Promise<string> {
  const ext = uri.split(".").pop() || "jpg";
  const fileName = `menu_${itemId}_${Date.now()}.${ext}`;
  const response = await fetch(uri);
  const blob = await response.blob();
  const { data: uploadData, error: uploadError } = await supabase.storage
    .from("menu-images")
    .upload(fileName, blob, { upsert: true, contentType: `image/${ext}` });
  if (uploadError) throw uploadError;
  const { data: urlData } = supabase.storage.from("menu-images").getPublicUrl(uploadData.path);
  return urlData.publicUrl;
}

export function MenuItemDetailSettingsModal({
  visible,
  item,
  onClose,
  onSaved,
  onDeleted,
}: {
  visible: boolean;
  item: UIMenuItem | null;
  onClose: () => void;
  onSaved: (next: UIMenuItem) => void;
  onDeleted: (id: string) => void;
}) {
  const [name, setName] = useState("");
  const [price, setPrice] = useState("");
  const [description, setDescription] = useState("");
  const [category, setCategory] = useState("");
  const [isVegetarian, setIsVegetarian] = useState(false);
  const [spiceLevel, setSpiceLevel] = useState(0);
  const [mealTimes, setMealTimes] = useState<MealTag[]>([]);
  const [saving, setSaving] = useState(false);
  const [uploading, setUploading] = useState(false);

  useEffect(() => {
    if (!item) return;
    setName(item.name);
    setPrice(item.price.toString());
    setDescription(item.description);
    setCategory(item.category);
    setIsVegetarian(item.isVegetarian);
    setSpiceLevel(item.spiceLevel);
    setMealTimes(normalizeMealTimes(item.mealTimes));
  }, [item?.id, visible]);

  if (!item) return null;

  const selectImage = async (fromCamera: boolean) => {
    try {
      setUploading(true);
      if (fromCamera) {
        const { status } = await ImagePicker.requestCameraPermissionsAsync();
        if (status !== "granted") {
          Alert.alert("Permission needed", "Camera access is required.");
          return;
        }
      } else {
        const { status } = await ImagePicker.requestMediaLibraryPermissionsAsync();
        if (status !== "granted") {
          Alert.alert("Permission needed", "Camera roll access is required.");
          return;
        }
      }
      const result = fromCamera
        ? await ImagePicker.launchCameraAsync({ allowsEditing: true, aspect: [1, 1], quality: 0.8 })
        : await ImagePicker.launchImageLibraryAsync({ mediaTypes: ["images"], allowsEditing: true, aspect: [1, 1], quality: 0.8 });
      if (result.canceled || !result.assets?.[0]) return;

      const publicUrl = await uploadMenuImage(item.id, result.assets[0].uri);
      const { error } = await supabase.from("menu_items").update({ image_url: publicUrl }).eq("id", Number(item.id));
      if (error) throw error;
      onSaved({ ...item, image: publicUrl });
    } catch (err: any) {
      Alert.alert("Error", err.message || "Failed to update image.");
    } finally {
      setUploading(false);
    }
  };

  const save = async () => {
    const trimmed = name.trim();
    const parsed = parseFloat(price);
    if (!trimmed) {
      Alert.alert("Validation", "Name is required.");
      return;
    }
    if (isNaN(parsed) || parsed < 0) {
      Alert.alert("Validation", "Please enter a valid price.");
      return;
    }
    if (mealTimes.length === 0) {
      Alert.alert("Validation", "Please select at least one identifier (Breakfast/Lunch/Dinner/Specials/All Day).");
      return;
    }
    try {
      setSaving(true);
      const updateData = {
        name: trimmed,
        price: parsed,
        description: description.trim() || null,
        category: category.trim() || null,
        category_id: null,
        meal_times: formatMealTimesForDb(mealTimes),
        is_vegetarian: isVegetarian,
        is_spicy: spiceLevel > 0,
      };
      const { error } = await supabase.from("menu_items").update(updateData).eq("id", Number(item.id));
      if (error) throw error;
      onSaved({
        ...item,
        name: trimmed,
        price: parsed,
        description: description.trim(),
        category: category.trim() || "Menu Item",
        mealTimes: formatMealTimesForDb(mealTimes),
        isVegetarian,
        spiceLevel,
      });
      onClose();
    } catch (err: any) {
      Alert.alert("Error", err.message || "Failed to save item.");
    } finally {
      setSaving(false);
    }
  };

  return (
    <Modal visible={visible} transparent animationType="slide" onRequestClose={onClose}>
      <KeyboardAvoidingView behavior={Platform.OS === "ios" ? "padding" : "height"} style={{ flex: 1 }}>
        <View style={{ flex: 1, backgroundColor: "rgba(0,0,0,0.72)", justifyContent: "flex-end" }}>
          <Pressable style={{ flex: 1 }} onPress={onClose} />
          <View
            style={{
              backgroundColor: "#1a1a1a",
              borderTopLeftRadius: 24,
              borderTopRightRadius: 24,
              borderWidth: 1,
              borderColor: "#2a2a2a",
              padding: 20,
              paddingBottom: Platform.OS === "ios" ? 10 : 8,
              maxHeight: "92%",
              minHeight: "70%",
            }}
          >
            <View style={{ flexDirection: "row", justifyContent: "space-between", alignItems: "center", marginBottom: 12 }}>
              <Text style={{ fontFamily: "BricolageGrotesque_700Bold", color: "#f5f5f5", fontSize: 20 }}>Item Settings</Text>
              <Pressable onPress={onClose} style={{ padding: 6 }}>
                <X size={22} color="#999" />
              </Pressable>
            </View>

            <View style={{ flex: 1 }}>
            <ScrollView
              style={{ flex: 1 }}
              showsVerticalScrollIndicator={false}
              contentContainerStyle={{ paddingBottom: 12 }}
            >
              <Text style={labelStyle}>Image</Text>
              <View style={{ flexDirection: "row", gap: 8, marginBottom: 12 }}>
                <Pressable onPress={() => selectImage(true)} style={smallActionButton}>
                  <Camera size={14} color="#22C55E" />
                  <Text style={smallActionText}>Take Photo</Text>
                </Pressable>
                <Pressable onPress={() => selectImage(false)} style={smallActionButton}>
                  <ImageIcon size={14} color="#FF9933" />
                  <Text style={smallActionText}>Camera Roll</Text>
                </Pressable>
                <Pressable
                  onPress={() => {
                    Alert.alert("Delete Item", `Remove "${item.name}" from the menu?`, [
                      { text: "Cancel", style: "cancel" },
                      {
                        text: "Delete",
                        style: "destructive",
                        onPress: async () => {
                          try {
                            const { error } = await supabase.from("menu_items").delete().eq("id", Number(item.id));
                            if (error) throw error;
                            onDeleted(item.id);
                            onClose();
                          } catch (err: any) {
                            Alert.alert("Error", err.message || "Failed to delete item.");
                          }
                        },
                      },
                    ]);
                  }}
                  style={[smallActionButton, { borderColor: "rgba(239,68,68,0.4)" }]}
                >
                  <Trash2 size={14} color="#EF4444" />
                  <Text style={[smallActionText, { color: "#EF4444" }]}>Delete</Text>
                </Pressable>
              </View>

              <Text style={labelStyle}>Name</Text>
              <TextInput style={inputStyle} value={name} onChangeText={setName} placeholder="Name" placeholderTextColor="#666" />
              <Text style={labelStyle}>Price</Text>
              <TextInput style={inputStyle} value={price} onChangeText={setPrice} placeholder="Price" placeholderTextColor="#666" keyboardType="decimal-pad" />
              <Text style={labelStyle}>Description</Text>
              <TextInput style={[inputStyle, { minHeight: 82, textAlignVertical: "top" }]} value={description} onChangeText={setDescription} placeholder="Description" placeholderTextColor="#666" multiline />
              <Text style={labelStyle}>Category</Text>
              <TextInput style={inputStyle} value={category} onChangeText={setCategory} placeholder="Category" placeholderTextColor="#666" />

              <Text style={labelStyle}>Meal Identifiers *</Text>
              <View style={{ flexDirection: "row", flexWrap: "wrap", gap: 8 }}>
                {[
                  { key: "breakfast", label: "Breakfast", c: "#F97316", bg: "rgba(249,115,22,0.14)", b: "rgba(249,115,22,0.45)" },
                  { key: "lunch", label: "Lunch", c: "#22C55E", bg: "rgba(34,197,94,0.14)", b: "rgba(34,197,94,0.45)" },
                  { key: "dinner", label: "Dinner", c: "#818CF8", bg: "rgba(129,140,248,0.14)", b: "rgba(129,140,248,0.45)" },
                  { key: "specials", label: "Specials", c: "#F59E0B", bg: "rgba(245,158,11,0.14)", b: "rgba(245,158,11,0.45)" },
                  { key: "all_day", label: "All Day", c: "#38BDF8", bg: "rgba(56,189,248,0.14)", b: "rgba(56,189,248,0.45)" },
                ].map((tag) => {
                  const active = mealTimes.includes(tag.key as MealTag);
                  return (
                    <Pressable
                      key={tag.key}
                      onPress={() => setMealTimes(toggleMealTag(mealTimes, tag.key as MealTag))}
                      style={{ borderRadius: 999, borderWidth: 1, borderColor: active ? tag.b : "#2f2f2f", backgroundColor: active ? tag.bg : "#121212", paddingHorizontal: 12, paddingVertical: 8 }}
                    >
                      <Text style={{ fontFamily: active ? "Manrope_700Bold" : "Manrope_600SemiBold", color: active ? tag.c : "#888", fontSize: 12 }}>{tag.label}</Text>
                    </Pressable>
                  );
                })}
              </View>

              <Text style={labelStyle}>Spice Level</Text>
              <View style={{ flexDirection: "row", alignItems: "center", gap: 8 }}>
                {[0, 1, 2, 3].map((n) => (
                  <Pressable
                    key={n}
                    onPress={() => setSpiceLevel(n)}
                    style={{ width: 40, height: 40, borderRadius: 20, borderWidth: 1, borderColor: n === spiceLevel ? "rgba(239,68,68,0.45)" : "#2f2f2f", backgroundColor: n === spiceLevel ? "rgba(239,68,68,0.12)" : "#121212", alignItems: "center", justifyContent: "center" }}
                  >
                    {n === 0 ? (
                      <Text style={{ fontFamily: "Manrope_700Bold", color: n === spiceLevel ? "#EF4444" : "#777", fontSize: 12 }}>0</Text>
                    ) : (
                      <View style={{ flexDirection: "row" }}>
                        {Array.from({ length: n }).map((_, i) => (
                          <Flame key={i} size={11} color={n === spiceLevel ? "#EF4444" : "#777"} fill={n === spiceLevel ? "#EF4444" : "transparent"} />
                        ))}
                      </View>
                    )}
                  </Pressable>
                ))}
              </View>

              <Text style={labelStyle}>Vegetarian</Text>
              <Pressable onPress={() => setIsVegetarian((v) => !v)} style={{ ...inputStyle, flexDirection: "row", alignItems: "center", justifyContent: "center", borderColor: isVegetarian ? "rgba(34,197,94,0.45)" : "#333", backgroundColor: isVegetarian ? "rgba(34,197,94,0.12)" : "#0f0f0f" }}>
                <Leaf size={14} color={isVegetarian ? "#22C55E" : "#777"} />
                <Text style={{ marginLeft: 8, fontFamily: "Manrope_700Bold", color: isVegetarian ? "#22C55E" : "#777" }}>
                  {isVegetarian ? "Vegetarian ON" : "Vegetarian OFF"}
                </Text>
              </Pressable>

            </ScrollView>
            </View>
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
                onPress={save}
                disabled={saving || uploading}
                style={{
                  backgroundColor: "#22C55E",
                  borderRadius: 12,
                  paddingVertical: 14,
                  alignItems: "center",
                  opacity: saving || uploading ? 0.7 : 1,
                }}
              >
                {saving || uploading ? (
                  <ActivityIndicator color="#0f0f0f" />
                ) : (
                  <Text style={{ fontFamily: "BricolageGrotesque_700Bold", color: "#0f0f0f", fontSize: 16 }}>Save Item</Text>
                )}
              </Pressable>
            </View>
          </View>
        </View>
      </KeyboardAvoidingView>
    </Modal>
  );
}

const labelStyle = {
  fontFamily: "Manrope_600SemiBold" as const,
  color: "#999999",
  fontSize: 12,
  textTransform: "uppercase" as const,
  letterSpacing: 1,
  marginBottom: 8,
  marginTop: 6,
};

const inputStyle = {
  backgroundColor: "#0f0f0f",
  color: "#f5f5f5",
  borderWidth: 1,
  borderColor: "#333",
  borderRadius: 10,
  paddingHorizontal: 12,
  paddingVertical: 12,
  marginBottom: 12,
  fontFamily: "Manrope_500Medium",
  fontSize: 14,
} as const;

const smallActionButton = {
  flexDirection: "row" as const,
  alignItems: "center" as const,
  gap: 6,
  borderWidth: 1,
  borderColor: "#2f2f2f",
  borderRadius: 10,
  backgroundColor: "#111111",
  paddingHorizontal: 10,
  paddingVertical: 8,
};

const smallActionText = {
  fontFamily: "Manrope_600SemiBold" as const,
  color: "#f5f5f5",
  fontSize: 12,
};
