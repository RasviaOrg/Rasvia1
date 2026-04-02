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
import { ArrowLeft, Save, Plus, Building2, Users, X } from "lucide-react-native";
import * as Haptics from "expo-haptics";
import { supabase } from "@/lib/supabase";
import { useAdminMode } from "@/hooks/useAdminMode";

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
  stripe_account_id: string | null;
};

type ProfileOption = {
  id: string;
  email: string | null;
  full_name: string | null;
  role: string | null;
  phone_number: string | null;
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
    stripe_account_id: "",
  };
}

function profileLabel(p: ProfileOption) {
  const bits = [p.full_name?.trim(), p.email?.trim()].filter(Boolean);
  const label = bits.length ? bits.join(" · ") : p.id.slice(0, 8);
  const role = p.role && p.role !== "user" ? ` (${p.role})` : "";
  return `${label}${role}`;
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
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [adminMode, setAdminMode] = useState<"restaurants" | "users">("restaurants");
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

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const [rRes, pRes] = await Promise.all([
        supabase.from("restaurants").select("*").order("name", { ascending: true }),
        supabase.from("profiles").select("id, email, full_name, role, phone_number").order("email", { ascending: true }),
      ]);
      if (rRes.error) throw rRes.error;
      if (pRes.error) throw pRes.error;
      setRestaurants((rRes.data ?? []) as RestaurantRow[]);
      setProfiles((pRes.data ?? []) as ProfileOption[]);
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

  const haptic = () => {
    if (Platform.OS !== "web") Haptics.selectionAsync();
  };

  if (roleLoading) {
    return (
      <View style={{ flex: 1, backgroundColor: "#0f0f0f", alignItems: "center", justifyContent: "center" }}>
        <ActivityIndicator size="large" color="#FF9933" />
      </View>
    );
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
          Admin portal
        </Text>
      </View>

      <View style={{ flexDirection: "row", flexWrap: "wrap", gap: 8, paddingHorizontal: 16, paddingVertical: 10 }}>
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
      </View>

      {loading ? (
        <View style={{ flex: 1, alignItems: "center", justifyContent: "center" }}>
          <ActivityIndicator size="large" color="#FF9933" />
        </View>
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
                }}
              >
                <Text style={{ color: "#f5f5f5", fontFamily: "Manrope_600SemiBold", fontSize: 14 }}>{profileLabel(p)}</Text>
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
