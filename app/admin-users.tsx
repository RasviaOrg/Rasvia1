import React, { useCallback, useEffect, useMemo, useState } from "react";
import {
  View,
  Text,
  TextInput,
  Pressable,
  ActivityIndicator,
  ScrollView,
  Alert,
  Platform,
} from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";
import { useRouter } from "expo-router";
import { ArrowLeft, Save } from "lucide-react-native";
import * as Haptics from "expo-haptics";
import { supabase } from "@/lib/supabase";
import { useAdminMode } from "@/hooks/useAdminMode";

type ProfileRow = {
  id: string;
  email: string | null;
  full_name: string | null;
  role: string | null;
  phone_number: string | null;
};

export default function AdminUsersScreen() {
  const router = useRouter();
  const { isAdmin, loading: roleLoading } = useAdminMode();
  const [profiles, setProfiles] = useState<ProfileRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [search, setSearch] = useState("");
  const [selected, setSelected] = useState<ProfileRow | null>(null);
  const [draft, setDraft] = useState({ full_name: "", phone_number: "", role: "user" });
  const [saving, setSaving] = useState(false);

  const load = useCallback(async () => {
    setLoading(true);
    const { data, error } = await supabase
      .from("profiles")
      .select("id, email, full_name, role, phone_number")
      .order("email", { ascending: true });
    if (error) {
      Alert.alert("Error", error.message);
    } else {
      setProfiles((data ?? []) as ProfileRow[]);
    }
    setLoading(false);
  }, []);

  useEffect(() => {
    if (!roleLoading && isAdmin) void load();
  }, [roleLoading, isAdmin, load]);

  useEffect(() => {
    if (!selected) return;
    setDraft({
      full_name: selected.full_name ?? "",
      phone_number: selected.phone_number ?? "",
      role: selected.role ?? "user",
    });
  }, [selected]);

  const filtered = useMemo(() => {
    const q = search.trim().toLowerCase();
    if (!q) return profiles;
    return profiles.filter(
      (p) =>
        p.email?.toLowerCase().includes(q) ||
        p.full_name?.toLowerCase().includes(q) ||
        p.id.toLowerCase().includes(q),
    );
  }, [profiles, search]);

  const save = async () => {
    if (!selected) return;
    setSaving(true);
    const digits = draft.phone_number.replace(/\D/g, "").trim();
    const { error } = await supabase
      .from("profiles")
      .update({
        full_name: draft.full_name.trim() || null,
        phone_number: digits || null,
        role: draft.role,
        updated_at: new Date().toISOString(),
      })
      .eq("id", selected.id);
    setSaving(false);
    if (error) {
      Alert.alert("Error", error.message);
      return;
    }
    if (Platform.OS !== "web") Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
    await load();
    setSelected(null);
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
      <View style={{ flex: 1, backgroundColor: "#0f0f0f", alignItems: "center", justifyContent: "center", padding: 24 }}>
        <Text style={{ fontFamily: "Manrope_500Medium", color: "#888", textAlign: "center" }}>
          Admin access only.
        </Text>
        <Pressable onPress={() => router.back()} style={{ marginTop: 16 }}>
          <Text style={{ color: "#FF9933", fontFamily: "Manrope_600SemiBold" }}>Go back</Text>
        </Pressable>
      </View>
    );
  }

  return (
    <SafeAreaView style={{ flex: 1, backgroundColor: "#0f0f0f" }} edges={["top"]}>
      <View style={{ flexDirection: "row", alignItems: "center", paddingHorizontal: 16, paddingVertical: 12, borderBottomWidth: 1, borderBottomColor: "#222" }}>
        <Pressable
          onPress={() => (selected ? setSelected(null) : router.back())}
          hitSlop={12}
          style={{ padding: 8, marginRight: 8 }}
        >
          <ArrowLeft size={22} color="#fff" />
        </Pressable>
        <Text style={{ fontFamily: "BricolageGrotesque_700Bold", fontSize: 18, color: "#fff", flex: 1 }}>
          {selected ? "Edit user" : "User management"}
        </Text>
      </View>

      {selected ? (
        <ScrollView style={{ flex: 1 }} contentContainerStyle={{ padding: 20, paddingBottom: 40 }}>
          <Text style={{ fontFamily: "Manrope_500Medium", fontSize: 12, color: "#666", marginBottom: 16 }}>
            {selected.email ?? selected.id}
          </Text>
          <Text style={{ fontFamily: "Manrope_600SemiBold", color: "#888", fontSize: 11, marginBottom: 6 }}>FULL NAME</Text>
          <TextInput
            value={draft.full_name}
            onChangeText={(t) => setDraft((d) => ({ ...d, full_name: t }))}
            style={{
              backgroundColor: "#1a1a1a",
              borderRadius: 12,
              borderWidth: 1,
              borderColor: "#333",
              padding: 14,
              color: "#f5f5f5",
              marginBottom: 16,
              fontFamily: "Manrope_500Medium",
            }}
          />
          <Text style={{ fontFamily: "Manrope_600SemiBold", color: "#888", fontSize: 11, marginBottom: 6 }}>PHONE</Text>
          <TextInput
            value={draft.phone_number}
            onChangeText={(t) => setDraft((d) => ({ ...d, phone_number: t }))}
            keyboardType="phone-pad"
            style={{
              backgroundColor: "#1a1a1a",
              borderRadius: 12,
              borderWidth: 1,
              borderColor: "#333",
              padding: 14,
              color: "#f5f5f5",
              marginBottom: 16,
              fontFamily: "Manrope_500Medium",
            }}
          />
          <Text style={{ fontFamily: "Manrope_600SemiBold", color: "#888", fontSize: 11, marginBottom: 6 }}>ROLE</Text>
          <View style={{ flexDirection: "row", flexWrap: "wrap", gap: 8, marginBottom: 24 }}>
            {["user", "restaurant_owner", "admin"].map((r) => (
              <Pressable
                key={r}
                onPress={() => setDraft((d) => ({ ...d, role: r }))}
                style={{
                  paddingHorizontal: 14,
                  paddingVertical: 10,
                  borderRadius: 12,
                  borderWidth: 1,
                  borderColor: draft.role === r ? "#FF9933" : "#333",
                  backgroundColor: draft.role === r ? "rgba(255,153,51,0.12)" : "#1a1a1a",
                }}
              >
                <Text style={{ fontFamily: "Manrope_600SemiBold", fontSize: 13, color: draft.role === r ? "#FF9933" : "#aaa" }}>
                  {r}
                </Text>
              </Pressable>
            ))}
          </View>
          <Pressable
            onPress={() => void save()}
            disabled={saving}
            style={{
              flexDirection: "row",
              alignItems: "center",
              justifyContent: "center",
              gap: 8,
              backgroundColor: "#FF9933",
              borderRadius: 14,
              padding: 16,
              opacity: saving ? 0.7 : 1,
            }}
          >
            {saving ? <ActivityIndicator color="#0f0f0f" /> : <Save size={18} color="#0f0f0f" />}
            <Text style={{ fontFamily: "BricolageGrotesque_700Bold", fontSize: 16, color: "#0f0f0f" }}>Save</Text>
          </Pressable>
        </ScrollView>
      ) : (
        <>
          <TextInput
            value={search}
            onChangeText={setSearch}
            placeholder="Search name, email, id…"
            placeholderTextColor="#555"
            style={{
              marginHorizontal: 16,
              marginTop: 12,
              marginBottom: 8,
              backgroundColor: "#1a1a1a",
              borderRadius: 12,
              borderWidth: 1,
              borderColor: "#2a2a2a",
              paddingHorizontal: 14,
              paddingVertical: 12,
              color: "#f5f5f5",
              fontFamily: "Manrope_500Medium",
            }}
          />
          {loading ? (
            <ActivityIndicator color="#FF9933" style={{ marginTop: 40 }} />
          ) : (
            <ScrollView contentContainerStyle={{ padding: 16, paddingBottom: 40 }}>
              {filtered.map((p) => (
                <Pressable
                  key={p.id}
                  onPress={() => setSelected(p)}
                  style={{
                    padding: 16,
                    borderRadius: 14,
                    backgroundColor: "#1a1a1a",
                    borderWidth: 1,
                    borderColor: "#2a2a2a",
                    marginBottom: 10,
                  }}
                >
                  <Text style={{ fontFamily: "Manrope_600SemiBold", fontSize: 15, color: "#f5f5f5" }}>
                    {p.full_name?.trim() || p.email || "—"}
                  </Text>
                  <Text style={{ fontFamily: "Manrope_500Medium", fontSize: 12, color: "#666", marginTop: 4 }}>{p.email}</Text>
                  <Text style={{ fontFamily: "Manrope_500Medium", fontSize: 11, color: "#444", marginTop: 2 }}>{p.id}</Text>
                </Pressable>
              ))}
            </ScrollView>
          )}
        </>
      )}
    </SafeAreaView>
  );
}
