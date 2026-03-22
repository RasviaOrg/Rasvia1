import React, { useState } from "react";
import {
  View,
  Text,
  TextInput,
  Pressable,
  ActivityIndicator,
  Alert,
  KeyboardAvoidingView,
  Platform,
  TouchableWithoutFeedback,
  Keyboard,
  ScrollView,
} from "react-native";
import { X } from "lucide-react-native";
import Animated, { FadeInDown, FadeOutDown } from "react-native-reanimated";
import { supabase } from "@/lib/supabase";

interface AddRestaurantModalProps {
  coords: { lat: number; lng: number };
  onClose: () => void;
  onSuccess: () => void;
}

export function AddRestaurantModal({
  coords,
  onClose,
  onSuccess,
}: AddRestaurantModalProps) {
  const [name, setName] = useState("");
  const [description, setDescription] = useState("");
  const [address, setAddress] = useState("");
  const [imageUrl, setImageUrl] = useState("");
  const [cuisine, setCuisine] = useState("");
  const [waitTime, setWaitTime] = useState("");
  const [saving, setSaving] = useState(false);

  const handleSave = async () => {
    if (!name.trim() || !address.trim()) {
      Alert.alert("Validation Error", "Name and Address are required.");
      return;
    }

    setSaving(true);
    try {
      const cuisineTags = cuisine.trim()
        ? cuisine.split(",").map(t => t.trim()).filter(Boolean)
        : ["Various"];
      const parsedWait = parseInt(waitTime, 10);
      const { error } = await supabase.from("restaurants").insert([
        {
          name: name.trim(),
          description: description.trim() || null,
          address: address.trim(),
          image_url: imageUrl.trim() || null,
          cuisine_tags: cuisineTags,
          lat: coords.lat,
          long: coords.lng,
          current_wait_time: waitTime.trim() !== "" && !isNaN(parsedWait) ? parsedWait : -1,
          is_waitlist_open: true,
          is_enabled: true,
          rating: 0,
          price_range: "$$",
        },
      ]);

      if (error) {
        throw error;
      }

      onSuccess();
    } catch (err: any) {
      console.error("Error inserting restaurant:", err);
      Alert.alert("Save Error", err.message || "Failed to add restaurant.");
    } finally {
      setSaving(false);
    }
  };

  return (
    <View
      style={{
        position: "absolute",
        top: 0,
        left: 0,
        right: 0,
        bottom: 0,
        justifyContent: "flex-end",
        zIndex: 999,
        backgroundColor: "rgba(0,0,0,0.4)",
      }}
    >
      <TouchableWithoutFeedback onPress={onClose}>
        <View style={{ flex: 1 }} />
      </TouchableWithoutFeedback>

      <KeyboardAvoidingView
        behavior={Platform.OS === "ios" ? "padding" : "height"}
      >
        <Animated.View
          entering={FadeInDown.springify().damping(18).stiffness(150)}
          exiting={FadeOutDown.duration(200)}
          style={{
            backgroundColor: "#1a1a1a",
            borderTopLeftRadius: 24,
            borderTopRightRadius: 24,
            padding: 24,
            paddingBottom: Platform.OS === "ios" ? 40 : 24,
            borderWidth: 1,
            borderColor: "#2a2a2a",
            maxHeight: "80%", // Ensure it fits the screen
          }}
        >
          <View style={{ flexDirection: "row", justifyContent: "space-between", alignItems: "center", marginBottom: 16 }}>
            <Text
              style={{
                fontFamily: "BricolageGrotesque_700Bold",
                color: "#FF9933",
                fontSize: 20,
              }}
            >
              Add Restaurant
            </Text>
            <Pressable onPress={onClose} style={{ padding: 4 }}>
              <X color="#999" size={24} />
            </Pressable>
          </View>

          <ScrollView style={{ flexGrow: 0 }}>
            <Text style={{ color: "#999", marginBottom: 8, fontSize: 12 }}>
              Location: {coords.lat.toFixed(4)}, {coords.lng.toFixed(4)}
            </Text>

            <TextInput
              style={styles.input}
              placeholder="Restaurant Name *"
              placeholderTextColor="#666"
              value={name}
              onChangeText={setName}
            />

            <TextInput
              style={styles.input}
              placeholder="Cuisine (e.g., North Indian, Chaat)"
              placeholderTextColor="#666"
              value={cuisine}
              onChangeText={setCuisine}
            />

            <TextInput
              style={styles.input}
              placeholder="Address *"
              placeholderTextColor="#666"
              value={address}
              onChangeText={setAddress}
            />

            <TextInput
              style={styles.input}
              placeholder="Wait Time (minutes, leave blank for no wait)"
              placeholderTextColor="#666"
              value={waitTime}
              onChangeText={setWaitTime}
              keyboardType="number-pad"
            />

            <TextInput
              style={[styles.input, { height: 80, textAlignVertical: "top" }]}
              placeholder="Description"
              placeholderTextColor="#666"
              multiline
              value={description}
              onChangeText={setDescription}
            />

            <TextInput
              style={styles.input}
              placeholder="Image URL"
              placeholderTextColor="#666"
              value={imageUrl}
              onChangeText={setImageUrl}
              autoCapitalize="none"
              keyboardType="url"
            />
          </ScrollView>

          <Pressable
            onPress={handleSave}
            disabled={saving}
            style={{
              backgroundColor: "#FF9933",
              paddingVertical: 14,
              borderRadius: 12,
              alignItems: "center",
              marginTop: 16,
              opacity: saving ? 0.7 : 1,
            }}
          >
            {saving ? (
              <ActivityIndicator color="#0f0f0f" />
            ) : (
              <Text
                style={{
                  fontFamily: "BricolageGrotesque_700Bold",
                  color: "#0f0f0f",
                  fontSize: 16,
                }}
              >
                Save Restaurant
              </Text>
            )}
          </Pressable>
        </Animated.View>
      </KeyboardAvoidingView>
    </View>
  );
}

const styles = {
  input: {
    backgroundColor: "#0f0f0f",
    color: "#f5f5f5",
    borderWidth: 1,
    borderColor: "#333",
    borderRadius: 8,
    paddingHorizontal: 12,
    paddingVertical: 12,
    marginBottom: 12,
    fontFamily: "Manrope_500Medium",
    fontSize: 14,
  },
};
