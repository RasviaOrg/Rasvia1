import React, { useCallback, useEffect, useMemo, useState } from "react";
import {
  View,
  Text,
  Pressable,
  ScrollView,
  TextInput,
  Alert,
  Platform,
  Modal,
  Image,
  Switch,
} from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";
import { useRouter } from "expo-router";
import { ArrowLeft, ChevronDown, ChevronUp, Plus, Trash2 } from "lucide-react-native";
import * as Haptics from "expo-haptics";
import * as ImagePicker from "expo-image-picker";
import { supabase } from "@/lib/supabase";
import { useAdminMode } from "@/hooks/useAdminMode";

type MenuItemOption = { id: number; name: string; image_url: string | null };
type SlideDraft = { localId: string; imageUrl: string; menuItemId: number | null };

function toPublicImageUrl(value: string): string {
  const raw = value.trim();
  if (!raw) return "";
  if (/^https?:\/\//i.test(raw)) return raw;
  return supabase.storage.from("restaurant-images").getPublicUrl(raw).data.publicUrl;
}

export default function OwnerMediaCarouselScreen() {
  const router = useRouter();
  const { isRestaurantOwner, effectiveOwnerRestaurantId } = useAdminMode();

  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [menuItems, setMenuItems] = useState<MenuItemOption[]>([]);
  const [slides, setSlides] = useState<SlideDraft[]>([]);
  const [pickerForSlide, setPickerForSlide] = useState<string | null>(null);
  const [uploadingSlideId, setUploadingSlideId] = useState<string | null>(null);
  const [includeDefaultStarter, setIncludeDefaultStarter] = useState(true);

  const activeRestaurantId = Number(effectiveOwnerRestaurantId || 0);

  const loadData = useCallback(async () => {
    if (!activeRestaurantId || !isRestaurantOwner) {
      setLoading(false);
      return;
    }
    setLoading(true);
    try {
      const [menuRes, slidesRes, restaurantRes] = await Promise.all([
        supabase
          .from("menu_items")
          .select("id, name, image_url")
          .eq("restaurant_id", activeRestaurantId)
          .order("name", { ascending: true }),
        supabase
          .from("restaurant_media_slides")
          .select("id, image_url, menu_item_id, position")
          .eq("restaurant_id", activeRestaurantId)
          .order("position", { ascending: true }),
        supabase
          .from("restaurants")
          .select("use_regular_image_as_first_slide")
          .eq("id", activeRestaurantId)
          .maybeSingle(),
      ]);

      if (menuRes.error) throw menuRes.error;
      if (slidesRes.error) throw slidesRes.error;
      if (restaurantRes.error) throw restaurantRes.error;

      setMenuItems((menuRes.data ?? []) as MenuItemOption[]);
      const nextSlides = ((slidesRes.data ?? []) as any[]).map((row) => ({
        localId: String(row.id),
        imageUrl: String(row.image_url ?? ""),
        menuItemId: row.menu_item_id ? Number(row.menu_item_id) : null,
      }));
      setSlides(nextSlides);
      setIncludeDefaultStarter((restaurantRes.data as any)?.use_regular_image_as_first_slide !== false);
    } catch (err: any) {
      Alert.alert("Error", err?.message || "Could not load carousel settings.");
    } finally {
      setLoading(false);
    }
  }, [activeRestaurantId, isRestaurantOwner]);

  useEffect(() => {
    void loadData();
  }, [loadData]);

  const addSlide = () => {
    setSlides((prev) => [
      ...prev,
      {
        localId: `new-${Date.now()}-${Math.random().toString(16).slice(2)}`,
        imageUrl: "",
        menuItemId: null,
      },
    ]);
  };

  const updateSlide = (localId: string, patch: Partial<SlideDraft>) => {
    setSlides((prev) => prev.map((s) => (s.localId === localId ? { ...s, ...patch } : s)));
  };

  const removeSlide = (localId: string) => {
    setSlides((prev) => prev.filter((s) => s.localId !== localId));
  };

  const moveSlide = (index: number, dir: -1 | 1) => {
    setSlides((prev) => {
      const target = index + dir;
      if (target < 0 || target >= prev.length) return prev;
      const copy = [...prev];
      const [item] = copy.splice(index, 1);
      copy.splice(target, 0, item);
      return copy;
    });
  };

  const pickerSlide = useMemo(() => slides.find((s) => s.localId === pickerForSlide) ?? null, [slides, pickerForSlide]);

  const selectedMenuName = (menuItemId: number | null) => {
    if (!menuItemId) return "No linked menu item";
    return menuItems.find((m) => m.id === menuItemId)?.name ?? "Unknown item";
  };

  const tapHaptic = useCallback(() => {
    if (Platform.OS !== "web") {
      Haptics.selectionAsync();
    }
  }, []);

  const impactHaptic = useCallback(() => {
    if (Platform.OS !== "web") {
      Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
    }
  }, []);

  const confirmRemoveSlide = useCallback((localId: string) => {
    Alert.alert("Delete Slide", "Are you sure you want to delete this slide?", [
      { text: "Cancel", style: "cancel" },
      {
        text: "Delete",
        style: "destructive",
        onPress: () => {
          impactHaptic();
          removeSlide(localId);
        },
      },
    ]);
  }, [impactHaptic]);

  const saveAll = async () => {
    if (!activeRestaurantId) return;
    const validSlides = slides.filter((s) => s.imageUrl.trim().length > 0 || !!s.menuItemId);
    setSaving(true);
    try {
      const { error: restUpdateError } = await supabase
        .from("restaurants")
        .update({ use_regular_image_as_first_slide: includeDefaultStarter })
        .eq("id", activeRestaurantId);
      if (restUpdateError) throw restUpdateError;

      const { error: delError } = await supabase
        .from("restaurant_media_slides")
        .delete()
        .eq("restaurant_id", activeRestaurantId);
      if (delError) throw delError;

      if (validSlides.length > 0) {
        const payload = validSlides.map((s, index) => ({
          restaurant_id: activeRestaurantId,
          position: index,
          image_url: s.imageUrl.trim() || null,
          menu_item_id: s.menuItemId,
        }));
        const { error: insError } = await supabase.from("restaurant_media_slides").insert(payload as any);
        if (insError) throw insError;
      }

      Alert.alert("Saved", "Carousel settings updated.");
      await loadData();
    } catch (err: any) {
      Alert.alert("Error", err?.message || "Could not save carousel settings.");
    } finally {
      setSaving(false);
    }
  };

  const uploadImageForSlide = useCallback(
    async (slideLocalId: string) => {
      if (!activeRestaurantId) return;
      try {
        const perm = await ImagePicker.requestMediaLibraryPermissionsAsync();
        if (!perm.granted) {
          Alert.alert("Permission needed", "Please allow photo library access to upload images.");
          return;
        }
        const result = await ImagePicker.launchImageLibraryAsync({
          mediaTypes: "images",
          allowsEditing: true,
          quality: 0.9,
        });
        if (result.canceled || !result.assets?.[0]?.uri) return;
        const asset = result.assets[0];
        setUploadingSlideId(slideLocalId);
        const response = await fetch(asset.uri);
        const arrayBuffer = await response.arrayBuffer();
        const extFromName = (asset.fileName ?? "").split(".").pop()?.toLowerCase();
        const ext = extFromName && /^[a-z0-9]+$/.test(extFromName) ? extFromName : "jpg";
        const mime = asset.mimeType || (ext === "png" ? "image/png" : ext === "webp" ? "image/webp" : "image/jpeg");
        const path = `${activeRestaurantId}/${Date.now()}-${Math.random().toString(36).slice(2, 10)}.${ext}`;
        const { data, error } = await supabase.storage
          .from("restaurant-images")
          .upload(path, arrayBuffer, { contentType: mime, upsert: false });
        if (error) throw error;
        updateSlide(slideLocalId, { imageUrl: data.path });
        Alert.alert("Uploaded", "Image uploaded successfully.");
      } catch (err: any) {
        Alert.alert("Upload failed", err?.message || "Could not upload image.");
      } finally {
        setUploadingSlideId(null);
      }
    },
    [activeRestaurantId]
  );

  if (!isRestaurantOwner) {
    return (
      <View style={{ flex: 1, backgroundColor: "#0f0f0f", alignItems: "center", justifyContent: "center", padding: 24 }}>
        <Text style={{ color: "#f5f5f5", fontFamily: "BricolageGrotesque_700Bold", fontSize: 22, marginBottom: 8 }}>
          Owners only
        </Text>
        <Text style={{ color: "#999", fontFamily: "Manrope_500Medium", textAlign: "center" }}>
          You need owner access to edit restaurant carousel media.
        </Text>
      </View>
    );
  }

  return (
    <View style={{ flex: 1, backgroundColor: "#0f0f0f" }}>
      <SafeAreaView style={{ flex: 1 }} edges={["top"]}>
        <View style={{ flexDirection: "row", alignItems: "center", paddingHorizontal: 16, paddingBottom: 10, paddingTop: 6 }}>
          <Pressable
            onPress={() => {
              tapHaptic();
              router.back();
            }}
            style={{ width: 40, height: 40, borderRadius: 20, alignItems: "center", justifyContent: "center", backgroundColor: "#1a1a1a", borderWidth: 1, borderColor: "#2a2a2a" }}
          >
            <ArrowLeft size={20} color="#f5f5f5" />
          </Pressable>
          <Text style={{ marginLeft: 12, color: "#f5f5f5", fontFamily: "BricolageGrotesque_800ExtraBold", fontSize: 24 }}>
            Media Carousel
          </Text>
        </View>

        <ScrollView contentContainerStyle={{ padding: 16, paddingBottom: 40 }}>
          <Text style={{ color: "#999", fontFamily: "Manrope_500Medium", marginBottom: 12 }}>
            Top item is the starting image. Add URLs, optional linked menu items, and reorder.
          </Text>

          <View style={{ borderWidth: 1, borderColor: "#2a2a2a", backgroundColor: "#171717", borderRadius: 14, padding: 12, marginBottom: 10 }}>
            <View style={{ flexDirection: "row", alignItems: "center", justifyContent: "space-between", gap: 12 }}>
              <View style={{ flex: 1 }}>
                <Text style={{ color: "#f5f5f5", fontFamily: "Manrope_700Bold", fontSize: 14 }}>
                  Use regular restaurant image as slide 1
                </Text>
                <Text style={{ color: "#8f8f8f", fontFamily: "Manrope_500Medium", fontSize: 12, marginTop: 3 }}>
                  {includeDefaultStarter ? "Custom slides start at Slide 2." : "Custom slides start at Slide 1."}
                </Text>
              </View>
              <Switch
                value={includeDefaultStarter}
                onValueChange={(v) => {
                  tapHaptic();
                  setIncludeDefaultStarter(v);
                }}
                trackColor={{ false: "#3a3a3a", true: "#FF9933" }}
                thumbColor="#f5f5f5"
              />
            </View>
          </View>

          {slides.map((slide, index) => (
            <View key={slide.localId} style={{ borderWidth: 1, borderColor: "#2a2a2a", backgroundColor: "#171717", borderRadius: 14, padding: 12, marginBottom: 10 }}>
              <View style={{ flexDirection: "row", alignItems: "center", justifyContent: "space-between", marginBottom: 10 }}>
                <Text style={{ color: index === 0 ? "#FF9933" : "#f5f5f5", fontFamily: "Manrope_700Bold" }}>
                  Slide {index + (includeDefaultStarter ? 2 : 1)}
                  {index === 0 ? (includeDefaultStarter ? " (First custom slide)" : " (Starts first)") : ""}
                </Text>
                <View style={{ flexDirection: "row", alignItems: "center", gap: 8 }}>
                  <Pressable
                    onPress={() => {
                      if (index === 0) return;
                      tapHaptic();
                      moveSlide(index, -1);
                    }}
                    style={{ padding: 6, opacity: index === 0 ? 0.35 : 1 }}
                  >
                    <ChevronUp size={18} color="#f5f5f5" />
                  </Pressable>
                  <Pressable
                    onPress={() => {
                      if (index === slides.length - 1) return;
                      tapHaptic();
                      moveSlide(index, 1);
                    }}
                    style={{ padding: 6, opacity: index === slides.length - 1 ? 0.35 : 1 }}
                  >
                    <ChevronDown size={18} color="#f5f5f5" />
                  </Pressable>
                  <Pressable
                    onPress={() => {
                      tapHaptic();
                      confirmRemoveSlide(slide.localId);
                    }}
                    style={{ padding: 6 }}
                  >
                    <Trash2 size={18} color="#EF4444" />
                  </Pressable>
                </View>
              </View>

              <Text style={{ color: "#8f8f8f", fontFamily: "Manrope_600SemiBold", fontSize: 12, marginBottom: 6 }}>
                Image URL (optional if menu item selected)
              </Text>
              <TextInput
                value={slide.imageUrl}
                onChangeText={(text) => updateSlide(slide.localId, { imageUrl: text })}
                placeholder="https://..."
                placeholderTextColor="#666"
                style={{ borderWidth: 1, borderColor: "#2a2a2a", borderRadius: 10, backgroundColor: "#111", color: "#f5f5f5", paddingHorizontal: 10, paddingVertical: 10, fontFamily: "Manrope_500Medium" }}
                autoCapitalize="none"
              />

              {!!slide.imageUrl.trim() && (
                <View style={{ marginTop: 8 }}>
                  <Text style={{ color: "#8f8f8f", fontFamily: "Manrope_600SemiBold", fontSize: 12, marginBottom: 6 }}>
                    Preview
                  </Text>
                  <Image
                    source={{ uri: toPublicImageUrl(slide.imageUrl) }}
                    style={{ width: 64, height: 64, borderRadius: 10, backgroundColor: "#202020", borderWidth: 1, borderColor: "#2a2a2a" }}
                    resizeMode="cover"
                  />
                </View>
              )}

              <Pressable
                onPress={() => {
                  tapHaptic();
                  uploadImageForSlide(slide.localId);
                }}
                disabled={uploadingSlideId === slide.localId}
                style={{
                  marginTop: 8,
                  borderWidth: 1,
                  borderColor: "#2a2a2a",
                  borderRadius: 10,
                  backgroundColor: "#111",
                  paddingHorizontal: 10,
                  paddingVertical: 10,
                  opacity: uploadingSlideId === slide.localId ? 0.65 : 1,
                }}
              >
                <Text style={{ color: "#f5f5f5", fontFamily: "Manrope_600SemiBold" }}>
                  {uploadingSlideId === slide.localId ? "Uploading..." : "Upload from Library"}
                </Text>
              </Pressable>

              <Pressable
                onPress={() => {
                  tapHaptic();
                  setPickerForSlide(slide.localId);
                }}
                style={{ marginTop: 10, borderWidth: 1, borderColor: "#2a2a2a", borderRadius: 10, backgroundColor: "#111", paddingHorizontal: 10, paddingVertical: 10 }}
              >
                <Text style={{ color: "#8f8f8f", fontFamily: "Manrope_600SemiBold", fontSize: 12, marginBottom: 3 }}>
                  Linked menu item (for top-right tag)
                </Text>
                <Text style={{ color: "#f5f5f5", fontFamily: "Manrope_600SemiBold" }} numberOfLines={1}>
                  {selectedMenuName(slide.menuItemId)}
                </Text>
              </Pressable>
            </View>
          ))}

          <Pressable
            onPress={() => {
              tapHaptic();
              addSlide();
            }}
            style={{ marginTop: 4, borderWidth: 1, borderColor: "#3a3a3a", borderRadius: 12, backgroundColor: "#1a1a1a", paddingVertical: 12, alignItems: "center", justifyContent: "center", flexDirection: "row", gap: 8 }}
          >
            <Plus size={18} color="#f5f5f5" />
            <Text style={{ color: "#f5f5f5", fontFamily: "Manrope_700Bold" }}>Add Slide</Text>
          </Pressable>

          <Pressable
            onPress={() => {
              impactHaptic();
              saveAll();
            }}
            disabled={saving || loading}
            style={{ marginTop: 12, borderRadius: 12, backgroundColor: "#FF9933", paddingVertical: 13, alignItems: "center", opacity: saving || loading ? 0.65 : 1 }}
          >
            <Text style={{ color: "#0f0f0f", fontFamily: "Manrope_700Bold", fontSize: 15 }}>
              {saving ? "Saving..." : "Save Carousel"}
            </Text>
          </Pressable>
        </ScrollView>
      </SafeAreaView>

      <Modal visible={!!pickerSlide} transparent animationType="slide" onRequestClose={() => setPickerForSlide(null)}>
        <View style={{ flex: 1, backgroundColor: "rgba(0,0,0,0.65)", justifyContent: "flex-end" }}>
          <View style={{ maxHeight: "72%", backgroundColor: "#121212", borderTopLeftRadius: 18, borderTopRightRadius: 18, borderWidth: 1, borderColor: "#2a2a2a" }}>
            <SafeAreaView edges={["bottom"]}>
              <View style={{ paddingHorizontal: 16, paddingTop: 16, paddingBottom: 8, borderBottomWidth: 1, borderBottomColor: "#222" }}>
                <Text style={{ color: "#f5f5f5", fontFamily: "BricolageGrotesque_700Bold", fontSize: 20 }}>
                  Select Menu Item
                </Text>
              </View>
              <ScrollView contentContainerStyle={{ padding: 12, paddingBottom: 24 }}>
                <Pressable
                  onPress={() => {
                    tapHaptic();
                    if (pickerSlide) updateSlide(pickerSlide.localId, { menuItemId: null });
                    setPickerForSlide(null);
                  }}
                  style={{ borderWidth: 1, borderColor: "#2a2a2a", borderRadius: 10, backgroundColor: "#171717", paddingHorizontal: 12, paddingVertical: 12, marginBottom: 8 }}
                >
                  <Text style={{ color: "#f5f5f5", fontFamily: "Manrope_600SemiBold" }}>No linked menu item</Text>
                </Pressable>
                {menuItems.map((item) => (
                  <Pressable
                    key={item.id}
                    onPress={() => {
                      tapHaptic();
                      if (pickerSlide) updateSlide(pickerSlide.localId, { menuItemId: item.id });
                      setPickerForSlide(null);
                    }}
                    style={{ borderWidth: 1, borderColor: "#2a2a2a", borderRadius: 10, backgroundColor: "#171717", paddingHorizontal: 12, paddingVertical: 12, marginBottom: 8 }}
                  >
                    <Text style={{ color: "#f5f5f5", fontFamily: "Manrope_600SemiBold" }}>{item.name}</Text>
                    {!!item.image_url && (
                      <Text style={{ color: "#8f8f8f", fontFamily: "Manrope_500Medium", fontSize: 12, marginTop: 2 }}>Has menu image</Text>
                    )}
                  </Pressable>
                ))}
              </ScrollView>
            </SafeAreaView>
          </View>
        </View>
      </Modal>
    </View>
  );
}
