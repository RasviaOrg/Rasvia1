import React, { useState } from "react";
import {
  View,
  Text,
  Pressable,
  Modal,
  Alert,
  ActivityIndicator,
  Platform,
  ScrollView,
  TextInput,
  KeyboardAvoidingView,
} from "react-native";
import { X, Check } from "lucide-react-native";
import * as Haptics from "expo-haptics";
import { supabase } from "@/lib/supabase";

interface RestaurantEditModalProps {
  restaurantId: string;
  initial: {
    name: string;
    address: string;
    description: string;
    cuisine: string; // comma-separated tags
  };
  onClose: () => void;
  onSaved: (updated: { name: string; address: string; description: string; cuisine: string }) => void;
}

export function RestaurantEditModal({
  restaurantId,
  initial,
  onClose,
  onSaved,
}: RestaurantEditModalProps) {
  const [name, setName] = useState(initial.name);
  const [address, setAddress] = useState(initial.address);
  const [description, setDescription] = useState(initial.description);
  const [cuisine, setCuisine] = useState(initial.cuisine);
  const [saving, setSaving] = useState(false);

  const haptic = () => {
    if (Platform.OS !== "web") Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
  };

  const handleSave = async () => {
    if (!name.trim()) {
      Alert.alert("Validation", "Restaurant name is required.");
      return;
    }
    haptic();
    setSaving(true);
    try {
      const cuisineTags = cuisine
        .split(",")
        .map((t) => t.trim())
        .filter(Boolean);

      const { error } = await supabase
        .from("restaurants")
        .update({
          name: name.trim(),
          address: address.trim() || null,
          description: description.trim() || null,
          cuisine_tags: cuisineTags.length > 0 ? cuisineTags : null,
        })
        .eq("id", Number(restaurantId));

      if (error) throw error;

      onSaved({ name: name.trim(), address: address.trim(), description: description.trim(), cuisine: cuisineTags.join(", ") });
    } catch (err: any) {
      Alert.alert("Error", err.message || "Failed to save changes.");
    } finally {
      setSaving(false);
    }
  };

  const inputStyle = {
    backgroundColor: "#0f0f0f",
    borderRadius: 12,
    borderWidth: 1,
    borderColor: "#2a2a2a",
    paddingHorizontal: 14,
    paddingVertical: 12,
    color: "#f5f5f5" as const,
    fontFamily: "Manrope_500Medium",
    fontSize: 15,
  };

  const labelStyle = {
    fontFamily: "Manrope_600SemiBold" as const,
    color: "#999999",
    fontSize: 12,
    textTransform: "uppercase" as const,
    letterSpacing: 1,
    marginBottom: 8,
  };

  return (
    <Modal visible transparent animationType="slide" onRequestClose={onClose}>
      <KeyboardAvoidingView
        style={{ flex: 1 }}
        behavior={Platform.OS === "ios" ? "padding" : undefined}
      >
        <View style={{ flex: 1, backgroundColor: "rgba(0,0,0,0.5)", justifyContent: "flex-end" }}>
          <Pressable style={{ flex: 1 }} onPress={onClose} />
          <View
            style={{
              backgroundColor: "#1a1a1a",
              borderTopLeftRadius: 24,
              borderTopRightRadius: 24,
              padding: 24,
              paddingBottom: Platform.OS === "ios" ? 40 : 24,
              borderWidth: 1,
              borderColor: "#2a2a2a",
              maxHeight: "90%",
            }}
          >
            {/* Header */}
            <View
              style={{
                flexDirection: "row",
                justifyContent: "space-between",
                alignItems: "center",
                marginBottom: 24,
              }}
            >
              <Text
                style={{
                  fontFamily: "BricolageGrotesque_700Bold",
                  color: "#f5f5f5",
                  fontSize: 20,
                }}
              >
                Edit Restaurant
              </Text>
              <Pressable
                onPress={() => { haptic(); onClose(); }}
                style={{ padding: 8, backgroundColor: "#2a2a2a", borderRadius: 12 }}
              >
                <X color="#999999" size={22} />
              </Pressable>
            </View>

            <ScrollView showsVerticalScrollIndicator={false} keyboardShouldPersistTaps="handled">
              {/* Name */}
              <View style={{ marginBottom: 18 }}>
                <Text style={labelStyle}>Name</Text>
                <TextInput
                  value={name}
                  onChangeText={setName}
                  style={inputStyle}
                  placeholder="Restaurant name"
                  placeholderTextColor="#555"
                  autoCorrect={false}
                />
              </View>

              {/* Address */}
              <View style={{ marginBottom: 18 }}>
                <Text style={labelStyle}>Address</Text>
                <TextInput
                  value={address}
                  onChangeText={setAddress}
                  style={inputStyle}
                  placeholder="Full address"
                  placeholderTextColor="#555"
                  autoCorrect={false}
                />
              </View>

              {/* Description */}
              <View style={{ marginBottom: 18 }}>
                <Text style={labelStyle}>Description</Text>
                <TextInput
                  value={description}
                  onChangeText={setDescription}
                  style={[inputStyle, { minHeight: 90, textAlignVertical: "top" }]}
                  placeholder="Short description"
                  placeholderTextColor="#555"
                  multiline
                  numberOfLines={4}
                />
              </View>

              {/* Cuisine */}
              <View style={{ marginBottom: 24 }}>
                <Text style={labelStyle}>Cuisine Tags</Text>
                <TextInput
                  value={cuisine}
                  onChangeText={setCuisine}
                  style={inputStyle}
                  placeholder="e.g. Indian, Curry, Vegetarian"
                  placeholderTextColor="#555"
                  autoCorrect={false}
                />
                <Text
                  style={{
                    fontFamily: "Manrope_500Medium",
                    color: "#555",
                    fontSize: 11,
                    marginTop: 6,
                    marginLeft: 2,
                  }}
                >
                  Separate multiple tags with commas
                </Text>
              </View>

              {/* Save button */}
              <Pressable
                onPress={handleSave}
                disabled={saving}
                style={{
                  backgroundColor: "#FF9933",
                  borderRadius: 14,
                  padding: 16,
                  alignItems: "center",
                  flexDirection: "row",
                  justifyContent: "center",
                  gap: 8,
                  opacity: saving ? 0.7 : 1,
                }}
              >
                {saving ? (
                  <ActivityIndicator size="small" color="#0f0f0f" />
                ) : (
                  <>
                    <Check size={18} color="#0f0f0f" strokeWidth={2.5} />
                    <Text
                      style={{
                        fontFamily: "BricolageGrotesque_700Bold",
                        color: "#0f0f0f",
                        fontSize: 16,
                      }}
                    >
                      Save Changes
                    </Text>
                  </>
                )}
              </Pressable>
            </ScrollView>
          </View>
        </View>
      </KeyboardAvoidingView>
    </Modal>
  );
}
