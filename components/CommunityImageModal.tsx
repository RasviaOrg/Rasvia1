/**
 * CommunityImageModal
 *
 * Lets a signed-in user submit a photo for a menu item that lacks an official image.
 * The image is uploaded to Supabase Storage (community-images bucket) and a row
 * is inserted into `community_menu_images` with status = 'pending' for admin review.
 *
 * SQL migration you need to run in Supabase once:
 * ─────────────────────────────────────────────
 * CREATE TABLE IF NOT EXISTS community_menu_images (
 *   id              UUID        DEFAULT gen_random_uuid() PRIMARY KEY,
 *   menu_item_id    INTEGER     NOT NULL REFERENCES menu_items(id) ON DELETE CASCADE,
 *   restaurant_id   INTEGER     NOT NULL REFERENCES restaurants(id) ON DELETE CASCADE,
 *   submitted_by    UUID        REFERENCES auth.users(id) ON DELETE SET NULL,
 *   submitter_name  TEXT        NOT NULL,
 *   image_url       TEXT        NOT NULL,
 *   status          TEXT        NOT NULL DEFAULT 'pending'
 *                               CHECK (status IN ('pending','approved','rejected')),
 *   admin_note      TEXT,
 *   reviewed_by     UUID        REFERENCES auth.users(id) ON DELETE SET NULL,
 *   reviewed_at     TIMESTAMPTZ,
 *   created_at      TIMESTAMPTZ DEFAULT now() NOT NULL
 * );
 * ALTER TABLE community_menu_images ENABLE ROW LEVEL SECURITY;
 * -- Anyone logged-in can insert their own rows
 * CREATE POLICY "insert own" ON community_menu_images
 *   FOR INSERT TO authenticated WITH CHECK (auth.uid() = submitted_by);
 * -- Users see their own rows; public sees approved rows
 * CREATE POLICY "select own or approved" ON community_menu_images
 *   FOR SELECT USING (auth.uid() = submitted_by OR status = 'approved');
 * -- Service role / admins bypass RLS automatically
 *
 * Storage bucket: create a public bucket named "community-images"
 * ─────────────────────────────────────────────
 */

import React, { useEffect, useState } from "react";
import {
  View,
  Text,
  Modal,
  Pressable,
  Image,
  ActivityIndicator,
  Platform,
  Alert,
  KeyboardAvoidingView,
  ScrollView,
  Switch,
} from "react-native";
import { Camera, X, Upload, CheckCircle } from "lucide-react-native";
import * as ImagePicker from "expo-image-picker";
import * as Haptics from "expo-haptics";
import { supabase } from "@/lib/supabase";
import { useAuth } from "@/lib/auth-context";
import type { UIMenuItem } from "@/lib/restaurant-types";

interface Props {
  visible: boolean;
  item: UIMenuItem | null;
  restaurantId: string;
  onClose: () => void;
}

export function CommunityImageModal({ visible, item, restaurantId, onClose }: Props) {
  const { session } = useAuth();
  const [photoUri, setPhotoUri] = useState<string | null>(null);
  const [accountName, setAccountName] = useState("");
  const [anonymous, setAnonymous] = useState(false);
  const [uploading, setUploading] = useState(false);
  const [submitted, setSubmitted] = useState(false);

  const prettifyName = (raw: string) => {
    const base = (raw || "").split("@")[0];
    const spaced = base.replace(/[._-]+/g, " ").replace(/\s+/g, " ").trim();
    if (!spaced) return "User";
    return spaced
      .split(" ")
      .map((part) => part.charAt(0).toUpperCase() + part.slice(1).toLowerCase())
      .join(" ");
  };

  function reset() {
    setPhotoUri(null);
    setAnonymous(false);
    setUploading(false);
    setSubmitted(false);
  }

  useEffect(() => {
    if (!visible) return;
    const user = session?.user;
    const fallbackNameRaw =
      user?.user_metadata?.full_name ||
      user?.user_metadata?.name ||
      user?.email?.split("@")[0] ||
      "User";
    setAccountName(prettifyName(String(fallbackNameRaw)));
  }, [visible, session?.user]);

  function handleClose() {
    reset();
    onClose();
  }

  async function pickImage() {
    const { status } = await ImagePicker.requestMediaLibraryPermissionsAsync();
    if (status !== "granted") {
      Alert.alert("Permission needed", "Please allow photo library access to contribute an image.");
      return;
    }
    const result = await ImagePicker.launchImageLibraryAsync({
      mediaTypes: ImagePicker.MediaTypeOptions.Images,
      allowsEditing: true,
      aspect: [4, 3],
      quality: 0.75,
    });
    if (!result.canceled && result.assets[0]) {
      setPhotoUri(result.assets[0].uri);
    }
  }

  async function handleSubmit() {
    if (!photoUri) return;
    if (!session?.user?.id) {
      Alert.alert("Sign in required", "You must be signed in to contribute photos.");
      return;
    }
    if (!item) return;

    if (Platform.OS !== "web") Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Medium);
    setUploading(true);

    try {
      // 1. Read the image as a blob
      const response = await fetch(photoUri);
      const blob = await response.blob();
      const ext = photoUri.split(".").pop()?.toLowerCase() ?? "jpg";
      // Put auth uid first in path so common bucket RLS policies ("first folder = auth.uid()") pass.
      const filePath = `${session.user.id}/${restaurantId}/${item.id}/${Date.now()}.${ext}`;

      // 2. Upload to Supabase Storage
      const { error: uploadError } = await supabase.storage
        .from("community-images")
        .upload(filePath, blob, { contentType: `image/${ext}`, upsert: false });

      if (uploadError) throw uploadError;

      // 3. Get public URL
      const { data: urlData } = supabase.storage
        .from("community-images")
        .getPublicUrl(filePath);

      // 4. Insert submission row
      const { error: insertError } = await supabase
        .from("community_menu_images")
        .insert({
          menu_item_id: Number(item.id),
          restaurant_id: Number(restaurantId),
          submitted_by: session.user.id,
          submitter_name: anonymous ? "Anonymous" : accountName,
          image_url: urlData.publicUrl,
          status: "pending",
        });

      if (insertError) throw insertError;

      if (Platform.OS !== "web") Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
      setSubmitted(true);
    } catch (err: any) {
      if (Platform.OS !== "web") Haptics.notificationAsync(Haptics.NotificationFeedbackType.Error);
      Alert.alert("Upload failed", err.message ?? "Something went wrong. Please try again.");
    } finally {
      setUploading(false);
    }
  }

  return (
    <Modal visible={visible} animationType="slide" presentationStyle="pageSheet" onRequestClose={handleClose}>
      <KeyboardAvoidingView
        style={{ flex: 1, backgroundColor: "#0f0f0f" }}
        behavior={Platform.OS === "ios" ? "padding" : undefined}
      >
        <ScrollView contentContainerStyle={{ flexGrow: 1 }} keyboardShouldPersistTaps="handled">
          {/* Header */}
          <View
            style={{
              flexDirection: "row",
              alignItems: "center",
              paddingHorizontal: 20,
              paddingTop: 20,
              paddingBottom: 16,
              borderBottomWidth: 1,
              borderBottomColor: "#1e1e1e",
            }}
          >
            <Camera size={20} color="#FF9933" style={{ marginRight: 10 }} />
            <View style={{ flex: 1 }}>
              <Text style={{ fontFamily: "BricolageGrotesque_700Bold", color: "#f5f5f5", fontSize: 18 }}>
                Contribute a Photo
              </Text>
              <Text style={{ fontFamily: "Manrope_500Medium", color: "#888", fontSize: 12, marginTop: 1 }}>
                {item?.name ?? ""}
              </Text>
            </View>
            <Pressable onPress={handleClose} hitSlop={12}>
              <X size={22} color="#888" />
            </Pressable>
          </View>

          <View style={{ padding: 24 }}>
            {submitted ? (
              /* ── Success state ── */
              <View style={{ alignItems: "center", paddingTop: 32 }}>
                <View
                  style={{
                    width: 72, height: 72, borderRadius: 36,
                    backgroundColor: "rgba(34,197,94,0.12)",
                    borderWidth: 2, borderColor: "rgba(34,197,94,0.5)",
                    alignItems: "center", justifyContent: "center",
                    marginBottom: 20,
                  }}
                >
                  <CheckCircle size={34} color="#22C55E" />
                </View>
                <Text style={{ fontFamily: "BricolageGrotesque_700Bold", color: "#f5f5f5", fontSize: 22, marginBottom: 10, textAlign: "center" }}>
                  Photo submitted!
                </Text>
                <Text style={{ fontFamily: "Manrope_500Medium", color: "#888", fontSize: 14, textAlign: "center", lineHeight: 20, marginBottom: 32 }}>
                  Thanks! Our team will review your photo.{"\n"}If selected, it&apos;ll appear with your credit.
                </Text>
                <Pressable
                  onPress={handleClose}
                  style={{
                    backgroundColor: "#FF9933",
                    borderRadius: 14,
                    paddingHorizontal: 32,
                    paddingVertical: 14,
                  }}
                >
                  <Text style={{ fontFamily: "Manrope_700Bold", color: "#0f0f0f", fontSize: 15 }}>Done</Text>
                </Pressable>
              </View>
            ) : (
              /* ── Upload form ── */
              <>
                <Text style={{ fontFamily: "Manrope_500Medium", color: "#888", fontSize: 13, lineHeight: 19, marginBottom: 24 }}>
                  Help the community by adding a real photo of this dish. If approved, your name will appear as a small credit on the image.
                </Text>

                {/* Photo picker */}
                <Pressable
                  onPress={pickImage}
                  style={{
                    borderWidth: 1.5,
                    borderColor: photoUri ? "#2a2a2a" : "rgba(255,153,51,0.4)",
                    borderStyle: photoUri ? "solid" : "dashed",
                    borderRadius: 16,
                    height: 200,
                    overflow: "hidden",
                    alignItems: "center",
                    justifyContent: "center",
                    backgroundColor: "#141414",
                    marginBottom: 20,
                  }}
                >
                  {photoUri ? (
                    <Image
                      source={{ uri: photoUri }}
                      style={{ width: "100%", height: "100%" }}
                      resizeMode="cover"
                    />
                  ) : (
                    <View style={{ alignItems: "center", gap: 10 }}>
                      <View
                        style={{
                          width: 52, height: 52, borderRadius: 26,
                          backgroundColor: "rgba(255,153,51,0.12)",
                          alignItems: "center", justifyContent: "center",
                        }}
                      >
                        <Camera size={26} color="#FF9933" />
                      </View>
                      <Text style={{ fontFamily: "Manrope_600SemiBold", color: "#FF9933", fontSize: 14 }}>
                        Tap to choose photo
                      </Text>
                      <Text style={{ fontFamily: "Manrope_500Medium", color: "#666", fontSize: 12 }}>
                        4:3 ratio recommended
                      </Text>
                    </View>
                  )}
                </Pressable>

                {photoUri && (
                  <Pressable
                    onPress={() => setPhotoUri(null)}
                    style={{ alignSelf: "center", marginBottom: 20 }}
                  >
                    <Text style={{ fontFamily: "Manrope_600SemiBold", color: "#888", fontSize: 12 }}>
                      Change photo
                    </Text>
                  </Pressable>
                )}

                <View
                  style={{
                    backgroundColor: "#141414",
                    borderWidth: 1,
                    borderColor: "#2a2a2a",
                    borderRadius: 12,
                    paddingHorizontal: 14,
                    paddingVertical: 12,
                    marginBottom: 28,
                  }}
                >
                  <Text style={{ fontFamily: "Manrope_600SemiBold", color: "#999", fontSize: 12, marginBottom: 8 }}>
                    Photo credit name
                  </Text>
                  <Text style={{ fontFamily: "Manrope_700Bold", color: "#f5f5f5", fontSize: 14 }}>
                    {anonymous ? "Anonymous" : accountName}
                  </Text>
                  <View style={{ marginTop: 12, flexDirection: "row", alignItems: "center", justifyContent: "space-between" }}>
                    <Text style={{ fontFamily: "Manrope_500Medium", color: "#b8b8b8", fontSize: 13 }}>
                      Submit anonymously
                    </Text>
                    <Switch
                      value={anonymous}
                      onValueChange={setAnonymous}
                      trackColor={{ false: "#333", true: "rgba(148,163,184,0.45)" }}
                      thumbColor={anonymous ? "#94A3B8" : "#888"}
                    />
                  </View>
                </View>

                <Pressable
                  onPress={handleSubmit}
                  disabled={!photoUri || uploading}
                  style={{
                    backgroundColor: !photoUri || uploading ? "#2a2a2a" : "#FF9933",
                    borderRadius: 14,
                    paddingVertical: 15,
                    alignItems: "center",
                    flexDirection: "row",
                    justifyContent: "center",
                    gap: 8,
                  }}
                >
                  {uploading ? (
                    <ActivityIndicator color="#0f0f0f" />
                  ) : (
                    <>
                      <Upload size={16} color={!photoUri ? "#666" : "#0f0f0f"} />
                      <Text
                        style={{
                          fontFamily: "Manrope_700Bold",
                          color: !photoUri ? "#666" : "#0f0f0f",
                          fontSize: 15,
                        }}
                      >
                        Submit for Review
                      </Text>
                    </>
                  )}
                </Pressable>
              </>
            )}
          </View>
        </ScrollView>
      </KeyboardAvoidingView>
    </Modal>
  );
}
