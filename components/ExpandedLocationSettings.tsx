import React, { useCallback, useEffect, useState } from "react";
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
import Animated, { FadeInDown } from "react-native-reanimated";
import * as Location from "expo-location";
import * as Haptics from "expo-haptics";
import { MapPin, Search, X, Crosshair, BookmarkPlus, Trash2 } from "lucide-react-native";
import { supabase } from "@/lib/supabase";
import { useAuth } from "@/lib/auth-context";
import { useLocation } from "@/lib/location-context";
import { useAppTheme } from "@/lib/app-theme";
import { buildTexasNominatimSearchUrl, nominatimResultInTexas } from "@/lib/nominatim-texas";

type Suggestion = { display_name: string; lat: number; lon: number };

type SavedAddressRow = {
  id: string;
  label: string | null;
  formatted_address: string;
  latitude: number;
  longitude: number;
};

function extractCityLabel(displayName: string): string | null {
  const parts = displayName.split(",").map((p) => p.trim());
  const countyIdx = parts.findIndex((p) => /county|parish/i.test(p));
  if (countyIdx > 0) return parts[countyIdx - 1];
  return parts[1] ?? parts[0] ?? null;
}

function normalizeAddressKey(formatted: string): string {
  return formatted.trim().toLowerCase().replace(/\s+/g, " ");
}

/** Match DB unique index: 4 decimal places (~11 m). */
function sameRoundedCoords(
  lat1: number,
  lon1: number,
  lat2: number,
  lon2: number
): boolean {
  return (
    Math.round(lat1 * 1e4) / 1e4 === Math.round(lat2 * 1e4) / 1e4 &&
    Math.round(lon1 * 1e4) / 1e4 === Math.round(lon2 * 1e4) / 1e4
  );
}

type Props = {
  /** After a search pick or live-location apply (optional collapse parent). */
  onApplied?: () => void;
};

export function ExpandedLocationSettings({ onApplied }: Props) {
  const { session, refreshProfile } = useAuth();
  const { colors, isDark } = useAppTheme();
  const {
    isUsingDiningPreferenceFallback,
    diningPreferenceAreaLabel,
    reloadLocationPrefs,
    setSearchOverride,
    setLiveLocationEnabledPersisted,
    requestLocationPermission,
  } = useLocation();

  const [hydrated, setHydrated] = useState(false);
  const [liveBusy, setLiveBusy] = useState(false);
  const [addressQuery, setAddressQuery] = useState("");
  const [suggestions, setSuggestions] = useState<Suggestion[]>([]);
  const [searching, setSearching] = useState(false);
  const [applyingPick, setApplyingPick] = useState(false);
  const [savedList, setSavedList] = useState<SavedAddressRow[]>([]);
  const [loadingSaved, setLoadingSaved] = useState(true);
  const [savingRowId, setSavingRowId] = useState<string | null>(null);

  const loadSavedAddresses = useCallback(async () => {
    if (!session?.user?.id) {
      setSavedList([]);
      setLoadingSaved(false);
      return;
    }
    setLoadingSaved(true);
    try {
      const { data, error } = await supabase
        .from("profile_saved_addresses")
        .select("id, label, formatted_address, latitude, longitude")
        .eq("user_id", session.user.id)
        .order("created_at", { ascending: false });
      if (error) throw error;
      setSavedList((data ?? []) as SavedAddressRow[]);
    } catch {
      setSavedList([]);
    } finally {
      setLoadingSaved(false);
    }
  }, [session?.user?.id]);

  useEffect(() => {
    let cancelled = false;
    async function boot() {
      if (!session?.user?.id) {
        if (!cancelled) {
          setHydrated(true);
          setLoadingSaved(false);
        }
        return;
      }
      await loadSavedAddresses();
      if (!cancelled) setHydrated(true);
    }
    void boot();
    return () => {
      cancelled = true;
    };
  }, [session?.user?.id, loadSavedAddresses]);

  // Quick search — Nominatim
  useEffect(() => {
    const controller = new AbortController();
    let active = true;
    const t = setTimeout(async () => {
      if (addressQuery.length < 3) {
        if (active) setSuggestions([]);
        return;
      }
      setSearching(true);
      try {
        const res = await fetch(buildTexasNominatimSearchUrl(addressQuery), {
          headers: { "User-Agent": "RasviaApp/1.0" },
          signal: controller.signal,
        });
        const results = (await res.json()) as Array<{
          display_name: string;
          lat: string;
          lon: string;
          address?: Record<string, string>;
        }>;
        if (!active) return;
        const inTexas = results.filter(nominatimResultInTexas).slice(0, 4);
        setSuggestions(
          inTexas.map((r) => ({
            display_name: r.display_name,
            lat: parseFloat(r.lat),
            lon: parseFloat(r.lon),
          }))
        );
      } catch {
        if (active) setSuggestions([]);
      } finally {
        if (active) setSearching(false);
      }
    }, 450);
    return () => {
      active = false;
      controller.abort();
      clearTimeout(t);
    };
  }, [addressQuery]);

  const applyAsCurrentLocation = useCallback(
    async (item: Suggestion) => {
      if (!session?.user?.id) return;
      setApplyingPick(true);
      try {
        const cityLabel = extractCityLabel(item.display_name);
        const coords = { latitude: item.lat, longitude: item.lon };
        await setLiveLocationEnabledPersisted(false);
        const { error } = await supabase
          .from("profiles")
          .update({
            saved_address: item.display_name,
            home_lat: item.lat,
            home_long: item.lon,
            updated_at: new Date().toISOString(),
          })
          .eq("id", session.user.id);
        if (error) throw error;
        setSearchOverride({ coords, label: cityLabel });
        setAddressQuery("");
        setSuggestions([]);
        await reloadLocationPrefs();
        await refreshProfile();
        await loadSavedAddresses();
        if (Platform.OS !== "web") {
          Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
        }
        onApplied?.();
      } catch (e: unknown) {
        Alert.alert("Error", (e as Error)?.message || "Could not use that address.");
      } finally {
        setApplyingPick(false);
      }
    },
    [
      session?.user?.id,
      setSearchOverride,
      setLiveLocationEnabledPersisted,
      reloadLocationPrefs,
      refreshProfile,
      loadSavedAddresses,
      onApplied,
    ]
  );

  const saveSuggestionToList = useCallback(
    async (item: Suggestion) => {
      if (!session?.user?.id) return;
      const key = normalizeAddressKey(item.display_name);
      const dupText = savedList.some((r) => normalizeAddressKey(r.formatted_address) === key);
      const dupCoords = savedList.some((r) => sameRoundedCoords(item.lat, item.lon, r.latitude, r.longitude));
      if (dupText || dupCoords) {
        Alert.alert("Already saved", "That address is already in your saved list.");
        return;
      }
      setSavingRowId(`new-${item.lat}-${item.lon}`);
      try {
        const { error } = await supabase.from("profile_saved_addresses").insert({
          user_id: session.user.id,
          formatted_address: item.display_name,
          latitude: item.lat,
          longitude: item.lon,
          label: null,
        });
        if (error) {
          if ((error as { code?: string }).code === "23505") {
            Alert.alert("Already saved", "That address is already in your saved list.");
            return;
          }
          throw error;
        }
        await loadSavedAddresses();
        await reloadLocationPrefs();
        if (Platform.OS !== "web") {
          Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
        }
      } catch (e: unknown) {
        Alert.alert("Error", (e as Error)?.message || "Could not save that address.");
      } finally {
        setSavingRowId(null);
      }
    },
    [session?.user?.id, savedList, loadSavedAddresses, reloadLocationPrefs]
  );

  const useSavedRow = useCallback(
    async (row: SavedAddressRow) => {
      if (!session?.user?.id) return;
      setSavingRowId(row.id);
      try {
        const cityLabel = extractCityLabel(row.formatted_address);
        const coords = { latitude: row.latitude, longitude: row.longitude };
        await setLiveLocationEnabledPersisted(false);
        const { error } = await supabase
          .from("profiles")
          .update({
            saved_address: row.formatted_address,
            home_lat: row.latitude,
            home_long: row.longitude,
            updated_at: new Date().toISOString(),
          })
          .eq("id", session.user.id);
        if (error) throw error;
        setSearchOverride({ coords, label: cityLabel });
        await reloadLocationPrefs();
        await refreshProfile();
        if (Platform.OS !== "web") {
          Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
        }
        onApplied?.();
      } catch (e: unknown) {
        Alert.alert("Error", (e as Error)?.message || "Could not use that saved address.");
      } finally {
        setSavingRowId(null);
      }
    },
    [
      session?.user?.id,
      setSearchOverride,
      setLiveLocationEnabledPersisted,
      reloadLocationPrefs,
      refreshProfile,
      onApplied,
    ]
  );

  const deleteSavedRow = useCallback(
    (row: SavedAddressRow) => {
      if (!session?.user?.id) return;
      Alert.alert("Remove address", `Remove “${row.label || row.formatted_address.slice(0, 48)}…” from saved?`, [
        { text: "Cancel", style: "cancel" },
        {
          text: "Remove",
          style: "destructive",
          onPress: () => {
            void (async () => {
              try {
                const { error } = await supabase
                  .from("profile_saved_addresses")
                  .delete()
                  .eq("id", row.id)
                  .eq("user_id", session.user!.id);
                if (error) throw error;
                await loadSavedAddresses();
                await reloadLocationPrefs();
                if (Platform.OS !== "web") {
                  Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
                }
              } catch (e: unknown) {
                Alert.alert("Error", (e as Error)?.message || "Could not remove that address.");
              }
            })();
          },
        },
      ]);
    },
    [session?.user?.id, loadSavedAddresses, reloadLocationPrefs]
  );

  const applyLiveLocationNow = useCallback(async () => {
    setLiveBusy(true);
    try {
      const granted = await requestLocationPermission();
      if (!granted) {
        Alert.alert("Location access", "Please enable location access in your device settings.");
        return;
      }
      const loc = await Location.getCurrentPositionAsync({ accuracy: Location.Accuracy.Balanced });
      const coords = { latitude: loc.coords.latitude, longitude: loc.coords.longitude };
      let label: string | null = null;
      try {
        const geo = await Location.reverseGeocodeAsync(coords);
        if (geo?.length) label = geo[0].city || geo[0].subregion || null;
      } catch {
        /* ignore */
      }
      await setLiveLocationEnabledPersisted(false);
      setSearchOverride({ coords, label });
      setAddressQuery("");
      setSuggestions([]);
      await reloadLocationPrefs();
      await refreshProfile();
      if (Platform.OS !== "web") {
        Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
      }
      onApplied?.();
    } catch (e: unknown) {
      Alert.alert("Error", (e as Error)?.message || "Could not read your location.");
    } finally {
      setLiveBusy(false);
    }
  }, [
    requestLocationPermission,
    setLiveLocationEnabledPersisted,
    setSearchOverride,
    reloadLocationPrefs,
    refreshProfile,
    onApplied,
  ]);

  if (!hydrated) {
    return (
      <View style={{ paddingVertical: 20, alignItems: "center" }}>
        <ActivityIndicator color={colors.saffron} />
      </View>
    );
  }

  const dividerColor = colors.cardBorder;
  const suggestionRowBorder = colors.cardBorder;

  return (
    <Animated.View entering={FadeInDown.duration(250)}>
      <Text
        style={{
          fontFamily: "Manrope_600SemiBold",
          color: colors.textMuted,
          fontSize: 11,
          letterSpacing: 0.6,
          textTransform: "uppercase",
          marginBottom: 10,
        }}
      >
        Where you’re ordering from
      </Text>

      <Pressable
        onPress={() => void applyLiveLocationNow()}
        disabled={liveBusy}
        style={{
          flexDirection: "row",
          alignItems: "center",
          justifyContent: "center",
          gap: 10,
          backgroundColor: isDark ? "rgba(255,153,51,0.12)" : "rgba(255,153,51,0.1)",
          borderWidth: 1,
          borderColor: isDark ? "rgba(255,153,51,0.35)" : "rgba(255,153,51,0.28)",
          borderRadius: 14,
          paddingVertical: 12,
          paddingHorizontal: 14,
          opacity: liveBusy ? 0.7 : 1,
        }}
      >
        {liveBusy ? (
          <ActivityIndicator color={colors.saffron} />
        ) : (
          <Crosshair size={18} color={colors.saffron} />
        )}
        <Text style={{ fontFamily: "Manrope_700Bold", color: colors.saffron, fontSize: 15 }}>
          Use current location
        </Text>
      </Pressable>
      <Text
        style={{
          fontFamily: "Manrope_500Medium",
          color: colors.textMuted,
          fontSize: 11,
          marginTop: 8,
          lineHeight: 15,
        }}
      >
        Overrides the map and nearby results with a one-time GPS fix (continuous tracking is off).
      </Text>

      <View
        style={{
          height: 1,
          backgroundColor: dividerColor,
          marginVertical: 14,
        }}
      />

      <Text style={{ fontFamily: "Manrope_600SemiBold", color: colors.textMuted, fontSize: 12, marginBottom: 8 }}>
        Search address
      </Text>
      <View style={{ flexDirection: "row", alignItems: "center", gap: 10 }}>
        <View
          style={{
            flex: 1,
            flexDirection: "row",
            alignItems: "center",
            backgroundColor: colors.backgroundElevated,
            borderRadius: 14,
            borderWidth: 1,
            borderColor: colors.cardBorder,
            paddingHorizontal: 12,
            height: 44,
          }}
        >
          <Search size={16} color={colors.iconMuted} />
          <TextInput
            style={{
              flex: 1,
              color: colors.text,
              fontFamily: "Manrope_500Medium",
              fontSize: 14,
              marginLeft: 8,
            }}
            placeholder="Search and pick a result…"
            placeholderTextColor={colors.textMuted}
            value={addressQuery}
            onChangeText={setAddressQuery}
            autoCorrect={false}
            keyboardAppearance={isDark ? "dark" : "light"}
            returnKeyType="search"
          />
          {addressQuery.length > 0 && (
            <Pressable
              onPress={() => {
                setAddressQuery("");
                setSuggestions([]);
              }}
              hitSlop={10}
            >
              <X size={16} color={colors.iconMuted} />
            </Pressable>
          )}
        </View>
      </View>
      {searching && (
        <Text style={{ color: colors.textMuted, fontSize: 11, fontFamily: "Manrope_500Medium", marginTop: 8 }}>
          Searching…
        </Text>
      )}
      {suggestions.length > 0 && (
        <View
          style={{
            backgroundColor: colors.card,
            borderRadius: 12,
            borderWidth: 1,
            borderColor: colors.cardBorder,
            marginTop: 10,
            overflow: "hidden",
            maxHeight: 220,
          }}
        >
          <ScrollView nestedScrollEnabled keyboardShouldPersistTaps="handled">
            {suggestions.map((item, idx) => (
              <View
                key={`${item.lat}-${item.lon}-${idx}`}
                style={{
                  flexDirection: "row",
                  alignItems: "center",
                  borderBottomWidth: idx < suggestions.length - 1 ? 1 : 0,
                  borderColor: suggestionRowBorder,
                  opacity: applyingPick ? 0.5 : 1,
                }}
              >
                <Pressable
                  style={{ flex: 1, padding: 12 }}
                  disabled={applyingPick}
                  onPress={() => {
                    if (Platform.OS !== "web") Haptics.selectionAsync();
                    void applyAsCurrentLocation(item);
                  }}
                >
                  <View style={{ flexDirection: "row", alignItems: "flex-start", gap: 8 }}>
                    <MapPin size={14} color={colors.saffron} style={{ marginTop: 2 }} />
                    <Text
                      style={{
                        flex: 1,
                        color: colors.text,
                        fontFamily: "Manrope_500Medium",
                        fontSize: 13,
                        lineHeight: 18,
                      }}
                    >
                      {item.display_name}
                    </Text>
                  </View>
                </Pressable>
                <Pressable
                  onPress={() => {
                    if (Platform.OS !== "web") Haptics.selectionAsync();
                    void saveSuggestionToList(item);
                  }}
                  disabled={savingRowId != null}
                  style={{
                    paddingHorizontal: 12,
                    paddingVertical: 12,
                    borderLeftWidth: 1,
                    borderLeftColor: suggestionRowBorder,
                  }}
                  hitSlop={8}
                >
                  <BookmarkPlus
                    size={20}
                    color={
                      savingRowId === `new-${item.lat}-${item.lon}`
                        ? colors.iconMuted
                        : colors.saffron
                    }
                  />
                </Pressable>
              </View>
            ))}
          </ScrollView>
        </View>
      )}
      {applyingPick && (
        <View style={{ flexDirection: "row", alignItems: "center", justifyContent: "center", marginTop: 10, gap: 8 }}>
          <ActivityIndicator size="small" color={colors.saffron} />
          <Text style={{ color: colors.textMuted, fontFamily: "Manrope_500Medium", fontSize: 12 }}>Applying…</Text>
        </View>
      )}

      <View
        style={{
          height: 1,
          backgroundColor: dividerColor,
          marginVertical: 14,
        }}
      />

      {isUsingDiningPreferenceFallback && (
        <View
          style={{
            marginBottom: 12,
            borderRadius: 10,
            borderWidth: 1,
            borderColor: isDark ? "rgba(255,153,51,0.24)" : "rgba(255,153,51,0.22)",
            backgroundColor: isDark ? "rgba(255,153,51,0.08)" : "rgba(255,153,51,0.06)",
            paddingHorizontal: 10,
            paddingVertical: 8,
          }}
        >
          <Text
            style={{
              fontFamily: "Manrope_500Medium",
              color: isDark ? "#FFB566" : "#c2410c",
              fontSize: 12,
              lineHeight: 16,
            }}
          >
            {`No saved address — using your dining preference area${diningPreferenceAreaLabel ? ` (${diningPreferenceAreaLabel})` : ""}.`}
          </Text>
        </View>
      )}

      <Text style={{ fontFamily: "Manrope_600SemiBold", color: colors.textMuted, fontSize: 12, marginBottom: 8 }}>
        Saved addresses
      </Text>
      {loadingSaved ? (
        <View style={{ paddingVertical: 16, alignItems: "center" }}>
          <ActivityIndicator color={colors.saffron} size="small" />
        </View>
      ) : savedList.length === 0 ? (
        <Text style={{ fontFamily: "Manrope_500Medium", color: colors.textMuted, fontSize: 13, lineHeight: 18 }}>
          No saved addresses yet. Tap the bookmark on a search result to save one here.
        </Text>
      ) : (
        <View style={{ gap: 8 }}>
          {savedList.map((row) => (
            <View
              key={row.id}
              style={{
                backgroundColor: colors.backgroundElevated,
                borderRadius: 12,
                borderWidth: 1,
                borderColor: colors.cardBorder,
                flexDirection: "row",
                alignItems: "center",
                overflow: "hidden",
              }}
            >
              <Pressable
                onPress={() => void useSavedRow(row)}
                disabled={savingRowId != null}
                style={{ flex: 1, padding: 12 }}
              >
                {row.label ? (
                  <Text
                    style={{
                      fontFamily: "Manrope_700Bold",
                      color: colors.text,
                      fontSize: 14,
                      marginBottom: 4,
                    }}
                    numberOfLines={1}
                  >
                    {row.label}
                  </Text>
                ) : null}
                <Text
                  style={{
                    fontFamily: "Manrope_500Medium",
                    color: colors.textSecondary,
                    fontSize: 12,
                    lineHeight: 16,
                  }}
                  numberOfLines={2}
                >
                  {row.formatted_address}
                </Text>
              </Pressable>
              <View style={{ flexDirection: "row", alignItems: "center" }}>
                <Pressable
                  onPress={() => void useSavedRow(row)}
                  disabled={savingRowId === row.id}
                  style={{
                    paddingVertical: 12,
                    paddingHorizontal: 10,
                  }}
                >
                  {savingRowId === row.id ? (
                    <ActivityIndicator size="small" color={colors.saffron} />
                  ) : (
                    <Text style={{ fontFamily: "Manrope_700Bold", color: colors.saffron, fontSize: 12 }}>Use</Text>
                  )}
                </Pressable>
                <Pressable
                  onPress={() => deleteSavedRow(row)}
                  style={{ paddingVertical: 12, paddingHorizontal: 12 }}
                  hitSlop={8}
                >
                  <Trash2 size={18} color={colors.iconMuted} />
                </Pressable>
              </View>
            </View>
          ))}
        </View>
      )}
    </Animated.View>
  );
}
