import React, { useCallback, useEffect, useState } from "react";
import {
  View,
  Text,
  ScrollView,
  Pressable,
  Image,
  ActivityIndicator,
  Alert,
  Platform,
  TextInput,
} from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";
import { useRouter } from "expo-router";
import {
  ArrowLeft,
  CheckCircle,
  XCircle,
  Camera,
  RefreshCw,
  Clock,
  Store,
  User,
} from "lucide-react-native";
import * as Haptics from "expo-haptics";
import { supabase } from "@/lib/supabase";
import { useAdminMode } from "@/hooks/useAdminMode";

type SubmissionStatus = "pending" | "approved" | "rejected";

type Submission = {
  id: string;
  menu_item_id: number;
  restaurant_id: number;
  submitted_by: string | null;
  submitter_name: string;
  image_url: string;
  status: SubmissionStatus;
  admin_note: string | null;
  created_at: string;
  menu_item_name?: string;
  restaurant_name?: string;
};

const STATUS_FILTERS: { key: SubmissionStatus | "all"; label: string }[] = [
  { key: "all", label: "All" },
  { key: "pending", label: "Pending" },
  { key: "approved", label: "Approved" },
  { key: "rejected", label: "Rejected" },
];

export default function AdminMenuImages() {
  const router = useRouter();
  const { isAdmin } = useAdminMode();
  const [submissions, setSubmissions] = useState<Submission[]>([]);
  const [loading, setLoading] = useState(true);
  const [activeFilter, setActiveFilter] = useState<SubmissionStatus | "all">("pending");
  const [actioningId, setActioningId] = useState<string | null>(null);
  const [adminNotes, setAdminNotes] = useState<Record<string, string>>({});

  const normalizeImageUrl = useCallback((value: string) => {
    if (!value) return value;
    if (/^https?:\/\//i.test(value)) return value;
    return supabase.storage.from("community-images").getPublicUrl(value).data.publicUrl;
  }, []);

  const fetchSubmissions = useCallback(async () => {
    setLoading(true);
    try {
      const { data, error } = await supabase
        .from("community_menu_images")
        .select("*")
        .order("created_at", { ascending: false });

      if (error) throw error;

      if (data && data.length > 0) {
        // Fetch menu item names and restaurant names in batch
        const menuItemIds = [...new Set(data.map((d: any) => d.menu_item_id))];
        const restaurantIds = [...new Set(data.map((d: any) => d.restaurant_id))];

        const [menuRes, restRes] = await Promise.all([
          supabase
            .from("menu_items")
            .select("id, name")
            .in("id", menuItemIds),
          supabase
            .from("restaurants")
            .select("id, name")
            .in("id", restaurantIds),
        ]);

        const menuMap: Record<number, string> = {};
        (menuRes.data ?? []).forEach((m: any) => { menuMap[m.id] = m.name; });
        const restMap: Record<number, string> = {};
        (restRes.data ?? []).forEach((r: any) => { restMap[r.id] = r.name; });

        setSubmissions(
          data.map((d: any) => ({
            ...d,
            image_url: normalizeImageUrl(d.image_url),
            menu_item_name: menuMap[d.menu_item_id] ?? `Item #${d.menu_item_id}`,
            restaurant_name: restMap[d.restaurant_id] ?? `Restaurant #${d.restaurant_id}`,
          }))
        );
      } else {
        setSubmissions([]);
      }
    } catch (err: any) {
      Alert.alert("Error", err.message ?? "Could not fetch submissions.");
    } finally {
      setLoading(false);
    }
  }, [normalizeImageUrl]);

  useEffect(() => {
    if (isAdmin) fetchSubmissions();
  }, [isAdmin, fetchSubmissions]);

  async function handleAction(
    submission: Submission,
    action: "approved" | "rejected"
  ) {
    if (Platform.OS !== "web") Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Medium);
    setActioningId(submission.id);
    try {
      const note = adminNotes[submission.id]?.trim() ?? null;

      const { error } = await supabase
        .from("community_menu_images")
        .update({
          status: action,
          admin_note: note || null,
          reviewed_at: new Date().toISOString(),
        })
        .eq("id", submission.id);

      if (error) throw error;

      // If approving: update the menu item's image_url so it's used going forward
      if (action === "approved") {
        const normalizedUrl = normalizeImageUrl(submission.image_url);
        const { error: menuUpdateError } = await supabase
          .from("menu_items")
          .update({ image_url: normalizedUrl })
          .eq("id", submission.menu_item_id);
        if (menuUpdateError) throw menuUpdateError;
      }

      if (Platform.OS !== "web")
        Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);

      setSubmissions((prev) =>
        prev.map((s) =>
          s.id === submission.id
            ? { ...s, status: action, admin_note: note }
            : s
        )
      );
    } catch (err: any) {
      if (Platform.OS !== "web")
        Haptics.notificationAsync(Haptics.NotificationFeedbackType.Error);
      Alert.alert("Error", err.message ?? "Action failed.");
    } finally {
      setActioningId(null);
    }
  }

  if (!isAdmin) {
    return (
      <View style={{ flex: 1, backgroundColor: "#0f0f0f", alignItems: "center", justifyContent: "center" }}>
        <Text style={{ fontFamily: "Manrope_500Medium", color: "#888", fontSize: 14 }}>
          Admin access required.
        </Text>
      </View>
    );
  }

  const filtered =
    activeFilter === "all"
      ? submissions
      : submissions.filter((s) => s.status === activeFilter);

  const pendingCount = submissions.filter((s) => s.status === "pending").length;

  return (
    <View style={{ flex: 1, backgroundColor: "#0f0f0f" }}>
      <SafeAreaView edges={["top"]}>
        {/* Header */}
        <View
          style={{
            flexDirection: "row",
            alignItems: "center",
            paddingHorizontal: 16,
            paddingVertical: 12,
            borderBottomWidth: 1,
            borderBottomColor: "#1e1e1e",
          }}
        >
          <Pressable
            onPress={() => router.back()}
            style={{
              width: 40, height: 40, borderRadius: 20,
              alignItems: "center", justifyContent: "center",
              backgroundColor: "#1a1a1a",
              borderWidth: 1, borderColor: "#2a2a2a",
              marginRight: 12,
            }}
          >
            <ArrowLeft size={20} color="#f5f5f5" />
          </Pressable>

          <View style={{ flex: 1 }}>
            <View style={{ flexDirection: "row", alignItems: "center", gap: 8 }}>
              <Camera size={18} color="#FF9933" />
              <Text style={{ fontFamily: "BricolageGrotesque_700Bold", color: "#f5f5f5", fontSize: 20 }}>
                Menu Image Review
              </Text>
              {pendingCount > 0 && (
                <View
                  style={{
                    backgroundColor: "#EF4444",
                    borderRadius: 10,
                    minWidth: 20,
                    height: 20,
                    alignItems: "center",
                    justifyContent: "center",
                    paddingHorizontal: 5,
                  }}
                >
                  <Text style={{ fontFamily: "Manrope_700Bold", color: "#fff", fontSize: 11 }}>
                    {pendingCount}
                  </Text>
                </View>
              )}
            </View>
            <Text style={{ fontFamily: "Manrope_500Medium", color: "#666", fontSize: 12 }}>
              Community-submitted food photos
            </Text>
          </View>

          <Pressable
            onPress={fetchSubmissions}
            hitSlop={12}
            style={{ padding: 8 }}
          >
            <RefreshCw size={18} color="#888" />
          </Pressable>
        </View>

        {/* Filter tabs */}
        <View
          style={{
            flexDirection: "row",
            paddingHorizontal: 16,
            paddingVertical: 10,
            gap: 8,
            borderBottomWidth: 1,
            borderBottomColor: "#1a1a1a",
          }}
        >
          {STATUS_FILTERS.map((f) => {
            const active = activeFilter === f.key;
            const count =
              f.key === "all"
                ? submissions.length
                : submissions.filter((s) => s.status === f.key).length;
            return (
              <Pressable
                key={f.key}
                onPress={() => setActiveFilter(f.key)}
                style={{
                  borderRadius: 20,
                  paddingHorizontal: 14,
                  paddingVertical: 7,
                  backgroundColor: active ? "rgba(255,153,51,0.14)" : "#1a1a1a",
                  borderWidth: 1,
                  borderColor: active ? "rgba(255,153,51,0.5)" : "#2a2a2a",
                  flexDirection: "row",
                  alignItems: "center",
                  gap: 5,
                }}
              >
                <Text
                  style={{
                    fontFamily: active ? "Manrope_700Bold" : "Manrope_500Medium",
                    color: active ? "#FF9933" : "#888",
                    fontSize: 13,
                  }}
                >
                  {f.label}
                </Text>
                {count > 0 && (
                  <Text
                    style={{
                      fontFamily: "JetBrainsMono_600SemiBold",
                      color: active ? "#FF9933" : "#666",
                      fontSize: 11,
                    }}
                  >
                    {count}
                  </Text>
                )}
              </Pressable>
            );
          })}
        </View>
      </SafeAreaView>

      {loading ? (
        <View style={{ flex: 1, alignItems: "center", justifyContent: "center" }}>
          <ActivityIndicator size="large" color="#FF9933" />
        </View>
      ) : filtered.length === 0 ? (
        <View style={{ flex: 1, alignItems: "center", justifyContent: "center", paddingHorizontal: 32 }}>
          <Camera size={40} color="#333" style={{ marginBottom: 16 }} />
          <Text style={{ fontFamily: "Manrope_600SemiBold", color: "#555", fontSize: 15, textAlign: "center" }}>
            No {activeFilter === "all" ? "" : activeFilter} submissions
          </Text>
        </View>
      ) : (
        <ScrollView
          showsVerticalScrollIndicator={false}
          contentContainerStyle={{ padding: 16, paddingBottom: 60, gap: 16 }}
        >
          {filtered.map((submission) => (
            <SubmissionCard
              key={submission.id}
              submission={submission}
              note={adminNotes[submission.id] ?? ""}
              onNoteChange={(text) =>
                setAdminNotes((prev) => ({ ...prev, [submission.id]: text }))
              }
              actioning={actioningId === submission.id}
              onApprove={() => handleAction(submission, "approved")}
              onReject={() => handleAction(submission, "rejected")}
            />
          ))}
        </ScrollView>
      )}
    </View>
  );
}

function SubmissionCard({
  submission,
  note,
  onNoteChange,
  actioning,
  onApprove,
  onReject,
}: {
  submission: Submission;
  note: string;
  onNoteChange: (text: string) => void;
  actioning: boolean;
  onApprove: () => void;
  onReject: () => void;
}) {
  const isPending = submission.status === "pending";
  const isApproved = submission.status === "approved";

  const statusColor = isApproved ? "#22C55E" : submission.status === "rejected" ? "#EF4444" : "#FF9933";
  const statusLabel = isApproved ? "Approved" : submission.status === "rejected" ? "Rejected" : "Pending review";

  return (
    <View
      style={{
        backgroundColor: "#141414",
        borderRadius: 20,
        borderWidth: 1,
        borderColor: "#1e1e1e",
        overflow: "hidden",
      }}
    >
      {/* Photo */}
      <View style={{ height: 220, backgroundColor: "#1a1a1a" }}>
        <Image
          source={{ uri: submission.image_url }}
          style={{ width: "100%", height: "100%" }}
          resizeMode="cover"
        />
        {/* Status badge */}
        <View
          style={{
            position: "absolute",
            top: 10,
            right: 10,
            backgroundColor: "rgba(0,0,0,0.72)",
            borderRadius: 12,
            borderWidth: 1,
            borderColor: statusColor,
            paddingHorizontal: 10,
            paddingVertical: 4,
          }}
        >
          <Text style={{ fontFamily: "Manrope_700Bold", color: statusColor, fontSize: 11 }}>
            {statusLabel}
          </Text>
        </View>
      </View>

      <View style={{ padding: 16 }}>
        {/* Meta info */}
        <View style={{ gap: 6, marginBottom: 14 }}>
          <View style={{ flexDirection: "row", alignItems: "center", gap: 6 }}>
            <Store size={13} color="#888" />
            <Text style={{ fontFamily: "Manrope_600SemiBold", color: "#f5f5f5", fontSize: 14 }}>
              {submission.restaurant_name}
            </Text>
            <Text style={{ fontFamily: "Manrope_500Medium", color: "#888", fontSize: 13 }}>
              ·
            </Text>
            <Text style={{ fontFamily: "Manrope_500Medium", color: "#aaa", fontSize: 13 }}>
              {submission.menu_item_name}
            </Text>
          </View>

          <View style={{ flexDirection: "row", alignItems: "center", gap: 6 }}>
            <User size={13} color="#888" />
            <Text style={{ fontFamily: "Manrope_500Medium", color: "#aaa", fontSize: 13 }}>
              Submitted by{" "}
              <Text style={{ fontFamily: "Manrope_700Bold", color: "#f5f5f5" }}>
                {submission.submitter_name}
              </Text>
            </Text>
          </View>

          <View style={{ flexDirection: "row", alignItems: "center", gap: 6 }}>
            <Clock size={12} color="#666" />
            <Text style={{ fontFamily: "Manrope_500Medium", color: "#666", fontSize: 12 }}>
              {new Date(submission.created_at).toLocaleDateString("en-US", {
                month: "short", day: "numeric", year: "numeric",
                hour: "2-digit", minute: "2-digit",
              })}
            </Text>
          </View>
        </View>

        {/* Admin note (editable when pending, read-only otherwise) */}
        {isPending ? (
          <TextInput
            value={note}
            onChangeText={onNoteChange}
            placeholder="Optional note for contributor…"
            placeholderTextColor="#444"
            multiline
            style={{
              backgroundColor: "#1a1a1a",
              borderWidth: 1,
              borderColor: "#2a2a2a",
              borderRadius: 10,
              paddingHorizontal: 12,
              paddingVertical: 10,
              fontFamily: "Manrope_500Medium",
              color: "#f5f5f5",
              fontSize: 13,
              minHeight: 56,
              marginBottom: 14,
            }}
          />
        ) : submission.admin_note ? (
          <View
            style={{
              backgroundColor: "#1a1a1a",
              borderRadius: 10,
              borderWidth: 1,
              borderColor: "#2a2a2a",
              padding: 10,
              marginBottom: 12,
            }}
          >
            <Text style={{ fontFamily: "Manrope_500Medium", color: "#888", fontSize: 12 }}>
              Admin note: {submission.admin_note}
            </Text>
          </View>
        ) : null}

        {/* Action buttons — only shown when pending */}
        {isPending && (
          <View style={{ flexDirection: "row", gap: 10 }}>
            <Pressable
              onPress={onApprove}
              disabled={actioning}
              style={{
                flex: 1,
                backgroundColor: actioning ? "#1a1a1a" : "rgba(34,197,94,0.12)",
                borderWidth: 1.5,
                borderColor: actioning ? "#2a2a2a" : "rgba(34,197,94,0.5)",
                borderRadius: 14,
                paddingVertical: 13,
                flexDirection: "row",
                alignItems: "center",
                justifyContent: "center",
                gap: 7,
              }}
            >
              {actioning ? (
                <ActivityIndicator size="small" color="#22C55E" />
              ) : (
                <>
                  <CheckCircle size={16} color="#22C55E" />
                  <Text style={{ fontFamily: "Manrope_700Bold", color: "#22C55E", fontSize: 14 }}>
                    Approve
                  </Text>
                </>
              )}
            </Pressable>

            <Pressable
              onPress={onReject}
              disabled={actioning}
              style={{
                flex: 1,
                backgroundColor: actioning ? "#1a1a1a" : "rgba(239,68,68,0.10)",
                borderWidth: 1.5,
                borderColor: actioning ? "#2a2a2a" : "rgba(239,68,68,0.45)",
                borderRadius: 14,
                paddingVertical: 13,
                flexDirection: "row",
                alignItems: "center",
                justifyContent: "center",
                gap: 7,
              }}
            >
              <>
                <XCircle size={16} color="#EF4444" />
                <Text style={{ fontFamily: "Manrope_700Bold", color: "#EF4444", fontSize: 14 }}>
                  Reject
                </Text>
              </>
            </Pressable>
          </View>
        )}
      </View>
    </View>
  );
}
