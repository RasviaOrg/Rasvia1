import React, { useEffect, useMemo, useState } from "react";
import * as SecureStore from "expo-secure-store";
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
  Moon,
  ChevronUp,
  ChevronDown,
  Pencil,
} from "lucide-react-native";
import * as ImagePicker from "expo-image-picker";
import * as Haptics from "expo-haptics";
import { useAdminMode } from "@/hooks/useAdminMode";
import { supabase } from "@/lib/supabase";
import { uploadMenuImageToStorage, type PickedImage } from "@/lib/menu-image-upload";
import { MenuGridItem } from "./MenuGridItem";
import { mapMenuItemToUI, type SupabaseMenuItem, type UIMenuItem } from "@/lib/restaurant-types";
import {
  DEFAULT_MENU_TAGS,
  ensureKnownTags,
  parseRestaurantMenuTags,
  serializeMenuTags,
  slugifyTag,
  type MenuTagConfig,
} from "@/lib/menu-tags";
import { MenuTagDialog } from "./MenuTagDialog";
import { useAppTheme } from "@/lib/app-theme";

function useMenuEditorFormStyles() {
  const { colors, isDark } = useAppTheme();
  return useMemo(
    () => ({
      labelStyle: {
        fontFamily: "Manrope_600SemiBold",
        color: colors.textMuted,
        fontSize: 12,
        textTransform: "uppercase" as const,
        letterSpacing: 1,
        marginBottom: 8,
        marginTop: 6,
      },
      helperText: {
        fontFamily: "Manrope_500Medium",
        color: colors.textMuted,
        fontSize: 11,
        marginTop: 8,
        marginBottom: 10,
      },
      inputStyle: {
        backgroundColor: isDark ? "#0f0f0f" : colors.backgroundElevated,
        color: colors.text,
        borderWidth: 1,
        borderColor: colors.cardBorder,
        borderRadius: 10,
        paddingHorizontal: 12,
        paddingVertical: 12,
        marginBottom: 12,
        fontFamily: "Manrope_500Medium",
        fontSize: 14,
      },
      smallActionButton: {
        flexDirection: "row" as const,
        alignItems: "center" as const,
        gap: 6,
        borderWidth: 1,
        borderColor: colors.cardBorder,
        borderRadius: 10,
        backgroundColor: isDark ? "#111111" : colors.pressableBg,
        paddingHorizontal: 10,
        paddingVertical: 8,
      },
      smallActionText: {
        fontFamily: "Manrope_600SemiBold" as const,
        color: colors.text,
        fontSize: 12,
      },
      modalSheet: {
        backgroundColor: colors.card,
        borderTopLeftRadius: 24,
        borderTopRightRadius: 24,
        borderWidth: 1,
        borderColor: colors.cardBorder,
      },
      modalFooterBar: {
        borderTopColor: colors.cardBorder,
        backgroundColor: colors.card,
      },
    }),
    [colors, isDark]
  );
}

function formatMealTimesForDb(values: string[]): string[] {
  return Array.from(new Set(values.map((v) => slugifyTag(v)).filter(Boolean)));
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
  tags,
}: {
  value: string[];
  onChange: (next: string[]) => void;
  tags: MenuTagConfig[];
}) {
  const { colors, isDark } = useAppTheme();
  const defs = tags.filter((t) => t.enabled !== false);

  return (
    <View style={{ flexDirection: "row", flexWrap: "wrap", gap: 8 }}>
      {defs.map((def) => {
        const active = value.includes(def.key);
        return (
          <Pressable
            key={def.key}
            onPress={() => {
              if (Platform.OS !== "web") Haptics.selectionAsync();
              if (value.includes(def.key)) {
                onChange(value.filter((key) => key !== def.key));
              } else {
                onChange([...value, def.key]);
              }
            }}
            style={{
              borderRadius: 999,
              borderWidth: 1,
              borderColor: active ? def.border : colors.cardBorder,
              backgroundColor: active ? def.bg : (isDark ? "#121212" : colors.pressableBg),
              paddingHorizontal: 12,
              paddingVertical: 8,
            }}
          >
            <Text
              style={{
                fontFamily: active ? "Manrope_700Bold" : "Manrope_600SemiBold",
                color: active ? def.color : colors.textMuted,
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
  const { colors, isDark } = useAppTheme();
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
            borderColor: n === level ? "rgba(239,68,68,0.45)" : colors.cardBorder,
            backgroundColor: n === level ? "rgba(239,68,68,0.12)" : (isDark ? "#121212" : colors.pressableBg),
            alignItems: "center",
            justifyContent: "center",
          }}
        >
          {n === 0 ? (
            <Text style={{ fontFamily: "Manrope_700Bold", color: n === level ? "#EF4444" : colors.textMuted, fontSize: 12 }}>0</Text>
          ) : (
            <View style={{ flexDirection: "row", alignItems: "center", justifyContent: "center" }}>
              {Array.from({ length: n }).map((_, idx) => (
                <Flame
                  key={idx}
                  size={12}
                  color={n === level ? "#EF4444" : colors.textMuted}
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
  menuTags,
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
  menuTags: MenuTagConfig[];
}) {
  const formStyles = useMenuEditorFormStyles();
  const { colors, isDark } = useAppTheme();
  const [showSettings, setShowSettings] = useState(false);
  const [saving, setSaving] = useState(false);
  const [uploadingImage, setUploadingImage] = useState(false);

  const [name, setName] = useState(item.name);
  const [price, setPrice] = useState(item.price.toString());
  const [description, setDescription] = useState(item.description);
  const [category, setCategory] = useState(item.category);
  const [isVegetarian, setIsVegetarian] = useState(item.isVegetarian);
  const [isHalal, setIsHalal] = useState(item.isHalal);
  const [spiceLevel, setSpiceLevel] = useState(item.spiceLevel);
  const [mealTimes, setMealTimes] = useState<string[]>(ensureKnownTags(item.mealTimes, menuTags));

  const openSettings = () => {
    if (Platform.OS !== "web") Haptics.selectionAsync();
    setName(item.name);
    setPrice(item.price.toString());
    setDescription(item.description);
    setCategory(item.category);
    setIsVegetarian(item.isVegetarian);
    setIsHalal(item.isHalal);
    setSpiceLevel(item.spiceLevel);
    setMealTimes(ensureKnownTags(item.mealTimes, menuTags));
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
      Alert.alert("Validation", "Select at least one menu tag.");
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
        is_halal: isHalal,
        is_spicy: spiceLevel > 0,
        spice_level: Math.max(0, Math.min(3, spiceLevel)),
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
        isHalal,
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
      <MenuGridItem item={item as any} index={index} onPress={onPress} onQuickAdd={onQuickAdd} showQuickAdd={showQuickAdd} onContributeImage={onContributeImage} ownerBadgeOffset={canEdit} />

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
          <View style={{ flex: 1, backgroundColor: isDark ? "rgba(0,0,0,0.72)" : "rgba(0,0,0,0.45)", justifyContent: "flex-end" }}>
            <Pressable style={{ flex: 1 }} onPress={() => setShowSettings(false)} />
            <View
              style={{
                ...formStyles.modalSheet,
                padding: 20,
                paddingBottom: Platform.OS === "ios" ? 10 : 8,
                maxHeight: "92%",
                minHeight: "70%",
              }}
            >
              <View style={{ flexDirection: "row", alignItems: "center", justifyContent: "space-between", marginBottom: 12 }}>
                <Text style={{ fontFamily: "BricolageGrotesque_700Bold", color: colors.text, fontSize: 20 }}>Item Settings</Text>
                <Pressable onPress={() => setShowSettings(false)} style={{ padding: 6 }}>
                  <X size={22} color={colors.textMuted} />
                </Pressable>
              </View>

              <View style={{ flex: 1 }}>
              <ScrollView
                style={{ flex: 1 }}
                showsVerticalScrollIndicator={false}
                contentContainerStyle={{ paddingBottom: 12 }}
              >
                <Text style={formStyles.labelStyle}>Image</Text>
                <View style={{ flexDirection: "row", gap: 8, marginBottom: 12 }}>
                  <Pressable onPress={() => updateImage(pickImageFromCamera)} style={formStyles.smallActionButton}>
                    <Camera size={14} color="#22C55E" />
                    <Text style={formStyles.smallActionText}>Take Photo</Text>
                  </Pressable>
                  <Pressable onPress={() => updateImage(pickImageFromLibrary)} style={formStyles.smallActionButton}>
                    <ImageIcon size={14} color="#FF9933" />
                    <Text style={formStyles.smallActionText}>Camera Roll</Text>
                  </Pressable>
                  <Pressable onPress={deleteItem} style={[formStyles.smallActionButton, { borderColor: "rgba(239,68,68,0.4)" }]}>
                    <Trash2 size={14} color="#EF4444" />
                    <Text style={[formStyles.smallActionText, { color: "#EF4444" }]}>Delete</Text>
                  </Pressable>
                </View>
                {!!item.image?.trim() && (
                  <Image
                    source={{ uri: item.image }}
                    style={{ width: "100%", height: 140, borderRadius: 12, marginBottom: 12, borderWidth: 1, borderColor: colors.cardBorder }}
                    resizeMode="cover"
                  />
                )}

                <Text style={formStyles.labelStyle}>Name</Text>
                <TextInput style={formStyles.inputStyle} value={name} onChangeText={setName} placeholder="Item name" placeholderTextColor={colors.textMuted} />

                <Text style={formStyles.labelStyle}>Price</Text>
                <TextInput style={formStyles.inputStyle} value={price} onChangeText={setPrice} keyboardType="decimal-pad" placeholder="Price" placeholderTextColor={colors.textMuted} />

                <Text style={formStyles.labelStyle}>Description</Text>
                <TextInput
                  style={[formStyles.inputStyle, { minHeight: 82, textAlignVertical: "top" }]}
                  value={description}
                  onChangeText={setDescription}
                  multiline
                  placeholder="Description"
                  placeholderTextColor={colors.textMuted}
                />

                <Text style={formStyles.labelStyle}>Category</Text>
                <TextInput style={formStyles.inputStyle} value={category} onChangeText={setCategory} placeholder="Category" placeholderTextColor={colors.textMuted} />

                <Text style={formStyles.labelStyle}>Meal Identifiers *</Text>
                <MealTimesSelector value={mealTimes} onChange={setMealTimes} tags={menuTags} />
                <Text style={formStyles.helperText}>Choose one or more tags for this item.</Text>

                <Text style={formStyles.labelStyle}>Spice Level</Text>
                <SpiceSelector level={spiceLevel} onChange={setSpiceLevel} />

                <Text style={formStyles.labelStyle}>Dietary</Text>
                {/* Split row: Vegetarian (left) + Halal (right). Both are
                    independently toggleable so an item can be marked as one,
                    both, or neither. Mirrors the web ItemFormDialog. */}
                <View style={{ flexDirection: "row", gap: 10, marginBottom: 12 }}>
                  <Pressable
                    onPress={() => setIsVegetarian((v) => !v)}
                    style={{
                      flex: 1,
                      flexDirection: "row",
                      alignItems: "center",
                      justifyContent: "center",
                      borderWidth: 1,
                      borderRadius: 10,
                      paddingVertical: 12,
                      borderColor: isVegetarian ? "rgba(34,197,94,0.45)" : colors.cardBorder,
                      backgroundColor: isVegetarian ? "rgba(34,197,94,0.12)" : (isDark ? "#0f0f0f" : colors.pressableBg),
                    }}
                  >
                    <Leaf size={14} color={isVegetarian ? "#22C55E" : colors.textMuted} />
                    <Text style={{ marginLeft: 8, fontFamily: "Manrope_700Bold", color: isVegetarian ? "#22C55E" : colors.textMuted }}>
                      Vegetarian
                    </Text>
                  </Pressable>
                  <Pressable
                    onPress={() => setIsHalal((v) => !v)}
                    style={{
                      flex: 1,
                      flexDirection: "row",
                      alignItems: "center",
                      justifyContent: "center",
                      borderWidth: 1,
                      borderRadius: 10,
                      paddingVertical: 12,
                      borderColor: isHalal ? "rgba(56,189,248,0.45)" : colors.cardBorder,
                      backgroundColor: isHalal ? "rgba(56,189,248,0.12)" : (isDark ? "#0f0f0f" : colors.pressableBg),
                    }}
                  >
                    <Moon size={14} color={isHalal ? "#38BDF8" : colors.textMuted} />
                    <Text style={{ marginLeft: 8, fontFamily: "Manrope_700Bold", color: isHalal ? "#38BDF8" : colors.textMuted }}>
                      Halal
                    </Text>
                  </Pressable>
                </View>

              </ScrollView>
              </View>
              <View
                style={{
                  borderTopWidth: 1,
                  ...formStyles.modalFooterBar,
                  marginHorizontal: -20,
                  marginTop: 6,
                  paddingTop: 12,
                  paddingHorizontal: 20,
                  paddingBottom: Platform.OS === "ios" ? 18 : 10,
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
  onMenuTagsChange?: (tags: MenuTagConfig[]) => void;
}

export function MenuEditor({ menu, setMenu, onItemPress, onQuickAdd, restaurantId, onContributeImage, onMenuTagsChange }: MenuEditorProps) {
  const { isAdmin, isRestaurantOwner, ownedRestaurantId } = useAdminMode();
  const canEdit = isAdmin || (isRestaurantOwner && !!restaurantId && restaurantId === ownedRestaurantId);
  // The orange "+" quick-add should be available whenever the viewer isn't
  // the one *editing* this specific menu. Previously we also hid it for
  // restaurant-owner accounts browsing *other* restaurants (walk-in
  // pre-order flow), which is why the buttons mysteriously disappeared
  // after tapping "Browse menu" from a waitlist or zero-wait prompt on any
  // staff/owner phone. Tie quick-add to `!canEdit` so owners still get to
  // order from venues they don't manage.
  const canOrder = !canEdit;
  const formStyles = useMenuEditorFormStyles();
  const { colors, isDark } = useAppTheme();

  const [showAddItem, setShowAddItem] = useState(false);
  const [newItemName, setNewItemName] = useState("");
  const [newItemPrice, setNewItemPrice] = useState("");
  const [newItemDesc, setNewItemDesc] = useState("");
  const [newItemCategory, setNewItemCategory] = useState("");
  const [menuTags, setMenuTags] = useState<MenuTagConfig[]>(DEFAULT_MENU_TAGS);
  const [savingTags, setSavingTags] = useState(false);
  /**
   * Owners manage a lot of vertical UI in this editor (add item + tag grid +
   * item list). The tag card can get tall once a restaurant has many tags, so
   * we let owners collapse it. Persisted per-restaurant via SecureStore so the
   * preference sticks across app launches.
   */
  const [tagsCollapsed, setTagsCollapsed] = useState(false);

  const tagsCollapsedKey = restaurantId ? `rasvia.menu_tags_collapsed.${restaurantId}` : null;

  useEffect(() => {
    if (!tagsCollapsedKey) return;
    let cancelled = false;
    (async () => {
      try {
        const raw = await SecureStore.getItemAsync(tagsCollapsedKey);
        if (cancelled) return;
        if (raw === "1") setTagsCollapsed(true);
        else if (raw === "0") setTagsCollapsed(false);
      } catch {
        // SecureStore misses shouldn't block the editor.
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [tagsCollapsedKey]);

  const toggleTagsCollapsed = () => {
    setTagsCollapsed((prev) => {
      const next = !prev;
      if (Platform.OS !== "web") Haptics.selectionAsync();
      if (tagsCollapsedKey) {
        SecureStore.setItemAsync(tagsCollapsedKey, next ? "1" : "0").catch(() => {
          // Non-fatal; state still updates in-memory.
        });
      }
      return next;
    });
  };
  /**
   * Popup state for the add/edit tag sheet. `null` means the dialog is
   * closed; otherwise we carry the mode + the tag being edited so the
   * child component can seed its fields.
   */
  const [tagDialog, setTagDialog] = useState<
    | { mode: "create" }
    | { mode: "edit"; tag: MenuTagConfig }
    | null
  >(null);
  const [newMealTimes, setNewMealTimes] = useState<string[]>([]);
  const [newIsVegetarian, setNewIsVegetarian] = useState(false);
  const [newIsHalal, setNewIsHalal] = useState(false);
  const [newSpiceLevel, setNewSpiceLevel] = useState(0);
  const [newImageAsset, setNewImageAsset] = useState<PickedImage | null>(null);
  const [addingItem, setAddingItem] = useState(false);

  useEffect(() => {
    let mounted = true;
    if (!restaurantId) return;
    const fetchTags = async () => {
      try {
        const { data, error } = await supabase
          .from("restaurant_menu_tags")
          .select("key, label, color, bg, border, enabled, position")
          .eq("restaurant_id", Number(restaurantId))
          .order("position", { ascending: true });
        if (error) throw error;
        if (!mounted) return;
        const parsed = parseRestaurantMenuTags((data ?? []) as unknown[]);
        const next = parsed.length > 0 ? parsed : DEFAULT_MENU_TAGS;
        setMenuTags(next);
        onMenuTagsChange?.(next);
      } catch {
        if (!mounted) return;
        setMenuTags(DEFAULT_MENU_TAGS);
        onMenuTagsChange?.(DEFAULT_MENU_TAGS);
      }
    };
    void fetchTags();
    const topicSuffix = Math.random().toString(36).slice(2, 8);
    const tagSub = supabase
      .channel(`owner-editor-menu-tags:${restaurantId}:${topicSuffix}`)
      .on(
        "postgres_changes",
        { event: "*", schema: "public", table: "restaurant_menu_tags", filter: `restaurant_id=eq.${restaurantId}` },
        () => { void fetchTags(); }
      )
      .subscribe();
    return () => {
      mounted = false;
      supabase.removeChannel(tagSub);
    };
  }, [restaurantId, onMenuTagsChange]);

  /**
   * Writes the full tag list via the server RPC. Returns `true` on success —
   * used by the popup dialog to decide whether to close itself.
   */
  const persistTags = async (nextTags: MenuTagConfig[]): Promise<boolean> => {
    if (!restaurantId) return false;
    const serialized = serializeMenuTags(nextTags);
    setMenuTags(serialized);
    onMenuTagsChange?.(serialized);
    setSavingTags(true);
    try {
      const { error } = await supabase
        .rpc("set_restaurant_menu_tags", {
          p_restaurant_id: Number(restaurantId),
          p_tags: serialized as any,
        });
      if (error) throw error;
      return true;
    } catch (err: any) {
      Alert.alert("Error", err?.message || "Could not save menu tags.");
      return false;
    } finally {
      setSavingTags(false);
    }
  };

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
    setNewIsHalal(false);
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
      Alert.alert("Validation", "Please select at least one menu tag.");
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
        is_halal: newIsHalal,
        is_spicy: newSpiceLevel > 0,
        spice_level: Math.max(0, Math.min(3, newSpiceLevel)),
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
        <View style={{ marginBottom: 12 }}>
          <View style={{ flexDirection: "row", justifyContent: "flex-end", marginBottom: 10 }}>
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
          <View style={{ backgroundColor: colors.card, borderRadius: 12, borderWidth: 1, borderColor: colors.cardBorder, padding: 10 }}>
            <View style={{ flexDirection: "row", alignItems: "center", justifyContent: "space-between", marginBottom: tagsCollapsed ? 0 : 8 }}>
              <Pressable
                onPress={toggleTagsCollapsed}
                hitSlop={6}
                style={{ flexDirection: "row", alignItems: "center", gap: 6, flex: 1 }}
              >
                <Text style={{ color: colors.text, fontFamily: "Manrope_700Bold", fontSize: 13 }}>Menu Tags</Text>
                <Text style={{ color: colors.textMuted, fontFamily: "Manrope_500Medium", fontSize: 11 }}>
                  {tagsCollapsed ? `(${menuTags.length})` : ""}
                </Text>
              </Pressable>
              <View style={{ flexDirection: "row", alignItems: "center", gap: 8 }}>
                {savingTags && <ActivityIndicator color="#FF9933" size="small" />}
                {/* Mirrors the web dashboard: tag CRUD lives in a focused
                    popup instead of an inline editor, so the card stays
                    compact and the form fields don't compete with the
                    item grid for space. */}
                <Pressable
                  onPress={() => setTagDialog({ mode: "create" })}
                  style={{
                    flexDirection: "row",
                    alignItems: "center",
                    gap: 4,
                    backgroundColor: "rgba(255,153,51,0.12)",
                    borderWidth: 1,
                    borderColor: "rgba(255,153,51,0.4)",
                    borderRadius: 8,
                    paddingHorizontal: 10,
                    paddingVertical: 6,
                  }}
                >
                  <Plus size={12} color="#FF9933" />
                  <Text style={{ color: "#FF9933", fontFamily: "Manrope_700Bold", fontSize: 11 }}>Add Tag</Text>
                </Pressable>
                {/* Collapse chevron: lets owners shrink the tag list so the
                    item grid below gets more viewport. State is persisted
                    per-restaurant via SecureStore. */}
                <Pressable
                  onPress={toggleTagsCollapsed}
                  hitSlop={6}
                  style={{
                    width: 28,
                    height: 28,
                    borderRadius: 8,
                    borderWidth: 1,
                    borderColor: colors.cardBorder,
                    backgroundColor: colors.pressableBg,
                    alignItems: "center",
                    justifyContent: "center",
                  }}
                >
                  {tagsCollapsed ? (
                    <ChevronDown size={14} color={colors.textMuted} />
                  ) : (
                    <ChevronUp size={14} color={colors.textMuted} />
                  )}
                </Pressable>
              </View>
            </View>
            {!tagsCollapsed && (
              <Text style={{ color: colors.textMuted, fontFamily: "Manrope_600SemiBold", fontSize: 11, marginBottom: 10 }}>
                Ordered top to bottom for display priority.
              </Text>
            )}
            {!tagsCollapsed && (
            <View style={{ gap: 8 }}>
              {menuTags.map((tag, idx) => (
                <View
                  key={tag.key}
                  style={{
                    flexDirection: "row",
                    alignItems: "center",
                    borderRadius: 12,
                    borderWidth: 1,
                    borderColor: tag.border,
                    backgroundColor: isDark ? "#0f0f0f" : colors.backgroundElevated,
                    paddingHorizontal: 10,
                    paddingVertical: 10,
                  }}
                >
                  <View style={{ width: 22, height: 22, borderRadius: 999, borderWidth: 1, borderColor: colors.cardBorder, alignItems: "center", justifyContent: "center", marginRight: 8 }}>
                    <Text style={{ color: colors.textMuted, fontFamily: "Manrope_700Bold", fontSize: 11 }}>{idx + 1}</Text>
                  </View>
                  <View style={{ flex: 1 }}>
                    <Text style={{ color: tag.color, fontFamily: "Manrope_700Bold", fontSize: 15 }}>{tag.label}</Text>
                  </View>
                  <View style={{ flexDirection: "row", gap: 6 }}>
                    <Pressable
                      onPress={() => setTagDialog({ mode: "edit", tag })}
                      style={{ width: 28, height: 28, borderRadius: 8, borderWidth: 1, borderColor: "rgba(255,153,51,0.45)", backgroundColor: "rgba(255,153,51,0.12)", alignItems: "center", justifyContent: "center" }}
                    >
                      <Pencil size={14} color="#FF9933" />
                    </Pressable>
                    <Pressable
                      onPress={() => {
                        if (idx <= 0) return;
                        const next = [...menuTags];
                        const temp = next[idx - 1];
                        next[idx - 1] = next[idx];
                        next[idx] = temp;
                        void persistTags(next);
                      }}
                      style={{ width: 28, height: 28, borderRadius: 8, borderWidth: 1, borderColor: colors.cardBorder, backgroundColor: colors.pressableBg, alignItems: "center", justifyContent: "center" }}
                    >
                      <ChevronUp size={14} color={colors.textMuted} />
                    </Pressable>
                    <Pressable
                      onPress={() => {
                        if (idx >= menuTags.length - 1) return;
                        const next = [...menuTags];
                        const temp = next[idx + 1];
                        next[idx + 1] = next[idx];
                        next[idx] = temp;
                        void persistTags(next);
                      }}
                      style={{ width: 28, height: 28, borderRadius: 8, borderWidth: 1, borderColor: colors.cardBorder, backgroundColor: colors.pressableBg, alignItems: "center", justifyContent: "center" }}
                    >
                      <ChevronDown size={14} color={colors.textMuted} />
                    </Pressable>
                    <Pressable
                      onPress={() => {
                        Alert.alert("Delete tag?", `Remove "${tag.label}" from menu tags?`, [
                          { text: "Cancel", style: "cancel" },
                          {
                            text: "Delete",
                            style: "destructive",
                            onPress: () => {
                              const next = menuTags.filter((_, i) => i !== idx);
                              if (next.length === 0) return;
                              void persistTags(next);
                            },
                          },
                        ]);
                      }}
                      style={{ width: 28, height: 28, borderRadius: 8, borderWidth: 1, borderColor: "rgba(239,68,68,0.45)", backgroundColor: "rgba(239,68,68,0.12)", alignItems: "center", justifyContent: "center" }}
                    >
                      <Trash2 size={14} color="#EF4444" />
                    </Pressable>
                  </View>
                </View>
              ))}
            </View>
            )}
          </View>
        </View>
      )}

      <MenuTagDialog
        visible={!!tagDialog}
        mode={tagDialog?.mode ?? "create"}
        tags={menuTags}
        editingTag={tagDialog?.mode === "edit" ? tagDialog.tag : null}
        onClose={() => setTagDialog(null)}
        onSubmit={persistTags}
      />

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
              menuTags={menuTags}
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
              menuTags={menuTags}
            />
          ))}
        </View>
      </View>

      <Modal visible={showAddItem} transparent animationType="slide" onRequestClose={() => setShowAddItem(false)}>
        <KeyboardAvoidingView behavior={Platform.OS === "ios" ? "padding" : "height"} style={{ flex: 1 }}>
          <View style={{ flex: 1, backgroundColor: isDark ? "rgba(0,0,0,0.72)" : "rgba(0,0,0,0.45)", justifyContent: "flex-end" }}>
            <Pressable style={{ flex: 1 }} onPress={() => setShowAddItem(false)} />
            <View
              style={{
                ...formStyles.modalSheet,
                padding: 20,
                paddingBottom: Platform.OS === "ios" ? 10 : 8,
                maxHeight: "92%",
                minHeight: "70%",
              }}
            >
              <View style={{ flexDirection: "row", justifyContent: "space-between", alignItems: "center", marginBottom: 12 }}>
                <Text style={{ fontFamily: "BricolageGrotesque_700Bold", color: "#22C55E", fontSize: 20 }}>Add Menu Item</Text>
                <Pressable onPress={() => setShowAddItem(false)} style={{ padding: 6 }}>
                  <X size={22} color={colors.textMuted} />
                </Pressable>
              </View>

              <View style={{ flex: 1 }}>
              <ScrollView
                style={{ flex: 1 }}
                showsVerticalScrollIndicator={false}
                contentContainerStyle={{ paddingBottom: 12 }}
              >
                <Text style={formStyles.labelStyle}>Image (Optional)</Text>
                <View style={{ flexDirection: "row", gap: 8, marginBottom: 12 }}>
                  <Pressable onPress={pickAddImage} style={formStyles.smallActionButton}>
                    <ImageIcon size={14} color="#FF9933" />
                    <Text style={formStyles.smallActionText}>Select Image</Text>
                  </Pressable>
                  {newImageAsset && (
                    <Pressable onPress={() => setNewImageAsset(null)} style={[formStyles.smallActionButton, { borderColor: "rgba(239,68,68,0.4)" }]}>
                      <Trash2 size={14} color="#EF4444" />
                      <Text style={[formStyles.smallActionText, { color: "#EF4444" }]}>Clear</Text>
                    </Pressable>
                  )}
                </View>
                {newImageAsset && (
                  <Image
                    source={{ uri: newImageAsset.uri }}
                    style={{ width: "100%", height: 140, borderRadius: 12, marginBottom: 12, borderWidth: 1, borderColor: colors.cardBorder }}
                    resizeMode="cover"
                  />
                )}

                <Text style={formStyles.labelStyle}>Name *</Text>
                <TextInput style={formStyles.inputStyle} placeholder="Item name" placeholderTextColor={colors.textMuted} value={newItemName} onChangeText={setNewItemName} />

                <Text style={formStyles.labelStyle}>Price *</Text>
                <TextInput style={formStyles.inputStyle} placeholder="Price" placeholderTextColor={colors.textMuted} value={newItemPrice} onChangeText={setNewItemPrice} keyboardType="decimal-pad" />

                <Text style={formStyles.labelStyle}>Description</Text>
                <TextInput
                  style={[formStyles.inputStyle, { minHeight: 82, textAlignVertical: "top" }]}
                  placeholder="Description (optional)"
                  placeholderTextColor={colors.textMuted}
                  value={newItemDesc}
                  onChangeText={setNewItemDesc}
                  multiline
                />

                <Text style={formStyles.labelStyle}>Category</Text>
                <TextInput style={formStyles.inputStyle} placeholder="Category (optional)" placeholderTextColor={colors.textMuted} value={newItemCategory} onChangeText={setNewItemCategory} />

                <Text style={formStyles.labelStyle}>Meal Identifiers *</Text>
                <MealTimesSelector value={newMealTimes} onChange={setNewMealTimes} tags={menuTags} />
                <Text style={formStyles.helperText}>Required. Choose at least one period.</Text>

                <Text style={formStyles.labelStyle}>Spice Level</Text>
                <SpiceSelector level={newSpiceLevel} onChange={setNewSpiceLevel} />

                <Text style={formStyles.labelStyle}>Dietary</Text>
                {/* Split row: Vegetarian (left) + Halal (right). Matches
                    the item settings modal + web ItemFormDialog so both
                    flags are set at creation time. */}
                <View style={{ flexDirection: "row", gap: 10, marginBottom: 12 }}>
                  <Pressable
                    onPress={() => setNewIsVegetarian((v) => !v)}
                    style={{
                      flex: 1,
                      flexDirection: "row",
                      alignItems: "center",
                      justifyContent: "center",
                      borderWidth: 1,
                      borderRadius: 10,
                      paddingVertical: 12,
                      borderColor: newIsVegetarian ? "rgba(34,197,94,0.45)" : colors.cardBorder,
                      backgroundColor: newIsVegetarian ? "rgba(34,197,94,0.12)" : (isDark ? "#0f0f0f" : colors.pressableBg),
                    }}
                  >
                    <Leaf size={14} color={newIsVegetarian ? "#22C55E" : colors.textMuted} />
                    <Text style={{ marginLeft: 8, fontFamily: "Manrope_700Bold", color: newIsVegetarian ? "#22C55E" : colors.textMuted }}>
                      Vegetarian
                    </Text>
                  </Pressable>
                  <Pressable
                    onPress={() => setNewIsHalal((v) => !v)}
                    style={{
                      flex: 1,
                      flexDirection: "row",
                      alignItems: "center",
                      justifyContent: "center",
                      borderWidth: 1,
                      borderRadius: 10,
                      paddingVertical: 12,
                      borderColor: newIsHalal ? "rgba(56,189,248,0.45)" : colors.cardBorder,
                      backgroundColor: newIsHalal ? "rgba(56,189,248,0.12)" : (isDark ? "#0f0f0f" : colors.pressableBg),
                    }}
                  >
                    <Moon size={14} color={newIsHalal ? "#38BDF8" : colors.textMuted} />
                    <Text style={{ marginLeft: 8, fontFamily: "Manrope_700Bold", color: newIsHalal ? "#38BDF8" : colors.textMuted }}>
                      Halal
                    </Text>
                  </Pressable>
                </View>

              </ScrollView>
              </View>
              <View
                style={{
                  borderTopWidth: 1,
                  ...formStyles.modalFooterBar,
                  marginHorizontal: -20,
                  marginTop: 6,
                  paddingTop: 12,
                  paddingHorizontal: 20,
                  paddingBottom: Platform.OS === "ios" ? 18 : 10,
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
