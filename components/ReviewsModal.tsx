import React, { useState, useEffect, useCallback, useRef, useMemo } from "react";
import {
  View,
  Text,
  Modal,
  Pressable,
  ScrollView,
  TextInput,
  ActivityIndicator,
  Alert,
  KeyboardAvoidingView,
  Platform,
  Dimensions,
} from "react-native";
import Animated, {
  useSharedValue,
  useAnimatedStyle,
  withSpring,
  runOnJS,
} from "react-native-reanimated";
import { Gesture, GestureDetector } from "react-native-gesture-handler";
import { Image } from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";
import {
  X,
  Star,
  Camera,
  Pencil,
  Trash2,
  Check,
} from "lucide-react-native";
import * as Haptics from "expo-haptics";
import * as ImagePicker from "expo-image-picker";
import { supabase } from "@/lib/supabase";
import { uploadReviewPhotoToStorage } from "@/lib/review-image-upload";
import { useAuth } from "@/lib/auth-context";
import { useAdminMode } from "@/hooks/useAdminMode";
import type { UIMenuItem } from "@/lib/restaurant-types";

// ================================================================
// Types
// ================================================================
type SortMode = "newest" | "highest" | "lowest";

interface ReviewReply {
  id: number;
  review_id: number;
  user_id: string;
  author_name: string;
  body: string;
  created_at: string;
  edited_at: string | null;
}

interface Review {
  id: number;
  user_id: string | null;
  reviewer_name: string;
  reviewer_avatar_url: string | null;
  rating: number;
  body: string | null;
  menu_item_ids: number[];
  photo_urls: string[];
  is_verified_purchase: boolean;
  is_from_google: boolean;
  created_at: string;
  edited_at: string | null;
  review_replies?: ReviewReply[] | null;
}

interface Props {
  visible: boolean;
  onClose: () => void;
  restaurantId: string;
  restaurantName: string;
  menuItems: UIMenuItem[];
  /** From parent (e.g. restaurant page) so header matches before fetch completes */
  initialReviewCount?: number | null;
  initialAvgRating?: number | null;
  /** Called when review list stats change (submit/edit/delete or after fetch) */
  onReviewsChanged?: (newCount: number, newAvg: number) => void;
}

// ================================================================
// Helpers
// ================================================================
function formatDate(iso: string) {
  const d = new Date(iso);
  return d.toLocaleDateString("en-AU", { day: "numeric", month: "short", year: "numeric" });
}

function formatEditedLabel(edited: string, created: string) {
  const eDate = new Date(edited);
  const cDate = new Date(created);
  const diff = eDate.getTime() - cDate.getTime();
  const mins = Math.round(diff / 60000);
  if (mins < 60) return `edited ${mins}m after posting`;
  const hours = Math.round(diff / 3600000);
  if (hours < 24) return `edited ${hours}h after posting`;
  const days = Math.round(diff / 86400000);
  return `edited ${days}d after posting`;
}

function avgRating(reviews: Review[]) {
  if (!reviews.length) return 0;
  return reviews.reduce((s, r) => s + r.rating, 0) / reviews.length;
}

function sortReviewsByMode(list: Review[], mode: SortMode): Review[] {
  const arr = [...list];
  if (mode === "newest") {
    arr.sort((a, b) => new Date(b.created_at).getTime() - new Date(a.created_at).getTime());
  } else if (mode === "highest") {
    arr.sort((a, b) => b.rating - a.rating);
  } else {
    arr.sort((a, b) => a.rating - b.rating);
  }
  return arr;
}

function sortReplies(list: ReviewReply[]): ReviewReply[] {
  return [...list].sort((a, b) => new Date(a.created_at).getTime() - new Date(b.created_at).getTime());
}

// ================================================================
// Sub-component: StarRow
// ================================================================
function StarRow({
  rating,
  size = 16,
  onPress,
}: {
  rating: number;
  size?: number;
  onPress?: (r: number) => void;
}) {
  return (
    <View style={{ flexDirection: "row", gap: 3 }}>
      {[1, 2, 3, 4, 5].map((s) => (
        <Pressable key={s} onPress={() => onPress?.(s)} hitSlop={6}>
          <Star
            size={size}
            color="#FF9933"
            fill={s <= rating ? "#FF9933" : "transparent"}
          />
        </Pressable>
      ))}
    </View>
  );
}

// ================================================================
// Sub-component: ZoomablePage (one slide inside the lightbox)
// ================================================================
function ZoomablePage({
  uri,
  width,
  height,
  onZoomChange,
}: {
  uri: string;
  width: number;
  height: number;
  onZoomChange: (zoomed: boolean) => void;
}) {
  const scale = useSharedValue(1);
  const savedScale = useSharedValue(1);

  const MIN_SCALE = 1;
  const MAX_SCALE = 4;
  // Allow slight rubber-band overshoot past limits during the gesture,
  // then spring back — gives a natural, elastic feel at both edges.
  const clampElastic = (raw: number) => {
    "worklet";
    if (raw < MIN_SCALE) return MIN_SCALE + (raw - MIN_SCALE) * 0.2;
    if (raw > MAX_SCALE) return MAX_SCALE + (raw - MAX_SCALE) * 0.2;
    return raw;
  };

  const pinch = Gesture.Pinch()
    .onUpdate((e) => {
      scale.value = clampElastic(savedScale.value * e.scale);
    })
    .onEnd(() => {
      // Snap back to hard limits with a spring
      const clamped = Math.min(Math.max(scale.value, MIN_SCALE), MAX_SCALE);
      scale.value = withSpring(clamped, { damping: 20, stiffness: 200 });
      savedScale.value = clamped;
      if (clamped <= 1.05) {
        scale.value = withSpring(1, { damping: 20, stiffness: 200 });
        savedScale.value = 1;
        runOnJS(onZoomChange)(false);
      } else {
        runOnJS(onZoomChange)(true);
      }
    });

  const doubleTap = Gesture.Tap()
    .numberOfTaps(2)
    .onEnd(() => {
      if (scale.value > 1) {
        scale.value = withSpring(1);
        savedScale.value = 1;
        runOnJS(onZoomChange)(false);
      } else {
        scale.value = withSpring(2.5);
        savedScale.value = 2.5;
        runOnJS(onZoomChange)(true);
      }
    });

  const composed = Gesture.Simultaneous(pinch, doubleTap);

  const animStyle = useAnimatedStyle(() => ({
    transform: [{ scale: scale.value }],
  }));

  return (
    <GestureDetector gesture={composed}>
      <Animated.View
        style={{ width, height, justifyContent: "center", alignItems: "center" }}
      >
        <Animated.Image
          source={{ uri }}
          style={[{ width, height: height * 0.75 }, animStyle]}
          resizeMode="contain"
        />
      </Animated.View>
    </GestureDetector>
  );
}

// ================================================================
// Sub-component: FullscreenPhotoModal
// ================================================================
function FullscreenPhotoModal({
  urls,
  startIndex,
  onClose,
}: {
  urls: string[];
  startIndex: number;
  onClose: () => void;
}) {
  const { width: sw, height: sh } = Dimensions.get("window");
  const [currentIndex, setCurrentIndex] = useState(startIndex);
  const [scrollEnabled, setScrollEnabled] = useState(true);
  const scrollRef = useRef<ScrollView>(null);

  // Scroll to the tapped photo after mount
  useEffect(() => {
    if (startIndex > 0) {
      scrollRef.current?.scrollTo({ x: startIndex * sw, animated: false });
    }
  }, []);

  return (
    <Modal visible animationType="fade" transparent onRequestClose={onClose}>
      <View style={{ flex: 1, backgroundColor: "rgba(0,0,0,0.95)" }}>
        {/* Swipeable paged photos */}
        <ScrollView
          ref={scrollRef}
          horizontal
          pagingEnabled
          scrollEnabled={scrollEnabled}
          showsHorizontalScrollIndicator={false}
          style={{ flex: 1 }}
          onMomentumScrollEnd={(e) => {
            const idx = Math.round(e.nativeEvent.contentOffset.x / sw);
            setCurrentIndex(idx);
          }}
        >
          {urls.map((url, i) => (
            <ZoomablePage
              key={i}
              uri={url}
              width={sw}
              height={sh}
              onZoomChange={(zoomed) => setScrollEnabled(!zoomed)}
            />
          ))}
        </ScrollView>

        {/* Close button */}
        <Pressable
          onPress={onClose}
          style={{ position: "absolute", top: 56, right: 20, padding: 10 }}
          hitSlop={10}
        >
          <X size={24} color="#f5f5f5" />
        </Pressable>

        {/* Dot indicators */}
        {urls.length > 1 && (
          <View
            style={{
              position: "absolute",
              bottom: 52,
              left: 0,
              right: 0,
              flexDirection: "row",
              justifyContent: "center",
              gap: 8,
            }}
          >
            {urls.map((_, i) => (
              <View
                key={i}
                style={{
                  width: 8,
                  height: 8,
                  borderRadius: 4,
                  backgroundColor: i === currentIndex ? "#FF9933" : "#555",
                }}
              />
            ))}
          </View>
        )}

        {/* Zoom hint — fades away once user interacts */}
        {urls.length === 1 && (
          <Text
            style={{
              position: "absolute",
              bottom: 52,
              left: 0,
              right: 0,
              textAlign: "center",
              color: "#555",
              fontFamily: "Manrope_400Regular",
              fontSize: 12,
            }}
          >
            Pinch or double-tap to zoom
          </Text>
        )}
      </View>
    </Modal>
  );
}

// ================================================================
// Sub-component: Reply thread (restaurant owner responses only — reviewers cannot reply to their own review)
// ================================================================
function ReviewReplyThread({
  reviewId,
  replies,
  restaurantOwnerId,
  sessionUserId,
  isOwnerOfRestaurant,
  onRepliesChanged,
}: {
  reviewId: number;
  replies: ReviewReply[];
  restaurantOwnerId: string | null;
  sessionUserId: string | undefined;
  isOwnerOfRestaurant: boolean;
  onRepliesChanged: () => void;
}) {
  const { session } = useAuth();
  const sorted = useMemo(() => sortReplies(replies), [replies]);
  const [draft, setDraft] = useState("");
  const [sending, setSending] = useState(false);

  const canReply = !!session?.user && isOwnerOfRestaurant;

  const submit = async () => {
    const t = draft.trim();
    if (!t || !session?.user) return;
    setSending(true);
    try {
      const { data: profile } = await supabase
        .from("profiles")
        .select("full_name")
        .eq("id", session.user.id)
        .maybeSingle();
      const author_name = profile?.full_name || session.user.email?.split("@")[0] || "User";
      const { error } = await supabase.from("review_replies").insert({
        review_id: reviewId,
        user_id: session.user.id,
        author_name,
        body: t,
      });
      if (error) throw error;
      setDraft("");
      Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
      onRepliesChanged();
    } catch (e: unknown) {
      Alert.alert("Error", e instanceof Error ? e.message : "Could not post reply.");
    } finally {
      setSending(false);
    }
  };

  const deleteReply = (replyId: number) => {
    Alert.alert("Delete reply?", undefined, [
      { text: "Cancel", style: "cancel" },
      {
        text: "Delete",
        style: "destructive",
        onPress: async () => {
          const { error } = await supabase.from("review_replies").delete().eq("id", replyId);
          if (!error) onRepliesChanged();
          else Alert.alert("Error", "Could not delete reply.");
        },
      },
    ]);
  };

  return (
    <View style={{ marginTop: 12, paddingTop: 12, borderTopWidth: 1, borderTopColor: "#2a2a2a" }}>
      {sorted.length > 0 && (
        <Text
          style={{
            color: "#777",
            fontFamily: "Manrope_600SemiBold",
            fontSize: 11,
            marginBottom: 8,
            textTransform: "uppercase",
            letterSpacing: 0.5,
          }}
        >
          {isOwnerOfRestaurant ? "Conversation" : "Replies"}
        </Text>
      )}
      {sorted.map((rp) => {
        const isOwnerReply = restaurantOwnerId != null && rp.user_id === restaurantOwnerId;
        const isMine = sessionUserId === rp.user_id;
        return (
          <View
            key={rp.id}
            style={{
              marginBottom: 10,
              paddingLeft: 10,
              borderLeftWidth: 2,
              borderLeftColor: isOwnerReply ? "rgba(255,153,51,0.55)" : "#444",
            }}
          >
            <View style={{ flexDirection: "row", justifyContent: "space-between", alignItems: "flex-start" }}>
              <View style={{ flex: 1, paddingRight: 8 }}>
                <Text style={{ color: isOwnerReply ? "#FFB366" : "#bbb", fontFamily: "Manrope_600SemiBold", fontSize: 12 }}>
                  {isOwnerReply ? "Restaurant" : rp.author_name}
                  {isOwnerReply ? (
                    <Text style={{ color: "#888", fontFamily: "Manrope_500Medium", fontSize: 10 }}> · Owner</Text>
                  ) : null}
                </Text>
                <Text
                  style={{
                    color: "#ccc",
                    fontFamily: "Manrope_400Regular",
                    fontSize: 13,
                    lineHeight: 18,
                    marginTop: 4,
                  }}
                >
                  {rp.body}
                </Text>
              </View>
              <View style={{ alignItems: "flex-end" }}>
                <Text style={{ color: "#555", fontFamily: "Manrope_400Regular", fontSize: 10 }}>{formatDate(rp.created_at)}</Text>
                {isMine && (
                  <Pressable onPress={() => deleteReply(rp.id)} hitSlop={6} style={{ marginTop: 4 }}>
                    <Trash2 size={12} color="#666" />
                  </Pressable>
                )}
              </View>
            </View>
          </View>
        );
      })}
      {canReply && (
        <View style={{ marginTop: 4 }}>
          <TextInput
            value={draft}
            onChangeText={setDraft}
            placeholder="Respond as restaurant…"
            placeholderTextColor="#555"
            multiline
            style={{
              backgroundColor: "#141414",
              borderRadius: 10,
              borderWidth: 1,
              borderColor: "#333",
              color: "#f5f5f5",
              fontFamily: "Manrope_400Regular",
              fontSize: 13,
              padding: 10,
              minHeight: 56,
              textAlignVertical: "top",
            }}
          />
          <Pressable
            onPress={() => void submit()}
            disabled={sending || !draft.trim()}
            style={{
              marginTop: 8,
              alignSelf: "flex-end",
              backgroundColor: draft.trim() && !sending ? "rgba(255,153,51,0.2)" : "#2a2a2a",
              paddingHorizontal: 14,
              paddingVertical: 8,
              borderRadius: 10,
              borderWidth: 1,
              borderColor: draft.trim() ? "rgba(255,153,51,0.4)" : "#333",
            }}
          >
            {sending ? (
              <ActivityIndicator color="#FF9933" size="small" />
            ) : (
              <Text style={{ color: "#FF9933", fontFamily: "Manrope_600SemiBold", fontSize: 13 }}>Send</Text>
            )}
          </Pressable>
        </View>
      )}
    </View>
  );
}

// ================================================================
// Sub-component: ReviewCard
// ================================================================
function ReviewCard({
  review,
  isOwn,
  menuItems,
  onEdit,
  onDelete,
  restaurantOwnerId,
  sessionUserId,
  isOwnerOfRestaurant,
  onRepliesChanged,
}: {
  review: Review;
  isOwn: boolean;
  menuItems: UIMenuItem[];
  onEdit?: () => void;
  onDelete?: () => void;
  restaurantOwnerId: string | null;
  sessionUserId: string | undefined;
  isOwnerOfRestaurant: boolean;
  onRepliesChanged: () => void;
}) {
  const [lightboxIndex, setLightboxIndex] = useState<number | null>(null);

  // Resolve menu item names from IDs
  const triedItems = menuItems.filter((m) => review.menu_item_ids.includes(Number(m.id)));

  return (
    <View
      style={{
        backgroundColor: "#1a1a1a",
        borderRadius: 14,
        padding: 14,
        marginBottom: 12,
        borderWidth: 1,
        borderColor: "#2a2a2a",
      }}
    >
      {/* Top row: avatar + name/date | badges (top-right) | edit/delete */}
      <View style={{ flexDirection: "row", alignItems: "flex-start", marginBottom: 8 }}>
        {/* Avatar */}
        <View
          style={{
            width: 34,
            height: 34,
            borderRadius: 17,
            backgroundColor: "#2a2a2a",
            alignItems: "center",
            justifyContent: "center",
            marginRight: 10,
          }}
        >
          {review.reviewer_avatar_url ? (
            <Image
              source={{ uri: review.reviewer_avatar_url }}
              style={{ width: 34, height: 34, borderRadius: 17 }}
            />
          ) : (
            <Text style={{ color: "#999", fontFamily: "Manrope_600SemiBold", fontSize: 13 }}>
              {(review.reviewer_name || "?")[0].toUpperCase()}
            </Text>
          )}
        </View>

        {/* Name + date */}
        <View style={{ flex: 1 }}>
          <Text style={{ color: "#f5f5f5", fontFamily: "Manrope_600SemiBold", fontSize: 14 }}>
            {review.reviewer_name}
          </Text>
          <Text style={{ color: "#666", fontFamily: "Manrope_400Regular", fontSize: 11, marginTop: 1 }}>
            {formatDate(review.created_at)}
            {review.edited_at && (
              <Text style={{ color: "#555", fontStyle: "italic" }}>
                {" · " + formatEditedLabel(review.edited_at, review.created_at)}
              </Text>
            )}
          </Text>
        </View>

        {/* Badges top-right */}
        <View style={{ alignItems: "flex-end", gap: 4, marginLeft: 8 }}>
          {review.is_from_google && (
            <View
              style={{
                backgroundColor: "#2a2a2a",
                borderRadius: 8,
                paddingHorizontal: 7,
                paddingVertical: 3,
              }}
            >
              <Text style={{ color: "#888", fontFamily: "Manrope_500Medium", fontSize: 10 }}>
                From Google
              </Text>
            </View>
          )}
          {review.is_verified_purchase && (
            <View
              style={{
                backgroundColor: "rgba(255,153,51,0.15)",
                borderRadius: 8,
                paddingHorizontal: 7,
                paddingVertical: 3,
                borderWidth: 1,
                borderColor: "rgba(255,153,51,0.35)",
              }}
            >
              <Text style={{ color: "#FF9933", fontFamily: "Manrope_600SemiBold", fontSize: 10 }}>
                Verified Purchase
              </Text>
            </View>
          )}
          {/* Own review actions */}
          {isOwn && (
            <View style={{ flexDirection: "row", gap: 10, marginTop: 2 }}>
              <Pressable onPress={onEdit} hitSlop={8}>
                <Pencil size={14} color="#888" />
              </Pressable>
              <Pressable onPress={onDelete} hitSlop={8}>
                <Trash2 size={14} color="#666" />
              </Pressable>
            </View>
          )}
        </View>
      </View>

      {/* Stars */}
      <StarRow rating={review.rating} size={14} />

      {/* Items tried pills — max 4 shown */}
      {triedItems.length > 0 && (
        <View style={{ flexDirection: "row", flexWrap: "wrap", gap: 6, marginTop: 8 }}>
          {triedItems.slice(0, 4).map((item) => (
            <View
              key={item.id}
              style={{
                backgroundColor: "#222",
                borderRadius: 20,
                paddingHorizontal: 10,
                paddingVertical: 4,
                borderWidth: 1,
                borderColor: "#333",
              }}
            >
              <Text style={{ color: "#aaa", fontFamily: "Manrope_500Medium", fontSize: 11 }}>
                {item.name}
              </Text>
            </View>
          ))}
          {triedItems.length > 4 && (
            <View
              style={{
                backgroundColor: "#222",
                borderRadius: 20,
                paddingHorizontal: 10,
                paddingVertical: 4,
                borderWidth: 1,
                borderColor: "#333",
              }}
            >
              <Text style={{ color: "#666", fontFamily: "Manrope_500Medium", fontSize: 11 }}>
                +{triedItems.length - 4} more
              </Text>
            </View>
          )}
        </View>
      )}

      {/* Body */}
      {!!review.body && (
        <Text
          style={{
            color: "#cccccc",
            fontFamily: "Manrope_400Regular",
            fontSize: 13,
            lineHeight: 19,
            marginTop: 8,
          }}
        >
          {review.body}
        </Text>
      )}

      {/* Photos — tappable for full-screen lightbox */}
      {review.photo_urls.length > 0 && (
        <ScrollView
          horizontal
          showsHorizontalScrollIndicator={false}
          style={{ marginTop: 10, height: 90 }}
          contentContainerStyle={{ gap: 8, alignItems: "center" }}
        >
          {review.photo_urls.map((url, i) => (
            <Pressable
              key={i}
              onPress={() => setLightboxIndex(i)}
              style={{
                width: 110,
                height: 80,
                borderRadius: 8,
                backgroundColor: "#2a2a2a",
                overflow: "hidden",
              }}
            >
              <Image
                source={{ uri: url }}
                style={{ width: 110, height: 80 }}
                resizeMode="cover"
              />
            </Pressable>
          ))}
        </ScrollView>
      )}

      {lightboxIndex !== null && (
        <FullscreenPhotoModal
          urls={review.photo_urls}
          startIndex={lightboxIndex}
          onClose={() => setLightboxIndex(null)}
        />
      )}

      <ReviewReplyThread
        reviewId={review.id}
        replies={review.review_replies ?? []}
        restaurantOwnerId={restaurantOwnerId}
        sessionUserId={sessionUserId}
        isOwnerOfRestaurant={isOwnerOfRestaurant}
        onRepliesChanged={onRepliesChanged}
      />
    </View>
  );
}

// ================================================================
// Write / Edit Review Form
// ================================================================
function WriteReviewForm({
  restaurantId,
  menuItems,
  existing,
  onSaved,
  onCancel,
}: {
  restaurantId: string;
  menuItems: UIMenuItem[];
  existing: Review | null;
  onSaved: (review: Review) => void;
  onCancel: () => void;
}) {
  const { session } = useAuth();
  const [rating, setRating] = useState(existing?.rating ?? 0);
  const [body, setBody] = useState(existing?.body ?? "");
  const [selectedMenuIds, setSelectedMenuIds] = useState<number[]>(existing?.menu_item_ids ?? []);
  const [photos, setPhotos] = useState<
    { uri: string; mimeType?: string | null; uploaded?: string }[]
  >((existing?.photo_urls ?? []).map((url) => ({ uri: url, uploaded: url })));
  const [saving, setSaving] = useState(false);

  const toggleMenuItem = (id: number) => {
    setSelectedMenuIds((prev) => {
      if (prev.includes(id)) return prev.filter((x) => x !== id);
      if (prev.length >= 4) return prev; // hard cap at 4
      return [...prev, id];
    });
  };

  const pickPhoto = async () => {
    if (photos.length >= 2) {
      Alert.alert("Photo limit", "You can attach up to 2 photos per review.");
      return;
    }
    const { status } = await ImagePicker.requestMediaLibraryPermissionsAsync();
    if (status !== "granted") {
      Alert.alert("Permission required", "Allow photo access to attach photos.");
      return;
    }
    const result = await ImagePicker.launchImageLibraryAsync({
      mediaTypes: "images",
      quality: 0.75,
      allowsEditing: true,
      aspect: [4, 3],
    });
    const asset = result.assets?.[0];
    if (!result.canceled && asset) {
      setPhotos((prev) => [...prev, { uri: asset.uri, mimeType: asset.mimeType }]);
    }
  };

  const removePhoto = (idx: number) => {
    setPhotos((prev) => prev.filter((_, i) => i !== idx));
  };

  const handleSave = async () => {
    if (!session?.user) {
      Alert.alert("Sign in required", "Please sign in to leave a review.");
      return;
    }
    if (rating === 0) {
      Alert.alert("Rating required", "Please select a star rating.");
      return;
    }

    // Monthly cap check (skip when editing)
    if (!existing) {
      const startOfMonth = new Date();
      startOfMonth.setDate(1);
      startOfMonth.setHours(0, 0, 0, 0);
      const { data: existing_ } = await supabase
        .from("restaurant_reviews")
        .select("id")
        .eq("restaurant_id", restaurantId)
        .eq("user_id", session.user.id)
        .gte("created_at", startOfMonth.toISOString())
        .maybeSingle();
      if (existing_) {
        Alert.alert(
          "Monthly limit reached",
          "You can leave one review per restaurant per month."
        );
        return;
      }
    }

    setSaving(true);
    try {
      // Upload any new photos (throws with a clear message if read/upload fails)
      const uploadedUrls: string[] = [];
      for (const p of photos) {
        if (p.uploaded) {
          uploadedUrls.push(p.uploaded);
        } else {
          const url = await uploadReviewPhotoToStorage(restaurantId, p.uri, p.mimeType);
          uploadedUrls.push(url);
        }
      }

      // Check for verified purchase (ordered at this restaurant in the last 24h)
      let isVerified = existing?.is_verified_purchase ?? false;
      if (!existing) {
        const since = new Date(Date.now() - 24 * 60 * 60 * 1000).toISOString();
        const { data: orders } = await supabase
          .from("orders")
          .select("id")
          .eq("restaurant_id", restaurantId)
          .eq("user_id", session.user.id)
          .gte("created_at", since)
          .limit(1);
        isVerified = !!(orders && orders.length > 0);
      }

      // Fetch display name
      const { data: profile } = await supabase
        .from("profiles")
        .select("full_name, avatar_url")
        .eq("id", session.user.id)
        .maybeSingle();
      const reviewerName = profile?.full_name || session.user.email?.split("@")[0] || "Anonymous";
      const reviewerAvatar = profile?.avatar_url ?? null;

      let savedReview: Review;

      if (existing && existing.id > 0) {
        // Edit existing
        const { data, error } = await supabase
          .from("restaurant_reviews")
          .update({
            rating,
            body: body.trim() || null,
            menu_item_ids: selectedMenuIds,
            photo_urls: uploadedUrls,
            edited_at: new Date().toISOString(),
          })
          .eq("id", existing.id)
          .select()
          .single();
        if (error) throw error;
        savedReview = data as Review;
      } else {
        // Insert new
        const { data, error } = await supabase
          .from("restaurant_reviews")
          .insert({
            restaurant_id: Number(restaurantId),
            user_id: session.user.id,
            reviewer_name: reviewerName,
            reviewer_avatar_url: reviewerAvatar,
            rating,
            body: body.trim() || null,
            menu_item_ids: selectedMenuIds,
            photo_urls: uploadedUrls,
            is_verified_purchase: isVerified,
            is_from_google: false,
          })
          .select()
          .single();
        if (error) throw error;
        savedReview = data as Review;
      }

      Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
      onSaved(savedReview);
    } catch (e: unknown) {
      const msg = e instanceof Error ? e.message : "Could not save your review.";
      Alert.alert("Error", msg);
    } finally {
      setSaving(false);
    }
  };

  return (
    <KeyboardAvoidingView
      behavior={Platform.OS === "ios" ? "padding" : undefined}
      style={{ flex: 1 }}
    >
      {/* Header */}
      <View
        style={{
          flexDirection: "row",
          alignItems: "center",
          justifyContent: "space-between",
          paddingHorizontal: 20,
          paddingVertical: 14,
          borderBottomWidth: 1,
          borderBottomColor: "#2a2a2a",
        }}
      >
        <Pressable onPress={onCancel} hitSlop={10}>
          <X size={22} color="#f5f5f5" />
        </Pressable>
        <Text style={{ color: "#f5f5f5", fontFamily: "Manrope_700Bold", fontSize: 16 }}>
          {existing ? "Edit Review" : "Write a Review"}
        </Text>
        <View style={{ width: 22 }} />
      </View>

      <ScrollView
        contentContainerStyle={{ padding: 20, paddingBottom: 16 }}
        keyboardShouldPersistTaps="handled"
        showsVerticalScrollIndicator={false}
      >
        {/* Star rating picker */}
        <Text style={labelStyle}>Your rating *</Text>
        <View style={{ flexDirection: "row", gap: 10, marginBottom: 24 }}>
          {[1, 2, 3, 4, 5].map((s) => (
            <Pressable
              key={s}
              onPress={() => {
                Haptics.selectionAsync();
                setRating(s);
              }}
              hitSlop={6}
            >
              <Star
                size={36}
                color="#FF9933"
                fill={s <= rating ? "#FF9933" : "transparent"}
              />
            </Pressable>
          ))}
        </View>

        {/* Review text */}
        <Text style={labelStyle}>Review (optional)</Text>
        <TextInput
          value={body}
          onChangeText={setBody}
          placeholder="Share your experience..."
          placeholderTextColor="#555"
          multiline
          numberOfLines={4}
          style={{
            backgroundColor: "#1a1a1a",
            borderRadius: 12,
            borderWidth: 1,
            borderColor: "#2a2a2a",
            color: "#f5f5f5",
            fontFamily: "Manrope_400Regular",
            fontSize: 14,
            padding: 14,
            minHeight: 100,
            textAlignVertical: "top",
            marginBottom: 24,
          }}
        />

        {/* Menu item pills */}
        {menuItems.length > 0 && (
          <>
            <Text style={labelStyle}>
              Items you tried (optional · max 4)
            </Text>
            <View style={{ flexDirection: "row", flexWrap: "wrap", gap: 8, marginBottom: 24 }}>
              {menuItems.map((item) => {
                const selected = selectedMenuIds.includes(Number(item.id));
                const atCap = selectedMenuIds.length >= 4 && !selected;
                return (
                  <Pressable
                    key={item.id}
                    onPress={() => {
                      if (!atCap) Haptics.selectionAsync();
                      toggleMenuItem(Number(item.id));
                    }}
                    style={{
                      paddingHorizontal: 12,
                      paddingVertical: 7,
                      borderRadius: 20,
                      backgroundColor: selected ? "rgba(255,153,51,0.15)" : "#1a1a1a",
                      borderWidth: 1,
                      borderColor: selected ? "rgba(255,153,51,0.5)" : "#2a2a2a",
                      flexDirection: "row",
                      alignItems: "center",
                      gap: 5,
                      opacity: atCap ? 0.35 : 1,
                    }}
                  >
                    {selected && <Check size={11} color="#FF9933" />}
                    <Text
                      style={{
                        color: selected ? "#FF9933" : "#aaa",
                        fontFamily: "Manrope_500Medium",
                        fontSize: 12,
                      }}
                    >
                      {item.name}
                    </Text>
                  </Pressable>
                );
              })}
            </View>
          </>
        )}

        {/* Photo picker */}
        <Text style={labelStyle}>Photos (up to 2)</Text>
        <View style={{ flexDirection: "row", gap: 10, marginBottom: 28 }}>
          {photos.map((p, i) => (
            <View key={i} style={{ position: "relative" }}>
              <View
                style={{
                  width: 90,
                  height: 70,
                  borderRadius: 10,
                  backgroundColor: "#2a2a2a",
                  overflow: "hidden",
                }}
              >
                <Image
                  source={{ uri: p.uri }}
                  style={{ width: 90, height: 70 }}
                  resizeMode="cover"
                />
              </View>
              <Pressable
                onPress={() => removePhoto(i)}
                style={{
                  position: "absolute",
                  top: -6,
                  right: -6,
                  backgroundColor: "#1a1a1a",
                  borderRadius: 10,
                  padding: 3,
                  borderWidth: 1,
                  borderColor: "#333",
                }}
              >
                <X size={10} color="#f5f5f5" />
              </Pressable>
            </View>
          ))}
          {photos.length < 2 && (
            <Pressable
              onPress={pickPhoto}
              style={{
                width: 90,
                height: 70,
                borderRadius: 10,
                backgroundColor: "#1a1a1a",
                borderWidth: 1,
                borderColor: "#2a2a2a",
                borderStyle: "dashed",
                alignItems: "center",
                justifyContent: "center",
                gap: 4,
              }}
            >
              <Camera size={18} color="#666" />
              <Text style={{ color: "#666", fontFamily: "Manrope_400Regular", fontSize: 10 }}>
                Add photo
              </Text>
            </Pressable>
          )}
        </View>
      </ScrollView>

      {/* Sticky save button */}
      <View
        style={{
          paddingHorizontal: 20,
          paddingBottom: Platform.OS === "ios" ? 28 : 20,
          paddingTop: 12,
          borderTopWidth: 1,
          borderTopColor: "#2a2a2a",
          backgroundColor: "#111",
        }}
      >
        <Pressable
          onPress={handleSave}
          disabled={saving}
          style={{
            backgroundColor: saving ? "#333" : "#FF9933",
            borderRadius: 14,
            paddingVertical: 15,
            alignItems: "center",
          }}
        >
          {saving ? (
            <ActivityIndicator color="#fff" size="small" />
          ) : (
            <Text style={{ color: "#111", fontFamily: "Manrope_700Bold", fontSize: 15 }}>
              {existing ? "Save Changes" : "Submit Review"}
            </Text>
          )}
        </Pressable>
      </View>
    </KeyboardAvoidingView>
  );
}

const labelStyle = {
  color: "#999",
  fontFamily: "Manrope_600SemiBold" as const,
  fontSize: 12,
  marginBottom: 10,
  textTransform: "uppercase" as const,
  letterSpacing: 0.6,
};

// ================================================================
// Main ReviewsModal
// ================================================================
export function ReviewsModal({
  visible,
  onClose,
  restaurantId,
  restaurantName,
  menuItems,
  initialReviewCount = null,
  initialAvgRating = null,
  onReviewsChanged,
}: Props) {
  const { session } = useAuth();
  const { isRestaurantOwner, ownedRestaurantId } = useAdminMode();
  /** Signed-in user owns this restaurant page — reply only, no new review on own venue */
  const isOwnerHere = isRestaurantOwner && ownedRestaurantId === restaurantId;
  const [restaurantOwnerId, setRestaurantOwnerId] = useState<string | null>(null);
  const [reviews, setReviews] = useState<Review[]>([]);
  const [loading, setLoading] = useState(true);
  const [sortMode, setSortMode] = useState<SortMode>("newest");
  const [showWrite, setShowWrite] = useState(false);
  const [editingReview, setEditingReview] = useState<Review | null>(null);

  // ──────────────────────────────────────────────────────────────
  // Fetch real reviews from Supabase
  // ──────────────────────────────────────────────────────────────
  const fetchReviews = useCallback(async () => {
    if (!restaurantId) return;
    setLoading(true);
    try {
      const [{ data, error }, { data: restRow }] = await Promise.all([
        supabase
          .from("restaurant_reviews")
          .select(
            `
          *,
          review_replies (
            id,
            review_id,
            user_id,
            author_name,
            body,
            created_at,
            edited_at
          )
        `
          )
          .eq("restaurant_id", restaurantId)
          .order("created_at", { ascending: false }),
        supabase.from("restaurants").select("owner_id").eq("id", restaurantId).maybeSingle(),
      ]);
      if (!error && data) {
        setReviews(data as Review[]);
      }
      setRestaurantOwnerId((restRow as { owner_id: string | null } | null)?.owner_id ?? null);
    } finally {
      setLoading(false);
    }
  }, [restaurantId]);

  useEffect(() => {
    if (visible) fetchReviews();
  }, [visible, fetchReviews]);

  // Sorted list — memoized so changing sort mode doesn't re-sort on unrelated renders
  const sortedReviews = useMemo(
    () => sortReviewsByMode(reviews, sortMode),
    [reviews, sortMode]
  );

  const computedAvg = useMemo(() => avgRating(reviews), [reviews]);
  const computedCount = reviews.length;

  const headerAvg = useMemo(() => {
    if (reviews.length > 0) return computedAvg;
    if (initialAvgRating != null && initialAvgRating > 0) return initialAvgRating;
    return 0;
  }, [reviews.length, computedAvg, initialAvgRating]);

  const headerCount = useMemo(() => {
    if (reviews.length > 0) return computedCount;
    if (initialReviewCount != null) return initialReviewCount;
    return 0;
  }, [reviews.length, computedCount, initialReviewCount]);

  // True when the signed-in user already has a review this calendar month
  const hasReviewedThisMonth = !!session?.user && reviews.some((r) => {
    if (r.user_id !== session.user!.id) return false;
    const d = new Date(r.created_at);
    const now = new Date();
    return d.getMonth() === now.getMonth() && d.getFullYear() === now.getFullYear();
  });

  // Push live stats to parent only after fetch completes (avoids wiping with 0 while loading)
  useEffect(() => {
    if (!onReviewsChanged || loading) return;
    const c = reviews.length;
    const a = c > 0 ? computedAvg : 0;
    onReviewsChanged(c, a);
  }, [reviews, computedAvg, loading, onReviewsChanged]);

  const setSortModeAndHaptic = useCallback((mode: SortMode) => {
    if (mode === sortMode) return;
    Haptics.selectionAsync();
    setSortMode(mode);
  }, [sortMode]);

  // ──────────────────────────────────────────────────────────────
  // Write / edit / delete handlers
  // ──────────────────────────────────────────────────────────────
  const handleSaved = (review: Review) => {
    const normalized: Review = { ...review, review_replies: review.review_replies ?? [] };
    setReviews((prev) => {
      const idx = prev.findIndex((r) => r.id === normalized.id);
      if (idx >= 0) {
        const next = [...prev];
        next[idx] = normalized;
        return next;
      }
      return [normalized, ...prev];
    });
    setShowWrite(false);
    setEditingReview(null);
  };

  const handleDelete = (id: number) => {
    Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Medium);
    Alert.alert("Delete review", "Are you sure you want to delete this review?", [
      { text: "Cancel", style: "cancel" },
      {
        text: "Delete",
        style: "destructive",
        onPress: async () => {
          const { error } = await supabase
            .from("restaurant_reviews")
            .delete()
            .eq("id", id);
          if (!error) {
            setReviews((prev) => prev.filter((r) => r.id !== id));
          } else {
            Alert.alert("Error", "Could not delete review.");
          }
        },
      },
    ]);
  };

  const openEdit = (review: Review) => {
    setEditingReview(review);
    setShowWrite(true);
  };

  const openWrite = () => {
    setEditingReview(null);
    setShowWrite(true);
  };

  // ──────────────────────────────────────────────────────────────
  // Render
  // ──────────────────────────────────────────────────────────────
  return (
    <Modal visible={visible} animationType="slide" presentationStyle="pageSheet" onRequestClose={onClose}>
      <View style={{ flex: 1, backgroundColor: "#111" }}>
        <SafeAreaView style={{ flex: 1 }} edges={["top", "bottom"]}>
          {showWrite ? (
            <WriteReviewForm
              restaurantId={restaurantId}
              menuItems={menuItems}
              existing={editingReview}
              onSaved={handleSaved}
              onCancel={() => {
                setShowWrite(false);
                setEditingReview(null);
              }}
            />
          ) : (
            <>
              {/* ── Header ── */}
              <View
                style={{
                  flexDirection: "row",
                  alignItems: "center",
                  justifyContent: "space-between",
                  paddingHorizontal: 20,
                  paddingVertical: 14,
                  borderBottomWidth: 1,
                  borderBottomColor: "#2a2a2a",
                }}
              >
                <View style={{ width: 22 }} />
                <Text style={{ color: "#f5f5f5", fontFamily: "Manrope_700Bold", fontSize: 16 }}>
                  Reviews
                </Text>
                <Pressable
                  onPress={() => {
                    Haptics.selectionAsync();
                    onClose();
                  }}
                  hitSlop={10}
                >
                  <X size={22} color="#f5f5f5" />
                </Pressable>
              </View>

              {/* ── Avg rating summary ── */}
              <View
                style={{
                  paddingHorizontal: 20,
                  paddingVertical: 18,
                  borderBottomWidth: 1,
                  borderBottomColor: "#2a2a2a",
                }}
              >
                <Text
                  style={{
                    color: "#f5f5f5",
                    fontFamily: "Manrope_700Bold",
                    fontSize: 13,
                    marginBottom: 4,
                  }}
                >
                  {restaurantName}
                </Text>
                <View style={{ flexDirection: "row", alignItems: "center", gap: 10 }}>
                  <Text
                    style={{
                      color: "#FF9933",
                      fontFamily: "JetBrainsMono_600SemiBold",
                      fontSize: 34,
                    }}
                  >
                    {headerCount === 0 ? "—" : headerAvg.toFixed(1)}
                  </Text>
                  <View>
                    <StarRow rating={headerCount === 0 ? 0 : Math.round(headerAvg)} size={18} />
                    <Text
                      style={{
                        color: "#666",
                        fontFamily: "Manrope_400Regular",
                        fontSize: 12,
                        marginTop: 3,
                      }}
                    >
                      {headerCount} {headerCount === 1 ? "review" : "reviews"}
                    </Text>
                  </View>
                </View>
              </View>

              {/* ── Sort by (single active pill) ── */}
              <View
                style={{
                  paddingHorizontal: 20,
                  paddingVertical: 12,
                  borderBottomWidth: 1,
                  borderBottomColor: "#2a2a2a",
                }}
              >
                <Text
                  style={{
                    color: "#888",
                    fontFamily: "Manrope_600SemiBold",
                    fontSize: 12,
                    marginBottom: 10,
                  }}
                >
                  Sort by:
                </Text>
                <View style={{ flexDirection: "row", flexWrap: "wrap", gap: 8 }}>
                  {(["newest", "highest", "lowest"] as const).map((mode) => {
                    const active = sortMode === mode;
                    const label =
                      mode === "newest" ? "Newest" : mode === "highest" ? "Highest" : "Lowest";
                    return (
                      <Pressable
                        key={mode}
                        onPress={() => setSortModeAndHaptic(mode)}
                        style={{
                          paddingHorizontal: 14,
                          paddingVertical: 8,
                          borderRadius: 20,
                          backgroundColor: active ? "rgba(255,153,51,0.2)" : "#1a1a1a",
                          borderWidth: 1,
                          borderColor: active ? "rgba(255,153,51,0.55)" : "#2a2a2a",
                        }}
                      >
                        <Text
                          style={{
                            color: active ? "#FF9933" : "#888",
                            fontFamily: "Manrope_600SemiBold",
                            fontSize: 13,
                          }}
                        >
                          {label}
                        </Text>
                      </Pressable>
                    );
                  })}
                </View>
              </View>

              {/* ── Reviews list ── */}
              <ScrollView
                contentContainerStyle={{ padding: 20, paddingBottom: 100 }}
                showsVerticalScrollIndicator={false}
              >
                {loading ? (
                  <ActivityIndicator color="#FF9933" style={{ marginTop: 40 }} />
                ) : sortedReviews.length === 0 ? (
                  <Text
                    style={{
                      color: "#555",
                      fontFamily: "Manrope_400Regular",
                      fontSize: 14,
                      textAlign: "center",
                      marginTop: 40,
                    }}
                  >
                    {isOwnerHere
                      ? "No reviews yet. When customers leave reviews, you can reply here."
                      : isRestaurantOwner
                        ? "No reviews yet."
                        : "No reviews yet. Be the first!"}
                  </Text>
                ) : (
                  sortedReviews.map((r) => (
                    <ReviewCard
                      key={r.id}
                      review={r}
                      isOwn={!!session?.user && r.user_id === session.user.id}
                      menuItems={menuItems}
                      onEdit={() => openEdit(r)}
                      onDelete={() => handleDelete(r.id)}
                      restaurantOwnerId={restaurantOwnerId}
                      sessionUserId={session?.user?.id}
                      isOwnerOfRestaurant={!!isOwnerHere}
                      onRepliesChanged={() => void fetchReviews()}
                    />
                  ))
                )}
              </ScrollView>

              {/* ── Write review (customers only) or owner hints ── */}
              {session && !isRestaurantOwner && (
                <View
                  style={{
                    position: "absolute",
                    bottom: 0,
                    left: 0,
                    right: 0,
                    paddingHorizontal: 20,
                    paddingBottom: Platform.OS === "ios" ? 32 : 20,
                    paddingTop: 12,
                    backgroundColor: "#111",
                    borderTopWidth: 1,
                    borderTopColor: "#2a2a2a",
                  }}
                >
                  <Pressable
                    onPress={() => {
                      if (hasReviewedThisMonth) return;
                      Haptics.selectionAsync();
                      openWrite();
                    }}
                    style={{
                      backgroundColor: hasReviewedThisMonth ? "#2a2a2a" : "#FF9933",
                      borderRadius: 14,
                      paddingVertical: 15,
                      alignItems: "center",
                      opacity: hasReviewedThisMonth ? 0.6 : 1,
                    }}
                  >
                    <Text
                      style={{
                        color: hasReviewedThisMonth ? "#666" : "#111",
                        fontFamily: "Manrope_700Bold",
                        fontSize: 15,
                      }}
                    >
                      Write a Review
                    </Text>
                  </Pressable>
                </View>
              )}
              {session && isOwnerHere && (
                <View
                  style={{
                    position: "absolute",
                    bottom: 0,
                    left: 0,
                    right: 0,
                    paddingHorizontal: 20,
                    paddingBottom: Platform.OS === "ios" ? 32 : 20,
                    paddingTop: 12,
                    backgroundColor: "#111",
                    borderTopWidth: 1,
                    borderTopColor: "#2a2a2a",
                  }}
                >
                  <Text
                    style={{
                      color: "#666",
                      fontFamily: "Manrope_500Medium",
                      fontSize: 13,
                      textAlign: "center",
                      lineHeight: 18,
                    }}
                  >
                    You manage this restaurant. Reply to reviews above. You cannot post a new review on your own venue.
                  </Text>
                </View>
              )}
              {session && isRestaurantOwner && !isOwnerHere && (
                <View
                  style={{
                    position: "absolute",
                    bottom: 0,
                    left: 0,
                    right: 0,
                    paddingHorizontal: 20,
                    paddingBottom: Platform.OS === "ios" ? 32 : 20,
                    paddingTop: 12,
                    backgroundColor: "#111",
                    borderTopWidth: 1,
                    borderTopColor: "#2a2a2a",
                  }}
                >
                  <Text
                    style={{
                      color: "#666",
                      fontFamily: "Manrope_500Medium",
                      fontSize: 13,
                      textAlign: "center",
                      lineHeight: 18,
                    }}
                  >
                    Restaurant owners can’t post reviews on other venues.
                  </Text>
                </View>
              )}
            </>
          )}
        </SafeAreaView>
      </View>
    </Modal>
  );
}
