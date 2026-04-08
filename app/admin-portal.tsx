import React, { useCallback, useEffect, useMemo, useState } from "react";
import {
  View,
  Text,
  ScrollView,
  Pressable,
  TextInput,
  ActivityIndicator,
  Alert,
  Platform,
  Switch,
  Modal,
  FlatList,
} from "react-native";
import { SafeAreaView, useSafeAreaInsets } from "react-native-safe-area-context";
import { useRouter } from "expo-router";
import { ArrowLeft, Save, Plus, Building2, Users, X, Shield, Store, User as UserIcon, Settings2, Flag, Trash2, Camera } from "lucide-react-native";
import * as Haptics from "expo-haptics";
import { supabase } from "@/lib/supabase";
import { useAdminMode } from "@/hooks/useAdminMode";
import { BrandedLoader } from "@/components/BrandedLoader";

type RestaurantRow = {
  id: number;
  name: string;
  address: string | null;
  description: string | null;
  image_url: string | null;
  current_wait_time: number | null;
  price_range: string | null;
  cuisine_tags: string[] | null;
  lat: number | null;
  long: number | null;
  owner_id: string | null;
  is_featured: boolean | null;
  is_enabled: boolean | null;
  waitlist_open: boolean | null;
  is_coming_soon: boolean | null;
  stripe_account_id: string | null;
};

type ProfileOption = {
  id: string;
  email: string | null;
  full_name: string | null;
  role: string | null;
  phone_number: string | null;
};

type ReviewReportView = {
  id: number;
  review_id: number;
  restaurant_id: number;
  owner_user_id: string;
  status: "pending" | "declined";
  reason: string | null;
  admin_message: string | null;
  created_at: string;
  reviewed_at: string | null;
  review: {
    id: number;
    rating: number;
    body: string | null;
    reviewer_name: string;
    created_at: string;
  } | null;
  restaurant: {
    id: number;
    name: string;
  } | null;
  ownerLabel: string;
};

function emptyForm(): Partial<RestaurantRow> {
  return {
    name: "",
    address: "",
    description: "",
    image_url: "",
    current_wait_time: 0,
    price_range: "$$",
    cuisine_tags: [],
    lat: null,
    long: null,
    owner_id: null,
    is_featured: false,
    is_enabled: true,
    waitlist_open: true,
    is_coming_soon: false,
    stripe_account_id: "",
  };
}

function profileLabel(p: ProfileOption) {
  const bits = [p.full_name?.trim(), p.email?.trim()].filter(Boolean);
  return bits.length ? bits.join(" · ") : p.id.slice(0, 8);
}

function getRoleBadge(role: string | null | undefined) {
  switch (role) {
    case 'admin':
      return { label: 'Admin', color: '#FF9933', bg: 'rgba(255,153,51,0.15)', Icon: Shield };
    case 'restaurant_owner':
      return { label: 'Owner', color: '#A78BFA', bg: 'rgba(167,139,250,0.15)', Icon: Store };
    default:
      return { label: 'User', color: '#60A5FA', bg: 'rgba(96,165,250,0.15)', Icon: UserIcon };
  }
}

async function syncRolesAfterOwnerChange(previousOwnerId: string | null, newOwnerId: string | null) {
  if (previousOwnerId && previousOwnerId !== newOwnerId) {
    const { count, error: cErr } = await supabase
      .from("restaurants")
      .select("*", { count: "exact", head: true })
      .eq("owner_id", previousOwnerId);
    if (cErr) console.error(cErr);
    if (count === 0) {
      const { data: prevProfile } = await supabase.from("profiles").select("role").eq("id", previousOwnerId).maybeSingle();
      if (prevProfile?.role === "restaurant_owner") {
        await supabase.from("profiles").update({ role: "user" }).eq("id", previousOwnerId);
      }
    }
  }
  if (newOwnerId) {
    const { data: np } = await supabase.from("profiles").select("role").eq("id", newOwnerId).maybeSingle();
    if (np?.role && np.role !== "admin" && np.role !== "restaurant_owner") {
      await supabase.from("profiles").update({ role: "restaurant_owner" }).eq("id", newOwnerId);
    }
  }
}

export default function AdminPortalScreen() {
  const router = useRouter();
  const insets = useSafeAreaInsets();
  const { isAdmin, loading: roleLoading } = useAdminMode();
  const [restaurants, setRestaurants] = useState<RestaurantRow[]>([]);
  const [profiles, setProfiles] = useState<ProfileOption[]>([]);
  const [reviewReports, setReviewReports] = useState<ReviewReportView[]>([]);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [adminMode, setAdminMode] = useState<"restaurants" | "users" | "settings">("restaurants");
  const [selectedId, setSelectedId] = useState<number | "new" | null>(null);
  const [draft, setDraft] = useState<Partial<RestaurantRow>>(emptyForm());
  const [cuisineTagsText, setCuisineTagsText] = useState("");
  const [latText, setLatText] = useState("");
  const [lngText, setLngText] = useState("");
  const [userSearch, setUserSearch] = useState("");
  const [selectedUserId, setSelectedUserId] = useState<string | null>(null);
  const [userDraft, setUserDraft] = useState({ full_name: "", phone_number: "", role: "user" });
  const [userSaving, setUserSaving] = useState(false);
  const [ownerPickerOpen, setOwnerPickerOpen] = useState(false);
  const [reportActionLoadingId, setReportActionLoadingId] = useState<number | null>(null);
  const [declineTarget, setDeclineTarget] = useState<ReviewReportView | null>(null);
  const [declineMessage, setDeclineMessage] = useState("");
  const [declineSaving, setDeclineSaving] = useState(false);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const [rRes, pRes, rrRes] = await Promise.all([
        supabase.from("restaurants").select("*").order("name", { ascending: true }),
        supabase.from("profiles").select("id, email, full_name, role, phone_number").order("email", { ascending: true }),
        supabase
          .from("review_reports")
          .select(`
            id,
            review_id,
            restaurant_id,
            owner_user_id,
            status,
            reason,
            admin_message,
            created_at,
            reviewed_at,
            restaurant_reviews (
              id,
              rating,
              body,
              reviewer_name,
              created_at
            ),
            restaurants (
              id,
              name
            )
          `)
          .order("created_at", { ascending: false }),
      ]);
      if (rRes.error) throw rRes.error;
      if (pRes.error) throw pRes.error;
      if (rrRes.error) throw rrRes.error;
      const profileRows = (pRes.data ?? []) as ProfileOption[];
      setRestaurants((rRes.data ?? []) as RestaurantRow[]);
      setProfiles(profileRows);

      const ownerLabelById = new Map(profileRows.map((p) => [p.id, profileLabel(p)]));
      const normalizedReports: ReviewReportView[] = ((rrRes.data ?? []) as any[]).map((row) => {
        const reviewRaw = Array.isArray(row.restaurant_reviews) ? row.restaurant_reviews[0] : row.restaurant_reviews;
        const restaurantRaw = Array.isArray(row.restaurants) ? row.restaurants[0] : row.restaurants;
        return {
          id: row.id,
          review_id: row.review_id,
          restaurant_id: row.restaurant_id,
          owner_user_id: row.owner_user_id,
          status: row.status,
          reason: row.reason ?? null,
          admin_message: row.admin_message ?? null,
          created_at: row.created_at,
          reviewed_at: row.reviewed_at ?? null,
          review: reviewRaw
            ? {
                id: reviewRaw.id,
                rating: reviewRaw.rating,
                body: reviewRaw.body ?? null,
                reviewer_name: reviewRaw.reviewer_name,
                created_at: reviewRaw.created_at,
              }
            : null,
          restaurant: restaurantRaw
            ? {
                id: restaurantRaw.id,
                name: restaurantRaw.name,
              }
            : null,
          ownerLabel: ownerLabelById.get(row.owner_user_id) ?? row.owner_user_id,
        };
      });
      setReviewReports(normalizedReports);
    } catch (e: unknown) {
      Alert.alert("Error", e instanceof Error ? e.message : "Failed to load");
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    if (!roleLoading && isAdmin) void load();
  }, [roleLoading, isAdmin, load]);

  useEffect(() => {
    if (!selectedUserId) return;
    const p = profiles.find((x) => x.id === selectedUserId);
    if (p) {
      setUserDraft({
        full_name: p.full_name ?? "",
        phone_number: p.phone_number ?? "",
        role: p.role ?? "user",
      });
    }
  }, [selectedUserId, profiles]);

  const selectedRestaurant = useMemo(
    () => (selectedId !== null && selectedId !== "new" ? restaurants.find((r) => r.id === selectedId) : null),
    [restaurants, selectedId],
  );

  useEffect(() => {
    if (selectedId === "new") {
      setDraft(emptyForm());
      setCuisineTagsText("");
      setLatText("");
      setLngText("");
      return;
    }
    if (selectedRestaurant) {
      setDraft({ ...selectedRestaurant });
      setCuisineTagsText((selectedRestaurant.cuisine_tags ?? []).join(", "));
      setLatText(selectedRestaurant.lat != null ? String(selectedRestaurant.lat) : "");
      setLngText(selectedRestaurant.long != null ? String(selectedRestaurant.long) : "");
    }
  }, [selectedId, selectedRestaurant]);

  const filteredProfiles = useMemo(() => {
    const q = userSearch.trim().toLowerCase();
    if (!q) return profiles;
    return profiles.filter(
      (p) =>
        p.email?.toLowerCase().includes(q) ||
        p.full_name?.toLowerCase().includes(q) ||
        p.id.toLowerCase().includes(q),
    );
  }, [profiles, userSearch]);

  const parseCoord = (s: string): number | null => {
    const t = s.trim();
    if (t === "" || t === "-" || t === "." || t === "-.") return null;
    const n = parseFloat(t);
    return Number.isFinite(n) ? n : null;
  };

  const handleSaveRestaurant = async () => {
    if (selectedId === null) return;
    const name = (draft.name ?? "").trim();
    if (!name) {
      Alert.alert("Validation", "Name is required.");
      return;
    }
    const tags = cuisineTagsText
      .split(",")
      .map((t) => t.trim())
      .filter(Boolean);

    const payload = {
      name,
      address: draft.address?.trim() || null,
      description: draft.description?.trim() || null,
      image_url: draft.image_url?.trim() || null,
      current_wait_time: draft.current_wait_time ?? 0,
      price_range: draft.price_range?.trim() || "$$",
      cuisine_tags: tags.length ? tags : null,
      lat: parseCoord(latText),
      long: parseCoord(lngText),
      owner_id: draft.owner_id || null,
      is_featured: Boolean(draft.is_featured),
      is_enabled: draft.is_enabled !== false,
      waitlist_open: draft.waitlist_open !== false,
      is_coming_soon: draft.is_coming_soon === true,
      stripe_account_id: draft.stripe_account_id?.trim() || null,
    };

    setSaving(true);
    try {
      if (selectedId === "new") {
        const { data, error } = await supabase.from("restaurants").insert(payload).select("id").single();
        if (error) throw error;
        await syncRolesAfterOwnerChange(null, payload.owner_id);
        if (Platform.OS !== "web") Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
        await load();
        if (data?.id) setSelectedId(data.id);
        Alert.alert("Saved", "Restaurant created.");
        return;
      }

      const prev = restaurants.find((r) => r.id === selectedId);
      const prevOwner = prev?.owner_id ?? null;
      const { error } = await supabase.from("restaurants").update(payload).eq("id", selectedId);
      if (error) throw error;
      await syncRolesAfterOwnerChange(prevOwner, payload.owner_id);
      if (Platform.OS !== "web") Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
      await load();
      Alert.alert("Saved", "Restaurant updated.");
    } catch (e: unknown) {
      Alert.alert("Error", e instanceof Error ? e.message : "Save failed");
    } finally {
      setSaving(false);
    }
  };

  const handleSaveUser = async () => {
    if (!selectedUserId) return;
    setUserSaving(true);
    try {
      const digits = userDraft.phone_number.replace(/\D/g, "").trim();
      const { error } = await supabase
        .from("profiles")
        .update({
          full_name: userDraft.full_name.trim() || null,
          phone_number: digits || null,
          role: userDraft.role,
          updated_at: new Date().toISOString(),
        })
        .eq("id", selectedUserId);
      if (error) throw error;
      if (Platform.OS !== "web") Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
      await load();
      Alert.alert("Saved", "Profile updated.");
    } catch (e: unknown) {
      Alert.alert("Error", e instanceof Error ? e.message : "Save failed");
    } finally {
      setUserSaving(false);
    }
  };

  const handleDeleteReport = async (reportId: number) => {
    setReportActionLoadingId(reportId);
    try {
      const { data, error } = await supabase.rpc("delete_review_report", {
        p_report_id: reportId,
      });
      if (error) throw error;
      if (data !== true) {
        Alert.alert("Not found", "This report may have already been removed.");
      }
      if (Platform.OS !== "web") Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
      await load();
    } catch (e: unknown) {
      Alert.alert("Error", e instanceof Error ? e.message : "Could not delete report");
    } finally {
      setReportActionLoadingId(null);
    }
  };

  const handleSubmitDecline = async () => {
    if (!declineTarget) return;
    const msg = declineMessage.trim();
    if (msg.length < 3) {
      Alert.alert("Message required", "Please add a short decline reason for the owner.");
      return;
    }

    setDeclineSaving(true);
    try {
      const { error } = await supabase.rpc("decline_review_report", {
        p_report_id: declineTarget.id,
        p_message: msg,
      });
      if (error) throw error;
      if (Platform.OS !== "web") Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
      setDeclineTarget(null);
      setDeclineMessage("");
      await load();
    } catch (e: unknown) {
      Alert.alert("Error", e instanceof Error ? e.message : "Could not decline report");
    } finally {
      setDeclineSaving(false);
    }
  };

  const haptic = () => {
    if (Platform.OS !== "web") Haptics.selectionAsync();
  };

  if (roleLoading) {
    return <BrandedLoader message="Loading admin portal..." />;
  }

  if (!isAdmin) {
    return (
      <SafeAreaView style={{ flex: 1, backgroundColor: "#0f0f0f" }}>
        <View style={{ padding: 24 }}>
          <Text style={{ color: "#f5f5f5", fontFamily: "Manrope_600SemiBold", fontSize: 16 }}>Access denied</Text>
          <Pressable onPress={() => router.back()} style={{ marginTop: 16 }}>
            <Text style={{ color: "#FF9933" }}>Go back</Text>
          </Pressable>
        </View>
      </SafeAreaView>
    );
  }

  const inputStyle = {
    backgroundColor: "#141414",
    borderWidth: 1,
    borderColor: "#2a2a2a",
    borderRadius: 12,
    paddingHorizontal: 14,
    paddingVertical: 12,
    color: "#f5f5f5",
    fontFamily: "Manrope_500Medium" as const,
    fontSize: 15,
  };

  const labelStyle = { color: "#999", fontFamily: "Manrope_600SemiBold" as const, fontSize: 12, marginBottom: 6 };

  return (
    <SafeAreaView style={{ flex: 1, backgroundColor: "#0f0f0f" }} edges={["top"]}>
      <View style={{ flexDirection: "row", alignItems: "center", paddingHorizontal: 16, paddingVertical: 12, borderBottomWidth: 1, borderBottomColor: "#2a2a2a" }}>
        <Pressable onPress={() => router.back()} hitSlop={12} style={{ marginRight: 12 }}>
          <ArrowLeft size={22} color="#f5f5f5" />
        </Pressable>
        <Building2 size={20} color="#EAB308" />
        <Text style={{ marginLeft: 8, fontFamily: "BricolageGrotesque_700Bold", fontSize: 18, color: "#f5f5f5", flex: 1 }}>
          Admin Portal
        </Text>
        <Pressable
          onPress={() => {
            if (Platform.OS !== "web") Haptics.selectionAsync();
            router.push("/admin-pulse" as any);
          }}
          style={{
            borderRadius: 999,
            borderWidth: 1,
            borderColor: "rgba(255,153,51,0.35)",
            backgroundColor: "rgba(255,153,51,0.12)",
            paddingHorizontal: 12,
            paddingVertical: 7,
          }}
        >
          <Text style={{ color: "#FF9933", fontFamily: "Manrope_700Bold", fontSize: 11 }}>
            Switch to Admin Pulse
          </Text>
        </Pressable>
      </View>

      <View style={{ flexDirection: "row", flexWrap: "wrap", gap: 8, paddingHorizontal: 16, paddingVertical: 10 }}>
        <Pressable
          onPress={() => { haptic(); router.push("/admin-menu-images" as any); }}
          style={{
            flexDirection: "row",
            alignItems: "center",
            gap: 6,
            paddingVertical: 8,
            paddingHorizontal: 14,
            borderRadius: 999,
            backgroundColor: "rgba(255,255,255,0.06)",
            borderWidth: 1,
            borderColor: "rgba(255,255,255,0.08)",
          }}
        >
          <Camera size={14} color="#888" />
          <Text style={{ fontFamily: "Manrope_600SemiBold", fontSize: 13, color: "#888" }}>
            Menu Images
          </Text>
        </Pressable>
        <Pressable
          onPress={() => {
            haptic();
            setAdminMode("restaurants");
            setSelectedUserId(null);
          }}
          style={{
            flexDirection: "row",
            alignItems: "center",
            gap: 6,
            paddingVertical: 8,
            paddingHorizontal: 14,
            borderRadius: 999,
            backgroundColor: adminMode === "restaurants" ? "rgba(234,179,8,0.2)" : "rgba(255,255,255,0.06)",
            borderWidth: 1,
            borderColor: adminMode === "restaurants" ? "rgba(234,179,8,0.45)" : "rgba(255,255,255,0.08)",
          }}
        >
          <Building2 size={14} color={adminMode === "restaurants" ? "#EAB308" : "#888"} />
          <Text style={{ fontFamily: "Manrope_600SemiBold", fontSize: 13, color: adminMode === "restaurants" ? "#EAB308" : "#888" }}>
            Restaurants
          </Text>
        </Pressable>
        <Pressable
          onPress={() => {
            haptic();
            setAdminMode("users");
            setSelectedId(null);
          }}
          style={{
            flexDirection: "row",
            alignItems: "center",
            gap: 6,
            paddingVertical: 8,
            paddingHorizontal: 14,
            borderRadius: 999,
            backgroundColor: adminMode === "users" ? "rgba(234,179,8,0.2)" : "rgba(255,255,255,0.06)",
            borderWidth: 1,
            borderColor: adminMode === "users" ? "rgba(234,179,8,0.45)" : "rgba(255,255,255,0.08)",
          }}
        >
          <Users size={14} color={adminMode === "users" ? "#EAB308" : "#888"} />
          <Text style={{ fontFamily: "Manrope_600SemiBold", fontSize: 13, color: adminMode === "users" ? "#EAB308" : "#888" }}>Users</Text>
        </Pressable>
        <Pressable
          onPress={() => {
            haptic();
            setAdminMode("settings");
            setSelectedId(null);
            setSelectedUserId(null);
          }}
          style={{
            flexDirection: "row",
            alignItems: "center",
            gap: 6,
            paddingVertical: 8,
            paddingHorizontal: 14,
            borderRadius: 999,
            backgroundColor: adminMode === "settings" ? "rgba(234,179,8,0.2)" : "rgba(255,255,255,0.06)",
            borderWidth: 1,
            borderColor: adminMode === "settings" ? "rgba(234,179,8,0.45)" : "rgba(255,255,255,0.08)",
          }}
        >
          <Settings2 size={14} color={adminMode === "settings" ? "#EAB308" : "#888"} />
          <Text style={{ fontFamily: "Manrope_600SemiBold", fontSize: 13, color: adminMode === "settings" ? "#EAB308" : "#888" }}>
            Review Reports
          </Text>
        </Pressable>
      </View>

      {loading ? (
        <BrandedLoader message="Loading data..." />
      ) : adminMode === "users" ? (
        <View style={{ flex: 1, paddingHorizontal: 16 }}>
          <TextInput
            placeholder="Search name, email, id…"
            placeholderTextColor="#666"
            value={userSearch}
            onChangeText={setUserSearch}
            style={[inputStyle, { marginBottom: 12 }]}
          />
          <FlatList
            style={{ flex: 1 }}
            data={filteredProfiles}
            keyExtractor={(item) => item.id}
            keyboardShouldPersistTaps="handled"
            contentContainerStyle={{ paddingBottom: 16, flexGrow: 1 }}
            renderItem={({ item: p }) => (
              <Pressable
                onPress={() => {
                  haptic();
                  setSelectedUserId(p.id);
                }}
                style={{
                  paddingVertical: 12,
                  paddingHorizontal: 12,
                  borderRadius: 10,
                  marginBottom: 4,
                  backgroundColor: "#141414",
                  borderWidth: 1,
                  borderColor: "#2a2a2a",
                  position: "relative",
                }}
              >
                {/* Role badge */}
                {(() => {
                  const badge = getRoleBadge(p.role);
                  const BadgeIcon = badge.Icon;
                  return (
                    <View style={{ position: "absolute", top: 10, right: 10, flexDirection: "row", alignItems: "center", gap: 3, backgroundColor: badge.bg, borderRadius: 999, paddingHorizontal: 7, paddingVertical: 3 }}>
                      <BadgeIcon size={10} color={badge.color} />
                      <Text style={{ fontFamily: "Manrope_600SemiBold", fontSize: 10, color: badge.color }}>{badge.label}</Text>
                    </View>
                  );
                })()}
                <Text style={{ color: "#f5f5f5", fontFamily: "Manrope_600SemiBold", fontSize: 14, paddingRight: 56 }}>{profileLabel(p)}</Text>
                <Text style={{ color: "#666", fontSize: 10, fontFamily: "Manrope_500Medium", marginTop: 2 }}>{p.id}</Text>
              </Pressable>
            )}
            ListEmptyComponent={
              <Text style={{ color: "#666", textAlign: "center", marginTop: 24, fontFamily: "Manrope_500Medium" }}>
                No users match your search.
              </Text>
            }
          />
          <Modal visible={selectedUserId != null} animationType="slide" onRequestClose={() => setSelectedUserId(null)}>
            <View
              style={{
                flex: 1,
                backgroundColor: "#0f0f0f",
                paddingTop: insets.top,
                paddingBottom: insets.bottom,
              }}
            >
              <View
                style={{
                  flexDirection: "row",
                  alignItems: "center",
                  justifyContent: "space-between",
                  paddingHorizontal: 16,
                  paddingVertical: 14,
                  borderBottomWidth: 1,
                  borderBottomColor: "#2a2a2a",
                }}
              >
                <Text
                  style={{
                    flex: 1,
                    marginRight: 12,
                    fontFamily: "BricolageGrotesque_700Bold",
                    fontSize: 18,
                    color: "#f5f5f5",
                  }}
                >
                  Edit profile
                </Text>
                <Pressable
                  onPress={() => setSelectedUserId(null)}
                  hitSlop={{ top: 16, bottom: 16, left: 16, right: 16 }}
                  style={{ flexShrink: 0, padding: 4 }}
                >
                  <X size={24} color="#f5f5f5" />
                </Pressable>
              </View>
              <ScrollView style={{ flex: 1, padding: 16 }} keyboardShouldPersistTaps="handled" contentContainerStyle={{ paddingBottom: 32 }}>
                <Text style={labelStyle}>Full name</Text>
                <TextInput style={[inputStyle, { marginBottom: 12 }]} value={userDraft.full_name} onChangeText={(t) => setUserDraft((d) => ({ ...d, full_name: t }))} />
                <Text style={labelStyle}>Phone (digits)</Text>
                <TextInput style={[inputStyle, { marginBottom: 12 }]} value={userDraft.phone_number} onChangeText={(t) => setUserDraft((d) => ({ ...d, phone_number: t }))} keyboardType="phone-pad" />
                <Text style={labelStyle}>Role</Text>
                <View style={{ flexDirection: "row", flexWrap: "wrap", gap: 8, marginBottom: 16 }}>
                  {(["user", "restaurant_owner", "admin"] as const).map((role) => (
                    <Pressable
                      key={role}
                      onPress={() => {
                        haptic();
                        setUserDraft((d) => ({ ...d, role }));
                      }}
                      style={{
                        paddingVertical: 8,
                        paddingHorizontal: 12,
                        borderRadius: 999,
                        backgroundColor: userDraft.role === role ? "rgba(234,179,8,0.2)" : "#1a1a1a",
                        borderWidth: 1,
                        borderColor: userDraft.role === role ? "rgba(234,179,8,0.45)" : "#333",
                      }}
                    >
                      <Text style={{ color: userDraft.role === role ? "#EAB308" : "#888", fontFamily: "Manrope_600SemiBold", fontSize: 12 }}>{role}</Text>
                    </Pressable>
                  ))}
                </View>
                <Pressable
                  onPress={() => void handleSaveUser()}
                  disabled={userSaving}
                  style={{
                    flexDirection: "row",
                    alignItems: "center",
                    justifyContent: "center",
                    gap: 8,
                    backgroundColor: "#EAB308",
                    paddingVertical: 14,
                    borderRadius: 14,
                    opacity: userSaving ? 0.7 : 1,
                  }}
                >
                  {userSaving ? <ActivityIndicator color="#0f0f0f" /> : <Save size={18} color="#0f0f0f" />}
                  <Text style={{ fontFamily: "Manrope_700Bold", color: "#0f0f0f", fontSize: 16 }}>Save profile</Text>
                </Pressable>
              </ScrollView>
            </View>
          </Modal>
        </View>
      ) : adminMode === "settings" ? (
        <View style={{ flex: 1, paddingHorizontal: 16 }}>
          <View
            style={{
              marginTop: 4,
              marginBottom: 10,
              backgroundColor: "#141414",
              borderWidth: 1,
              borderColor: "#2a2a2a",
              borderRadius: 12,
              paddingHorizontal: 12,
              paddingVertical: 11,
              flexDirection: "row",
              alignItems: "center",
              gap: 8,
            }}
          >
            <Flag size={14} color="#EAB308" />
            <Text style={{ color: "#f5f5f5", fontFamily: "Manrope_600SemiBold", fontSize: 13, flex: 1 }}>
              Review Reports
            </Text>
            <Text style={{ color: "#888", fontFamily: "JetBrainsMono_600SemiBold", fontSize: 11 }}>
              {reviewReports.length}
            </Text>
          </View>

          <FlatList
            style={{ flex: 1 }}
            data={reviewReports}
            keyExtractor={(item) => String(item.id)}
            keyboardShouldPersistTaps="handled"
            contentContainerStyle={{ paddingBottom: 20, flexGrow: 1 }}
            renderItem={({ item }) => {
              const pending = item.status === "pending";
              const actionLoading = reportActionLoadingId === item.id;
              return (
                <View
                  style={{
                    marginBottom: 10,
                    backgroundColor: "#141414",
                    borderWidth: 1,
                    borderColor: "#2a2a2a",
                    borderRadius: 12,
                    padding: 12,
                    gap: 8,
                  }}
                >
                  <View style={{ flexDirection: "row", justifyContent: "space-between", alignItems: "center", gap: 10 }}>
                    <Text style={{ color: "#f5f5f5", fontFamily: "Manrope_700Bold", fontSize: 14, flex: 1 }} numberOfLines={1}>
                      {item.restaurant?.name ?? `Restaurant #${item.restaurant_id}`}
                    </Text>
                    <View
                      style={{
                        borderRadius: 999,
                        borderWidth: 1,
                        borderColor: pending ? "rgba(234,179,8,0.45)" : "rgba(239,68,68,0.4)",
                        backgroundColor: pending ? "rgba(234,179,8,0.16)" : "rgba(239,68,68,0.16)",
                        paddingHorizontal: 9,
                        paddingVertical: 4,
                      }}
                    >
                      <Text
                        style={{
                          color: pending ? "#EAB308" : "#F87171",
                          fontFamily: "Manrope_700Bold",
                          fontSize: 10,
                        }}
                      >
                        {pending ? "PENDING" : "DECLINED"}
                      </Text>
                    </View>
                  </View>

                  <Text style={{ color: "#999", fontFamily: "Manrope_500Medium", fontSize: 11 }}>
                    Owner: {item.ownerLabel}
                  </Text>
                  <Text style={{ color: "#999", fontFamily: "Manrope_500Medium", fontSize: 11 }}>
                    Reviewer: {item.review?.reviewer_name ?? "Anonymous"} · {item.review?.rating ?? "?"}★
                  </Text>
                  {item.reason ? (
                    <Text style={{ color: "#b0b0b0", fontFamily: "Manrope_500Medium", fontSize: 11 }}>
                      Owner note: {item.reason}
                    </Text>
                  ) : null}
                  {!!item.review?.body && (
                    <Text
                      style={{ color: "#d5d5d5", fontFamily: "Manrope_500Medium", fontSize: 12, lineHeight: 18 }}
                      numberOfLines={3}
                    >
                      “{item.review.body}”
                    </Text>
                  )}
                  {!pending && item.admin_message ? (
                    <Text style={{ color: "#FCA5A5", fontFamily: "Manrope_600SemiBold", fontSize: 11 }}>
                      Decline reason: {item.admin_message}
                    </Text>
                  ) : null}

                  <View style={{ flexDirection: "row", gap: 8, marginTop: 2 }}>
                    {pending ? (
                      <Pressable
                        onPress={() => {
                          setDeclineTarget(item);
                          setDeclineMessage(item.admin_message ?? "");
                        }}
                        disabled={actionLoading}
                        style={{
                          flex: 1,
                          borderRadius: 10,
                          borderWidth: 1,
                          borderColor: "rgba(234,179,8,0.45)",
                          backgroundColor: "rgba(234,179,8,0.16)",
                          alignItems: "center",
                          justifyContent: "center",
                          paddingVertical: 10,
                          opacity: actionLoading ? 0.6 : 1,
                        }}
                      >
                        <Text style={{ color: "#EAB308", fontFamily: "Manrope_700Bold", fontSize: 12 }}>Decline</Text>
                      </Pressable>
                    ) : null}
                    <Pressable
                      onPress={() => {
                        Alert.alert(
                          "Delete report?",
                          "This removes the report from the queue and notifies the owner.",
                          [
                            { text: "Cancel", style: "cancel" },
                            {
                              text: "Delete",
                              style: "destructive",
                              onPress: () => {
                                void handleDeleteReport(item.id);
                              },
                            },
                          ]
                        );
                      }}
                      disabled={actionLoading}
                      style={{
                        flex: 1,
                        borderRadius: 10,
                        borderWidth: 1,
                        borderColor: "rgba(239,68,68,0.42)",
                        backgroundColor: "rgba(239,68,68,0.16)",
                        alignItems: "center",
                        justifyContent: "center",
                        paddingVertical: 10,
                        opacity: actionLoading ? 0.6 : 1,
                        flexDirection: "row",
                        gap: 6,
                      }}
                    >
                      {actionLoading ? (
                        <ActivityIndicator size="small" color="#F87171" />
                      ) : (
                        <Trash2 size={14} color="#F87171" />
                      )}
                      <Text style={{ color: "#F87171", fontFamily: "Manrope_700Bold", fontSize: 12 }}>
                        Delete Report
                      </Text>
                    </Pressable>
                  </View>
                </View>
              );
            }}
            ListEmptyComponent={
              <Text style={{ color: "#666", textAlign: "center", marginTop: 24, fontFamily: "Manrope_500Medium" }}>
                No review reports yet.
              </Text>
            }
          />
        </View>
      ) : (
        <View style={{ flex: 1 }}>
          <View style={{ flexDirection: "row", alignItems: "center", justifyContent: "space-between", paddingHorizontal: 16, paddingTop: 4, paddingBottom: 10 }}>
            <Text style={{ color: "#888", fontFamily: "Manrope_600SemiBold", fontSize: 11 }}>RESTAURANTS</Text>
            <Pressable
              onPress={() => {
                haptic();
                setSelectedId("new");
              }}
              style={{ flexDirection: "row", alignItems: "center", gap: 4, backgroundColor: "rgba(234,179,8,0.15)", paddingHorizontal: 12, paddingVertical: 6, borderRadius: 999 }}
            >
              <Plus size={14} color="#EAB308" />
              <Text style={{ color: "#EAB308", fontFamily: "Manrope_600SemiBold", fontSize: 13 }}>New</Text>
            </Pressable>
          </View>
          <FlatList
            style={{ flex: 1 }}
            data={restaurants}
            keyExtractor={(item) => String(item.id)}
            keyboardShouldPersistTaps="handled"
            contentContainerStyle={{ paddingHorizontal: 16, paddingBottom: 24, flexGrow: 1 }}
            renderItem={({ item: r }) => (
              <Pressable
                onPress={() => {
                  haptic();
                  setSelectedId(r.id);
                }}
                style={{
                  paddingVertical: 12,
                  paddingHorizontal: 12,
                  borderRadius: 10,
                  marginBottom: 4,
                  backgroundColor: "#141414",
                  borderWidth: 1,
                  borderColor: "#2a2a2a",
                }}
              >
                <Text style={{ color: "#f5f5f5", fontFamily: "Manrope_600SemiBold" }}>{r.name}</Text>
                <Text style={{ color: "#666", fontSize: 11, marginTop: 2 }}>ID {r.id}</Text>
              </Pressable>
            )}
            ListEmptyComponent={
              <Text style={{ color: "#666", textAlign: "center", marginTop: 24, fontFamily: "Manrope_500Medium" }}>
                No restaurants loaded.
              </Text>
            }
          />
          <Modal visible={selectedId !== null} animationType="slide" onRequestClose={() => setSelectedId(null)}>
            <View
              style={{
                flex: 1,
                backgroundColor: "#0f0f0f",
                paddingTop: insets.top,
                paddingBottom: insets.bottom,
              }}
            >
              <View
                style={{
                  flexDirection: "row",
                  alignItems: "center",
                  justifyContent: "space-between",
                  paddingHorizontal: 16,
                  paddingVertical: 14,
                  borderBottomWidth: 1,
                  borderBottomColor: "#2a2a2a",
                }}
              >
                <Text
                  style={{
                    flex: 1,
                    marginRight: 12,
                    fontFamily: "BricolageGrotesque_700Bold",
                    fontSize: 17,
                    color: "#f5f5f5",
                  }}
                  numberOfLines={1}
                >
                  {selectedId === "new" ? "New restaurant" : `Edit — ${selectedRestaurant?.name ?? ""}`}
                </Text>
                <Pressable
                  onPress={() => setSelectedId(null)}
                  hitSlop={{ top: 16, bottom: 16, left: 16, right: 16 }}
                  style={{ flexShrink: 0, padding: 4 }}
                >
                  <X size={24} color="#f5f5f5" />
                </Pressable>
              </View>
              {selectedId !== null && (selectedId === "new" || selectedRestaurant) && (
              <ScrollView style={{ flex: 1, padding: 16 }} keyboardShouldPersistTaps="handled" contentContainerStyle={{ paddingBottom: 40 }}>
              <Text style={labelStyle}>Name *</Text>
              <TextInput style={[inputStyle, { marginBottom: 12 }]} value={draft.name ?? ""} onChangeText={(t) => setDraft((d) => ({ ...d, name: t }))} />
              <Text style={labelStyle}>Owner</Text>
              <Pressable
                onPress={() => setOwnerPickerOpen(true)}
                style={[inputStyle, { marginBottom: 12 }]}
              >
                <Text style={{ color: draft.owner_id ? "#f5f5f5" : "#666" }}>
                  {(() => {
                    if (!draft.owner_id) return "No owner — tap to choose";
                    const op = profiles.find((p) => p.id === draft.owner_id);
                    return op ? profileLabel(op) : draft.owner_id;
                  })()}
                </Text>
              </Pressable>
              <Text style={labelStyle}>Address</Text>
              <TextInput style={[inputStyle, { marginBottom: 12 }]} value={draft.address ?? ""} onChangeText={(t) => setDraft((d) => ({ ...d, address: t }))} />
              <Text style={labelStyle}>Description</Text>
              <TextInput
                style={[inputStyle, { minHeight: 72, textAlignVertical: "top" }]}
                multiline
                value={draft.description ?? ""}
                onChangeText={(t) => setDraft((d) => ({ ...d, description: t }))}
              />
              <Text style={[labelStyle, { marginTop: 12 }]}>Image URL</Text>
              <TextInput style={[inputStyle, { marginBottom: 12 }]} value={draft.image_url ?? ""} onChangeText={(t) => setDraft((d) => ({ ...d, image_url: t }))} />
              <Text style={labelStyle}>Latitude</Text>
              <TextInput style={[inputStyle, { marginBottom: 12 }]} value={latText} onChangeText={setLatText} keyboardType="decimal-pad" />
              <Text style={labelStyle}>Longitude</Text>
              <TextInput style={[inputStyle, { marginBottom: 12 }]} value={lngText} onChangeText={setLngText} keyboardType="decimal-pad" />
              <Text style={labelStyle}>Current wait (minutes)</Text>
              <TextInput
                style={[inputStyle, { marginBottom: 12 }]}
                keyboardType="number-pad"
                value={String(draft.current_wait_time ?? 0)}
                onChangeText={(t) => setDraft((d) => ({ ...d, current_wait_time: Number(t) || 0 }))}
              />
              <Text style={labelStyle}>Price range</Text>
              <TextInput style={[inputStyle, { marginBottom: 12 }]} value={draft.price_range ?? "$$"} onChangeText={(t) => setDraft((d) => ({ ...d, price_range: t }))} />
              <Text style={labelStyle}>Cuisine tags (comma-separated)</Text>
              <TextInput style={[inputStyle, { marginBottom: 12 }]} value={cuisineTagsText} onChangeText={setCuisineTagsText} />
              <Text style={labelStyle}>Stripe account ID</Text>
              <TextInput
                style={[inputStyle, { marginBottom: 12, fontFamily: "JetBrainsMono_600SemiBold" }]}
                value={draft.stripe_account_id ?? ""}
                onChangeText={(t) => setDraft((d) => ({ ...d, stripe_account_id: t }))}
                autoCapitalize="none"
              />
              <View style={{ flexDirection: "row", alignItems: "center", justifyContent: "space-between", marginBottom: 10 }}>
                <Text style={{ color: "#ccc", fontFamily: "Manrope_500Medium" }}>Listed / enabled</Text>
                <Switch value={draft.is_enabled !== false} onValueChange={(v) => setDraft((d) => ({ ...d, is_enabled: v }))} trackColor={{ false: "#333", true: "rgba(234,179,8,0.4)" }} thumbColor={draft.is_enabled !== false ? "#EAB308" : "#666"} />
              </View>
              <View style={{ flexDirection: "row", alignItems: "center", justifyContent: "space-between", marginBottom: 10 }}>
                <Text style={{ color: "#ccc", fontFamily: "Manrope_500Medium" }}>Waitlist open</Text>
                <Switch value={draft.waitlist_open !== false} onValueChange={(v) => setDraft((d) => ({ ...d, waitlist_open: v }))} trackColor={{ false: "#333", true: "rgba(234,179,8,0.4)" }} thumbColor={draft.waitlist_open !== false ? "#EAB308" : "#666"} />
              </View>
              <View style={{ flexDirection: "row", alignItems: "center", justifyContent: "space-between", marginBottom: 10 }}>
                <Text style={{ color: "#ccc", fontFamily: "Manrope_500Medium" }}>Coming soon</Text>
                <Switch value={draft.is_coming_soon === true} onValueChange={(v) => setDraft((d) => ({ ...d, is_coming_soon: v }))} trackColor={{ false: "#333", true: "rgba(148,163,184,0.45)" }} thumbColor={draft.is_coming_soon ? "#94A3B8" : "#666"} />
              </View>
              <View style={{ flexDirection: "row", alignItems: "center", justifyContent: "space-between", marginBottom: 16 }}>
                <Text style={{ color: "#ccc", fontFamily: "Manrope_500Medium" }}>Featured</Text>
                <Switch value={Boolean(draft.is_featured)} onValueChange={(v) => setDraft((d) => ({ ...d, is_featured: v }))} trackColor={{ false: "#333", true: "rgba(234,179,8,0.4)" }} thumbColor={draft.is_featured ? "#EAB308" : "#666"} />
              </View>
              <Pressable
                onPress={() => void handleSaveRestaurant()}
                disabled={saving}
                style={{
                  flexDirection: "row",
                  alignItems: "center",
                  justifyContent: "center",
                  gap: 8,
                  backgroundColor: "#EAB308",
                  paddingVertical: 14,
                  borderRadius: 14,
                  opacity: saving ? 0.7 : 1,
                }}
              >
                {saving ? <ActivityIndicator color="#0f0f0f" /> : <Save size={18} color="#0f0f0f" />}
                <Text style={{ fontFamily: "Manrope_700Bold", color: "#0f0f0f", fontSize: 16 }}>
                  {selectedId === "new" ? "Create restaurant" : "Save changes"}
                </Text>
              </Pressable>
              </ScrollView>
              )}
            </View>
          </Modal>
        </View>
      )}

      <Modal visible={declineTarget != null} animationType="slide" onRequestClose={() => setDeclineTarget(null)}>
        <View
          style={{
            flex: 1,
            backgroundColor: "#0f0f0f",
            paddingTop: insets.top,
            paddingBottom: insets.bottom,
          }}
        >
          <View
            style={{
              flexDirection: "row",
              alignItems: "center",
              justifyContent: "space-between",
              paddingHorizontal: 16,
              paddingVertical: 14,
              borderBottomWidth: 1,
              borderBottomColor: "#2a2a2a",
            }}
          >
            <Text style={{ fontFamily: "BricolageGrotesque_700Bold", fontSize: 18, color: "#f5f5f5", flex: 1 }}>
              Decline Review Report
            </Text>
            <Pressable
              onPress={() => setDeclineTarget(null)}
              hitSlop={{ top: 16, bottom: 16, left: 16, right: 16 }}
              style={{ padding: 4 }}
            >
              <X size={24} color="#f5f5f5" />
            </Pressable>
          </View>
          <ScrollView style={{ flex: 1, padding: 16 }} keyboardShouldPersistTaps="handled" contentContainerStyle={{ paddingBottom: 24 }}>
            <View
              style={{
                backgroundColor: "#141414",
                borderWidth: 1,
                borderColor: "#2a2a2a",
                borderRadius: 12,
                padding: 12,
                marginBottom: 14,
              }}
            >
              <Text style={{ color: "#f5f5f5", fontFamily: "Manrope_600SemiBold", fontSize: 13 }}>
                {declineTarget?.restaurant?.name ?? `Restaurant #${declineTarget?.restaurant_id ?? "?"}`}
              </Text>
              <Text style={{ color: "#8a8a8a", fontFamily: "Manrope_500Medium", fontSize: 11, marginTop: 4 }}>
                Review: {declineTarget?.review?.reviewer_name ?? "Anonymous"} · {declineTarget?.review?.rating ?? "?"}★
              </Text>
            </View>

            <Text style={{ color: "#999", fontFamily: "Manrope_600SemiBold", fontSize: 12, marginBottom: 6 }}>
              Decline message for owner
            </Text>
            <TextInput
              value={declineMessage}
              onChangeText={setDeclineMessage}
              placeholder="Add a short reason (required)"
              placeholderTextColor="#666"
              multiline
              style={[
                inputStyle,
                {
                  minHeight: 110,
                  textAlignVertical: "top",
                  marginBottom: 14,
                },
              ]}
            />

            <Pressable
              onPress={() => void handleSubmitDecline()}
              disabled={declineSaving}
              style={{
                flexDirection: "row",
                alignItems: "center",
                justifyContent: "center",
                backgroundColor: "#EAB308",
                borderRadius: 14,
                paddingVertical: 14,
                opacity: declineSaving ? 0.7 : 1,
              }}
            >
              {declineSaving ? (
                <ActivityIndicator color="#0f0f0f" />
              ) : (
                <Text style={{ fontFamily: "Manrope_700Bold", color: "#0f0f0f", fontSize: 16 }}>Send decline</Text>
              )}
            </Pressable>
          </ScrollView>
        </View>
      </Modal>

      <Modal visible={ownerPickerOpen} animationType="slide" transparent onRequestClose={() => setOwnerPickerOpen(false)}>
        <View style={{ flex: 1, justifyContent: "flex-end" }}>
          <Pressable style={{ flex: 1, backgroundColor: "rgba(0,0,0,0.55)" }} onPress={() => setOwnerPickerOpen(false)} />
          <View
            style={{
              backgroundColor: "#141414",
              borderTopLeftRadius: 18,
              borderTopRightRadius: 18,
              maxHeight: "75%",
              paddingBottom: Math.max(insets.bottom, 16),
            }}
          >
            <Text style={{ padding: 16, fontFamily: "Manrope_700Bold", color: "#f5f5f5", fontSize: 17 }}>Select owner</Text>
            <Pressable
              onPress={() => {
                setDraft((d) => ({ ...d, owner_id: null }));
                setOwnerPickerOpen(false);
              }}
              style={{ paddingHorizontal: 16, paddingVertical: 14, borderBottomWidth: 1, borderBottomColor: "#252525" }}
            >
              <Text style={{ color: "#F87171", fontFamily: "Manrope_600SemiBold" }}>No owner</Text>
            </Pressable>
            <FlatList
              data={profiles}
              keyExtractor={(item) => item.id}
              keyboardShouldPersistTaps="handled"
              renderItem={({ item }) => (
                <Pressable
                  onPress={() => {
                    setDraft((d) => ({ ...d, owner_id: item.id }));
                    setOwnerPickerOpen(false);
                  }}
                  style={{ paddingHorizontal: 16, paddingVertical: 14, borderBottomWidth: 1, borderBottomColor: "#252525" }}
                >
                  <Text style={{ color: "#f5f5f5", fontFamily: "Manrope_600SemiBold" }}>{profileLabel(item)}</Text>
                </Pressable>
              )}
            />
          </View>
        </View>
      </Modal>
    </SafeAreaView>
  );
}
