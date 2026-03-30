import React, { useState, useEffect, useCallback } from "react";
import {
    View,
    Text,
    Modal,
    Pressable,
    ScrollView,
    ActivityIndicator,
    Platform,
} from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";
import { X, ShieldCheck, User } from "lucide-react-native";
import * as Haptics from "expo-haptics";
import { supabase } from "@/lib/supabase";
import { useAdminMode } from "@/hooks/useAdminMode";

type StaffMember = {
    id: string;
    role: string;
    role_name: string | null;
    full_name: string | null;
    email: string | null;
};

const ROLE_LABEL: Record<string, string> = {
    owner: "Owner",
    admin: "Admin",
    manager: "Manager",
    staff: "Staff",
};

const ROLE_COLOR: Record<string, string> = {
    owner: "#FF9933",
    admin: "#F87171",
    manager: "#A78BFA",
    staff: "#60A5FA",
};

function roleColor(role: string) {
    return ROLE_COLOR[role] ?? "#94A3B8";
}

function roleLabel(role: string) {
    return ROLE_LABEL[role] ?? role.charAt(0).toUpperCase() + role.slice(1);
}

/** Supabase PostgrestError is a plain object, not an Error — String(err) becomes "[object Object]". */
function formatSupabaseError(err: unknown): string {
    if (err instanceof Error) return err.message;
    if (err !== null && typeof err === "object") {
        const o = err as Record<string, unknown>;
        const msg = typeof o.message === "string" ? o.message : "";
        const details = typeof o.details === "string" ? o.details : "";
        const hint = typeof o.hint === "string" ? o.hint : "";
        const code = typeof o.code === "string" ? o.code : "";
        const parts = [msg, details, hint].filter(Boolean);
        if (parts.length) return parts.join(" — ") + (code ? ` (${code})` : "");
        try {
            return JSON.stringify(err);
        } catch {
            return "Unknown error";
        }
    }
    return String(err);
}

export function RolesModal({ onClose }: { onClose: () => void }) {
    const { ownedRestaurantId } = useAdminMode();
    const [staff, setStaff] = useState<StaffMember[]>([]);
    const [loading, setLoading] = useState(true);
    const [error, setError] = useState<string | null>(null);

    const fetchStaff = useCallback(async () => {
        if (!ownedRestaurantId) return;
        setLoading(true);
        setError(null);
        try {
            // PostgREST only auto-embeds over declared FKs; restaurant_staff.user_id → auth.users, not profiles.
            const { data: staffRows, error: staffErr } = await supabase
                .from("restaurant_staff")
                .select("id, role, user_id, restaurant_roles ( name )")
                .eq("restaurant_id", ownedRestaurantId)
                .order("role");

            if (staffErr) throw staffErr;

            const userIds = [...new Set((staffRows ?? []).map((r: { user_id?: string }) => r.user_id).filter(Boolean))] as string[];
            const profileMap = new Map<string, { full_name: string | null; email: string | null }>();
            if (userIds.length > 0) {
                const { data: profRows, error: profErr } = await supabase
                    .from("profiles")
                    .select("id, full_name, email")
                    .in("id", userIds);
                if (profErr) throw profErr;
                for (const p of profRows ?? []) {
                    profileMap.set(p.id as string, {
                        full_name: (p as { full_name?: string | null }).full_name ?? null,
                        email: (p as { email?: string | null }).email ?? null,
                    });
                }
            }

            const mapped: StaffMember[] = (staffRows ?? []).map((row: any) => {
                const prof = row.user_id ? profileMap.get(row.user_id) : undefined;
                return {
                    id: row.id,
                    role: row.role ?? "staff",
                    role_name: row.restaurant_roles?.name ?? null,
                    full_name: prof?.full_name ?? null,
                    email: prof?.email ?? null,
                };
            });
            setStaff(mapped);
        } catch (err: unknown) {
            console.error("[RolesModal] fetchStaff", err);
            const msg = formatSupabaseError(err);
            setError(msg || "Could not load staff list.");
        }
        setLoading(false);
    }, [ownedRestaurantId]);

    useEffect(() => { fetchStaff(); }, [fetchStaff]);

    return (
        <Modal visible animationType="slide" presentationStyle="pageSheet" onRequestClose={onClose}>
            <SafeAreaView style={{ flex: 1, backgroundColor: "#0f0f0f" }} edges={["top", "bottom"]}>
                {/* Header */}
                <View style={{
                    flexDirection: "row", alignItems: "center", justifyContent: "space-between",
                    paddingHorizontal: 20, paddingVertical: 16,
                    borderBottomWidth: 1, borderBottomColor: "#1e1e1e",
                }}>
                    <View style={{ flexDirection: "row", alignItems: "center", gap: 10 }}>
                        <ShieldCheck size={20} color="#A78BFA" />
                        <Text style={{ fontFamily: "BricolageGrotesque_700Bold", fontSize: 18, color: "#f5f5f5" }}>
                            Staff & Roles
                        </Text>
                    </View>
                    <Pressable
                        onPress={() => {
                            if (Platform.OS !== "web") Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
                            onClose();
                        }}
                        hitSlop={10}
                        style={({ pressed }) => ({ opacity: pressed ? 0.5 : 1 })}
                    >
                        <X size={22} color="#666" />
                    </Pressable>
                </View>

                <ScrollView style={{ flex: 1 }} contentContainerStyle={{ padding: 20, paddingBottom: 40 }}>
                    <Text style={{
                        fontFamily: "Manrope_500Medium", fontSize: 12, color: "#555",
                        marginBottom: 16, lineHeight: 18,
                    }}>
                        Manage roles and permissions from the partner portal on the web.
                    </Text>

                    {loading ? (
                        <ActivityIndicator color="#A78BFA" style={{ marginTop: 40 }} />
                    ) : error ? (
                        <View style={{ alignItems: "center", marginTop: 60, gap: 10 }}>
                            <Text style={{ fontFamily: "Manrope_500Medium", fontSize: 14, color: "#EF4444" }}>{error}</Text>
                        </View>
                    ) : staff.length === 0 ? (
                        <View style={{ alignItems: "center", marginTop: 60, gap: 12 }}>
                            <ShieldCheck size={40} color="#333" />
                            <Text style={{ fontFamily: "BricolageGrotesque_700Bold", fontSize: 17, color: "#555" }}>
                                No staff yet
                            </Text>
                            <Text style={{ fontFamily: "Manrope_500Medium", fontSize: 13, color: "#444", textAlign: "center" }}>
                                Add staff members from the partner portal to see them here.
                            </Text>
                        </View>
                    ) : (
                        <View style={{
                            backgroundColor: "#1a1a1a", borderRadius: 16,
                            borderWidth: 1, borderColor: "#2a2a2a", overflow: "hidden",
                        }}>
                            {staff.map((member, index) => (
                                <View key={member.id}>
                                    {index > 0 && <View style={{ height: 1, backgroundColor: "#252525" }} />}
                                    <View style={{
                                        flexDirection: "row", alignItems: "center",
                                        paddingVertical: 14, paddingHorizontal: 16, gap: 12,
                                    }}>
                                        {/* Avatar circle */}
                                        <View style={{
                                            width: 38, height: 38, borderRadius: 19,
                                            backgroundColor: `${roleColor(member.role)}20`,
                                            borderWidth: 1, borderColor: `${roleColor(member.role)}40`,
                                            alignItems: "center", justifyContent: "center",
                                        }}>
                                            <User size={16} color={roleColor(member.role)} />
                                        </View>

                                        {/* Name + email */}
                                        <View style={{ flex: 1 }}>
                                            <Text style={{
                                                fontFamily: "Manrope_600SemiBold", fontSize: 14, color: "#f5f5f5",
                                            }}>
                                                {member.full_name ?? member.email ?? "Unknown user"}
                                            </Text>
                                            {member.full_name && member.email ? (
                                                <Text style={{
                                                    fontFamily: "Manrope_500Medium", fontSize: 12, color: "#555", marginTop: 1,
                                                }}>
                                                    {member.email}
                                                </Text>
                                            ) : null}
                                            {member.role_name ? (
                                                <Text style={{
                                                    fontFamily: "Manrope_500Medium", fontSize: 11, color: "#444", marginTop: 1,
                                                }}>
                                                    {member.role_name}
                                                </Text>
                                            ) : null}
                                        </View>

                                        {/* Role badge */}
                                        <View style={{
                                            backgroundColor: `${roleColor(member.role)}18`,
                                            borderRadius: 10, paddingHorizontal: 10, paddingVertical: 4,
                                            borderWidth: 1, borderColor: `${roleColor(member.role)}35`,
                                        }}>
                                            <Text style={{
                                                fontFamily: "Manrope_700Bold", fontSize: 11,
                                                color: roleColor(member.role),
                                            }}>
                                                {roleLabel(member.role)}
                                            </Text>
                                        </View>
                                    </View>
                                </View>
                            ))}
                        </View>
                    )}
                </ScrollView>
            </SafeAreaView>
        </Modal>
    );
}
