import React, { createContext, useContext, useEffect, useMemo, useRef, useState, useCallback } from "react";
import * as Location from "expo-location";
import * as SecureStore from 'expo-secure-store';
import { supabase } from "@/lib/supabase";
import { useAuth } from "@/lib/auth-context";

interface LocationContextType {
    userCoords: { latitude: number; longitude: number } | null;
    isLiveLocationEnabled: boolean;
    locationLabel: string | null;
    hasSavedAddress: boolean;
    savedAddressOverridesGps: boolean;
    /** Onboarding / profile `location_city` (e.g. "Dallas, TX"), when set. */
    diningPreferenceAreaLabel: string | null;
    /**
     * True when live GPS is off, there is no saved address on the profile or in
     * saved-address list, the user has a dining-preference city, and no transient search override is active.
     */
    isUsingDiningPreferenceFallback: boolean;
    reloadLocationPrefs: () => Promise<void>;
    setUserCoordsOverride: (coords: {latitude: number; longitude: number} | null) => void;
    /**
     * Pin the user's effective location to a typed-in address regardless of
     * the live-location toggle, without persisting anything to the profile.
     * Pass `null` to clear the override and revert to the previously
     * configured behaviour (live GPS or saved address).
     */
    setSearchOverride: (
        override:
            | { coords: { latitude: number; longitude: number }; label: string | null }
            | null,
    ) => void;
    /** True while a transient front-page address override is in effect. */
    hasSearchOverride: boolean;
    /** Request location permission from the user. Returns true if granted. Call this only on user interaction (e.g. map open, detect-location button). */
    requestLocationPermission: () => Promise<boolean>;
    setLiveLocationEnabledPersisted: (enabled: boolean) => Promise<void>;
    setSavedAddressOverridePersisted: (enabled: boolean) => Promise<void>;
}

const LocationContext = createContext<LocationContextType>({
    userCoords: null,
    isLiveLocationEnabled: true,
    locationLabel: null,
    hasSavedAddress: false,
    savedAddressOverridesGps: true,
    diningPreferenceAreaLabel: null,
    isUsingDiningPreferenceFallback: false,
    reloadLocationPrefs: async () => {},
    setUserCoordsOverride: () => {},
    setSearchOverride: () => {},
    hasSearchOverride: false,
    requestLocationPermission: async () => false,
    setLiveLocationEnabledPersisted: async () => {},
    setSavedAddressOverridePersisted: async () => {},
});

const LIVE_LOCATION_ENABLED_KEY = "live_location_enabled";
const SAVED_ADDRESS_OVERRIDE_KEY = "saved_address_overrides_gps";

async function reverseGeocodeLabel(coords: { latitude: number; longitude: number }): Promise<string | null> {
    try {
        const results = await Location.reverseGeocodeAsync(coords);
        if (results && results.length > 0) {
            const r = results[0];
            return r.city || null;
        }
    } catch {
        // silently ignore geocoding errors
    }
    return null;
}

/**
 * Extract the city from a Nominatim display_name string.
 * Format: "Name, Street, City, County, State, ZIP, Country"
 * The city is always the segment immediately before the "County" segment.
 */
function extractCity(address: string): string {
    const parts = address.split(",").map((p) => p.trim());
    const countyIdx = parts.findIndex((p) => /county|parish/i.test(p));
    if (countyIdx > 0) return parts[countyIdx - 1];
    // Fallback: second segment, or first if only one
    return parts[1] ?? parts[0];
}

// City center coordinates for DFW cities (used as fallback when GPS is unavailable)
const CITY_CENTERS: Record<string, { latitude: number; longitude: number }> = {
    "Frisco, TX":        { latitude: 33.1507, longitude: -96.8236 },
    "Plano, TX":         { latitude: 33.0198, longitude: -96.6989 },
    "Irving, TX":        { latitude: 32.8140, longitude: -96.9489 },
    "Dallas, TX":        { latitude: 32.7767, longitude: -96.7970 },
    "Fort Worth, TX":    { latitude: 32.7555, longitude: -97.3308 },
    "Richardson, TX":    { latitude: 32.9483, longitude: -96.7298 },
    "Allen, TX":         { latitude: 33.1032, longitude: -96.6706 },
    "McKinney, TX":      { latitude: 33.1972, longitude: -96.6397 },
    "Carrollton, TX":    { latitude: 32.9537, longitude: -96.8903 },
    "Denton, TX":        { latitude: 33.2148, longitude: -97.1331 },
    "Arlington, TX":     { latitude: 32.7357, longitude: -97.1081 },
    "Garland, TX":       { latitude: 32.9126, longitude: -96.6389 },
    "Grapevine, TX":     { latitude: 32.9343, longitude: -97.0781 },
    "Southlake, TX":     { latitude: 32.9412, longitude: -97.1339 },
    "Coppell, TX":       { latitude: 32.9546, longitude: -97.0150 },
    "Prosper, TX":       { latitude: 33.2362, longitude: -96.8008 },
    "Lewisville, TX":    { latitude: 33.0462, longitude: -97.0072 },
    "Flower Mound, TX": { latitude: 33.0145, longitude: -97.0961 },
    "The Colony, TX":    { latitude: 33.0862, longitude: -96.8897 },
    "Little Elm, TX":    { latitude: 33.1626, longitude: -96.9375 },
};

export function LocationProvider({ children }: { children: React.ReactNode }) {
    const { session } = useAuth();
    const [userCoords, setUserCoords] = useState<{
        latitude: number;
        longitude: number;
    } | null>(null);
    const [isLiveLocationEnabled, setIsLiveLocationEnabled] = useState(false);
    const [isLoaded, setIsLoaded] = useState(false);
    const [locationLabel, setLocationLabel] = useState<string | null>(null);
    const [hasSavedAddress, setHasSavedAddress] = useState(false);
    const [savedAddressOverridesGps, setSavedAddressOverridesGps] = useState(true);
    const [diningPreferenceAreaLabel, setDiningPreferenceAreaLabel] = useState<string | null>(null);
    const liveRefreshIntervalRef = useRef<ReturnType<typeof setInterval> | null>(null);
    /** Tracks whether location permission has been granted (without triggering prompts). */
    const [locationPermissionGranted, setLocationPermissionGranted] = useState(false);
    /**
     * Transient front-page address override. While truthy, all background
     * location refreshes (live GPS, periodic city refresh, profile reloads)
     * are suppressed so the typed address stays pinned. Cleared explicitly
     * via `setSearchOverride(null)`.
     */
    const [searchOverride, setSearchOverrideState] = useState<{
        coords: { latitude: number; longitude: number };
        label: string | null;
    } | null>(null);
    const searchOverrideRef = useRef(searchOverride);
    useEffect(() => {
        searchOverrideRef.current = searchOverride;
    }, [searchOverride]);

    const setSearchOverride = useCallback(
        (
            override:
                | { coords: { latitude: number; longitude: number }; label: string | null }
                | null,
        ) => {
            setSearchOverrideState(override);
            if (override) {
                setUserCoords(override.coords);
                if (override.label) setLocationLabel(override.label);
            }
        },
        [],
    );

    /**
     * On-demand location permission request. Call this when the user explicitly
     * interacts with a location feature (e.g. tapping the detect-location button
     * or opening the map screen). This is the ONLY place permissions are prompted.
     */
    const requestLocationPermission = useCallback(async (): Promise<boolean> => {
        try {
            const { status } = await Location.requestForegroundPermissionsAsync();
            const granted = status === 'granted';
            setLocationPermissionGranted(granted);
            return granted;
        } catch {
            return false;
        }
    }, []);

    const setLiveLocationEnabledPersisted = useCallback(async (enabled: boolean) => {
        setIsLiveLocationEnabled(enabled);
        await SecureStore.setItemAsync(LIVE_LOCATION_ENABLED_KEY, JSON.stringify(enabled));
    }, []);

    const setSavedAddressOverridePersisted = useCallback(async (enabled: boolean) => {
        setSavedAddressOverridesGps(enabled);
        await SecureStore.setItemAsync(SAVED_ADDRESS_OVERRIDE_KEY, JSON.stringify(enabled));
    }, []);

    const reloadLocationPrefs = useCallback(async () => {
        try {
            const localToggle = await SecureStore.getItemAsync(LIVE_LOCATION_ENABLED_KEY);
            let liveEnabled = true;
            if (localToggle !== null) {
                liveEnabled = JSON.parse(localToggle);
                setIsLiveLocationEnabled(liveEnabled);
            } else {
                setIsLiveLocationEnabled(true);
            }
            const overrideToggle = await SecureStore.getItemAsync(SAVED_ADDRESS_OVERRIDE_KEY);
            let savedOverride = true;
            if (overrideToggle !== null) {
                savedOverride = JSON.parse(overrideToggle);
            }
            setSavedAddressOverridesGps(savedOverride);

            // While a transient front-page override is active we still want to
            // refresh `hasSavedAddress` / `savedAddress` from the profile, but
            // we must NOT overwrite the user's pinned coords or label.
            const overrideActive = searchOverrideRef.current != null;

            if (!session?.user?.id) {
                setDiningPreferenceAreaLabel(null);
            }

            if (session?.user?.id) {
                const { data, error } = await supabase
                    .from("profiles")
                    .select("home_lat, home_long, saved_address, location_city")
                    .eq("id", session.user.id)
                    .maybeSingle();

                const { count: savedAddrRowCount, error: savedAddrCountErr } = await supabase
                    .from("profile_saved_addresses")
                    .select("id", { count: "exact", head: true })
                    .eq("user_id", session.user.id);

                if (!error && data) {
                    const addr = data.saved_address || null;
                    const hasCoords = Boolean(data.home_lat && data.home_long);
                    const hasSavedAddr = Boolean(addr && addr.trim().length > 0);
                    const hasSavedAddrList =
                        !savedAddrCountErr && savedAddrRowCount != null && savedAddrRowCount > 0;
                    setHasSavedAddress(hasCoords || hasSavedAddr || hasSavedAddrList);

                    const locationCityRaw = (data.location_city as string | undefined)?.trim() || null;
                    setDiningPreferenceAreaLabel(locationCityRaw);

                    // Prefer stored GPS coords when present.
                    if (hasCoords) {
                        const coords = {
                            latitude: data.home_lat,
                            longitude: data.home_long,
                        };

                        // Saved address coordinates should always drive app/map
                        // when live GPS is disabled. When live GPS is enabled,
                        // the override toggle decides whether saved coords or
                        // live coords are used.
                        if (!overrideActive && (!liveEnabled || savedOverride)) {
                            setUserCoords(coords);
                            const label = addr ? extractCity(addr) : await reverseGeocodeLabel(coords);
                            setLocationLabel(label);
                        }
                    } else {
                        // No GPS coords stored.
                        if (!overrideActive && hasSavedAddr && (!liveEnabled || savedOverride)) {
                            // Address-only saved location (no coords yet) still
                            // provides a location label. (Map coordinates are
                            // unavailable until geocoded/saved with coords.)
                            setLocationLabel(extractCity(addr!));
                        }

                        // Fall back to onboarding city only when we are not
                        // meant to use a saved location.
                        const locationCity = locationCityRaw;
                        if (locationCity) {
                            const cityLabel = locationCity.split(",")[0].trim();
                            if (!liveEnabled && !overrideActive && !hasSavedAddr) {
                                setLocationLabel(cityLabel);
                                const cityCenter = CITY_CENTERS[locationCity];
                                if (cityCenter) {
                                    setUserCoords(cityCenter);
                                }
                            }
                        } else if (addr && !liveEnabled && !overrideActive && !hasSavedAddr) {
                            setLocationLabel(extractCity(addr));
                        }
                    }
                }
            }
        } catch (err) {
            console.warn("Error fetching location prefs:", err);
        } finally {
            setIsLoaded(true);
        }
    }, [session]);

    useEffect(() => {
        reloadLocationPrefs();
    }, [reloadLocationPrefs]);

    useEffect(() => {
        if (!isLoaded) return;
        
        let subscription: Location.LocationSubscription | null = null;
        let isActive = true;

        // Clear any existing label refresh interval
        if (liveRefreshIntervalRef.current) {
            clearInterval(liveRefreshIntervalRef.current);
            liveRefreshIntervalRef.current = null;
        }

        // Live GPS runs only when the live toggle is on AND saved-address
        // override is not active.
        if (!isLiveLocationEnabled || (savedAddressOverridesGps && hasSavedAddress)) {
            return;
        }

        const updateCoordsAndLabel = async (coords: { latitude: number; longitude: number }) => {
            if (!isActive) return;
            // Front-page typed-address override always wins over live GPS until
            // the user explicitly clears it.
            if (searchOverrideRef.current) return;
            setUserCoords(coords);
            const label = await reverseGeocodeLabel(coords);
            if (isActive && label) setLocationLabel(label);
        };

        (async () => {
            // Check-only: do NOT prompt the user. If permission isn't granted yet,
            // fall back to saved address / city center. The user can grant it later
            // by tapping detect-location or opening the map.
            const { status } = await Location.getForegroundPermissionsAsync();
            if (!isActive || status !== "granted") {
                if (status !== "granted") console.warn("📍 Location permission not yet granted — using fallback");
                return;
            }
            setLocationPermissionGranted(true);

            try {
                // Get initial position with Balanced accuracy to reduce timeout/simulator exceptions
                let loc = await Location.getCurrentPositionAsync({
                    accuracy: Location.Accuracy.Balanced,
                });
                
                if (!isActive) return;

                const coords = {
                    latitude: loc.coords.latitude,
                    longitude: loc.coords.longitude,
                };

                await updateCoordsAndLabel(coords);

                // Watch for significant location changes (updates every ~150m movement)
                subscription = await Location.watchPositionAsync(
                    {
                        accuracy: Location.Accuracy.Balanced,
                        distanceInterval: 150, // meters before triggering update
                    },
                    (newLoc) => {
                        if (isActive) {
                            updateCoordsAndLabel({
                                latitude: newLoc.coords.latitude,
                                longitude: newLoc.coords.longitude,
                            });
                        }
                    },
                );

                // Refresh label every 30 seconds for live location
                liveRefreshIntervalRef.current = setInterval(async () => {
                    if (!isActive) return;
                    try {
                        const fresh = await Location.getCurrentPositionAsync({
                            accuracy: Location.Accuracy.Balanced,
                        });
                        await updateCoordsAndLabel({
                            latitude: fresh.coords.latitude,
                            longitude: fresh.coords.longitude,
                        });
                    } catch {
                        // silently ignore periodic refresh errors
                    }
                }, 60_000);
            } catch (error) {
                console.warn("Location error, attempting fallback:", error);
                try {
                    const fallback = await Location.getLastKnownPositionAsync();
                    if (fallback && isActive) {
                        await updateCoordsAndLabel({
                            latitude: fallback.coords.latitude,
                            longitude: fallback.coords.longitude,
                        });
                    }
                } catch (fallbackErr) {
                    console.error("Total location failure:", fallbackErr);
                }
            }
        })();

        return () => {
            isActive = false;
            subscription?.remove();
            if (liveRefreshIntervalRef.current) {
                clearInterval(liveRefreshIntervalRef.current);
                liveRefreshIntervalRef.current = null;
            }
        };
    }, [isLiveLocationEnabled, isLoaded, locationPermissionGranted, savedAddressOverridesGps, hasSavedAddress]);

    const isUsingDiningPreferenceFallback = useMemo(
        () =>
            !isLiveLocationEnabled &&
            !hasSavedAddress &&
            Boolean(diningPreferenceAreaLabel?.trim()) &&
            searchOverride == null,
        [isLiveLocationEnabled, hasSavedAddress, diningPreferenceAreaLabel, searchOverride],
    );

    return (
        <LocationContext.Provider value={{
            userCoords,
            isLiveLocationEnabled,
            locationLabel,
            hasSavedAddress,
            savedAddressOverridesGps,
            diningPreferenceAreaLabel,
            isUsingDiningPreferenceFallback,
            reloadLocationPrefs,
            setUserCoordsOverride: setUserCoords,
            setSearchOverride,
            hasSearchOverride: searchOverride != null,
            requestLocationPermission,
            setLiveLocationEnabledPersisted,
            setSavedAddressOverridePersisted,
        }}>
            {children}
        </LocationContext.Provider>
    );
}

export function useLocation() {
    return useContext(LocationContext);
}
