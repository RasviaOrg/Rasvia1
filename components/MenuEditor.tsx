import React, { useState } from "react";
import {
  View,
  Text,
  Pressable,
  Platform,
  Alert,
  Modal,
  TextInput,
  ActivityIndicator,
  ScrollView,
  Image,
  KeyboardAvoidingView,
} from "react-native";
import {
  Camera,
  Plus,
  X,
  Trash2,
  Settings,
  Image as ImageIcon,
  Flame,
  Leaf,
} from "lucide-react-native";
import * as ImagePicker from "expo-image-picker";
import * as Haptics from "expo-haptics";
import { useAdminMode } from "@/hooks/useAdminMode";
import { supabase } from "@/lib/supabase";
import { uploadMenuImageToStorage, type PickedImage } from "@/lib/menu-image-upload";
import { MenuGridItem } from "./MenuGridItem";
import { mapMenuItemToUI, type SupabaseMenuItem, type UIMenuItem } from "@/lib/restaurant-types";

type MealTag = "breakfast" | "lunch" | "dinner" | "specials" | "all_day";
const BASE_MEAL_TAGS: MealTag[] = ["breakfast", "lunch", "dinner"];
const ALL_MEAL_TAGS: MealTag[] = ["breakfast", "lunch", "dinner", "specials", "all_day"];

function normalizeMealTimes(input: string[] | undefined | null): MealTag[] {
  const normalized = (input ?? [])
    .map((m) => m?.toLowerCase?.().trim())
    .map((m) => (m === "special" ? "specials" : m))
    .map((m) => (m === "all" ? "all_day" : m))
    .filter((m): m is MealTag => ALL_MEAL_TAGS.includes(m as MealTag));

  if (
    normalized.includes("breakfast") &&
    normalized.includes("lunch") &&
    normalized.includes("dinner") &&
    !normalized.includes("all_day")
  ) {
    const rest = normalized.filter((m) => !BASE_MEAL_TAGS.includes(m));
    return ["all_day", ...rest];
  }
  return Array.from(new Set(normalized));
}

function toggleMealTag(current: MealTag[], tag: MealTag): MealTag[] {
  const set = new Set(current);

  if (tag === "all_day") {
    if (set.has("all_day")) {
      set.delete("all_day");
    } else {
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

function formatMealTimesForDb(values: MealTag[]): string[] {
  return values.map((m) => (m === "specials" ? "specials" : m));
}

async function pickImageFromLibrary(): Promise<PickedImage | null> {
  const { status } = await ImagePicker.requestMediaLibraryPermissionsAsync();
  if (status !== "granted") {
    Alert.alert("Permission needed", "Camera roll access is required to upload photos.");
    return null;
  }
  const result = await ImagePicker.launchImageLibraryAsync({
    mediaTypes: ["images"],
    allowsEditing: true,
    aspect: [1, 1],
    quality: 0.8,
  });
  if (result.canceled || !result.assets?.[0]) return null;
  const a = result.assets[0];
  return { uri: a.uri, mimeType: a.mimeType };
}

async function pickImageFromCamera(): Promise<PickedImage | null> {
  const { status } = await ImagePicker.requestCameraPermissionsAsync();
  if (status !== "granted") {
    Alert.alert("Permission needed", "Camera access is required.");
    return null;
  }
  const result = await ImagePicker.launchCameraAsync({
    allowsEditing: true,
    aspect: [1, 1],
    quality: 0.8,
  });
  if (result.canceled || !result.assets?.[0]) return null;
  const a = result.assets[0];
  return { uri: a.uri, mimeType: a.mimeType };
}

function MealTimesSelector({
  value,
  onChange,
}: {
  value: MealTag[];
  onChange: (next: MealTag[]) => void;
}) {
  const defs: Array<{ key: MealTag; label: string; color: string; bg: string; border: string }> = [
    { key: "breakfast", label: "Breakfast", color: "#F97316", bg: "rgba(249,115,22,0.14)", border: "rgba(249,115,22,0.45)" },
    { key: "lunch", label: "Lunch", color: "#22C55E", bg: "rgba(34,197,94,0.14)", border: "rgba(34,197,94,0.45)" },
    { key: "dinner", label: "Dinner", color: "#818CF8", bg: "rgba(129,140,248,0.14)", border: "rgba(129,140,248,0.45)" },
    { key: "specials", label: "Specials", color: "#F59E0B", bg: "rgba(245,158,11,0.14)", border: "rgba(245,158,11,0.45)" },
    { key: "all_day", label: "All Day", color: "#38BDF8", bg: "rgba(56,189,248,0.14)", border: "rgba(56,189,248,0.45)" },
  ];

  return (
    <View style={{ flexDirection: "row", flexWrap: "wrap", gap: 8 }}>
      {defs.map((def) => {
        const active = value.includes(def.key);
        return (
          <Pressable
            key={def.key}
            onPress={() => {
              if (Platform.OS !== "web") Haptics.selectionAsync();
              onChange(toggleMealTag(value, def.key));
            }}
            style={{
              borderRadius: 999,
              borderWidth: 1,
              borderColor: active ? def.border : "#2f2f2f",
              backgroundColor: active ? def.bg : "#121212",
              paddingHorizontal: 12,
              paddingVertical: 8,
            }}
          >
            <Text
              style={{
                fontFamily: active ? "Manrope_700Bold" : "Manrope_600SemiBold",
                color: active ? def.color : "#888",
                fontSize: 12,
              }}
            >
              {def.label}
            </Text>
          </Pressable>
        );
      })}
    </View>
  );
}

function SpiceSelector({
  level,
  onChange,
}: {
  level: number;
  onChange: (next: number) => void;
}) {
  return (
    <View style={{ flexDirection: "row", alignItems: "center", gap: 8 }}>
      {[0, 1, 2, 3].map((n) => (
        <Pressable
          key={n}
          onPress={() => {
            if (Platform.OS !== "web") Haptics.selectionAsync();
            onChange(n);
          }}
          style={{
            width: 38,
            height: 38,
            borderRadius: 19,
            borderWidth: 1,
            borderColor: n === level ? "rgba(239,68,68,0.45)" : "#2f2f2f",
            backgroundColor: n === level ? "rgba(239,68,68,0.12)" : "#121212",
            alignItems: "center",
            justifyContent: "center",
          }}
        >
          {n === 0 ? (
            <Text style={{ fontFamily: "Manrope_700Bold", color: n === level ? "#EF4444" : "#777", fontSize: 12 }}>0</Text>
          ) : (
            <View style={{ flexDirection: "row", alignItems: "center", justifyContent: "center" }}>
              {Array.from({ length: n }).map((_, idx) => (
                <Flame
                  key={idx}
                  size={12}
                  color={n === level ? "#EF4444" : "#777"}
                  fill={n === level ? "#EF4444" : "transparent"}
                />
              ))}
            </View>
          )}
        </Pressable>
      ))}
    </View>
  );
}

function EditableMenuItem({
  item,
  index,
  onPress,
  onQuickAdd,
  onItemUpdated,
  onDelete,
  canEdit,
  showQuickAdd,
  onContributeImage,
}: {
  item: UIMenuItem;
  index: number;
  onPress: () => void;
  onQuickAdd: () => void;
  onItemUpdated: (updatedItem: UIMenuItem) => void;
  onDelete: (id: string) => void;
  canEdit: boolean;
  showQuickAdd: boolean;
  onContributeImage?: (item: UIMenuItem) => void;
}) {
  const [showSettings, setShowSettings] = useState(false);
  const [saving, setSaving] = useState(false);
  const [uploadingImage, setUploadingImage] = useState(false);

  const [name, setName] = useState(item.name);
  const [price, setPrice] = useState(item.price.toString());
  const [description, setDescription] = useState(item.description);
  const [category, setCategory] = useState(item.category);
  const [isVegetarian, setIsVegetarian] = useState(item.isVegetarian);
  const [spiceLevel, setSpiceLevel] = useState(item.spiceLevel);
  const [mealTimes, setMealTimes] = useState<MealTag[]>(normalizeMealTimes(item.mealTimes));

  const openSettings = () => {
    if (Platform.OS !== "web") Haptics.selectionAsync();
    setName(item.name);
    setPrice(item.price.toString());
    setDescription(item.description);
    setCategory(item.category);
    setIsVegetarian(item.isVegetarian);
    setSpiceLevel(item.spiceLevel);
    setMealTimes(normalizeMealTimes(item.mealTimes));
    setShowSettings(true);
  };

  const updateImage = async (picker: () => Promise<PickedImage | null>) => {
    try {
      setUploadingImage(true);
      const picked = await picker();
      if (!picked) return;
      const publicUrl = await uploadMenuImageToStorage(item.id, picked.uri, picked.mimeType);
      const { error } = await supabase.from("menu_items").update({ image_url: publicUrl }).eq("id", Number(item.id));
      if (error) throw error;
      onItemUpdated({ ...item, image: publicUrl, hasOfficialImage: true, communityImageCredit: null });
    } catch (err: any) {
      Alert.alert("Upload Failed", err.message || "Could not upload image.");
    } finally {
      setUploadingImage(false);
    }
  };

  const saveSettings = async () => {
    const trimmedName = name.trim();
    const parsedPrice = parseFloat(price);
    if (!trimmedName) {
      Alert.alert("Validation", "Name is required.");
      return;
    }
    if (isNaN(parsedPrice) || parsedPrice < 0) {
      Alert.alert("Validation", "Please enter a valid price.");
      return;
    }
    if (mealTimes.length === 0) {
      Alert.alert("Validation", "Select at least one identifier (Breakfast/Lunch/Dinner/Specials/All Day).");
      return;
    }

    try {
      setSaving(true);
      const updateData = {
        name: trimmedName,
        price: parsedPrice,
        description: description.trim() || null,
        category: category.trim() || null,
        category_id: null,
        meal_times: formatMealTimesForDb(mealTimes),
        is_vegetarian: isVegetarian,
        is_spicy: spiceLevel > 0,
      };
      const { error } = await supabase.from("menu_items").update(updateData).eq("id", Number(item.id));
      if (error) throw error;

      onItemUpdated({
        ...item,
        name: trimmedName,
        price: parsedPrice,
        description: description.trim(),
        category: category.trim() || "Menu Item",
        mealTimes: formatMealTimesForDb(mealTimes),
        isVegetarian,
        spiceLevel,
      });
      setShowSettings(false);
    } catch (err: any) {
      Alert.alert("Error", err.message || "Failed to update item.");
    } finally {
      setSaving(false);
    }
  };

  const deleteItem = () => {
    Alert.alert("Delete Item", `Remove "${item.name}" from the menu?`, [
      { text: "Cancel", style: "cancel" },
      {
        text: "Delete",
        style: "destructive",
        onPress: async () => {
          try {
            const { error } = await supabase.from("menu_items").delete().eq("id", Number(item.id));
            if (error) throw error;
            onDelete(item.id);
            setShowSettings(false);
          } catch (err: any) {
            Alert.alert("Error", err.message || "Failed to delete item.");
          }
        },
      },
    ]);
  };

  return (
    <View style={{ position: "relative" }}>
      <MenuGridItem item={item as any} index={index} onPress={onPress} onQuickAdd={onQuickAdd} showQuickAdd={showQuickAdd} onContributeImage={onContributeImage} />

      {canEdit && (
        <Pressable
          onPress={openSettings}
          style={{
            position: "absolute",
            top: 6,
            right: 6,
            width: 28,
            height: 28,
            borderRadius: 14,
            alignItems: "center",
            justifyContent: "center",
            backgroundColor: "rgba(0,0,0,0.72)",
            borderWidth: 1,
            borderColor: "rgba(255,255,255,0.1)",
          }}
        >
          <Settings size={14} color="#f5f5f5" />
        </Pressable>
      )}

      {uploadingImage && (
        <View
          style={{
            position: "absolute",
            top: 0,
            left: 0,
            right: 0,
            bottom: 0,
            borderRadius: 12,
            backgroundColor: "rgba(0,0,0,0.45)",
            alignItems: "center",
            justifyContent: "center",
          }}
        >
          <ActivityIndicator color="#FF9933" />
        </View>
      )}

      <Modal visible={showSettings} transparent animationType="slide" onRequestClose={() => setShowSettings(false)}>
        <KeyboardAvoidingView behavior={Platform.OS === "ios" ? "padding" : "height"} style={{ flex: 1 }}>
          <View style={{ flex: 1, backgroundColor: "rgba(0,0,0,0.72)", justifyContent: "flex-end" }}>
            <Pressable style={{ flex: 1 }} onPress={() => setShowSettings(false)} />
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
              <View style={{ flexDirection: "row", alignItems: "center", justifyContent: "space-between", marginBottom: 12 }}>
                <Text style={{ fontFamily: "BricolageGrotesque_700Bold", color: "#f5f5f5", fontSize: 20 }}>Item Settings</Text>
                <Pressable onPress={() => setShowSettings(false)} style={{ padding: 6 }}>
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
                  <Pressable onPress={() => updateImage(pickImageFromCamera)} style={smallActionButton}>
                    <Camera size={14} color="#22C55E" />
                    <Text style={smallActionText}>Take Photo</Text>
                  </Pressable>
                  <Pressable onPress={() => updateImage(pickImageFromLibrary)} style={smallActionButton}>
                    <ImageIcon size={14} color="#FF9933" />
                    <Text style={smallActionText}>Camera Roll</Text>
                  </Pressable>
                  <Pressable onPress={deleteItem} style={[smallActionButton, { borderColor: "rgba(239,68,68,0.4)" }]}>
                    <Trash2 size={14} color="#EF4444" />
                    <Text style={[smallActionText, { color: "#EF4444" }]}>Delete</Text>
                  </Pressable>
                </View>
                {!!item.image?.trim() && (
                  <Image
                    source={{ uri: item.image }}
                    style={{ width: "100%", height: 140, borderRadius: 12, marginBottom: 12, borderWidth: 1, borderColor: "#2f2f2f" }}
                    resizeMode="cover"
                  />
                )}

                <Text style={labelStyle}>Name</Text>
                <TextInput style={inputStyle} value={name} onChangeText={setName} placeholder="Item name" placeholderTextColor="#666" />

                <Text style={labelStyle}>Price</Text>
                <TextInput style={inputStyle} value={price} onChangeText={setPrice} keyboardType="decimal-pad" placeholder="Price" placeholderTextColor="#666" />

                <Text style={labelStyle}>Description</Text>
                <TextInput
                  style={[inputStyle, { minHeight: 82, textAlignVertical: "top" }]}
                  value={description}
                  onChangeText={setDescription}
                  multiline
                  placeholder="Description"
                  placeholderTextColor="#666"
                />

                <Text style={labelStyle}>Category</Text>
                <TextInput style={inputStyle} value={category} onChangeText={setCategory} placeholder="Category" placeholderTextColor="#666" />

                <Text style={labelStyle}>Meal Identifiers *</Text>
                <MealTimesSelector value={mealTimes} onChange={setMealTimes} />
                <Text style={helperText}>Selecting Breakfast + Lunch + Dinner automatically switches to All Day.</Text>

                <Text style={labelStyle}>Spice Level</Text>
                <SpiceSelector level={spiceLevel} onChange={setSpiceLevel} />

                <Text style={labelStyle}>Vegetarian</Text>
                <Pressable
                  onPress={() => setIsVegetarian((v) => !v)}
                  style={{
                    ...inputStyle,
                    flexDirection: "row",
                    alignItems: "center",
                    justifyContent: "center",
                    borderColor: isVegetarian ? "rgba(34,197,94,0.45)" : "#333",
                    backgroundColor: isVegetarian ? "rgba(34,197,94,0.12)" : "#0f0f0f",
                  }}
                >
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
                  onPress={saveSettings}
                  disabled={saving}
                  style={{
                    backgroundColor: "#22C55E",
                    borderRadius: 12,
                    paddingVertical: 14,
                    alignItems: "center",
                    opacity: saving ? 0.7 : 1,
                  }}
                >
                  {saving ? (
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
    </View>
  );
}

interface MenuEditorProps {
  menu: UIMenuItem[];
  setMenu: (menu: UIMenuItem[]) => void;
  onItemPress: (item: UIMenuItem) => void;
  onQuickAdd: (item: UIMenuItem) => void;
  restaurantId?: string;
  onContributeImage?: (item: UIMenuItem) => void;
}

export function MenuEditor({ menu, setMenu, onItemPress, onQuickAdd, restaurantId, onContributeImage }: MenuEditorProps) {
  const { isAdmin, isRestaurantOwner, ownedRestaurantId } = useAdminMode();
  const canEdit = isAdmin || (isRestaurantOwner && !!restaurantId && restaurantId === ownedRestaurantId);
  const canOrder = !isRestaurantOwner && !isAdmin;

  const [showAddItem, setShowAddItem] = useState(false);
  const [newItemName, setNewItemName] = useState("");
  const [newItemPrice, setNewItemPrice] = useState("");
  const [newItemDesc, setNewItemDesc] = useState("");
  const [newItemCategory, setNewItemCategory] = useState("");
  const [newMealTimes, setNewMealTimes] = useState<MealTag[]>([]);
  const [newIsVegetarian, setNewIsVegetarian] = useState(false);
  const [newSpiceLevel, setNewSpiceLevel] = useState(0);
  const [newImageAsset, setNewImageAsset] = useState<PickedImage | null>(null);
  const [addingItem, setAddingItem] = useState(false);

  const handleItemUpdated = (updatedItem: UIMenuItem) => {
    setMenu(menu.map((m) => (m.id === updatedItem.id ? updatedItem : m)));
  };

  const handleDelete = (id: string) => {
    setMenu(menu.filter((m) => m.id !== id));
  };

  const resetAddItemForm = () => {
    setNewItemName("");
    setNewItemPrice("");
    setNewItemDesc("");
    setNewItemCategory("");
    setNewMealTimes([]);
    setNewIsVegetarian(false);
    setNewSpiceLevel(0);
    setNewImageAsset(null);
  };

  const pickAddImage = async () => {
    const picked = await pickImageFromLibrary();
    if (picked) setNewImageAsset(picked);
  };

  const handleAddItem = async () => {
    const trimmedName = newItemName.trim();
    const parsedPrice = parseFloat(newItemPrice);

    if (!trimmedName) {
      Alert.alert("Validation", "Name is required.");
      return;
    }
    if (isNaN(parsedPrice) || parsedPrice < 0) {
      Alert.alert("Validation", "Please enter a valid price.");
      return;
    }
    if (!restaurantId) {
      Alert.alert("Error", "Restaurant ID is missing.");
      return;
    }
    if (newMealTimes.length === 0) {
      Alert.alert("Validation", "Please select at least one identifier (Breakfast/Lunch/Dinner/Specials/All Day).");
      return;
    }

    try {
      setAddingItem(true);
      const insertPayload = {
        restaurant_id: Number(restaurantId),
        name: trimmedName,
        price: parsedPrice,
        description: newItemDesc.trim() || null,
        category: newItemCategory.trim() || null,
        category_id: null,
        is_available: true,
        is_vegetarian: newIsVegetarian,
        is_spicy: newSpiceLevel > 0,
        meal_times: formatMealTimesForDb(newMealTimes),
      };

      const { data, error } = await supabase.from("menu_items").insert(insertPayload).select("*").single();
      if (error) throw error;

      let row = data as SupabaseMenuItem;
      if (newImageAsset) {
        const publicUrl = await uploadMenuImageToStorage(String(row.id), newImageAsset.uri, newImageAsset.mimeType);
        const { error: imageUpdateError } = await supabase
          .from("menu_items")
          .update({ image_url: publicUrl })
          .eq("id", row.id);
        if (imageUpdateError) throw imageUpdateError;
        row = { ...row, image_url: publicUrl };
      }

      const mapped = mapMenuItemToUI(row);
      const uiItem: UIMenuItem = {
        ...mapped,
        spiceLevel: newSpiceLevel,
        mealTimes: formatMealTimesForDb(newMealTimes),
      };

      setMenu([...menu, uiItem]);
      resetAddItemForm();
      setShowAddItem(false);
      if (Platform.OS !== "web") Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
    } catch (err: any) {
      Alert.alert("Error", err.message || "Failed to add menu item.");
    } finally {
      setAddingItem(false);
    }
  };

  const leftColumn = menu.filter((_, i) => i % 2 === 0);
  const rightColumn = menu.filter((_, i) => i % 2 !== 0);

  return (
    <View>
      {canEdit && (
        <View style={{ flexDirection: "row", justifyContent: "flex-end", marginBottom: 12 }}>
          <Pressable
            onPress={() => {
              if (Platform.OS !== "web") Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
              setShowAddItem(true);
            }}
            style={{
              flexDirection: "row",
              alignItems: "center",
              backgroundColor: "rgba(34,197,94,0.12)",
              paddingHorizontal: 12,
              paddingVertical: 8,
              borderRadius: 10,
              borderWidth: 1,
              borderColor: "rgba(34,197,94,0.3)",
            }}
          >
            <Plus size={14} color="#22C55E" />
            <Text style={{ fontFamily: "Manrope_600SemiBold", color: "#22C55E", fontSize: 12, marginLeft: 4 }}>Add Item</Text>
          </Pressable>
        </View>
      )}

      <View style={{ flexDirection: "row", justifyContent: "space-between" }}>
        <View style={{ flex: 1, marginRight: 5 }}>
          {leftColumn.map((item, index) => (
            <EditableMenuItem
              key={item.id}
              item={item}
              index={index}
              onPress={() => onItemPress(item)}
              onQuickAdd={() => onQuickAdd(item)}
              onItemUpdated={handleItemUpdated}
              onDelete={handleDelete}
              canEdit={canEdit}
              showQuickAdd={canOrder}
              onContributeImage={onContributeImage}
            />
          ))}
        </View>
        <View style={{ flex: 1, marginLeft: 5 }}>
          {rightColumn.map((item, index) => (
            <EditableMenuItem
              key={item.id}
              item={item}
              index={index}
              onPress={() => onItemPress(item)}
              onQuickAdd={() => onQuickAdd(item)}
              onItemUpdated={handleItemUpdated}
              onDelete={handleDelete}
              canEdit={canEdit}
              showQuickAdd={canOrder}
              onContributeImage={onContributeImage}
            />
          ))}
        </View>
      </View>

      <Modal visible={showAddItem} transparent animationType="slide" onRequestClose={() => setShowAddItem(false)}>
        <KeyboardAvoidingView behavior={Platform.OS === "ios" ? "padding" : "height"} style={{ flex: 1 }}>
          <View style={{ flex: 1, backgroundColor: "rgba(0,0,0,0.72)", justifyContent: "flex-end" }}>
            <Pressable style={{ flex: 1 }} onPress={() => setShowAddItem(false)} />
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
                <Text style={{ fontFamily: "BricolageGrotesque_700Bold", color: "#22C55E", fontSize: 20 }}>Add Menu Item</Text>
                <Pressable onPress={() => setShowAddItem(false)} style={{ padding: 6 }}>
                  <X size={22} color="#999" />
                </Pressable>
              </View>

              <View style={{ flex: 1 }}>
              <ScrollView
                style={{ flex: 1 }}
                showsVerticalScrollIndicator={false}
                contentContainerStyle={{ paddingBottom: 12 }}
              >
                <Text style={labelStyle}>Image (Optional)</Text>
                <View style={{ flexDirection: "row", gap: 8, marginBottom: 12 }}>
                  <Pressable onPress={pickAddImage} style={smallActionButton}>
                    <ImageIcon size={14} color="#FF9933" />
                    <Text style={smallActionText}>Select Image</Text>
                  </Pressable>
                  {newImageAsset && (
                    <Pressable onPress={() => setNewImageAsset(null)} style={[smallActionButton, { borderColor: "rgba(239,68,68,0.4)" }]}>
                      <Trash2 size={14} color="#EF4444" />
                      <Text style={[smallActionText, { color: "#EF4444" }]}>Clear</Text>
                    </Pressable>
                  )}
                </View>
                {newImageAsset && (
                  <Image
                    source={{ uri: newImageAsset.uri }}
                    style={{ width: "100%", height: 140, borderRadius: 12, marginBottom: 12, borderWidth: 1, borderColor: "#2f2f2f" }}
                    resizeMode="cover"
                  />
                )}

                <Text style={labelStyle}>Name *</Text>
                <TextInput style={inputStyle} placeholder="Item name" placeholderTextColor="#666" value={newItemName} onChangeText={setNewItemName} />

                <Text style={labelStyle}>Price *</Text>
                <TextInput style={inputStyle} placeholder="Price" placeholderTextColor="#666" value={newItemPrice} onChangeText={setNewItemPrice} keyboardType="decimal-pad" />

                <Text style={labelStyle}>Description</Text>
                <TextInput
                  style={[inputStyle, { minHeight: 82, textAlignVertical: "top" }]}
                  placeholder="Description (optional)"
                  placeholderTextColor="#666"
                  value={newItemDesc}
                  onChangeText={setNewItemDesc}
                  multiline
                />

                <Text style={labelStyle}>Category</Text>
                <TextInput style={inputStyle} placeholder="Category (optional)" placeholderTextColor="#666" value={newItemCategory} onChangeText={setNewItemCategory} />

                <Text style={labelStyle}>Meal Identifiers *</Text>
                <MealTimesSelector value={newMealTimes} onChange={setNewMealTimes} />
                <Text style={helperText}>Required. Choose at least one period.</Text>

                <Text style={labelStyle}>Spice Level</Text>
                <SpiceSelector level={newSpiceLevel} onChange={setNewSpiceLevel} />

                <Text style={labelStyle}>Vegetarian</Text>
                <Pressable
                  onPress={() => setNewIsVegetarian((v) => !v)}
                  style={{
                    ...inputStyle,
                    flexDirection: "row",
                    alignItems: "center",
                    justifyContent: "center",
                    borderColor: newIsVegetarian ? "rgba(34,197,94,0.45)" : "#333",
                    backgroundColor: newIsVegetarian ? "rgba(34,197,94,0.12)" : "#0f0f0f",
                  }}
                >
                  <Leaf size={14} color={newIsVegetarian ? "#22C55E" : "#777"} />
                  <Text style={{ marginLeft: 8, fontFamily: "Manrope_700Bold", color: newIsVegetarian ? "#22C55E" : "#777" }}>
                    {newIsVegetarian ? "Vegetarian ON" : "Vegetarian OFF"}
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
                  onPress={handleAddItem}
                  disabled={addingItem}
                  style={{
                    backgroundColor: "#22C55E",
                    borderRadius: 12,
                    paddingVertical: 14,
                    alignItems: "center",
                    opacity: addingItem ? 0.7 : 1,
                  }}
                >
                  {addingItem ? (
                    <ActivityIndicator color="#0f0f0f" />
                  ) : (
                    <Text style={{ fontFamily: "BricolageGrotesque_700Bold", color: "#0f0f0f", fontSize: 16 }}>Add to Menu</Text>
                  )}
                </Pressable>
              </View>
            </View>
          </View>
        </KeyboardAvoidingView>
      </Modal>
    </View>
  );
}

const labelStyle = {
  fontFamily: "Manrope_600SemiBold",
  color: "#999999",
  fontSize: 12,
  textTransform: "uppercase" as const,
  letterSpacing: 1,
  marginBottom: 8,
  marginTop: 6,
};

const helperText = {
  fontFamily: "Manrope_500Medium",
  color: "#666",
  fontSize: 11,
  marginTop: 8,
  marginBottom: 10,
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
