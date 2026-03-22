import React, { useState, useEffect, useCallback, useRef } from "react";
import {
  View,
  Text,
  Pressable,
  ScrollView,
  Alert,
  Platform,
  Switch,
  ActivityIndicator,
  Dimensions,
  TextInput,
  Modal,
  KeyboardAvoidingView,
  TouchableWithoutFeedback,
  Keyboard,
  Image,
} from "react-native";
import * as ImagePicker from "expo-image-picker";
import * as FileSystem from "expo-file-system/legacy";
import { SafeAreaView } from "react-native-safe-area-context";
import { useRouter } from "expo-router";
import {
  User,
  LogOut,
  ChevronRight,
  ChevronDown,
  ShoppingBag,
  Bell,
  ArrowLeft,
  Leaf,
  Drumstick,
  ShieldCheck,
  MapPin,
  Check,
  Sparkles,
  Utensils,
  Edit2,
  Activity,
  Shield,
  Phone,
  Heart,
  Clock,
  Bug,
  RefreshCw,
  AlertTriangle,
  FileText,
  Camera,
  Store,
} from "lucide-react-native";
import Animated, {
  FadeIn,
  FadeInDown,
  useAnimatedStyle,
  useSharedValue,
  withSpring,
} from "react-native-reanimated";
import * as Haptics from "expo-haptics";
import AsyncStorage from "@react-native-async-storage/async-storage";
import * as Location from "expo-location";
import { supabase } from "@/lib/supabase";
import { useAuth } from "@/lib/auth-context";
import { useLocation } from "@/lib/location-context";
import { useAdminMode } from "@/hooks/useAdminMode";
import { setDebugTime, getDebugTime } from "@/lib/restaurant-hours";
import {
  isPushEnabled,
  enablePushNotifications,
  disablePushNotifications,
  getPushPermissionStatus,
} from "@/lib/push-notifications";

let SCREEN_WIDTH = Dimensions.get("window").width;
Dimensions.addEventListener("change", ({ window }) => { SCREEN_WIDTH = window.width; });

const DFW_CITIES = [
  "Frisco, TX",
  "Plano, TX",
  "Irving, TX",
  "Dallas, TX",
  "Fort Worth, TX",
  "Richardson, TX",
  "Allen, TX",
  "McKinney, TX",
  "Carrollton, TX",
  "Denton, TX",
  "Arlington, TX",
  "Garland, TX",
  "Grapevine, TX",
  "Southlake, TX",
  "Coppell, TX",
  "Prosper, TX",
  "Lewisville, TX",
  "Flower Mound, TX",
  "The Colony, TX",
  "Little Elm, TX",
];

const DIETARY_OPTIONS = [
  { key: "Vegetarian", label: "Vegetarian", icon: Leaf, color: "#22C55E" },
  { key: "Non-Veg", label: "Non-Veg", icon: Drumstick, color: "#EF4444" },
  { key: "Halal", label: "Halal", icon: ShieldCheck, color: "#60A5FA" },
];

const DAYS = [
  { short: "M", full: "Mon" },
  { short: "Tu", full: "Tue" },
  { short: "W", full: "Wed" },
  { short: "Th", full: "Thu" },
  { short: "F", full: "Fri" },
  { short: "Sa", full: "Sat" },
  { short: "Su", full: "Sun" },
];

// ── CST day names used by debug picker ──
const DEBUG_DAYS = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];

/** Format a fake debug date (already in CST) to readable string */
function formatDebugDisplay(iso: string | null): string {
  if (!iso) return 'Real time (no override)';
  try {
    const d = new Date(iso);
    return d.toLocaleString('en-US', {
      timeZone: 'America/Chicago',
      weekday: 'short', month: 'short', day: 'numeric',
      hour: 'numeric', minute: '2-digit', hour12: true,
    });
  } catch { return 'Invalid time'; }
}

export default function ProfileSettingsScreen() {
  const router = useRouter();
  const { session } = useAuth();
  const { isAdmin, isRestaurantOwner } = useAdminMode();
  const { reloadLocationPrefs, setUserCoordsOverride } = useLocation();
  const [userEmail, setUserEmail] = useState("");
  const [fullName, setFullName] = useState("");
  const [phoneNumber, setPhoneNumber] = useState("");
  const [createdAt, setCreatedAt] = useState<string | null>(null);
  const [editingProfile, setEditingProfile] = useState(false);
  const [tempFirstName, setTempFirstName] = useState("");
  const [tempLastInitial, setTempLastInitial] = useState("");
  const [tempPhone, setTempPhone] = useState("");
  const [notificationsEnabled, setNotificationsEnabled] = useState(false);
  const [pushPermissionDenied, setPushPermissionDenied] = useState(false);
  const [loggingOut, setLoggingOut] = useState(false);
  const [avatarUrl, setAvatarUrl] = useState<string | null>(null);
  const [uploadingAvatar, setUploadingAvatar] = useState(false);

  // Admin tab state (only used when isAdmin)
  const [activeTab, setActiveTab] = useState<'preferences' | 'location' | 'debug' | 'orders'>('preferences');

  // Debug time override state
  const [debugDay, setDebugDay] = useState(0);     // 0=Sun..6=Sat
  const [debugHour, setDebugHour] = useState(12);  // 1–12
  const [debugAmPm, setDebugAmPm] = useState<'AM' | 'PM'>('PM');
  const [debugMinute, setDebugMinute] = useState(0);
  const [activeDebugTime, setActiveDebugTime] = useState<string | null>(getDebugTime());

  // Dining Preferences State
  const [loadingPrefs, setLoadingPrefs] = useState(true);
  const [savingPrefs, setSavingPrefs] = useState(false);
  const [city, setCity] = useState("Frisco, TX");
  const [dietaryType, setDietaryType] = useState("");
  const [restrictedDays, setRestrictedDays] = useState<string[]>([]);
  const [showCityPicker, setShowCityPicker] = useState(false);
  const [prefsChanged, setPrefsChanged] = useState(false);

  // Location Settings State
  const [savedAddress, setSavedAddress] = useState("");
  const [origSavedAddress, setOrigSavedAddress] = useState("");
  const [liveLocationEnabled, setLiveLocationEnabled] = useState(true);
  const [origLiveLocationEnabled, setOrigLiveLocationEnabled] = useState(true);
  const [isSavingLocation, setIsSavingLocation] = useState(false);
  const [locationPrefsChanged, setLocationPrefsChanged] = useState(false);
  const [addressSuggestions, setAddressSuggestions] = useState<any[]>([]);
  const [isSearchingAddress, setIsSearchingAddress] = useState(false);

  type Coordinates = { lat: string | number | null, lon: string | number | null } | null;
  const [selectedCoords, setSelectedCoords] = useState<Coordinates>(null);
  const [origSelectedCoords, setOrigSelectedCoords] = useState<Coordinates>(null);

  // Original values (to detect changes)
  const [origCity, setOrigCity] = useState("");
  const [origDietary, setOrigDietary] = useState("");
  const [origDays, setOrigDays] = useState<string[]>([]);

  useEffect(() => {
    if (session?.user?.email) {
      setUserEmail(session.user.email);
    }
  }, [session]);

  // Load preferences from profiles table
  useEffect(() => {
    async function loadPrefs() {
      if (!session?.user?.id) {
        setLoadingPrefs(false);
        return;
      }
      try {
        const { data, error } = await supabase
          .from("profiles")
          .select(
            "location_city, dietary_type, restricted_days, full_name, created_at, saved_address, home_lat, home_long, phone_number, avatar_url",
          )
          .eq("id", session.user.id)
          .maybeSingle();

        const localToggle = await AsyncStorage.getItem("live_location_enabled");
        if (localToggle !== null) {
          const isLive = JSON.parse(localToggle);
          setLiveLocationEnabled(isLive);
          setOrigLiveLocationEnabled(isLive);
        }

        // Check actual push notification status
        const pushStatus = await isPushEnabled();
        setNotificationsEnabled(pushStatus);

        if (!error && data) {
          const c = data.location_city || "Frisco, TX";
          const d = data.dietary_type || "";
          const r = data.restricted_days || [];
          setCity(c);
          setOrigCity(c);
          setDietaryType(d);
          setOrigDietary(d);
          setRestrictedDays(r);
          setOrigDays(r);

          setFullName(data.full_name || "");
          setPhoneNumber(formatPhoneNumber((data as any).phone_number || ""));
          setCreatedAt(data.created_at);
          if ((data as any).avatar_url) {
            setAvatarUrl((data as any).avatar_url);
          }

          const sAddr = data.saved_address || "";
          setSavedAddress(sAddr);
          setOrigSavedAddress(sAddr);

          if (data.home_lat && data.home_long) {
            const coords = { lat: data.home_lat, lon: data.home_long };
            setSelectedCoords(coords);
            setOrigSelectedCoords(coords);
          }
        }
      } catch { }
      setLoadingPrefs(false);
    }
    loadPrefs();
  }, [session?.user?.id]);

  // Track Location Changes
  useEffect(() => {
    if (loadingPrefs) return;
    const changed =
      savedAddress !== origSavedAddress ||
      liveLocationEnabled !== origLiveLocationEnabled;
    setLocationPrefsChanged(changed);
  }, [
    savedAddress,
    liveLocationEnabled,
    origSavedAddress,
    origLiveLocationEnabled,
    loadingPrefs,
  ]);

  // Autocomplete fetch
  useEffect(() => {
    const timer = setTimeout(async () => {
      if (savedAddress && savedAddress.trim().length > 4 && savedAddress !== origSavedAddress) {
        setIsSearchingAddress(true);
        try {
          // Ensure the search is loosely bounded to Texas to give better hits before filtering
          const query = savedAddress.toLowerCase().includes("tx") || savedAddress.toLowerCase().includes("texas")
            ? savedAddress
            : `${savedAddress}, Texas`;

          const res = await fetch(`https://nominatim.openstreetmap.org/search?q=${encodeURIComponent(query)}&format=json&addressdetails=1&limit=10`, {
            headers: { "User-Agent": "RasviaApp/1.0" }
          });
          const data = await res.json();

          // Filter results to only include Texas
          const filtered = (data || []).filter((item: any) => {
            return item.address?.state === "Texas";
          });

          // Take top 5
          setAddressSuggestions(filtered.slice(0, 5));
        } catch (e) { }
        setIsSearchingAddress(false);
      } else {
        setAddressSuggestions([]);
      }
    }, 600);
    return () => clearTimeout(timer);
  }, [savedAddress, origSavedAddress]);

  // Track changes (only after prefs are loaded)
  useEffect(() => {
    if (loadingPrefs) return; // Don't track changes while loading

    const changed =
      city !== origCity ||
      dietaryType !== origDietary ||
      JSON.stringify([...restrictedDays].sort()) !== JSON.stringify([...origDays].sort());
    setPrefsChanged(changed);
  }, [
    city,
    dietaryType,
    restrictedDays,
    origCity,
    origDietary,
    origDays,
    loadingPrefs,
  ]);

  const savePreferences = useCallback(async () => {
    if (!session?.user?.id || savingPrefs) return;
    setSavingPrefs(true);

    try {
      const { error } = await supabase
        .from("profiles")
        .update({
          location_city: city,
          dietary_type: dietaryType,
          restricted_days: dietaryType === "Non-Veg" ? restrictedDays : [],
          updated_at: new Date().toISOString(),
        })
        .eq("id", session.user.id);

      if (error) throw error;

      // Update originals so button disables
      setOrigCity(city);
      setOrigDietary(dietaryType);
      setOrigDays(dietaryType === "Non-Veg" ? restrictedDays : []);

      if (Platform.OS !== "web") {
        Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
      }
      Alert.alert("Saved!", "Your preferences have been updated.");
    } catch (err: any) {
      Alert.alert("Error", err.message || "Could not save preferences.");
    }
    setSavingPrefs(false);
  }, [session, city, dietaryType, restrictedDays, savingPrefs]);

  const handleSaveProfile = useCallback(async () => {
    if (!session?.user?.id) return;
    try {
      const updates: Record<string, any> = {
        updated_at: new Date().toISOString(),
      };

      // Name — only update if first name is filled in
      if (tempFirstName.trim()) {
        const newFullName = `${tempFirstName.trim()} ${tempLastInitial.trim().toUpperCase()}.`;
        updates.full_name = newFullName;
      }

      // Phone — optional
      const cleaned = tempPhone.replace(/\D/g, "").trim();
      if (cleaned) {
        updates.phone_number = cleaned;
      }

      const { error } = await supabase
        .from("profiles")
        .update(updates)
        .eq("id", session.user.id);

      if (error) throw error;

      if (updates.full_name) setFullName(updates.full_name);
      if (cleaned) setPhoneNumber(formatPhoneNumber(cleaned));
      setEditingProfile(false);

      if (Platform.OS !== "web") {
        Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
      }
    } catch (err: any) {
      Alert.alert("Error", err.message || "Could not update profile.");
    }
  }, [session, tempFirstName, tempLastInitial, tempPhone, phoneNumber]);


  function formatPhoneNumber(raw: string): string {
    const digits = raw.replace(/\D/g, "").slice(0, 10);
    if (digits.length <= 3) return digits.length ? `(${digits}` : "";
    if (digits.length <= 6) return `(${digits.slice(0, 3)}) ${digits.slice(3)}`;
    return `(${digits.slice(0, 3)}) ${digits.slice(3, 6)}-${digits.slice(6)}`;
  }


  async function handlePickAvatar() {
    if (!session?.user?.id) return;

    try {
      const { status } = await ImagePicker.requestMediaLibraryPermissionsAsync();
      if (status !== 'granted') {
        Alert.alert('Permission Required', 'Please allow access to your photo library to set a profile picture.');
        return;
      }

      const result = await ImagePicker.launchImageLibraryAsync({
        mediaTypes: ImagePicker.MediaTypeOptions.Images,
        allowsEditing: true,
        aspect: [1, 1],
        quality: 0.8,
      });

      if (result.canceled || !result.assets?.[0]) return;

      const asset = result.assets[0];
      setUploadingAvatar(true);

      // Read image as base64, then convert to ArrayBuffer for upload
      const base64 = await FileSystem.readAsStringAsync(asset.uri, {
        encoding: 'base64' as any,
      });

      // Decode base64 → Uint8Array
      const binaryStr = atob(base64);
      const bytes = new Uint8Array(binaryStr.length);
      for (let i = 0; i < binaryStr.length; i++) {
        bytes[i] = binaryStr.charCodeAt(i);
      }

      const fileName = `${session.user.id}.jpg`;
      const { error: uploadError } = await supabase.storage
        .from('avatars')
        .upload(fileName, bytes.buffer, {
          upsert: true,
          contentType: 'image/jpeg',
        });

      if (uploadError) throw uploadError;

      // Get the public URL
      const { data: { publicUrl } } = supabase.storage
        .from('avatars')
        .getPublicUrl(fileName);

      // Add a cache-busting param so React Native doesn't serve stale from cache
      const urlWithBust = `${publicUrl}?t=${Date.now()}`;
      console.log('[Avatar] Public URL:', urlWithBust);

      // Save clean URL to profile (without cache buster)
      const { error: updateError } = await supabase
        .from('profiles')
        .update({ avatar_url: publicUrl })
        .eq('id', session.user.id);

      if (updateError) throw updateError;

      setAvatarUrl(urlWithBust);
      if (Platform.OS !== 'web') Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
    } catch (err: any) {
      console.error('[Avatar] Upload error:', err);
      Alert.alert('Error', err.message || 'Could not upload photo.');
    } finally {
      setUploadingAvatar(false);
    }
  }

  async function handleLogout() {
    if (Platform.OS !== "web") {
      Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Heavy);
    }

    Alert.alert("Log Out", "Are you sure you want to log out?", [
      { text: "Cancel", style: "cancel" },
      {
        text: "Log Out",
        style: "destructive",
        onPress: async () => {
          setLoggingOut(true);
          try {
            // Don't remove the user-scoped active group order key —
            // it lets the user recover their group order after re-login.
            const { error } = await supabase.auth.signOut();
            if (error) throw error;
            router.replace("/auth");
          } catch (error: any) {
            Alert.alert("Error", error.message || "Failed to log out.");
          } finally {
            setLoggingOut(false);
          }
        },
      },
    ]);
  }

  const [deletingAccount, setDeletingAccount] = React.useState(false);

  async function handleDeleteAccount() {
    if (Platform.OS !== "web") Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Heavy);

    // First confirmation
    Alert.alert(
      "Delete Account",
      "This will permanently delete your account and all associated data. This action cannot be undone.",
      [
        { text: "Cancel", style: "cancel" },
        {
          text: "Continue",
          style: "destructive",
          onPress: () => {
            // Second confirmation — extra safety
            Alert.alert(
              "Are you absolutely sure?",
              `Your account (${userEmail}) and all order history will be permanently deleted.`,
              [
                { text: "Go Back", style: "cancel" },
                {
                  text: "Delete Forever",
                  style: "destructive",
                  onPress: async () => {
                    setDeletingAccount(true);
                    try {
                      const { data: { session } } = await supabase.auth.getSession();
                      if (!session?.access_token) throw new Error("Not authenticated");

                      const supabaseUrl = process.env.EXPO_PUBLIC_SUPABASE_URL;
                      const response = await fetch(
                        `${supabaseUrl}/functions/v1/delete-account`,
                        {
                          method: "POST",
                          headers: {
                            "Content-Type": "application/json",
                            Authorization: `Bearer ${session.access_token}`,
                          },
                        }
                      );

                      const result = await response.json();
                      if (!response.ok) throw new Error(result.error || "Deletion failed");

                      // Sign out and redirect
                      await supabase.auth.signOut();
                      router.replace("/auth");
                    } catch (err: any) {
                      Alert.alert("Error", err.message || "Could not delete account. Please contact support@rasvia.com.");
                    } finally {
                      setDeletingAccount(false);
                    }
                  },
                },
              ]
            );
          },
        },
      ]
    );
  }

  const logoutScale = useSharedValue(1);
  const logoutStyle = useAnimatedStyle(() => ({
    transform: [{ scale: logoutScale.value }],
  }));

  const saveScale = useSharedValue(1);
  const saveStyle = useAnimatedStyle(() => ({
    transform: [{ scale: saveScale.value }],
  }));

  const handleSaveLocationSettings = useCallback(async () => {
    if (!session?.user?.id || isSavingLocation) return;
    setIsSavingLocation(true);

    try {
      let lat = null;
      let lng = null;
      const addressToSave = savedAddress.trim();

      if (addressToSave) {
        if (selectedCoords && selectedCoords.lat && selectedCoords.lon) {
          lat = parseFloat(selectedCoords.lat.toString());
          lng = parseFloat(selectedCoords.lon.toString());
        } else {
          Alert.alert("Address Required", "Please select a specific address from the suggestions dropdown to ensure map accuracy.");
          setIsSavingLocation(false);
          return;
        }
      }

      // Save the toggle to local storage
      await AsyncStorage.setItem(
        "live_location_enabled",
        JSON.stringify(liveLocationEnabled),
      );

      // Save the address and coords to supabase
      const { error } = await supabase
        .from("profiles")
        .update({
          saved_address: addressToSave,
          home_lat: lat,
          home_long: lng,
          updated_at: new Date().toISOString(),
        })
        .eq("id", session.user.id);

      if (error) throw error;

      // Optimistic location update for immediate Map sync
      if (lat && lng) {
        setUserCoordsOverride({ latitude: lat, longitude: lng });
      }

      setOrigSavedAddress(addressToSave);
      setOrigSelectedCoords({ lat: lat ?? null, lon: lng ?? null });
      setOrigLiveLocationEnabled(liveLocationEnabled);
      setAddressSuggestions([]);

      await reloadLocationPrefs();

      if (Platform.OS !== "web") {
        Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
      }
      Alert.alert("Saved!", "Your location settings have been updated.");
    } catch (err: any) {
      Alert.alert("Error", err.message || "Could not save location settings.");
    }
    setIsSavingLocation(false);
  }, [session, savedAddress, liveLocationEnabled, isSavingLocation, selectedCoords, setUserCoordsOverride, reloadLocationPrefs]);

  const saveLocScale = useSharedValue(1);
  const saveLocStyle = useAnimatedStyle(() => ({
    transform: [{ scale: saveLocScale.value }],
  }));

  // ── Debug time helpers ──
  function applyDebugOverride() {
    const now = new Date();

    // Determine CST/CDT offset from UTC (CST = UTC-6, CDT = UTC-5)
    const isCDT = (() => {
      try {
        const fmt = new Intl.DateTimeFormat('en-US', { timeZone: 'America/Chicago', timeZoneName: 'short' });
        return fmt.format(now).includes('CDT');
      } catch { return false; }
    })();
    const cstOffsetHours = isCDT ? 5 : 6; // how many hours ahead UTC is of CST

    // Get current CST date parts to know which calendar day to anchor on
    const cstFormatter = new Intl.DateTimeFormat('en-US', { timeZone: 'America/Chicago', weekday: 'short' });
    const cstDayIdx = DEBUG_DAYS.indexOf(cstFormatter.format(now));
    const dayDiff = debugDay - cstDayIdx;

    const base = new Date(now);
    base.setDate(base.getDate() + dayDiff);

    // Get the CST calendar date (year/month/day) for the chosen weekday
    const year = base.toLocaleString('en-US', { timeZone: 'America/Chicago', year: 'numeric' });
    const month = base.toLocaleString('en-US', { timeZone: 'America/Chicago', month: '2-digit' });
    const day = base.toLocaleString('en-US', { timeZone: 'America/Chicago', day: '2-digit' });

    // Convert 12h → 24h for UTC calculation
    let hour24 = debugHour % 12; // 12 AM → 0, 12 PM → 12
    if (debugAmPm === 'PM') hour24 += 12;
    // Build UTC ISO directly: UTC hour = CST hour + offset
    const utcHour = hour24 + cstOffsetHours;
    const dayOverflow = utcHour >= 24 ? 1 : 0;
    const finalUTCHour = utcHour % 24;

    // If utcHour overflows into the next day, advance the date by 1
    const dateObj = new Date(`${year}-${month}-${day}T00:00:00Z`);
    dateObj.setUTCDate(dateObj.getUTCDate() + dayOverflow);
    const finalYear = dateObj.getUTCFullYear();
    const finalMonth = String(dateObj.getUTCMonth() + 1).padStart(2, '0');
    const finalDay = String(dateObj.getUTCDate()).padStart(2, '0');

    const iso = `${finalYear}-${finalMonth}-${finalDay}T${String(finalUTCHour).padStart(2, '0')}:${String(debugMinute).padStart(2, '0')}:00.000Z`;

    setDebugTime(iso);
    setActiveDebugTime(iso);
    if (Platform.OS !== 'web') Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
  }

  function resetDebugTime() {
    setDebugTime(null);
    setActiveDebugTime(null);
    if (Platform.OS !== 'web') Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Medium);
  }

  return (
    <View className="flex-1 bg-rasvia-black">
      <SafeAreaView className="flex-1" edges={["top"]}>
        {/* Header */}
        <Animated.View
          entering={FadeIn.duration(400)}
          style={{
            flexDirection: 'row',
            alignItems: 'center',
            justifyContent: 'space-between',
            paddingHorizontal: 20,
            paddingTop: 8,
            paddingBottom: 16,
          }}
        >
          {/* Left: back button + title */}
          <View style={{ flexDirection: 'row', alignItems: 'center', flex: 1 }}>
            <Pressable
              onPress={() => {
                if (Platform.OS !== "web") {
                  Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
                }
                router.back();
              }}
              style={{
                backgroundColor: "#1a1a1a",
                width: 44,
                height: 44,
                borderRadius: 22,
                alignItems: "center",
                justifyContent: "center",
                borderWidth: 1,
                borderColor: "#2a2a2a",
                marginRight: 16,
              }}
            >
              <ArrowLeft size={22} color="#f5f5f5" />
            </Pressable>
            <Text
              style={{
                fontFamily: "BricolageGrotesque_800ExtraBold",
                color: "#f5f5f5",
                fontSize: 28,
                letterSpacing: -0.5,
              }}
            >
              My Profile
            </Text>
          </View>

          {/* Right: Log Out button */}
          <Pressable
            onPress={handleLogout}
            disabled={loggingOut}
            style={{
              borderWidth: 1,
              borderColor: 'rgba(239,68,68,0.35)',
              borderRadius: 22,
              paddingVertical: 9,
              paddingHorizontal: 14,
              flexDirection: 'row',
              alignItems: 'center',
              gap: 6,
              backgroundColor: 'rgba(239,68,68,0.07)',
              opacity: loggingOut ? 0.5 : 1,
            }}
          >
            {loggingOut
              ? <ActivityIndicator size="small" color="#EF4444" />
              : <LogOut size={15} color="#EF4444" />
            }
            <Text style={{
              fontFamily: 'Manrope_600SemiBold',
              color: '#EF4444',
              fontSize: 13,
            }}>Log Out</Text>
          </Pressable>
        </Animated.View>

        {/* ── Admin Tab Bar ── */}
        {isAdmin && (
          <View style={{
            flexDirection: 'row',
            marginHorizontal: 20,
            marginBottom: 8,
            backgroundColor: '#1a1a1a',
            borderRadius: 14,
            borderWidth: 1,
            borderColor: '#2a2a2a',
            padding: 4,
          }}>
            {(['preferences', 'location', 'debug', 'orders'] as const).map((tab) => {
              const isActive = activeTab === tab;
              const label = tab === 'preferences' ? 'Preferences' : tab === 'location' ? 'Location' : tab === 'debug' ? 'Debug' : 'Orders';
              return (
                <Pressable
                  key={tab}
                  onPress={() => {
                    if (Platform.OS !== 'web') Haptics.selectionAsync();
                    if (tab === 'orders') {
                      router.push('/admin-orders' as any);
                    } else {
                      setActiveTab(tab);
                    }
                  }}
                  style={{
                    flex: 1,
                    paddingVertical: 9,
                    alignItems: 'center',
                    justifyContent: 'center',
                    borderRadius: 11,
                    backgroundColor: isActive
                      ? tab === 'debug' ? 'rgba(245,158,11,0.18)' : tab === 'orders' ? 'rgba(34,197,94,0.18)' : 'rgba(255,153,51,0.18)'
                      : 'transparent',
                  }}
                >
                  <Text style={{
                    fontFamily: isActive ? 'BricolageGrotesque_700Bold' : 'Manrope_600SemiBold',
                    fontSize: 12,
                    lineHeight: 18,
                    color: isActive
                      ? tab === 'debug' ? '#F59E0B' : tab === 'orders' ? '#22C55E' : '#FF9933'
                      : '#666666',
                  }}>
                    {tab === 'debug' ? '🐞 ' + label : label}
                  </Text>
                </Pressable>
              );
            })}
          </View>
        )}

        <ScrollView
          showsVerticalScrollIndicator={false}
          contentContainerStyle={{ paddingBottom: 40 }}
        >
          {/* User Info Card */}
          <Animated.View
            entering={FadeInDown.delay(100).duration(500)}
            className="mx-5 mt-4 mb-8"
            style={{
              backgroundColor: "#1a1a1a",
              borderRadius: 20,
              borderWidth: 1,
              borderColor: "#2a2a2a",
              padding: 24,
              alignItems: "center",
            }}
          >
            <Pressable
              onPress={() => {
                // Parse full_name to get first name and last initial
                const parts = fullName.split(" ");
                const first = parts.slice(0, -1).join(" ");
                const lastInit =
                  parts[parts.length - 1]?.replace(".", "") || "";
                setTempFirstName(first);
                setTempLastInitial(lastInit);
                setTempPhone(phoneNumber);
                setEditingProfile(true);
              }}
              style={{
                position: "absolute",
                top: 16,
                right: 16,
                width: 32,
                height: 32,
                borderRadius: 16,
                backgroundColor: "#262626",
                borderWidth: 1,
                borderColor: "#333333",
                alignItems: "center",
                justifyContent: "center",
              }}
            >
              <Edit2 size={14} color="#FF9933" />
            </Pressable>
            {/* Avatar circle — tappable to change photo */}
            <Pressable
              onPress={handlePickAvatar}
              style={{
                width: 80,
                height: 80,
                borderRadius: 40,
                backgroundColor: "#262626",
                borderWidth: 2,
                borderColor: "#FF9933",
                alignItems: "center",
                justifyContent: "center",
                marginBottom: 16,
                overflow: "hidden",
              }}
            >
              {uploadingAvatar ? (
                <ActivityIndicator color="#FF9933" />
              ) : avatarUrl ? (
                <Image
                  source={{ uri: avatarUrl }}
                  style={{ width: 80, height: 80, borderRadius: 40 }}
                  onError={(e) => {
                    console.warn('[Avatar] Image load error:', e.nativeEvent.error, 'url:', avatarUrl);
                    setAvatarUrl(null);
                  }}
                />
              ) : (
                <User size={36} color="#FF9933" />
              )}
              {/* Camera overlay */}
              {!uploadingAvatar && (
                <View
                  style={{
                    position: "absolute",
                    bottom: 0,
                    left: 0,
                    right: 0,
                    height: 26,
                    backgroundColor: "rgba(0,0,0,0.55)",
                    alignItems: "center",
                    justifyContent: "center",
                  }}
                >
                  <Camera size={13} color="#fff" />
                </View>
              )}
            </Pressable>
            <Text
              style={{
                fontFamily: "Manrope_600SemiBold",
                color: "#f5f5f5",
                fontSize: 16,
                marginBottom: 4,
              }}
              numberOfLines={1}
            >
              {fullName || userEmail || "User"}
            </Text>
            <Text
              style={{
                fontFamily: "Manrope_500Medium",
                color: "#999999",
                fontSize: 13,
                marginBottom: 2,
              }}
            >
              {userEmail || ""}
            </Text>

            {/* Phone row — read-only display, tap edit button above to change */}
            <View
              style={{
                flexDirection: "row",
                alignItems: "center",
                marginBottom: 4,
              }}
            >
              <Phone size={11} color="#666666" style={{ marginRight: 4 }} />
              <Text
                style={{
                  fontFamily: "Manrope_500Medium",
                  color: phoneNumber ? "#999999" : "#555555",
                  fontSize: 13,
                  marginRight: 4,
                }}
              >
                {phoneNumber || "Tap ✏️ to add phone number"}
              </Text>
            </View>

            <Text
              style={{
                fontFamily: "Manrope_500Medium",
                color: "#999999",
                fontSize: 13,
              }}
            >
              {createdAt
                ? `Foodie since ${new Date(createdAt).toLocaleDateString("en-US", { month: "long", year: "numeric" })}`
                : "Foodie since 2026"}
            </Text>
          </Animated.View>

          {/* ==========================================
                        DINING PREFERENCES SECTION
                    ========================================== */}
          {(!isAdmin || activeTab === 'preferences') && (
            <Animated.View
              entering={FadeInDown.delay(150).duration(500)}
              className="mx-5 mb-8"
            >
              {/* Section Header */}
              <View
                style={{
                  flexDirection: "row",
                  alignItems: "center",
                  marginBottom: 14,
                }}
              >
                <Utensils size={18} color="#FF9933" />
                <Text
                  style={{
                    fontFamily: "BricolageGrotesque_700Bold",
                    color: "#f5f5f5",
                    fontSize: 18,
                    marginLeft: 8,
                  }}
                >
                  Dining Preferences
                </Text>
              </View>

              <View
                style={{
                  backgroundColor: "#1a1a1a",
                  borderRadius: 20,
                  borderWidth: 1,
                  borderColor: "#2a2a2a",
                  padding: 20,
                }}
              >
                {loadingPrefs ? (
                  <View style={{ paddingVertical: 40, alignItems: "center" }}>
                    <ActivityIndicator color="#FF9933" />
                  </View>
                ) : (
                  <>
                    {/* === Location === */}
                    <Text
                      style={{
                        fontFamily: "Manrope_600SemiBold",
                        color: "#999",
                        fontSize: 12,
                        letterSpacing: 1,
                        textTransform: "uppercase",
                        marginBottom: 8,
                      }}
                    >
                      Location
                    </Text>
                    <Pressable
                      onPress={() => setShowCityPicker((p) => !p)}
                      style={{
                        flexDirection: "row",
                        alignItems: "center",
                        justifyContent: "space-between",
                        backgroundColor: "#262626",
                        borderRadius: 14,
                        borderWidth: 1,
                        borderColor: "#333",
                        paddingHorizontal: 14,
                        height: 48,
                        marginBottom: showCityPicker ? 8 : 20,
                      }}
                    >
                      <View
                        style={{ flexDirection: "row", alignItems: "center" }}
                      >
                        <MapPin size={16} color="#FF9933" />
                        <Text
                          style={{
                            fontFamily: "Manrope_600SemiBold",
                            color: "#f5f5f5",
                            fontSize: 15,
                            marginLeft: 8,
                          }}
                        >
                          {city}
                        </Text>
                      </View>
                      <ChevronDown
                        size={18}
                        color="#999"
                        style={{
                          transform: [
                            { rotate: showCityPicker ? "180deg" : "0deg" },
                          ],
                        }}
                      />
                    </Pressable>

                    {showCityPicker && (
                      <View
                        style={{
                          backgroundColor: "#222",
                          borderRadius: 14,
                          borderWidth: 1,
                          borderColor: "#2a2a2a",
                          maxHeight: 180,
                          marginBottom: 20,
                          overflow: "hidden",
                        }}
                      >
                        <ScrollView
                          showsVerticalScrollIndicator={false}
                          nestedScrollEnabled
                        >
                          {DFW_CITIES.map((c) => (
                            <Pressable
                              key={c}
                              onPress={() => {
                                setCity(c);
                                setShowCityPicker(false);
                                if (Platform.OS !== "web")
                                  Haptics.selectionAsync();
                              }}
                              style={{
                                flexDirection: "row",
                                alignItems: "center",
                                justifyContent: "space-between",
                                paddingHorizontal: 14,
                                paddingVertical: 12,
                                borderBottomWidth: 1,
                                borderBottomColor: "#2a2a2a",
                                backgroundColor:
                                  city === c
                                    ? "rgba(255,153,51,0.08)"
                                    : "transparent",
                              }}
                            >
                              <Text
                                style={{
                                  fontFamily: "Manrope_500Medium",
                                  color: city === c ? "#FF9933" : "#f5f5f5",
                                  fontSize: 14,
                                }}
                              >
                                {c}
                              </Text>
                              {city === c && <Check size={16} color="#FF9933" />}
                            </Pressable>
                          ))}
                        </ScrollView>
                      </View>
                    )}

                    {/* === Dietary Type === */}
                    <Text
                      style={{
                        fontFamily: "Manrope_600SemiBold",
                        color: "#999",
                        fontSize: 12,
                        letterSpacing: 1,
                        textTransform: "uppercase",
                        marginBottom: 10,
                      }}
                    >
                      Dietary Preference
                    </Text>
                    <View
                      style={{
                        flexDirection: "row",
                        flexWrap: "wrap",
                        gap: 10,
                        marginBottom: 20,
                      }}
                    >
                      {DIETARY_OPTIONS.map((option) => {
                        const isSelected = dietaryType === option.key;
                        const Icon = option.icon;
                        return (
                          <Pressable
                            key={option.key}
                            onPress={() => {
                              setDietaryType(option.key);
                              if (Platform.OS !== "web") Haptics.selectionAsync();
                            }}
                            style={{
                              flexDirection: "row",
                              alignItems: "center",
                              backgroundColor: isSelected
                                ? "rgba(255,153,51,0.12)"
                                : "#262626",
                              borderWidth: isSelected ? 1.5 : 1,
                              borderColor: isSelected ? "#FF9933" : "#333",
                              borderRadius: 12,
                              paddingHorizontal: 14,
                              paddingVertical: 10,
                            }}
                          >
                            <Icon
                              size={16}
                              color={isSelected ? "#FF9933" : option.color}
                            />
                            <Text
                              style={{
                                fontFamily: "Manrope_600SemiBold",
                                color: isSelected ? "#FF9933" : "#ccc",
                                fontSize: 14,
                                marginLeft: 8,
                              }}
                            >
                              {option.label}
                            </Text>
                            {isSelected && (
                              <View
                                style={{
                                  marginLeft: 6,
                                  width: 18,
                                  height: 18,
                                  borderRadius: 9,
                                  backgroundColor: "#FF9933",
                                  alignItems: "center",
                                  justifyContent: "center",
                                }}
                              >
                                <Check
                                  size={11}
                                  color="#0f0f0f"
                                  strokeWidth={3}
                                />
                              </View>
                            )}
                          </Pressable>
                        );
                      })}
                    </View>

                    {/* === Veg-Only Days (Non-Veg only) === */}
                    {dietaryType === "Non-Veg" && (
                      <>
                        <Text
                          style={{
                            fontFamily: "Manrope_600SemiBold",
                            color: "#999",
                            fontSize: 12,
                            letterSpacing: 1,
                            textTransform: "uppercase",
                            marginBottom: 10,
                          }}
                        >
                          Veg-Only Days
                        </Text>
                        <View
                          style={{
                            flexDirection: "row",
                            justifyContent: "space-between",
                            marginBottom: 10,
                          }}
                        >
                          {DAYS.map((day, index) => {
                            const isActive = restrictedDays.includes(day.full);
                            return (
                              <Pressable
                                key={day.full + index}
                                onPress={() => {
                                  setRestrictedDays((prev) =>
                                    prev.includes(day.full)
                                      ? prev.filter((d) => d !== day.full)
                                      : [...prev, day.full],
                                  );
                                  if (Platform.OS !== "web")
                                    Haptics.selectionAsync();
                                }}
                                style={{
                                  alignItems: "center",
                                }}
                              >
                                <View
                                  style={{
                                    width: 38,
                                    height: 38,
                                    borderRadius: 19,
                                    alignItems: "center",
                                    justifyContent: "center",
                                    backgroundColor: isActive
                                      ? "#10B981"
                                      : "#262626",
                                    borderWidth: isActive ? 0 : 1,
                                    borderColor: "#333",
                                  }}
                                >
                                  <Text
                                    style={{
                                      fontFamily: "BricolageGrotesque_700Bold",
                                      color: isActive ? "#fff" : "#999",
                                      fontSize: 13,
                                    }}
                                  >
                                    {day.short}
                                  </Text>
                                </View>
                                <Text
                                  style={{
                                    fontFamily: "Manrope_500Medium",
                                    color: isActive ? "#10B981" : "#555",
                                    fontSize: 9,
                                    marginTop: 4,
                                  }}
                                >
                                  {day.full}
                                </Text>
                              </Pressable>
                            );
                          })}
                        </View>
                        <Text
                          style={{
                            fontFamily: "Manrope_500Medium",
                            color: "#666",
                            fontSize: 12,
                            marginBottom: 10,
                          }}
                        >
                          {restrictedDays.length === 0
                            ? "No restrictions — you'll see all dishes every day."
                            : `Vegetarian only on ${restrictedDays.join(", ")}.`}
                        </Text>
                      </>
                    )}

                    {/* === Save Button === */}
                    {prefsChanged && (
                      <Animated.View style={saveStyle}>
                        <Pressable
                          onPress={savePreferences}
                          onPressIn={() => {
                            saveScale.value = withSpring(0.96);
                          }}
                          onPressOut={() => {
                            saveScale.value = withSpring(1);
                          }}
                          disabled={savingPrefs}
                          style={{
                            backgroundColor: "#FF9933",
                            borderRadius: 14,
                            height: 48,
                            alignItems: "center",
                            justifyContent: "center",
                            flexDirection: "row",
                            marginTop: 8,
                            shadowColor: "#FF9933",
                            shadowOffset: { width: 0, height: 4 },
                            shadowOpacity: 0.3,
                            shadowRadius: 12,
                            elevation: 8,
                            opacity: savingPrefs ? 0.7 : 1,
                          }}
                        >
                          {savingPrefs ? (
                            <ActivityIndicator color="#0f0f0f" />
                          ) : (
                            <>
                              <Sparkles size={16} color="#0f0f0f" />
                              <Text
                                style={{
                                  fontFamily: "BricolageGrotesque_700Bold",
                                  color: "#0f0f0f",
                                  fontSize: 15,
                                  marginLeft: 6,
                                }}
                              >
                                Save Preferences
                              </Text>
                            </>
                          )}
                        </Pressable>
                      </Animated.View>
                    )}
                  </>
                )}
              </View>
            </Animated.View>
          )}

          {/* Settings List — always shown (without legal links) */}
          {(!isAdmin || activeTab === 'preferences') && (
            <Animated.View
              entering={FadeInDown.delay(200).duration(500)}
              className="mx-5 mb-8"
              style={{
                backgroundColor: "#1a1a1a",
                borderRadius: 20,
                borderWidth: 1,
                borderColor: "#2a2a2a",
                overflow: "hidden",
              }}
            >
              <SettingsRow
                icon={<ShoppingBag size={20} color="#FF9933" />}
                label="My Orders"
                hasChevron
                onPress={() => {
                  if (Platform.OS !== "web") Haptics.selectionAsync();
                  router.push("/my-orders" as any);
                }}
              />
              {isRestaurantOwner && (
                <>
                  <Divider />
                  <SettingsRow
                    icon={<Store size={20} color="#4ADE80" />}
                    label="Owner Dashboard"
                    hasChevron
                    onPress={() => {
                      if (Platform.OS !== "web") Haptics.selectionAsync();
                      router.push("/owner-dashboard" as any);
                    }}
                  />
                </>
              )}
              <Divider />
              <View
                style={{
                  flexDirection: "row",
                  alignItems: "center",
                  paddingHorizontal: 20,
                  paddingVertical: 16,
                }}
              >
                <View
                  style={{
                    width: 40,
                    height: 40,
                    borderRadius: 12,
                    backgroundColor: "rgba(255, 153, 51, 0.12)",
                    alignItems: "center",
                    justifyContent: "center",
                    marginRight: 14,
                  }}
                >
                  <Bell size={20} color="#FF9933" />
                </View>
                <View style={{ flex: 1 }}>
                  <Text
                    style={{
                      fontFamily: "Manrope_600SemiBold",
                      color: "#f5f5f5",
                      fontSize: 15,
                    }}
                  >
                    Notifications
                  </Text>
                  <Text
                    style={{
                      fontFamily: "Manrope_500Medium",
                      color: notificationsEnabled ? "#22C55E" : "#EF4444",
                      fontSize: 11,
                      marginTop: 2,
                    }}
                  >
                    {notificationsEnabled ? "Active" : "Inactive"}
                  </Text>
                </View>
                <Switch
                  value={notificationsEnabled}
                  onValueChange={async (val) => {
                    if (Platform.OS !== "web") Haptics.selectionAsync();
                    if (val) {
                      const granted = await enablePushNotifications();
                      setNotificationsEnabled(granted);
                      if (!granted) {
                        Alert.alert(
                          "Notifications Blocked",
                          "Please enable notifications in your device Settings.",
                        );
                      }
                    } else {
                      await disablePushNotifications();
                      setNotificationsEnabled(false);
                    }
                  }}
                  trackColor={{ false: "#333333", true: "rgba(255,153,51,0.4)" }}
                  thumbColor={notificationsEnabled ? "#FF9933" : "#666666"}
                />
              </View>
              <Divider />
              <SettingsRow
                icon={<Heart size={20} color="#EF4444" />}
                label="Favorites"
                hasChevron
                onPress={() => {
                  if (Platform.OS !== "web") Haptics.selectionAsync();
                  router.push("/favorites" as any);
                }}
              />
            </Animated.View>
          )}

          {/* ==========================================
                      LOCATION SETTINGS SECTION
                  ========================================== */}
          {(!isAdmin || activeTab === 'location') && (
            <Animated.View
              entering={FadeInDown.delay(200).duration(500)}
              className="mx-5 mb-8"
            >
              {/* Section Header */}
              <View
                style={{
                  flexDirection: "row",
                  alignItems: "center",
                  marginBottom: 14,
                }}
              >
                <MapPin size={18} color="#FF9933" />
                <Text
                  style={{
                    fontFamily: "BricolageGrotesque_700Bold",
                    color: "#f5f5f5",
                    fontSize: 18,
                    marginLeft: 8,
                  }}
                >
                  Location Settings
                </Text>
              </View>

              <View
                style={{
                  backgroundColor: "#1a1a1a",
                  borderRadius: 20,
                  borderWidth: 1,
                  borderColor: "#2a2a2a",
                  padding: 20,
                }}
              >
                {/* === Live Location Toggle === */}
                <View
                  style={{
                    flexDirection: "row",
                    alignItems: "center",
                    justifyContent: "space-between",
                    marginBottom: 16,
                  }}
                >
                  <View style={{ flex: 1, marginRight: 16 }}>
                    <Text
                      style={{
                        fontFamily: "Manrope_600SemiBold",
                        color: "#f5f5f5",
                        fontSize: 15,
                        marginBottom: 4,
                      }}
                    >
                      Live Location Tracking
                    </Text>
                    <Text
                      style={{
                        fontFamily: "Manrope_500Medium",
                        color: "#999",
                        fontSize: 12,
                      }}
                    >
                      Automatically find nearby restaurants using device GPS
                    </Text>
                  </View>
                  <Switch
                    value={liveLocationEnabled}
                    onValueChange={(val) => {
                      setLiveLocationEnabled(val);
                      if (Platform.OS !== "web") Haptics.selectionAsync();
                    }}
                    trackColor={{
                      false: "#333333",
                      true: "rgba(255,153,51,0.4)",
                    }}
                    thumbColor={liveLocationEnabled ? "#FF9933" : "#666666"}
                  />
                </View>

                <Divider />

                {/* === Saved Address Input === */}
                <View style={{ marginTop: 16 }}>
                  <Text
                    style={{
                      fontFamily: "Manrope_600SemiBold",
                      color: "#999",
                      fontSize: 12,
                      letterSpacing: 1,
                      textTransform: "uppercase",
                      marginBottom: 8,
                    }}
                  >
                    Saved Address (Overrides GPS)
                  </Text>
                  <TextInput
                    value={savedAddress}
                    onChangeText={(val) => {
                      setSavedAddress(val);
                      setSelectedCoords(null);
                    }}
                    style={{
                      backgroundColor: "#262626",
                      borderRadius: 12,
                      borderWidth: 1,
                      borderColor: "#333",
                      paddingHorizontal: 14,
                      height: 48,
                      color: "#f5f5f5",
                      fontFamily: "Manrope_500Medium",
                      fontSize: 15,
                    }}
                    placeholder="Enter full address, e.g. 123 Main St..."
                    placeholderTextColor="#666"
                    autoCorrect={false}
                  />

                  {/* Autocomplete Suggestions */}
                  {addressSuggestions.length > 0 && (
                    <View style={{
                      backgroundColor: "#2a2a2a",
                      borderRadius: 12,
                      marginTop: 8,
                      borderWidth: 1,
                      borderColor: "#333",
                      overflow: 'hidden'
                    }}>
                      {addressSuggestions.map((item, idx) => (
                        <Pressable
                          key={idx}
                          style={{
                            padding: 12,
                            borderBottomWidth: idx < addressSuggestions.length - 1 ? 1 : 0,
                            borderColor: "#3a3a3a"
                          }}
                          onPress={() => {
                            setSavedAddress(item.display_name);
                            setSelectedCoords({ lat: item.lat, lon: item.lon });
                            setAddressSuggestions([]);
                            if (Platform.OS !== "web") Haptics.selectionAsync();
                          }}
                        >
                          <Text style={{ color: "#f5f5f5", fontFamily: "Manrope_500Medium", fontSize: 13, lineHeight: 18 }}>
                            {item.display_name}
                          </Text>
                        </Pressable>
                      ))}
                    </View>
                  )}
                  {isSearchingAddress && (
                    <Text style={{ color: "#666", fontSize: 11, fontFamily: "Manrope_500Medium", marginTop: 6, marginLeft: 4 }}>Searching...</Text>
                  )}
                </View>

                {/* === Save Location Button === */}
                {locationPrefsChanged && (
                  <Animated.View style={saveLocStyle}>
                    <Pressable
                      onPress={handleSaveLocationSettings}
                      onPressIn={() => {
                        saveLocScale.value = withSpring(0.96);
                      }}
                      onPressOut={() => {
                        saveLocScale.value = withSpring(1);
                      }}
                      disabled={isSavingLocation}
                      style={{
                        backgroundColor: "#FF9933",
                        borderRadius: 14,
                        height: 48,
                        alignItems: "center",
                        justifyContent: "center",
                        flexDirection: "row",
                        marginTop: 16,
                        shadowColor: "#FF9933",
                        shadowOffset: { width: 0, height: 4 },
                        shadowOpacity: 0.3,
                        shadowRadius: 12,
                        elevation: 8,
                        opacity: isSavingLocation ? 0.7 : 1,
                      }}
                    >
                      {isSavingLocation ? (
                        <ActivityIndicator color="#0f0f0f" />
                      ) : (
                        <>
                          <MapPin size={16} color="#0f0f0f" />
                          <Text
                            style={{
                              fontFamily: "BricolageGrotesque_700Bold",
                              color: "#0f0f0f",
                              fontSize: 15,
                              marginLeft: 6,
                            }}
                          >
                            Save Location Settings
                          </Text>
                        </>
                      )}
                    </Pressable>
                  </Animated.View>
                )}
              </View>
            </Animated.View>
          )}




          {/* ==========================================
                        DEBUG TAB (Admin only)
                    ========================================== */}
          {isAdmin && activeTab === 'debug' && (
            <Animated.View
              entering={FadeInDown.delay(100).duration(400)}
              className="mx-5 mb-8"
            >
              {/* Header */}
              <View style={{ flexDirection: 'row', alignItems: 'center', marginBottom: 14 }}>
                <Bug size={18} color="#F59E0B" />
                <Text style={{
                  fontFamily: 'BricolageGrotesque_700Bold',
                  color: '#f5f5f5',
                  fontSize: 18,
                  marginLeft: 8,
                }}>Debug Tools</Text>
              </View>

              {/* Caution Banner */}
              <View style={{
                backgroundColor: 'rgba(245,158,11,0.1)',
                borderWidth: 1,
                borderColor: 'rgba(245,158,11,0.3)',
                borderRadius: 14,
                padding: 14,
                flexDirection: 'row',
                alignItems: 'center',
                marginBottom: 16,
                gap: 10,
              }}>
                <AlertTriangle size={16} color="#F59E0B" />
                <Text style={{
                  fontFamily: 'Manrope_500Medium',
                  color: '#F59E0B',
                  fontSize: 13,
                  flex: 1,
                  lineHeight: 18,
                }}>
                  Debug mode — time override resets when app restarts. Affects hours display for all restaurants.
                </Text>
              </View>

              {/* Current override display */}
              <View style={{
                backgroundColor: '#1a1a1a',
                borderRadius: 16,
                borderWidth: 1,
                borderColor: '#2a2a2a',
                padding: 16,
                marginBottom: 16,
              }}>
                <Text style={{ fontFamily: 'Manrope_600SemiBold', color: '#999', fontSize: 11, letterSpacing: 1, textTransform: 'uppercase', marginBottom: 8 }}>
                  Active App Time (CST)
                </Text>
                <View style={{ flexDirection: 'row', alignItems: 'center', gap: 8 }}>
                  <Clock size={15} color={activeDebugTime ? '#F59E0B' : '#666'} />
                  <Text style={{
                    fontFamily: 'Manrope_600SemiBold',
                    color: activeDebugTime ? '#F59E0B' : '#888',
                    fontSize: 14,
                  }}>
                    {formatDebugDisplay(activeDebugTime)}
                  </Text>
                </View>
              </View>

              {/* Picker Card */}
              <View style={{
                backgroundColor: '#1a1a1a',
                borderRadius: 20,
                borderWidth: 1,
                borderColor: '#2a2a2a',
                padding: 20,
                marginBottom: 14,
              }}>
                {/* Day Picker */}
                <Text style={{ fontFamily: 'Manrope_600SemiBold', color: '#999', fontSize: 12, letterSpacing: 1, textTransform: 'uppercase', marginBottom: 10 }}>
                  Day of Week
                </Text>
                <ScrollView horizontal showsHorizontalScrollIndicator={false} style={{ marginBottom: 20 }} contentContainerStyle={{ gap: 8 }}>
                  {DEBUG_DAYS.map((d, i) => (
                    <Pressable
                      key={d}
                      onPress={() => { setDebugDay(i); if (Platform.OS !== 'web') Haptics.selectionAsync(); }}
                      style={{
                        width: 44,
                        height: 44,
                        borderRadius: 22,
                        alignItems: 'center',
                        justifyContent: 'center',
                        backgroundColor: debugDay === i ? 'rgba(245,158,11,0.18)' : '#262626',
                        borderWidth: debugDay === i ? 1.5 : 1,
                        borderColor: debugDay === i ? '#F59E0B' : '#333',
                      }}
                    >
                      <Text style={{
                        fontFamily: 'BricolageGrotesque_700Bold',
                        fontSize: 11,
                        color: debugDay === i ? '#F59E0B' : '#888',
                      }}>{d}</Text>
                    </Pressable>
                  ))}
                </ScrollView>

                {/* Hour Picker (1–12) */}
                <Text style={{ fontFamily: 'Manrope_600SemiBold', color: '#999', fontSize: 12, letterSpacing: 1, textTransform: 'uppercase', marginBottom: 10 }}>
                  Hour
                </Text>
                <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={{ gap: 6 }} style={{ marginBottom: 10 }}>
                  {Array.from({ length: 12 }, (_, i) => i + 1).map((h) => (
                    <Pressable
                      key={h}
                      onPress={() => { setDebugHour(h); if (Platform.OS !== 'web') Haptics.selectionAsync(); }}
                      style={{
                        minWidth: 44,
                        height: 44,
                        borderRadius: 12,
                        alignItems: 'center',
                        justifyContent: 'center',
                        paddingHorizontal: 8,
                        backgroundColor: debugHour === h ? 'rgba(245,158,11,0.18)' : '#262626',
                        borderWidth: debugHour === h ? 1.5 : 1,
                        borderColor: debugHour === h ? '#F59E0B' : '#333',
                      }}
                    >
                      <Text style={{
                        fontFamily: 'JetBrainsMono_600SemiBold',
                        fontSize: 13,
                        color: debugHour === h ? '#F59E0B' : '#888',
                      }}>{h}</Text>
                    </Pressable>
                  ))}
                </ScrollView>
                {/* AM / PM toggle — below the hour row */}
                <View style={{ flexDirection: 'row', gap: 10, marginBottom: 20 }}>
                  {(['AM', 'PM'] as const).map((period) => (
                    <Pressable
                      key={period}
                      onPress={() => { setDebugAmPm(period); if (Platform.OS !== 'web') Haptics.selectionAsync(); }}
                      style={{
                        flex: 1,
                        height: 40,
                        borderRadius: 12,
                        alignItems: 'center',
                        justifyContent: 'center',
                        backgroundColor: debugAmPm === period ? 'rgba(245,158,11,0.18)' : '#262626',
                        borderWidth: debugAmPm === period ? 1.5 : 1,
                        borderColor: debugAmPm === period ? '#F59E0B' : '#333',
                      }}
                    >
                      <Text style={{
                        fontFamily: 'JetBrainsMono_600SemiBold',
                        fontSize: 14,
                        color: debugAmPm === period ? '#F59E0B' : '#888',
                      }}>{period}</Text>
                    </Pressable>
                  ))}
                </View>

                {/* Minute Picker */}
                <Text style={{ fontFamily: 'Manrope_600SemiBold', color: '#999', fontSize: 12, letterSpacing: 1, textTransform: 'uppercase', marginBottom: 10 }}>
                  Minute
                </Text>
                <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={{ gap: 6 }}>
                  {[0, 5, 10, 15, 20, 25, 30, 35, 40, 45, 50, 55].map((m) => (
                    <Pressable
                      key={m}
                      onPress={() => { setDebugMinute(m); if (Platform.OS !== 'web') Haptics.selectionAsync(); }}
                      style={{
                        minWidth: 44,
                        height: 44,
                        borderRadius: 12,
                        alignItems: 'center',
                        justifyContent: 'center',
                        paddingHorizontal: 8,
                        backgroundColor: debugMinute === m ? 'rgba(245,158,11,0.18)' : '#262626',
                        borderWidth: debugMinute === m ? 1.5 : 1,
                        borderColor: debugMinute === m ? '#F59E0B' : '#333',
                      }}
                    >
                      <Text style={{
                        fontFamily: 'JetBrainsMono_600SemiBold',
                        fontSize: 12,
                        color: debugMinute === m ? '#F59E0B' : '#888',
                      }}>:{String(m).padStart(2, '0')}</Text>
                    </Pressable>
                  ))}
                </ScrollView>
              </View>

              {/* Action Buttons */}
              <Pressable
                onPress={applyDebugOverride}
                style={{
                  backgroundColor: '#F59E0B',
                  borderRadius: 14,
                  height: 50,
                  alignItems: 'center',
                  justifyContent: 'center',
                  flexDirection: 'row',
                  marginBottom: 10,
                  shadowColor: '#F59E0B',
                  shadowOffset: { width: 0, height: 4 },
                  shadowOpacity: 0.3,
                  shadowRadius: 10,
                  elevation: 6,
                }}
              >
                <Clock size={16} color="#0f0f0f" />
                <Text style={{ fontFamily: 'BricolageGrotesque_700Bold', color: '#0f0f0f', fontSize: 15, marginLeft: 8 }}>
                  Apply Time Override
                </Text>
              </Pressable>

              <Pressable
                onPress={resetDebugTime}
                style={{
                  backgroundColor: 'transparent',
                  borderRadius: 14,
                  height: 50,
                  alignItems: 'center',
                  justifyContent: 'center',
                  flexDirection: 'row',
                  borderWidth: 1,
                  borderColor: '#333',
                }}
              >
                <RefreshCw size={15} color="#999" />
                <Text style={{ fontFamily: 'Manrope_600SemiBold', color: '#999', fontSize: 15, marginLeft: 8 }}>
                  Reset to Real Time
                </Text>
              </Pressable>
            </Animated.View>
          )}

          {/* Admin Pulse — only visible to admins */}
          {isAdmin && (
            <Animated.View
              entering={FadeInDown.delay(280).duration(500)}
              className="mx-5 mb-4"
            >
              <Pressable
                onPress={() => {
                  if (Platform.OS !== "web") Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
                  router.push("/admin-pulse" as any);
                }}
                style={{
                  backgroundColor: "rgba(255,153,51,0.08)",
                  borderWidth: 1,
                  borderColor: "rgba(255,153,51,0.25)",
                  borderRadius: 16,
                  paddingVertical: 16,
                  paddingHorizontal: 20,
                  flexDirection: "row",
                  alignItems: "center",
                  justifyContent: "space-between",
                }}
              >
                <View style={{ flexDirection: "row", alignItems: "center" }}>
                  <Shield size={18} color="#FF9933" />
                  <Text style={{ fontFamily: "Manrope_700Bold", color: "#FF9933", fontSize: 16, marginLeft: 10 }}>
                    Admin Pulse
                  </Text>
                </View>
                <ChevronRight size={18} color="#FF9933" />
              </Pressable>
            </Animated.View>
          )}

          {/* ==========================================
                      DANGER ZONE — Delete Account
                      + Legal Links (bottom of page)
              ========================================== */}
          {(!isAdmin && !isRestaurantOwner) && (
            <Animated.View
              entering={FadeInDown.delay(300).duration(500)}
              className="mx-5 mb-8"
            >
              <View
                style={{
                  backgroundColor: "rgba(239,68,68,0.05)",
                  borderRadius: 20,
                  borderWidth: 1,
                  borderColor: "rgba(239,68,68,0.2)",
                  padding: 20,
                  marginBottom: 16,
                }}
              >
                <Text
                  style={{
                    fontFamily: "BricolageGrotesque_700Bold",
                    color: "#EF4444",
                    fontSize: 16,
                    marginBottom: 6,
                  }}
                >
                  Danger Zone
                </Text>
                <Text
                  style={{
                    fontFamily: "Manrope_500Medium",
                    color: "#999",
                    fontSize: 13,
                    lineHeight: 19,
                    marginBottom: 16,
                  }}
                >
                  Permanently deletes your account and all associated data. This cannot be undone.
                </Text>
                <Pressable
                  onPress={handleDeleteAccount}
                  disabled={deletingAccount}
                  style={{
                    backgroundColor: "rgba(239,68,68,0.1)",
                    borderWidth: 1,
                    borderColor: "rgba(239,68,68,0.4)",
                    borderRadius: 14,
                    height: 48,
                    alignItems: "center",
                    justifyContent: "center",
                    flexDirection: "row",
                    gap: 8,
                    opacity: deletingAccount ? 0.5 : 1,
                  }}
                >
                  {deletingAccount ? (
                    <ActivityIndicator color="#EF4444" size="small" />
                  ) : (
                    <LogOut size={16} color="#EF4444" />
                  )}
                  <Text
                    style={{
                      fontFamily: "BricolageGrotesque_700Bold",
                      color: "#EF4444",
                      fontSize: 15,
                    }}
                  >
                    {deletingAccount ? "Deleting…" : "Delete My Account"}
                  </Text>
                </Pressable>
              </View>

              {/* Legal Links at very bottom */}
              <View
                style={{
                  backgroundColor: "#1a1a1a",
                  borderRadius: 16,
                  borderWidth: 1,
                  borderColor: "#2a2a2a",
                  overflow: "hidden",
                }}
              >
                <SettingsRow
                  icon={<Shield size={20} color="#888888" />}
                  label="Privacy Policy"
                  hasChevron
                  onPress={() => {
                    if (Platform.OS !== "web") Haptics.selectionAsync();
                    router.push("/privacy" as any);
                  }}
                />
                <Divider />
                <SettingsRow
                  icon={<FileText size={20} color="#888888" />}
                  label="Terms of Service"
                  hasChevron
                  onPress={() => {
                    if (Platform.OS !== "web") Haptics.selectionAsync();
                    router.push("/terms" as any);
                  }}
                />
              </View>
            </Animated.View>
          )}

        </ScrollView>

        {/* Combined Profile Edit Modal */}
        <Modal
          visible={editingProfile}
          transparent
          animationType="fade"
          onRequestClose={() => setEditingProfile(false)}
        >
          <KeyboardAvoidingView
            style={{ flex: 1 }}
            behavior={Platform.OS === "ios" ? "padding" : "height"}
          >
            <TouchableWithoutFeedback onPress={() => { Keyboard.dismiss(); setEditingProfile(false); }}>
              <View style={{
                flex: 1,
                backgroundColor: "rgba(0, 0, 0, 0.75)",
                alignItems: "center",
                justifyContent: "center",
                paddingHorizontal: 24,
              }}>
                <TouchableWithoutFeedback onPress={() => Keyboard.dismiss()}>
                  <View
                    style={{
                      backgroundColor: "#1a1a1a",
                      borderRadius: 20,
                      borderWidth: 1,
                      borderColor: "#2a2a2a",
                      padding: 24,
                      width: "100%",
                      maxWidth: 420,
                    }}
                  >
                    {/* Header */}
                    <View style={{ flexDirection: "row", alignItems: "center", marginBottom: 20 }}>
                      <View style={{
                        width: 36, height: 36, borderRadius: 18,
                        backgroundColor: "rgba(255,153,51,0.15)",
                        alignItems: "center", justifyContent: "center",
                        marginRight: 12,
                      }}>
                        <Edit2 size={16} color="#FF9933" />
                      </View>
                      <Text style={{ fontFamily: "BricolageGrotesque_700Bold", color: "#f5f5f5", fontSize: 20 }}>
                        Edit Profile
                      </Text>
                    </View>

                    {/* Name fields */}
                    <Text style={{ fontFamily: "Manrope_600SemiBold", color: "#999", fontSize: 11, letterSpacing: 0.8, textTransform: "uppercase", marginBottom: 8 }}>
                      Display Name
                    </Text>
                    <View style={{ flexDirection: "row", gap: 12, marginBottom: 16 }}>
                      <View style={{ flex: 1 }}>
                        <Text style={{ fontFamily: "Manrope_500Medium", color: "#666", fontSize: 11, marginBottom: 6 }}>First Name</Text>
                        <TextInput
                          value={tempFirstName}
                          onChangeText={setTempFirstName}
                          style={{
                            backgroundColor: "#262626",
                            borderRadius: 12,
                            borderWidth: 1,
                            borderColor: tempFirstName ? "#FF9933" : "#333",
                            paddingHorizontal: 14,
                            height: 48,
                            color: "#f5f5f5",
                            fontFamily: "Manrope_500Medium",
                            fontSize: 15,
                          }}
                          placeholderTextColor="#666"
                          autoCapitalize="words"
                        />
                      </View>
                      <View style={{ width: 80 }}>
                        <Text style={{ fontFamily: "Manrope_500Medium", color: "#666", fontSize: 11, marginBottom: 6 }}>Last Initial</Text>
                        <TextInput
                          value={tempLastInitial}
                          onChangeText={(text) => setTempLastInitial(text.slice(0, 1))}
                          maxLength={1}
                          style={{
                            backgroundColor: "#262626",
                            borderRadius: 12,
                            borderWidth: 1,
                            borderColor: tempLastInitial ? "#FF9933" : "#333",
                            paddingHorizontal: 14,
                            height: 48,
                            color: "#f5f5f5",
                            fontFamily: "Manrope_500Medium",
                            fontSize: 15,
                            textAlign: "center",
                          }}
                          placeholderTextColor="#666"
                          autoCapitalize="characters"
                        />
                      </View>
                    </View>

                    {/* Email — read-only */}
                    <Text style={{ fontFamily: "Manrope_600SemiBold", color: "#999", fontSize: 11, letterSpacing: 0.8, textTransform: "uppercase", marginBottom: 8 }}>
                      Email
                    </Text>
                    <View style={{
                      backgroundColor: "#1e1e1e",
                      borderRadius: 12,
                      borderWidth: 1,
                      borderColor: "#2a2a2a",
                      paddingHorizontal: 14,
                      height: 48,
                      justifyContent: "center",
                      marginBottom: 16,
                    }}>
                      <Text style={{ fontFamily: "Manrope_500Medium", color: "#666", fontSize: 14 }}>
                        {userEmail || "—"}
                      </Text>
                    </View>
                    <Text style={{ fontFamily: "Manrope_500Medium", color: "#555", fontSize: 11, marginTop: -10, marginBottom: 16 }}>
                      Email cannot be changed here
                    </Text>

                    {/* Phone Number */}
                    <Text style={{ fontFamily: "Manrope_600SemiBold", color: "#999", fontSize: 11, letterSpacing: 0.8, textTransform: "uppercase", marginBottom: 8 }}>
                      Phone Number
                    </Text>
                    <View style={{
                      flexDirection: "row",
                      alignItems: "center",
                      backgroundColor: "#262626",
                      borderRadius: 12,
                      borderWidth: 1,
                      borderColor: tempPhone ? "#FF9933" : "#333",
                      paddingHorizontal: 14,
                      height: 48,
                      marginBottom: 24,
                    }}>
                      <Phone size={16} color="#999999" />
                      <TextInput
                        value={tempPhone}
                        onChangeText={(v) => setTempPhone(formatPhoneNumber(v))}
                        style={{
                          flex: 1,
                          color: "#f5f5f5",
                          fontFamily: "Manrope_500Medium",
                          fontSize: 15,
                          marginLeft: 10,
                        }}
                        placeholderTextColor="#666"
                        placeholder="(972) 555-1234"
                        keyboardType="phone-pad"
                      />
                    </View>

                    {/* Buttons */}
                    <View style={{ flexDirection: "row", gap: 12 }}>
                      <Pressable
                        onPress={() => setEditingProfile(false)}
                        style={{
                          flex: 1,
                          backgroundColor: "#262626",
                          borderRadius: 12,
                          height: 48,
                          alignItems: "center",
                          justifyContent: "center",
                          borderWidth: 1,
                          borderColor: "#333",
                        }}
                      >
                        <Text style={{ fontFamily: "Manrope_600SemiBold", color: "#999", fontSize: 15 }}>Cancel</Text>
                      </Pressable>
                      <Pressable
                        onPress={handleSaveProfile}
                        style={{
                          flex: 1,
                          backgroundColor: "#FF9933",
                          borderRadius: 12,
                          height: 48,
                          alignItems: "center",
                          justifyContent: "center",
                        }}
                      >
                        <Text style={{ fontFamily: "BricolageGrotesque_700Bold", color: "#0f0f0f", fontSize: 15 }}>Save</Text>
                      </Pressable>
                    </View>
                  </View>
                </TouchableWithoutFeedback>
              </View>
            </TouchableWithoutFeedback>
          </KeyboardAvoidingView>
        </Modal>
      </SafeAreaView>
    </View>
  );
}

// ==========================================
// HELPER COMPONENTS
// ==========================================

function SettingsRow({
  icon,
  label,
  hasChevron,
  onPress,
}: {
  icon: React.ReactNode;
  label: string;
  hasChevron?: boolean;
  onPress?: () => void;
}) {
  return (
    <Pressable
      onPress={onPress}
      style={{
        flexDirection: "row",
        alignItems: "center",
        paddingHorizontal: 20,
        paddingVertical: 16,
      }}
    >
      <View
        style={{
          width: 40,
          height: 40,
          borderRadius: 12,
          backgroundColor: "rgba(255, 153, 51, 0.12)",
          alignItems: "center",
          justifyContent: "center",
          marginRight: 14,
        }}
      >
        {icon}
      </View>
      <Text
        style={{
          flex: 1,
          fontFamily: "Manrope_600SemiBold",
          color: "#f5f5f5",
          fontSize: 15,
        }}
      >
        {label}
      </Text>
      {hasChevron && <ChevronRight size={18} color="#666666" />}
    </Pressable>
  );
}

function Divider() {
  return (
    <View
      style={{
        height: 1,
        backgroundColor: "#2a2a2a",
        marginHorizontal: 20,
      }}
    />
  );
}
