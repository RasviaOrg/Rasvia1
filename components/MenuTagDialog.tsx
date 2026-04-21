// components/MenuTagDialog.tsx
//
// Mobile companion for RasviaWeb/src/components/dashboard/MenuTagDialog.tsx.
// Surfaces an "Add Menu Tag" / "Edit Menu Tag" sheet so the owner-facing menu
// editor can use a focused popup (instead of the inline editor that was
// previously baked into `MenuEditor`). Keep in sync with the web dialog's
// affordances — shared props: name, color swatch, position, enabled.
import React, { useEffect, useMemo, useState } from "react";
import { useAppTheme } from "@/lib/app-theme";
import {
  View,
  Text,
  Pressable,
  Modal,
  TextInput,
  ActivityIndicator,
  ScrollView,
  Platform,
  KeyboardAvoidingView,
} from "react-native";
import { X } from "lucide-react-native";
import * as Haptics from "expo-haptics";
import {
  DEFAULT_MENU_TAGS,
  slugifyTag,
  type MenuTagConfig,
} from "@/lib/menu-tags";

type Mode = "create" | "edit";

const TAG_COLOR_PRESETS = DEFAULT_MENU_TAGS.map((tag) => ({
  color: tag.color,
  bg: tag.bg,
  border: tag.border,
}));

export interface MenuTagDialogProps {
  visible: boolean;
  mode: Mode;
  tags: MenuTagConfig[];
  /** Tag being edited (only in `edit` mode) — used to seed state. */
  editingTag?: MenuTagConfig | null;
  onClose: () => void;
  /** Persists the full resulting tag list. Should return true on success. */
  onSubmit: (next: MenuTagConfig[]) => Promise<boolean>;
}

export function MenuTagDialog({
  visible, mode, tags, editingTag, onClose, onSubmit,
}: MenuTagDialogProps) {
  const { colors, isDark } = useAppTheme();
  const [label, setLabel] = useState("");
  const [colorIdx, setColorIdx] = useState(0);
  const [position, setPosition] = useState(1);
  const [enabled, setEnabled] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  // Reset form whenever the sheet opens so a previous add/edit doesn't
  // leak into the next invocation.
  useEffect(() => {
    if (!visible) return;
    setError(null);
    setBusy(false);

    if (mode === "edit" && editingTag) {
      setLabel(editingTag.label);
      const matched = TAG_COLOR_PRESETS.findIndex(
        (p) => p.color === editingTag.color && p.bg === editingTag.bg && p.border === editingTag.border,
      );
      setColorIdx(matched >= 0 ? matched : 0);
      const existingIdx = tags.findIndex((t) => t.key === editingTag.key);
      setPosition(existingIdx >= 0 ? existingIdx + 1 : Math.max(tags.length, 1));
      setEnabled(editingTag.enabled !== false);
    } else {
      setLabel("");
      setColorIdx(tags.length % TAG_COLOR_PRESETS.length);
      setPosition(tags.length + 1);
      setEnabled(true);
    }
  }, [visible, mode, editingTag, tags]);

  const minPos = 1;
  const maxPos = mode === "create" ? tags.length + 1 : Math.max(tags.length, 1);

  const positionLabel = useMemo(() => `${minPos}–${maxPos}`, [minPos, maxPos]);

  const labelStyle = useMemo(
    () => [styles.label, { color: colors.textMuted }],
    [colors.textMuted],
  );
  const inputStyle = useMemo(
    () => [
      styles.input,
      {
        backgroundColor: isDark ? "#0f0f0f" : colors.pressableBg,
        color: colors.text,
        borderColor: colors.cardBorder,
      },
    ],
    [isDark, colors.pressableBg, colors.text, colors.cardBorder],
  );

  const handleSubmit = async () => {
    const trimmed = label.trim();
    if (!trimmed) {
      setError("Tag name cannot be empty.");
      return;
    }
    const key = slugifyTag(trimmed);
    if (!key) {
      setError("Tag name is invalid.");
      return;
    }

    const clampedPos = Math.min(Math.max(Math.floor(position) || 1, minPos), maxPos);
    const preset = TAG_COLOR_PRESETS[colorIdx] ?? TAG_COLOR_PRESETS[0];

    let working: MenuTagConfig[];
    if (mode === "edit" && editingTag) {
      const existingIdx = tags.findIndex((t) => t.key === editingTag.key);
      if (existingIdx < 0) {
        setError("Tag to edit was not found.");
        return;
      }
      if (key !== editingTag.key && tags.some((t) => t.key === key)) {
        setError("Another tag already uses this name.");
        return;
      }
      const updated: MenuTagConfig = {
        ...editingTag,
        key,
        label: trimmed,
        color: preset.color,
        bg: preset.bg,
        border: preset.border,
        enabled,
      };
      const without = tags.filter((_, i) => i !== existingIdx);
      const insertAt = Math.min(Math.max(clampedPos - 1, 0), without.length);
      working = [...without];
      working.splice(insertAt, 0, updated);
    } else {
      if (tags.some((t) => t.key === key)) {
        setError("This tag already exists.");
        return;
      }
      const newTag: MenuTagConfig = {
        key,
        label: trimmed,
        color: preset.color,
        bg: preset.bg,
        border: preset.border,
        enabled: true,
        position: clampedPos - 1,
      };
      const insertAt = Math.min(Math.max(clampedPos - 1, 0), tags.length);
      working = [...tags];
      working.splice(insertAt, 0, newTag);
    }

    // Re-normalise positions so they stay 0..n sequential.
    working = working.map((t, idx) => ({ ...t, position: idx }));

    setBusy(true);
    try {
      const ok = await onSubmit(working);
      if (ok) onClose();
    } finally {
      setBusy(false);
    }
  };

  return (
    <Modal visible={visible} transparent animationType="fade" onRequestClose={() => { if (!busy) onClose(); }}>
      <KeyboardAvoidingView behavior={Platform.OS === "ios" ? "padding" : "height"} style={{ flex: 1 }}>
        <View style={{ flex: 1, backgroundColor: isDark ? "rgba(0,0,0,0.72)" : "rgba(0,0,0,0.45)", justifyContent: "center", alignItems: "center", padding: 20 }}>
          <Pressable style={{ position: "absolute", inset: 0 }} onPress={() => { if (!busy) onClose(); }} />
          <View
            style={{
              width: "100%",
              maxWidth: 420,
              backgroundColor: isDark ? "#1a1a1a" : colors.card,
              borderRadius: 20,
              borderWidth: 1,
              borderColor: colors.cardBorder,
              padding: 20,
              maxHeight: "90%",
            }}
          >
            <View style={{ flexDirection: "row", alignItems: "center", justifyContent: "space-between", marginBottom: 14 }}>
              <Text style={{ fontFamily: "BricolageGrotesque_700Bold", color: colors.text, fontSize: 18 }}>
                {mode === "create" ? "Add Menu Tag" : "Edit Menu Tag"}
              </Text>
              <Pressable onPress={() => { if (!busy) onClose(); }} hitSlop={8} style={{ padding: 4 }}>
                <X size={20} color={colors.textMuted} />
              </Pressable>
            </View>

            <ScrollView showsVerticalScrollIndicator={false}>
              <Text style={labelStyle}>Name</Text>
              <TextInput
                value={label}
                onChangeText={(v) => { setLabel(v); if (error) setError(null); }}
                placeholder="e.g. Gluten-Free"
                placeholderTextColor={colors.textMuted}
                style={inputStyle}
                autoFocus={mode === "create"}
              />

              <Text style={labelStyle}>Color</Text>
              <View style={{ flexDirection: "row", flexWrap: "wrap", gap: 8, marginBottom: 12 }}>
                {TAG_COLOR_PRESETS.map((preset, idx) => (
                  <Pressable
                    key={`${preset.color}-${idx}`}
                    onPress={() => {
                      if (Platform.OS !== "web") Haptics.selectionAsync();
                      setColorIdx(idx);
                    }}
                    style={{
                      width: 34,
                      height: 34,
                      borderRadius: 999,
                      backgroundColor: preset.color,
                      borderWidth: 2,
                      borderColor: colorIdx === idx ? colors.text : colors.cardBorder,
                    }}
                  />
                ))}
              </View>

              <Text style={labelStyle}>Position ({positionLabel})</Text>
              <TextInput
                value={String(position)}
                onChangeText={(v) => {
                  const parsed = parseInt(v.replace(/[^0-9]/g, ""), 10);
                  setPosition(Number.isFinite(parsed) ? parsed : 1);
                }}
                keyboardType="number-pad"
                placeholder={positionLabel}
                placeholderTextColor={colors.textMuted}
                style={inputStyle}
              />

              {tags.length > 0 && (
                <View
                  style={{
                    marginTop: 4,
                    marginBottom: 12,
                    borderWidth: 1,
                    borderColor: isDark ? "#242424" : colors.cardBorder,
                    backgroundColor: isDark ? "#0d0d0d" : colors.backgroundElevated,
                    borderRadius: 10,
                    padding: 10,
                    maxHeight: 140,
                  }}
                >
                  <ScrollView>
                    {tags.map((t, i) => (
                      <View key={t.key} style={{ flexDirection: "row", alignItems: "center", paddingVertical: 3 }}>
                        <Text style={{ width: 22, color: colors.textMuted, fontFamily: "Manrope_600SemiBold", fontSize: 11, fontVariant: ["tabular-nums"] }}>
                          {i + 1}.
                        </Text>
                        <Text
                          numberOfLines={1}
                          style={{ flex: 1, color: t.color, fontFamily: "Manrope_700Bold", fontSize: 12 }}
                        >
                          {t.label}
                        </Text>
                        {mode === "edit" && editingTag?.key === t.key && (
                          <Text style={{ color: colors.textMuted, fontFamily: "Manrope_500Medium", fontSize: 10 }}>(editing)</Text>
                        )}
                      </View>
                    ))}
                  </ScrollView>
                </View>
              )}

              {mode === "edit" && (
                <Pressable
                  onPress={() => {
                    if (Platform.OS !== "web") Haptics.selectionAsync();
                    setEnabled((v) => !v);
                  }}
                  style={{
                    flexDirection: "row",
                    alignItems: "center",
                    gap: 10,
                    padding: 10,
                    borderWidth: 1,
                    borderColor: enabled ? "rgba(255,153,51,0.4)" : colors.cardBorder,
                    backgroundColor: enabled ? "rgba(255,153,51,0.08)" : (isDark ? "#0f0f0f" : colors.pressableBg),
                    borderRadius: 10,
                    marginBottom: 12,
                  }}
                >
                  <View
                    style={{
                      width: 18,
                      height: 18,
                      borderRadius: 4,
                      borderWidth: 1.5,
                      borderColor: enabled ? colors.saffron : colors.iconMuted,
                      backgroundColor: enabled ? colors.saffron : "transparent",
                      alignItems: "center",
                      justifyContent: "center",
                    }}
                  >
                    {enabled && <Text style={{ color: isDark ? "#0f0f0f" : "#ffffff", fontWeight: "900", fontSize: 12, lineHeight: 14 }}>✓</Text>}
                  </View>
                  <Text style={{ color: enabled ? colors.saffron : colors.textMuted, fontFamily: "Manrope_600SemiBold", fontSize: 13 }}>
                    Enabled (shown in filters)
                  </Text>
                </Pressable>
              )}

              {error && (
                <Text style={{ color: "#EF4444", fontFamily: "Manrope_600SemiBold", fontSize: 12, marginBottom: 8 }}>
                  {error}
                </Text>
              )}
            </ScrollView>

            <View style={{ flexDirection: "row", justifyContent: "flex-end", gap: 10, marginTop: 10 }}>
              <Pressable
                disabled={busy}
                onPress={() => { if (!busy) onClose(); }}
                style={{
                  borderWidth: 1,
                  borderColor: colors.cardBorder,
                  backgroundColor: isDark ? "#141414" : colors.pressableBg,
                  borderRadius: 10,
                  paddingHorizontal: 14,
                  paddingVertical: 10,
                  opacity: busy ? 0.6 : 1,
                }}
              >
                <Text style={{ color: colors.textSecondary, fontFamily: "Manrope_700Bold", fontSize: 13 }}>Cancel</Text>
              </Pressable>
              <Pressable
                disabled={busy}
                onPress={() => void handleSubmit()}
                style={{
                  borderWidth: 1,
                  borderColor: isDark ? "rgba(255,153,51,0.45)" : "#b45309",
                  backgroundColor: isDark ? "rgba(255,153,51,0.14)" : "#b45309",
                  borderRadius: 10,
                  paddingHorizontal: 14,
                  paddingVertical: 10,
                  flexDirection: "row",
                  alignItems: "center",
                  gap: 8,
                  opacity: busy ? 0.7 : 1,
                }}
              >
                {busy && <ActivityIndicator color={isDark ? colors.saffron : "#ffffff"} size="small" />}
                <Text style={{ color: isDark ? colors.saffron : "#ffffff", fontFamily: "Manrope_700Bold", fontSize: 13 }}>
                  {mode === "create" ? "Add Tag" : "Save"}
                </Text>
              </Pressable>
            </View>
          </View>
        </View>
      </KeyboardAvoidingView>
    </Modal>
  );
}

const styles = {
  label: {
    fontFamily: "Manrope_600SemiBold" as const,
    fontSize: 11,
    textTransform: "uppercase" as const,
    letterSpacing: 1,
    marginBottom: 6,
    marginTop: 6,
  },
  input: {
    borderWidth: 1,
    borderRadius: 10,
    paddingHorizontal: 12,
    paddingVertical: 10,
    marginBottom: 10,
    fontFamily: "Manrope_500Medium" as const,
    fontSize: 14,
  },
};
