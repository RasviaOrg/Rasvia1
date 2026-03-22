import React, { useState, useCallback } from "react";
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
import { Pencil, Camera, Plus, X, Trash2, FolderPlus } from "lucide-react-native";
import * as ImagePicker from "expo-image-picker";
import * as Haptics from "expo-haptics";
import { useAdminMode } from "@/hooks/useAdminMode";
import { supabase } from "@/lib/supabase";
import { MenuGridItem } from "./MenuGridItem";
import type { UIMenuItem } from "@/lib/restaurant-types";

type EditableField = "name" | "price" | "description" | "category" | "image";

function EditableMenuItem({
  item,
  index,
  onPress,
  onQuickAdd,
  onItemUpdated,
  onDelete,
  canEdit,
}: {
  item: UIMenuItem;
  index: number;
  onPress: () => void;
  onQuickAdd: () => void;
  onItemUpdated: (updatedItem: UIMenuItem) => void;
  onDelete: (id: string) => void;
  canEdit: boolean;
}) {
  const [editModalVisible, setEditModalVisible] = useState(false);
  const [editField, setEditField] = useState<EditableField | null>(null);
  const [editValue, setEditValue] = useState("");
  const [uploading, setUploading] = useState(false);

  const handleEditClick = (field: EditableField) => {
    if (Platform.OS !== "web") Haptics.selectionAsync();
    if (field === "image") {
      pickAndUploadImage();
      return;
    }
    setEditField(field);
    if (field === "price") setEditValue(item.price.toString());
    else if (field === "name") setEditValue(item.name);
    else if (field === "description") setEditValue(item.description);
    else if (field === "category") setEditValue(item.category);
    setEditModalVisible(true);
  };

  const pickAndUploadImage = async () => {
    try {
      const { status } = await ImagePicker.requestMediaLibraryPermissionsAsync();
      if (status !== "granted") {
        Alert.alert("Permission needed", "Camera roll access is required to upload photos.");
        return;
      }

      const result = await ImagePicker.launchImageLibraryAsync({
        mediaTypes: ["images"],
        allowsEditing: true,
        aspect: [1, 1],
        quality: 0.8,
      });

      if (result.canceled || !result.assets?.[0]) return;

      setUploading(true);
      const asset = result.assets[0];
      const ext = asset.uri.split(".").pop() || "jpg";
      const fileName = `menu_${item.id}_${Date.now()}.${ext}`;

      const formData = new FormData();
      formData.append("file", {
        uri: asset.uri,
        name: fileName,
        type: `image/${ext}`,
      } as any);

      const { data: uploadData, error: uploadError } = await supabase.storage
        .from("menu-images")
        .upload(fileName, formData, { upsert: true });

      if (uploadError) throw uploadError;

      const { data: urlData } = supabase.storage
        .from("menu-images")
        .getPublicUrl(uploadData.path);

      const publicUrl = urlData.publicUrl;

      const { error: updateError } = await supabase
        .from("menu_items")
        .update({ image_url: publicUrl })
        .eq("id", item.id);

      if (updateError) throw updateError;

      onItemUpdated({ ...item, image: publicUrl });
      if (Platform.OS !== "web") Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
    } catch (err: any) {
      console.error("Image upload error:", err);
      Alert.alert("Upload Failed", err.message || "Could not upload image.");
    } finally {
      setUploading(false);
    }
  };

  const takePhoto = async () => {
    try {
      const { status } = await ImagePicker.requestCameraPermissionsAsync();
      if (status !== "granted") {
        Alert.alert("Permission needed", "Camera access is required.");
        return;
      }

      const result = await ImagePicker.launchCameraAsync({
        allowsEditing: true,
        aspect: [1, 1],
        quality: 0.8,
      });

      if (result.canceled || !result.assets?.[0]) return;

      setUploading(true);
      const asset = result.assets[0];
      const ext = "jpg";
      const fileName = `menu_${item.id}_${Date.now()}.${ext}`;

      const formData = new FormData();
      formData.append("file", {
        uri: asset.uri,
        name: fileName,
        type: `image/${ext}`,
      } as any);

      const { data: uploadData, error: uploadError } = await supabase.storage
        .from("menu-images")
        .upload(fileName, formData, { upsert: true });

      if (uploadError) throw uploadError;

      const { data: urlData } = supabase.storage
        .from("menu-images")
        .getPublicUrl(uploadData.path);

      const publicUrl = urlData.publicUrl;

      const { error: updateError } = await supabase
        .from("menu_items")
        .update({ image_url: publicUrl })
        .eq("id", item.id);

      if (updateError) throw updateError;

      onItemUpdated({ ...item, image: publicUrl });
      if (Platform.OS !== "web") Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
    } catch (err: any) {
      console.error("Camera upload error:", err);
      Alert.alert("Upload Failed", err.message || "Could not upload image.");
    } finally {
      setUploading(false);
    }
  };

  const saveEdit = async () => {
    if (!editField) return;

    let updateData: Record<string, any> = {};
    let localUpdate: Partial<UIMenuItem> = {};

    if (editField === "name") {
      const v = editValue.trim();
      if (!v) { Alert.alert("Error", "Name cannot be empty"); return; }
      updateData.name = v;
      localUpdate.name = v;
    } else if (editField === "price") {
      const p = parseFloat(editValue);
      if (isNaN(p) || p < 0) { Alert.alert("Error", "Invalid price"); return; }
      updateData.price = p;
      localUpdate.price = p;
    } else if (editField === "description") {
      updateData.description = editValue.trim();
      localUpdate.description = editValue.trim();
    } else if (editField === "category") {
      updateData.category_id = null;
      updateData.category = editValue.trim();
      localUpdate.category = editValue.trim();
    }

    try {
      const { error } = await supabase
        .from("menu_items")
        .update(updateData)
        .eq("id", item.id);

      if (error) throw error;
      onItemUpdated({ ...item, ...localUpdate });
      setEditModalVisible(false);
    } catch (err: any) {
      console.error("Error updating menu item:", err);
      Alert.alert("Error", "Failed to update menu item.");
    }
  };

  const handleDelete = () => {
    if (Platform.OS !== "web") Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Medium);
    Alert.alert("Delete Item", `Remove "${item.name}" from the menu?`, [
      { text: "Cancel", style: "cancel" },
      {
        text: "Delete",
        style: "destructive",
        onPress: async () => {
          try {
            const { error } = await supabase
              .from("menu_items")
              .delete()
              .eq("id", item.id);
            if (error) throw error;
            onDelete(item.id);
          } catch (err: any) {
            Alert.alert("Error", "Failed to delete item.");
          }
        },
      },
    ]);
  };

  return (
    <View style={{ position: "relative" }}>
      <MenuGridItem
        item={item as any}
        index={index}
        onPress={onPress}
        onQuickAdd={onQuickAdd}
      />
      {canEdit && (
        <View
          style={{
            position: "absolute",
            top: 0,
            left: 0,
            right: 0,
            bottom: 0,
            pointerEvents: "box-none",
          }}
        >
          {uploading && (
            <View style={{
              position: "absolute", top: 0, left: 0, right: 0, bottom: 0,
              backgroundColor: "rgba(0,0,0,0.5)", alignItems: "center", justifyContent: "center",
              borderRadius: 12, zIndex: 10,
            }}>
              <ActivityIndicator color="#FF9933" size="large" />
            </View>
          )}

          <View style={{
            position: "absolute", top: 6, right: 6,
            flexDirection: "row", gap: 4,
          }}>
            <Pressable
              onPress={() => handleEditClick("image")}
              style={{ backgroundColor: "rgba(0,0,0,0.7)", padding: 5, borderRadius: 10 }}
            >
              <Camera size={12} color="#FF9933" />
            </Pressable>
            <Pressable
              onPress={takePhoto}
              style={{ backgroundColor: "rgba(0,0,0,0.7)", padding: 5, borderRadius: 10 }}
            >
              <Camera size={12} color="#22C55E" />
            </Pressable>
            <Pressable
              onPress={handleDelete}
              style={{ backgroundColor: "rgba(0,0,0,0.7)", padding: 5, borderRadius: 10 }}
            >
              <Trash2 size={12} color="#EF4444" />
            </Pressable>
          </View>

          <View style={{
            position: "absolute", bottom: 6, left: 6, right: 6,
            flexDirection: "row", justifyContent: "space-between",
          }}>
            <Pressable
              onPress={() => handleEditClick("name")}
              style={{ backgroundColor: "rgba(0,0,0,0.7)", padding: 5, borderRadius: 10 }}
            >
              <Pencil size={12} color="#FF9933" />
            </Pressable>
            <Pressable
              onPress={() => handleEditClick("price")}
              style={{ backgroundColor: "rgba(0,0,0,0.7)", padding: 5, borderRadius: 10 }}
            >
              <Pencil size={12} color="#22C55E" />
            </Pressable>
          </View>
        </View>
      )}

      <Modal visible={editModalVisible} transparent animationType="fade">
        <KeyboardAvoidingView
          behavior={Platform.OS === "ios" ? "padding" : "height"}
          style={{
            flex: 1, backgroundColor: "rgba(0,0,0,0.7)",
            justifyContent: "center", alignItems: "center", padding: 20,
          }}
        >
          <View style={{
            backgroundColor: "#1a1a1a", padding: 24, borderRadius: 16,
            width: "100%", borderWidth: 1, borderColor: "#333",
          }}>
            <Text style={{
              fontFamily: "BricolageGrotesque_700Bold", color: "#FF9933",
              fontSize: 18, marginBottom: 12,
            }}>
              Edit {editField === "name" ? "Name" : editField === "price" ? "Price" : editField === "description" ? "Description" : "Category"}
            </Text>
            <TextInput
              style={{
                backgroundColor: "#0f0f0f", color: "#f5f5f5", padding: 12,
                borderRadius: 8, borderWidth: 1, borderColor: "#444",
                marginBottom: 16, marginTop: 12, fontSize: 16,
                ...(editField === "description" ? { height: 100, textAlignVertical: "top" as const } : {}),
              }}
              value={editValue}
              onChangeText={setEditValue}
              keyboardType={editField === "price" ? "decimal-pad" : "default"}
              multiline={editField === "description"}
              autoFocus
            />
            <View style={{ flexDirection: "row", justifyContent: "flex-end" }}>
              <Pressable onPress={() => {
                if (Platform.OS !== "web") Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
                setEditModalVisible(false);
              }} style={{ padding: 12, marginRight: 8 }}>
                <Text style={{ color: "#999", fontFamily: "Manrope_600SemiBold" }}>Cancel</Text>
              </Pressable>
              <Pressable onPress={() => {
                if (Platform.OS !== "web") Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Medium);
                saveEdit();
              }} style={{
                backgroundColor: "#FF9933", paddingVertical: 12,
                paddingHorizontal: 20, borderRadius: 8,
              }}>
                <Text style={{ color: "#0f0f0f", fontFamily: "BricolageGrotesque_700Bold" }}>Save</Text>
              </Pressable>
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
}

export function MenuEditor({ menu, setMenu, onItemPress, onQuickAdd, restaurantId }: MenuEditorProps) {
  const { isAdmin, isRestaurantOwner, ownedRestaurantId } = useAdminMode();
  const canEdit = isAdmin || (isRestaurantOwner && !!restaurantId && restaurantId === ownedRestaurantId);
  const [showAddCategory, setShowAddCategory] = useState(false);
  const [newCategoryName, setNewCategoryName] = useState("");
  const [showAddItem, setShowAddItem] = useState(false);
  const [newItemName, setNewItemName] = useState("");
  const [newItemPrice, setNewItemPrice] = useState("");
  const [newItemDesc, setNewItemDesc] = useState("");
  const [addingItem, setAddingItem] = useState(false);

  const categories = Array.from(new Set(menu.map(m => m.category).filter(Boolean)));

  const handleItemUpdated = (updatedItem: UIMenuItem) => {
    setMenu(menu.map(m => m.id === updatedItem.id ? updatedItem : m));
  };

  const handleDelete = (id: string) => {
    setMenu(menu.filter(m => m.id !== id));
  };

  const handleAddItem = async () => {
    if (!newItemName.trim()) { Alert.alert("Error", "Name is required"); return; }
    const price = parseFloat(newItemPrice);
    if (isNaN(price) || price < 0) { Alert.alert("Error", "Invalid price"); return; }
    if (!restaurantId) { Alert.alert("Error", "Restaurant ID missing"); return; }

    setAddingItem(true);
    try {
      const { data, error } = await supabase
        .from("menu_items")
        .insert({
          restaurant_id: Number(restaurantId),
          name: newItemName.trim(),
          price,
          description: newItemDesc.trim() || null,
          is_available: true,
          is_vegetarian: false,
          is_spicy: false,
        })
        .select()
        .single();

      if (error) throw error;

      const newItem: UIMenuItem = {
        id: data.id.toString(),
        name: data.name,
        description: data.description || "",
        price: data.price,
        image: "https://images.unsplash.com/photo-1546069901-ba9599a7e63c?w=600&q=80",
        category: "Menu Item",
        isPopular: false,
        isVegetarian: false,
        spiceLevel: 0,
        mealTimes: [],
      };

      setMenu([...menu, newItem]);
      setShowAddItem(false);
      setNewItemName("");
      setNewItemPrice("");
      setNewItemDesc("");
      if (Platform.OS !== "web") Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
    } catch (err: any) {
      Alert.alert("Error", err.message || "Failed to add item");
    } finally {
      setAddingItem(false);
    }
  };

  const leftColumn = menu.filter((_, i) => i % 2 === 0);
  const rightColumn = menu.filter((_, i) => i % 2 !== 0);

  return (
    <View>
      {canEdit && (
        <View style={{
          flexDirection: "row", justifyContent: "flex-end",
          marginBottom: 12, gap: 8,
        }}>
          <Pressable
            onPress={() => {
              if (Platform.OS !== "web") Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
              setShowAddItem(true);
            }}
            style={{
              flexDirection: "row", alignItems: "center",
              backgroundColor: "rgba(34,197,94,0.12)",
              paddingHorizontal: 12, paddingVertical: 8,
              borderRadius: 10, borderWidth: 1,
              borderColor: "rgba(34,197,94,0.3)",
            }}
          >
            <Plus size={14} color="#22C55E" />
            <Text style={{ fontFamily: "Manrope_600SemiBold", color: "#22C55E", fontSize: 12, marginLeft: 4 }}>
              Add Item
            </Text>
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
            />
          ))}
        </View>
      </View>

      {/* Add Item Modal */}
      <Modal visible={showAddItem} transparent animationType="slide">
        <KeyboardAvoidingView
          behavior={Platform.OS === "ios" ? "padding" : "height"}
          style={{
            flex: 1, backgroundColor: "rgba(0,0,0,0.7)",
            justifyContent: "flex-end",
          }}
        >
          <View style={{
            backgroundColor: "#1a1a1a", borderTopLeftRadius: 24,
            borderTopRightRadius: 24, padding: 24,
            paddingBottom: Platform.OS === "ios" ? 40 : 24,
            borderWidth: 1, borderColor: "#2a2a2a",
          }}>
            <View style={{ flexDirection: "row", justifyContent: "space-between", alignItems: "center", marginBottom: 16 }}>
              <Text style={{ fontFamily: "BricolageGrotesque_700Bold", color: "#22C55E", fontSize: 20 }}>
                Add Menu Item
              </Text>
              <Pressable onPress={() => {
                if (Platform.OS !== "web") Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
                setShowAddItem(false);
              }} style={{ padding: 4 }}>
                <X color="#999" size={24} />
              </Pressable>
            </View>

            <TextInput
              style={inputStyle}
              placeholder="Item Name *"
              placeholderTextColor="#666"
              value={newItemName}
              onChangeText={setNewItemName}
            />
            <TextInput
              style={inputStyle}
              placeholder="Price *"
              placeholderTextColor="#666"
              value={newItemPrice}
              onChangeText={setNewItemPrice}
              keyboardType="decimal-pad"
            />
            <TextInput
              style={[inputStyle, { height: 80, textAlignVertical: "top" }]}
              placeholder="Description (optional)"
              placeholderTextColor="#666"
              value={newItemDesc}
              onChangeText={setNewItemDesc}
              multiline
            />

            <Pressable
              onPress={() => {
                if (Platform.OS !== "web") Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Medium);
                handleAddItem();
              }}
              disabled={addingItem}
              style={{
                backgroundColor: "#22C55E", paddingVertical: 14,
                borderRadius: 12, alignItems: "center", marginTop: 8,
                opacity: addingItem ? 0.7 : 1,
              }}
            >
              {addingItem ? (
                <ActivityIndicator color="#0f0f0f" />
              ) : (
                <Text style={{ fontFamily: "BricolageGrotesque_700Bold", color: "#0f0f0f", fontSize: 16 }}>
                  Add to Menu
                </Text>
              )}
            </Pressable>
          </View>
        </KeyboardAvoidingView>
      </Modal>
    </View>
  );
}

const inputStyle = {
  backgroundColor: "#0f0f0f",
  color: "#f5f5f5",
  borderWidth: 1,
  borderColor: "#333",
  borderRadius: 8,
  paddingHorizontal: 12,
  paddingVertical: 12,
  marginBottom: 12,
  fontFamily: "Manrope_500Medium",
  fontSize: 14,
} as const;
