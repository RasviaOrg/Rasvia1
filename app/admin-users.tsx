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
import { ArrowLeft, Save, Shield, Store, User as UserIcon } from "lucide-react-native";
import * as Haptics from "expo-haptics";
import { supabase } from "@/lib/supabase";
import { useAdminMode } from "@/hooks/useAdminMode";
import { useAuth } from "@/lib/auth-context";
import { useAppTheme } from "@/lib/app-theme";

type ProfileRow = {
  id: string;
  email: string | null;
  full_name: string | null;
  role: string | null;
  phone_number: string | null;
};

function getRoleBadge(role: string | null) {
  switch (role) {
    case 'admin':
      return { label: 'Admin', color: '#FF9933', bg: 'rgba(255,153,51,0.15)', icon: Shield };
    case 'restaurant_owner':
      return { label: 'Owner', color: '#A78BFA', bg: 'rgba(167,139,250,0.15)', icon: Store };
    default:
      return { label: 'User', color: '#60A5FA', bg: 'rgba(96,165,250,0.15)', icon: UserIcon };
  }
}

export default function AdminUsersScreen() {
  const router = useRouter();
  const { colors } = useAppTheme();
  const { isAdmin, loading: roleLoading } = useAdminMode();
  const { session } = useAuth();
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
      <View style={{ flex: 1, backgroundColor: colors.background, alignItems: "center", justifyContent: "center" }}>
        <ActivityIndicator size="large" color={colors.saffron} />
      </View>
    );
  }

  if (!isAdmin) {
    return (
      <View style={{ flex: 1, backgroundColor: colors.background, alignItems: "center", justifyContent: "center", padding: 24 }}>
        <Text style={{ fontFamily: "Manrope_500Medium", color: colors.textMuted, textAlign: "center" }}>
          Admin access only.
        </Text>
        <Pressable onPress={() => router.back()} style={{ marginTop: 16 }}>
          <Text style={{ color: colors.saffron, fontFamily: "Manrope_600SemiBold" }}>Go back</Text>
        </Pressable>
      </View>
    );
  }

  return (
    <SafeAreaView style={{ flex: 1, backgroundColor: colors.background }} edges={["top"]}>
      <View style={{ flexDirection: "row", alignItems: "center", paddingHorizontal: 16, paddingVertical: 12, borderBottomWidth: 1, borderBottomColor: colors.cardBorder }}>
        <Pressable
          onPress={() => (selected ? setSelected(null) : router.back())}
          hitSlop={12}
          style={{ padding: 8, marginRight: 8 }}
        >
          <ArrowLeft size={22} color={colors.text} />
        </Pressable>
        <Text style={{ fontFamily: "BricolageGrotesque_700Bold", fontSize: 18, color: colors.text, flex: 1 }}>
          {selected ? "Edit user" : "User management"}
        </Text>
      </View>

      {selected ? (
        <ScrollView style={{ flex: 1 }} contentContainerStyle={{ padding: 20, paddingBottom: 40 }}>
          <Text style={{ fontFamily: "Manrope_500Medium", fontSize: 12, color: colors.textMuted, marginBottom: 16 }}>
            {selected.email ?? selected.id}
          </Text>
          <Text style={{ fontFamily: "Manrope_600SemiBold", color: colors.textMuted, fontSize: 11, marginBottom: 6 }}>FULL NAME</Text>
          <TextInput
            value={draft.full_name}
            onChangeText={(t) => setDraft((d) => ({ ...d, full_name: t }))}
            style={{
              backgroundColor: colors.card,
              borderRadius: 12,
              borderWidth: 1,
              borderColor: colors.cardBorder,
              padding: 14,
              color: colors.text,
              marginBottom: 16,
              fontFamily: "Manrope_500Medium",
            }}
          />
          <Text style={{ fontFamily: "Manrope_600SemiBold", color: colors.textMuted, fontSize: 11, marginBottom: 6 }}>PHONE</Text>
          <TextInput
            value={draft.phone_number}
            onChangeText={(t) => setDraft((d) => ({ ...d, phone_number: t }))}
            keyboardType="phone-pad"
            style={{
              backgroundColor: colors.card,
              borderRadius: 12,
              borderWidth: 1,
              borderColor: colors.cardBorder,
              padding: 14,
              color: colors.text,
              marginBottom: 16,
              fontFamily: "Manrope_500Medium",
            }}
          />
          <Text style={{ fontFamily: "Manrope_600SemiBold", color: colors.textMuted, fontSize: 11, marginBottom: 6 }}>ROLE</Text>
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
                  borderColor: draft.role === r ? colors.saffron : colors.cardBorder,
                  backgroundColor: draft.role === r ? "rgba(255,153,51,0.12)" : colors.card,
                }}
              >
                <Text style={{ fontFamily: "Manrope_600SemiBold", fontSize: 13, color: draft.role === r ? colors.saffron : colors.textMuted }}>
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
              backgroundColor: colors.saffron,
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
            placeholderTextColor={colors.textMuted}
            style={{
              marginHorizontal: 16,
              marginTop: 12,
              marginBottom: 8,
              backgroundColor: colors.card,
              borderRadius: 12,
              borderWidth: 1,
              borderColor: colors.cardBorder,
              paddingHorizontal: 14,
              paddingVertical: 12,
              color: colors.text,
              fontFamily: "Manrope_500Medium",
            }}
          />
          {loading ? (
            <ActivityIndicator color={colors.saffron} style={{ marginTop: 40 }} />
          ) : (
            <ScrollView contentContainerStyle={{ padding: 16, paddingBottom: 40 }}>
              {filtered.map((p) => (
                <Pressable
                  key={p.id}
                  onPress={() => setSelected(p)}
                  style={{
                    padding: 16,
                    borderRadius: 14,
                    backgroundColor: colors.card,
                    borderWidth: p.id === session?.user?.id ? 1.5 : 1,
                    borderColor: p.id === session?.user?.id ? colors.saffron : colors.cardBorder,
                    marginBottom: 10,
                  }}
                >
                  {/* Role badge in top right */}
                  {(() => {
                    const badge = getRoleBadge(p.role);
                    const BadgeIcon = badge.icon;
                    return (
                      <View style={{ position: 'absolute', top: 10, right: 10, flexDirection: 'row', alignItems: 'center', gap: 4, backgroundColor: badge.bg, borderRadius: 999, paddingHorizontal: 8, paddingVertical: 3 }}>
                        <BadgeIcon size={11} color={badge.color} />
                        <Text style={{ fontFamily: 'Manrope_600SemiBold', fontSize: 10, color: badge.color }}>{badge.label}</Text>
                      </View>
                    );
                  })()}
                  <Text style={{ fontFamily: "Manrope_600SemiBold", fontSize: 15, color: p.id === session?.user?.id ? colors.saffron : colors.text, paddingRight: 60 }}>
                    {p.full_name?.trim() || p.email || "—"}{p.id === session?.user?.id ? " (you)" : ""}
                  </Text>
                  <Text style={{ fontFamily: "Manrope_500Medium", fontSize: 12, color: colors.textMuted, marginTop: 4 }}>{p.email}</Text>
                  <Text style={{ fontFamily: "Manrope_500Medium", fontSize: 11, color: colors.textSecondary, marginTop: 2 }}>{p.id}</Text>
                </Pressable>
              ))}
            </ScrollView>
          )}
        </>
      )}
    </SafeAreaView>
  );
}
