import React, { createContext, useContext, useEffect, useRef, useState, useCallback } from "react";
import * as Location from "expo-location";
import * as SecureStore from 'expo-secure-store';
import { supabase } from "@/lib/supabase";
import { useAuth } from "@/lib/auth-context";

interface LocationContextType {
    userCoords: { latitude: number; longitude: number } | null;
    isLiveLocationEnabled: boolean;
    locationLabel: string | null;
    hasSavedAddress: boolean;
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
}

const LocationContext = createContext<LocationContextType>({
    userCoords: null,
    isLiveLocationEnabled: true,
    locationLabel: null,
    hasSavedAddress: false,
    reloadLocationPrefs: async () => {},
    setUserCoordsOverride: () => {},
    setSearchOverride: () => {},
    hasSearchOverride: false,
    requestLocationPermission: async () => false,
});

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
    const [savedAddress, setSavedAddress] = useState<string | null>(null);
    const [hasSavedAddress, setHasSavedAddress] = useState(false);
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

    const reloadLocationPrefs = useCallback(async () => {
        try {
            const localToggle = await SecureStore.getItemAsync("live_location_enabled");
            let liveEnabled = true;
            if (localToggle !== null) {
                liveEnabled = JSON.parse(localToggle);
                setIsLiveLocationEnabled(liveEnabled);
            } else {
                setIsLiveLocationEnabled(true);
            }

            // While a transient front-page override is active we still want to
            // refresh `hasSavedAddress` / `savedAddress` from the profile, but
            // we must NOT overwrite the user's pinned coords or label.
            const overrideActive = searchOverrideRef.current != null;

            if (session?.user?.id) {
                const { data, error } = await supabase
                    .from("profiles")
                    .select("home_lat, home_long, saved_address")
                    .eq("id", session.user.id)
                    .maybeSingle();

                if (!error && data) {
                    const addr = data.saved_address || null;
                    setSavedAddress(addr);

                    // Prefer stored GPS coords (saved address)
                    if (data.home_lat && data.home_long) {
                        const coords = {
                            latitude: data.home_lat,
                            longitude: data.home_long,
                        };
                        setHasSavedAddress(true);

                        if (!liveEnabled && !overrideActive) {
                            setUserCoords(coords);
                            const label = addr ? extractCity(addr) : await reverseGeocodeLabel(coords);
                            setLocationLabel(label);
                        }
                    } else {
                        // No GPS stored — fall back to onboarding city
                        setHasSavedAddress(false);
                        const { data: profileData } = await supabase
                            .from("profiles")
                            .select("location_city")
                            .eq("id", session!.user!.id)
                            .maybeSingle();

                        const locationCity = profileData?.location_city as string | undefined;
                        if (locationCity) {
                            const cityLabel = locationCity.split(",")[0].trim();
                            if (!liveEnabled && !overrideActive) {
                                setLocationLabel(cityLabel);
                                const cityCenter = CITY_CENTERS[locationCity];
                                if (cityCenter) {
                                    setUserCoords(cityCenter);
                                }
                            }
                        } else if (addr && !liveEnabled && !overrideActive) {
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

        if (!isLiveLocationEnabled) {
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
    }, [isLiveLocationEnabled, isLoaded, locationPermissionGranted]);

    return (
        <LocationContext.Provider value={{
            userCoords,
            isLiveLocationEnabled,
            locationLabel,
            hasSavedAddress,
            reloadLocationPrefs,
            setUserCoordsOverride: setUserCoords,
            setSearchOverride,
            hasSearchOverride: searchOverride != null,
            requestLocationPermission,
        }}>
            {children}
        </LocationContext.Provider>
    );
}

export function useLocation() {
    return useContext(LocationContext);
}
