import React, {
  useState,
  useEffect,
  useRef,
  useCallback,
  useMemo,
} from "react";
import {
  View,
  Text,
  TextInput,
  Pressable,
  Alert,
  Platform,
  Dimensions,
  ActivityIndicator,
  Image,
  ScrollView,
  Animated as RNAnimated,
  PanResponder,
} from "react-native";
import { SafeAreaView, useSafeAreaInsets } from "react-native-safe-area-context";
import { useRouter, useLocalSearchParams } from "expo-router";
import MapView, { Marker, Callout, Region } from "react-native-maps";
import * as Location from "expo-location";
import {
  ArrowLeft,
  LocateFixed,
  Compass,
  Clock,
  Users,
  MapPin,
  Search,
  X,
  Home,
  ArrowUpDown,
  Plus,
} from "lucide-react-native";
import * as Haptics from "expo-haptics";
import Animated, { FadeIn, FadeInDown, FadeInUp, FadeOut, LinearTransition } from "react-native-reanimated";
import { supabase } from "@/lib/supabase";
import {
  type SupabaseRestaurant,
  type UIRestaurant,
  type WaitStatus,
  mapSupabaseToUI,
} from "@/lib/restaurant-types";
import { useLocation } from "@/lib/location-context";
import { useClosedRestaurantIds } from "@/hooks/useClosedRestaurantIds";
import { useAdminMode } from "@/hooks/useAdminMode";
import { AddRestaurantModal } from "@/components/AddRestaurantModal";
import { AdminRestaurantPanel } from "@/components/AdminRestaurantPanel";

const { width: SCREEN_WIDTH } = Dimensions.get("window");

// Zoom threshold: below this latDelta = "zoomed in" (show cards), above = "zoomed out" (show dots)
const ZOOM_THRESHOLD = 0.08;
// Clustering active only when zoomed in somewhat (approx < 8 miles span)
const CLUSTERING_THRESHOLD = 0.12;

// Cluster radius for "Discover Nearby" — restaurants within 3 miles of each other
const NEARBY_CLUSTER_RADIUS_MILES = 3;

// Wait-status colors (matches WaitBadge)
const STATUS_COLORS: Record<string, string> = {
  green: "#22C55E",
  amber: "#F59E0B",
  red: "#EF4444",
  grey: "#888888",
  darkgrey: "#555555",
  purple: "#A855F7",
};
const STATUS_BG: Record<string, string> = {
  green: "rgba(34, 197, 94, 0.2)",
  amber: "rgba(245, 158, 11, 0.2)",
  red: "rgba(239, 68, 68, 0.2)",
  grey: "rgba(136, 136, 136, 0.2)",
  darkgrey: "rgba(85, 85, 85, 0.2)",
  purple: "rgba(168, 85, 247, 0.2)",
};


// Google Maps dark style (Android only — Apple Maps uses userInterfaceStyle)
const GOOGLE_MAPS_DARK_STYLE = [
  { elementType: "geometry", stylers: [{ color: "#212121" }] },
  { elementType: "labels.icon", stylers: [{ visibility: "off" }] },
  { elementType: "labels.text.fill", stylers: [{ color: "#757575" }] },
  { elementType: "labels.text.stroke", stylers: [{ color: "#212121" }] },
  { featureType: "administrative", elementType: "geometry", stylers: [{ color: "#757575" }] },
  { featureType: "administrative.country", elementType: "labels.text.fill", stylers: [{ color: "#9e9e9e" }] },
  { featureType: "administrative.land_parcel", stylers: [{ visibility: "off" }] },
  { featureType: "administrative.locality", elementType: "labels.text.fill", stylers: [{ color: "#bdbdbd" }] },
  { featureType: "poi", elementType: "labels.text.fill", stylers: [{ color: "#757575" }] },
  { featureType: "poi.park", elementType: "geometry", stylers: [{ color: "#181818" }] },
  { featureType: "poi.park", elementType: "labels.text.fill", stylers: [{ color: "#616161" }] },
  { featureType: "poi.park", elementType: "labels.text.stroke", stylers: [{ color: "#1b1b1b" }] },
  { featureType: "road", elementType: "geometry.fill", stylers: [{ color: "#2c2c2c" }] },
  { featureType: "road", elementType: "labels.text.fill", stylers: [{ color: "#8a8a8a" }] },
  { featureType: "road.arterial", elementType: "geometry", stylers: [{ color: "#373737" }] },
  { featureType: "road.highway", elementType: "geometry", stylers: [{ color: "#3c3c3c" }] },
  { featureType: "road.highway.controlled_access", elementType: "geometry", stylers: [{ color: "#4e4e4e" }] },
  { featureType: "road.local", elementType: "labels.text.fill", stylers: [{ color: "#616161" }] },
  { featureType: "transit", elementType: "labels.text.fill", stylers: [{ color: "#757575" }] },
  { featureType: "water", elementType: "geometry", stylers: [{ color: "#000000" }] },
  { featureType: "water", elementType: "labels.text.fill", stylers: [{ color: "#3d3d3d" }] },
];

// Default region (fallback if location unavailable)
const DEFAULT_REGION: Region = {
  latitude: 32.7767,
  longitude: -96.7970,
  latitudeDelta: 0.08,
  longitudeDelta: 0.08,
};

// ==============================
// Cluster type
// ==============================
type Cluster = {
  id: string;
  latitude: number;
  longitude: number;
  restaurants: UIRestaurant[];
};

// Distance-based greedy clustering
function clusterRestaurants(
  restaurants: UIRestaurant[],
  latDelta: number,
): Cluster[] {
  // Cluster radius in degrees — proportional to visible area
  const radius = latDelta * 0.35;
  const used = new Set<string>();
  const clusters: Cluster[] = [];

  for (const r of restaurants) {
    if (used.has(r.id)) continue;
    // Start new cluster with this restaurant
    const group: UIRestaurant[] = [r];
    used.add(r.id);

    // Find all un-clustered restaurants within radius
    for (const other of restaurants) {
      if (used.has(other.id)) continue;
      const dLat = Math.abs(r.lat! - other.lat!);
      const dLon = Math.abs(r.long! - other.long!);
      if (dLat < radius && dLon < radius) {
        group.push(other);
        used.add(other.id);
      }
    }

    const avgLat = group.reduce((s, x) => s + x.lat!, 0) / group.length;
    const avgLong = group.reduce((s, x) => s + x.long!, 0) / group.length;
    clusters.push({
      id: group.map((x) => x.id).join("-"),
      latitude: avgLat,
      longitude: avgLong,
      restaurants: group,
    });
  }
  return clusters;
}

// Haversine distance in miles
function haversineDistance(
  lat1: number,
  lon1: number,
  lat2: number,
  lon2: number,
): number {
  const R = 3958.8; // Earth radius in miles
  const dLat = ((lat2 - lat1) * Math.PI) / 180;
  const dLon = ((lon2 - lon1) * Math.PI) / 180;
  const a =
    Math.sin(dLat / 2) ** 2 +
    Math.cos((lat1 * Math.PI) / 180) *
    Math.cos((lat2 * Math.PI) / 180) *
    Math.sin(dLon / 2) ** 2;
  return R * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
}

export default function MapScreen() {
  const router = useRouter();
  const mapRef = useRef<MapView>(null);
  const { isAdmin } = useAdminMode();

  // State
  const [restaurants, setRestaurants] = useState<UIRestaurant[]>([]);
  const [loading, setLoading] = useState(true);
  const [mapCenter, setMapCenter] = useState<Region>(DEFAULT_REGION);
  const [showAddModal, setShowAddModal] = useState(false);
  const [newRestCoords, setNewRestCoords] = useState<{ lat: number, lng: number } | null>(null);
  const [adminPanelRestaurant, setAdminPanelRestaurant] = useState<UIRestaurant | null>(null);
  const [isSettingLocation, setIsSettingLocation] = useState(false);
  const [restaurantBeingMoved, setRestaurantBeingMoved] = useState<UIRestaurant | null>(null);

  const handleAddRestaurantPress = () => {
    setIsSettingLocation(true);
    setRestaurantBeingMoved(null);
    setShowMapSearch(false);
    setShowNearbyList(false);
    setSelectedRestaurant(null);
  };

  const handleAdjustLocationStart = (restaurant: UIRestaurant) => {
    setRestaurantBeingMoved(restaurant);
    setIsSettingLocation(true);
    setAdminPanelRestaurant(null);
    setSelectedRestaurant(null);
    setShowMapSearch(false);
    setShowNearbyList(false);
  };

  const { userCoords: userLocation, isLiveLocationEnabled } = useLocation();
  const { targetLat, targetLng, restaurantId } = useLocalSearchParams<{ targetLat?: string; targetLng?: string; restaurantId?: string }>();
  const hasCenteredRef = useRef(false);

  const [region, setRegion] = useState<Region>(DEFAULT_REGION);
  const [isZoomedIn, setIsZoomedIn] = useState(false);
  const [selectedRestaurant, setSelectedRestaurant] =
    useState<UIRestaurant | null>(null);
  const [showNearbyList, setShowNearbyList] = useState(false);
  const [nearbyRestaurants, setNearbyRestaurants] = useState<UIRestaurant[]>(
    [],
  );
  const [showMapSearch, setShowMapSearch] = useState(false);
  // Live closed status from hours — automatically re-evaluates every 60 s
  const closedRestaurantIds = useClosedRestaurantIds();

  // Track which geographic cluster to show next (persists across renders)
  const nearbyClusterIndexRef = useRef(0);

  // Animated bottom position for search FAB
  const fabBottom = useRef(new RNAnimated.Value(40)).current;

  // ==============================
  // Fetch restaurants
  // ==============================
  useEffect(() => {
    async function fetchRestaurants() {
      try {
        const { data, error } = await supabase
          .from("restaurants")
          .select("*")
          .order("current_wait_time", { ascending: true });

        if (error) throw error;
        if (data) {
          setRestaurants(data.map((r: SupabaseRestaurant) => mapSupabaseToUI(r, userLocation)));
        }
      } catch (err) {
        console.error("Map: error fetching restaurants:", err);
      } finally {
        setLoading(false);
      }
    }
    fetchRestaurants();

    const subscription = supabase
      .channel("map:restaurants")
      .on(
        "postgres_changes",
        { event: "*", schema: "public", table: "restaurants" },
        (payload) => {
          if (payload.eventType === "UPDATE") {
            const updated = mapSupabaseToUI(payload.new as SupabaseRestaurant, userLocation);
            setRestaurants((prev) =>
              prev.map((r) => (r.id === updated.id ? updated : r)),
            );
          } else if (payload.eventType === "INSERT") {
            const added = mapSupabaseToUI(payload.new as SupabaseRestaurant, userLocation);
            setRestaurants((prev) => [...prev, added]);
          }
        },
      )
      .subscribe();

    return () => {
      supabase.removeChannel(subscription);
    };
  }, []);

  // Image prefetch removed — was loading ALL restaurant images into memory
  // on every data change. Images load on-demand now.

  // ==============================
  // Center Map & Focus logic
  // ==============================
  useEffect(() => {
    if (hasCenteredRef.current) return;

    if (targetLat && targetLng) {
      const target: Region = {
        latitude: parseFloat(targetLat),
        longitude: parseFloat(targetLng),
        latitudeDelta: 0.008,
        longitudeDelta: 0.008,
      };
      setRegion(target);
      setTimeout(() => mapRef.current?.animateToRegion(target, 600), 500);
      hasCenteredRef.current = true;
    } else if (userLocation) {
      const initialRegion: Region = {
        ...userLocation,
        latitudeDelta: 0.015,
        longitudeDelta: 0.015,
      };
      setRegion(initialRegion);
      setTimeout(() => mapRef.current?.animateToRegion(initialRegion, 600), 500);
      hasCenteredRef.current = true;
    }
  }, [userLocation, targetLat, targetLng]);

  useEffect(() => {
    if (restaurantId && restaurants.length > 0) {
      const targetRest = restaurants.find((r) => r.id === restaurantId);
      if (targetRest && !selectedRestaurant) {
        setSelectedRestaurant(targetRest);
      }
    }
  }, [restaurantId, restaurants]);

  // Recalculate distances when user location arrives/changes
  const restaurantsWithDistance = useMemo(() => {
    if (!userLocation) return restaurants;
    return restaurants.map((r) => {
      if (r.lat == null || r.long == null) return r;
      const dist = haversineDistance(
        userLocation.latitude, userLocation.longitude, r.lat, r.long,
      );
      return { ...r, distance: `${dist.toFixed(1)} mi` };
    });
  }, [restaurants, userLocation]);

  // Non-admin users only see enabled restaurants; admins see all.
  const visibleRestaurants = useMemo(
    () => isAdmin ? restaurantsWithDistance : restaurantsWithDistance.filter((r) => r.isEnabled),
    [restaurantsWithDistance, isAdmin]
  );

  // Restaurants with valid coordinates — this is the ONLY marker list.
  // It changes only when restaurant data changes (from Supabase), never during zoom.
  const mappableRestaurants = useMemo(
    () => visibleRestaurants.filter((r) => r.lat != null && r.long != null),
    [visibleRestaurants]
  );

  // ==============================
  // Handlers
  // ==============================

  // Location button: snap to current user location
  const handleLocationPress = useCallback(() => {
    if (Platform.OS !== "web") {
      Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
    }
    if (!userLocation) {
      Alert.alert("Location Unavailable", "Could not determine your location.");
      return;
    }
    const target: Region = {
      ...userLocation,
      latitudeDelta: 0.015,
      longitudeDelta: 0.015,
    };
    mapRef.current?.animateToRegion(target, 600);
    setSelectedRestaurant(null);
    // Reset cluster cycle so next Discover Nearby starts from closest
    nearbyClusterIndexRef.current = 0;
  }, [userLocation]);

  // Discover Nearby: cycle through geographic clusters on each press
  const handleDiscoverNearby = useCallback(() => {
    if (Platform.OS !== "web") {
      Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Medium);
    }
    if (!userLocation) {
      Alert.alert("Location Unavailable", "Could not determine your location.");
      return;
    }
    if (mappableRestaurants.length === 0) {
      Alert.alert("No Restaurants", "No restaurants with locations found.");
      return;
    }

    // Calculate distance from user for all restaurants and sort by distance
    const withDist = mappableRestaurants
      .map((r) => ({
        restaurant: r,
        dist: haversineDistance(
          userLocation.latitude,
          userLocation.longitude,
          r.lat!,
          r.long!,
        ),
      }))
      .filter((w) => w.dist <= 15) // only within 15 miles
      .sort((a, b) => a.dist - b.dist);

    if (withDist.length === 0) {
      Alert.alert("No Restaurants", "No nearby restaurants found within 15 miles.");
      return;
    }

    // Build geographic clusters: group restaurants within NEARBY_CLUSTER_RADIUS_MILES of each other
    // Greedy clustering on the sorted-by-distance list
    const used = new Set<string>();
    const clusters: UIRestaurant[][] = [];

    for (const item of withDist) {
      if (used.has(item.restaurant.id)) continue;
      const cluster: UIRestaurant[] = [item.restaurant];
      used.add(item.restaurant.id);

      for (const other of withDist) {
        if (used.has(other.restaurant.id)) continue;
        // Check if this restaurant is within the cluster radius of the seed
        const distBetween = haversineDistance(
          item.restaurant.lat!,
          item.restaurant.long!,
          other.restaurant.lat!,
          other.restaurant.long!,
        );
        if (distBetween <= NEARBY_CLUSTER_RADIUS_MILES) {
          cluster.push(other.restaurant);
          used.add(other.restaurant.id);
        }
      }
      clusters.push(cluster);
    }

    if (clusters.length === 0) {
      Alert.alert("No Restaurants", "No nearby restaurants found.");
      return;
    }

    // Limit to 4 closest clusters max
    const maxClusters = clusters.slice(0, 4);

    // Pick the current cluster (wrapping around)
    const idx = nearbyClusterIndexRef.current % maxClusters.length;
    const clusterRestaurants = maxClusters[idx];
    // Advance for next press
    nearbyClusterIndexRef.current = (idx + 1) % maxClusters.length;

    // Fit map to show all restaurants in this cluster
    // Offset center so pins appear in the VISIBLE area above the overlay.
    const lats = clusterRestaurants.map((r) => r.lat!);
    const longs = clusterRestaurants.map((r) => r.long!);
    const minLat = Math.min(...lats);
    const maxLat = Math.max(...lats);
    const minLong = Math.min(...longs);
    const maxLong = Math.max(...longs);
    const centerLat = (minLat + maxLat) / 2;
    const centerLong = (minLong + maxLong) / 2;
    const spanLat = Math.max((maxLat - minLat) * 1.6, 0.008);
    const spanLong = Math.max((maxLong - minLong) * 1.6, 0.008);
    // Shift center downward so pins land in the visible area above the overlay
    const overlayFraction = OVERLAY_HEIGHT / SCREEN_HEIGHT;
    const latOffset = spanLat * overlayFraction * 0.5;
    const fitRegion: Region = {
      latitude: centerLat - latOffset,
      longitude: centerLong,
      latitudeDelta: spanLat,
      longitudeDelta: spanLong,
    };
    mapRef.current?.animateToRegion(fitRegion, 800);

    if (clusterRestaurants.length === 1) {
      setShowNearbyList(false);
      setSelectedRestaurant(clusterRestaurants[0]);
    } else {
      // Prefetch images before showing overlay
      clusterRestaurants.forEach((r) => {
        if (r.image) Image.prefetch(r.image).catch(() => { });
      });
      setNearbyRestaurants([...clusterRestaurants].sort((a, b) => a.name.localeCompare(b.name)));
      // setTimeout 100ms to ensure map marker press event clears before state update
      setSelectedRestaurant(null)
      setTimeout(() => setShowNearbyList(true), 100);
    }
  }, [userLocation, mappableRestaurants]);

  // Track zoom level AND center for dropping pins
  const handleRegionChangeComplete = useCallback((newRegion: Region) => {
    setIsZoomedIn(newRegion.latitudeDelta < ZOOM_THRESHOLD);
    setMapCenter(newRegion);
  }, []);

  // Smoothly animate FAB when overlays appear/disappear
  useEffect(() => {
    let target = 40; // default bottom
    if (showNearbyList) {
      target = OVERLAY_HEIGHT + 16;
    } else if (selectedRestaurant) {
      target = CARD_HEIGHT + (isAdmin ? 65 : 20);
    }
    RNAnimated.timing(fabBottom, {
      toValue: target,
      duration: 280,
      useNativeDriver: false,
    }).start();
  }, [showNearbyList, selectedRestaurant, fabBottom, isSettingLocation]);

  // Restaurant press: navigate to detail
  const handleRestaurantPress = useCallback(
    (restaurant: UIRestaurant) => {
      if (Platform.OS !== "web") {
        Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
      }
      router.navigate(`/restaurant/${restaurant.id}` as any);
    },
    [router],
  );

  // Dot marker press: show popup
  const handleDotPress = useCallback((restaurant: UIRestaurant) => {
    if (Platform.OS !== "web") {
      Haptics.selectionAsync();
    }
    setShowNearbyList(false);
    setSelectedRestaurant(restaurant);
  }, []);

  const handleMapInteraction = useCallback(() => {
    setSelectedRestaurant(null);
    setShowNearbyList(false);
  }, []);

  // ==============================
  // Render
  // ==============================
  if (loading) {
    return (
      <View
        style={{
          flex: 1,
          backgroundColor: "#0f0f0f",
          alignItems: "center",
          justifyContent: "center",
        }}
      >
        <ActivityIndicator size="large" color="#FF9933" />
      </View>
    );
  }

  return (
    <View style={{ flex: 1, backgroundColor: "#0f0f0f" }}>
      {/* Map */}
      <MapView
        ref={mapRef}
        style={{ flex: 1 }}
        initialRegion={region}
        onRegionChangeComplete={handleRegionChangeComplete}
        onPanDrag={handleMapInteraction}
        onLongPress={isAdmin ? (e: any) => {
          const { latitude, longitude } = e.nativeEvent.coordinate;
          Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Heavy);
          setNewRestCoords({ lat: latitude, lng: longitude });
          setShowAddModal(true);
        } : undefined}
        showsUserLocation={isLiveLocationEnabled}
        showsMyLocationButton={false}
        userInterfaceStyle="dark"
        customMapStyle={Platform.OS === "android" ? GOOGLE_MAPS_DARK_STYLE : undefined}
        mapType="standard"
        toolbarEnabled={false}
      >
        {/* User Home Location Pin (if live disabled) */}
        {!isLiveLocationEnabled && userLocation && (
          <Marker coordinate={userLocation} zIndex={100} tracksViewChanges={Platform.OS === "android"}>
            {Platform.OS === "android" ? (
              <View style={{
                backgroundColor: "#FF9933",
                width: 28,
                height: 28,
                borderRadius: 14,
                borderWidth: 2.5,
                borderColor: "#0f0f0f",
                alignItems: "center",
                justifyContent: "center",
              }}>
                <View style={{ width: 8, height: 8, borderRadius: 4, backgroundColor: "#0f0f0f" }} />
              </View>
            ) : (
              <View style={{
                backgroundColor: "#FF9933",
                padding: 6,
                borderRadius: 16,
                borderWidth: 2,
                borderColor: "#0f0f0f",
                shadowColor: "#000",
                shadowOffset: { width: 0, height: 2 },
                shadowOpacity: 0.3,
                shadowRadius: 4,
                elevation: 5,
              }}>
                <Home size={16} color="#0f0f0f" strokeWidth={2.5} />
              </View>
            )}
          </Marker>
        )}

        {mappableRestaurants.map((restaurant) => {
          const isClosed = closedRestaurantIds.has(restaurant.id);
          const showCard = Platform.OS !== "android" && isZoomedIn;
          return (
            <Marker
              key={`${restaurant.id}-${isClosed}`}
              coordinate={{
                latitude: restaurant.lat!,
                longitude: restaurant.long!,
              }}
              tracksViewChanges={Platform.OS === "android"}
              onPress={() =>
                showCard
                  ? handleRestaurantPress(restaurant)
                  : handleDotPress(restaurant)
              }
            >
              {showCard ? (
                <ZoomedInMarker restaurant={restaurant} isClosed={isClosed} />
              ) : (
                <DotMarker status={restaurant.waitStatus} isClosed={isClosed} />
              )}
            </Marker>
          );
        })}
      </MapView>

      {/* Popup card when a pin is tapped — swipe down to dismiss */}
      {selectedRestaurant && (
        <SelectedRestaurantCard
          restaurant={selectedRestaurant}
          isClosed={closedRestaurantIds.has(selectedRestaurant.id)}
          onDismiss={() => setSelectedRestaurant(null)}
          onPress={() =>
            router.navigate(`/restaurant/${selectedRestaurant.id}` as any)
          }
          isAdmin={isAdmin}
          onAdminPress={() => setAdminPanelRestaurant(selectedRestaurant)}
        />
      )}

      {/* Admin Restaurant Panel */}
      {isAdmin && adminPanelRestaurant && (
        <AdminRestaurantPanel
          restaurant={{
            id: adminPanelRestaurant.id,
            name: adminPanelRestaurant.name,
            waitTime: adminPanelRestaurant.waitTime,
            waitStatus: adminPanelRestaurant.waitStatus,
            isEnabled: adminPanelRestaurant.isEnabled,
          }}
          isWaitlistOpen={adminPanelRestaurant.waitTime < 999}
          onClose={() => setAdminPanelRestaurant(null)}
          onUpdated={() => {
            setAdminPanelRestaurant(null);
            setSelectedRestaurant(null);
          }}
          onAdjustLocation={() => handleAdjustLocationStart(adminPanelRestaurant)}
        />
      )}

      {/* Top overlay: back + discover + location buttons */}
      <SafeAreaView
        edges={["top"]}
        style={{ position: "absolute", top: 0, left: 0, right: 0 }}
      >
        <View
          style={{
            flexDirection: "row",
            justifyContent: "space-between",
            alignItems: "center",
            paddingHorizontal: 16,
            paddingTop: 8,
          }}
        >
          {/* Back button */}
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
            }}
          >
            <ArrowLeft size={20} color="#f5f5f5" />
          </Pressable>

          {/* Discover Nearby — centered pill */}
          <Pressable
            onPress={() => {
              if (isSettingLocation) return;
              handleDiscoverNearby();
            }}
            style={{
              backgroundColor: "#1a1a1a",
              flexDirection: "row",
              alignItems: "center",
              paddingHorizontal: 22,
              paddingVertical: 14,
              borderRadius: 28,
              borderWidth: 1.5,
              borderColor: isSettingLocation ? "#666" : "#FF9933",
              opacity: isSettingLocation ? 0.5 : 1,
            }}
          >
            <Compass size={18} color={isSettingLocation ? "#666" : "#FF9933"} />
            <Text
              style={{
                fontFamily: "BricolageGrotesque_700Bold",
                color: isSettingLocation ? "#666" : "#FF9933",
                fontSize: 15,
                marginLeft: 8,
              }}
            >
              Discover Nearby
            </Text>
          </Pressable>

          {/* Location button */}
          <Pressable
            onPress={handleLocationPress}
            style={{
              backgroundColor: "#1a1a1a",
              width: 44,
              height: 44,
              borderRadius: 22,
              alignItems: "center",
              justifyContent: "center",
              borderWidth: 1,
              borderColor: "#2a2a2a",
            }}
          >
            <LocateFixed size={20} color="#FF9933" />
          </Pressable>
        </View>

        {/* Status pill — shown directly below Discover Nearby when in location-setting mode */}
        {isSettingLocation && (
          <View style={{ alignItems: "center", paddingTop: 8 }}>
            <View style={{
              flexDirection: "row",
              alignItems: "center",
              backgroundColor: "#1a1a1a",
              borderWidth: 1.5,
              borderColor: "#FF9933",
              borderRadius: 20,
              paddingHorizontal: 14,
              paddingVertical: 7,
            }}>
              <MapPin size={13} color="#FF9933" />
              <Text style={{
                fontFamily: "Manrope_600SemiBold",
                color: "#FF9933",
                fontSize: 13,
                marginLeft: 6,
              }}>
                {restaurantBeingMoved ? `Moving: ${restaurantBeingMoved.name}` : "Adding new restaurant"}
              </Text>
            </View>
          </View>
        )}
      </SafeAreaView>

      {/* Nearby list overlay — add closedRestaurantIds for live closed status + sort */}
      {showNearbyList && nearbyRestaurants.length > 0 && (
        <NearbyListOverlay
          restaurants={nearbyRestaurants}
          closedRestaurantIds={closedRestaurantIds}
          onClose={() => {
            if (Platform.OS !== "web") {
              Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
            }
            setShowNearbyList(false);
          }}
          onSelect={(r) => {
            if (Platform.OS !== "web") {
              Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
            }
            const currentDelta = region.latitudeDelta || 0.015;
            const latOffset = currentDelta * (OVERLAY_HEIGHT / SCREEN_HEIGHT) * 0.5;
            const targetRegion: Region = {
              latitude: r.lat! - latOffset,
              longitude: r.long!,
              latitudeDelta: 0.008,
              longitudeDelta: 0.008,
            };
            mapRef.current?.animateToRegion(targetRegion, 600);
          }}
        />
      )}

      {/* Search FAB — bottom right, smoothly rises above overlays */}
      {!showMapSearch && !isSettingLocation && (
        <RNAnimated.View
          style={{
            position: "absolute",
            right: 16,
            bottom: fabBottom,
          }}
        >
          <Pressable
            onPress={() => {
              if (Platform.OS !== "web") {
                Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
              }
              setShowMapSearch(true);
            }}
            style={{
              backgroundColor: "#1a1a1a",
              width: 50,
              height: 50,
              borderRadius: 25,
              alignItems: "center",
              justifyContent: "center",
              borderWidth: 1.5,
              borderColor: "#FF9933",
              shadowColor: "#000",
              shadowOffset: { width: 0, height: 3 },
              shadowOpacity: 0.4,
              shadowRadius: 6,
              elevation: 6,
            }}
          >
            <Search size={22} color="#FF9933" />
          </Pressable>
        </RNAnimated.View>
      )}

      {/* Map Search Overlay */}
      {showMapSearch && (
        <MapSearchOverlay
          restaurants={mappableRestaurants}
          closedRestaurantIds={closedRestaurantIds}
          onClose={() => setShowMapSearch(false)}
          onSelect={(r) => {
            setShowMapSearch(false);
            setShowNearbyList(false);
            const targetRegion: Region = {
              latitude: r.lat!,
              longitude: r.long!,
              latitudeDelta: 0.008,
              longitudeDelta: 0.008,
            };
            mapRef.current?.animateToRegion(targetRegion, 600);
          }}
        />
      )}

      {/* Admin Add Restaurant FAB */}
      {isAdmin && !showMapSearch && !selectedRestaurant && !showAddModal && !isSettingLocation && (
        <RNAnimated.View
          style={{
            position: "absolute",
            right: 16,
            bottom: RNAnimated.add(fabBottom, 70) as any,
          }}
        >
          <Pressable
            onPress={() => {
              if (Platform.OS !== "web") {
                Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
              }
              handleAddRestaurantPress();
            }}
            style={{
              backgroundColor: "#1a1a1a",
              width: 50,
              height: 50,
              borderRadius: 25,
              alignItems: "center",
              justifyContent: "center",
              borderWidth: 1.5,
              borderColor: "#22C55E", // Green to distinguish admin action
              shadowColor: "#000",
              shadowOffset: { width: 0, height: 3 },
              shadowOpacity: 0.4,
              shadowRadius: 6,
              elevation: 6,
            }}
          >
            <Plus size={24} color="#22C55E" />
          </Pressable>
        </RNAnimated.View>
      )}

      {/* Purple Location Pin & Bottom Button for Setting Location */}
      {isSettingLocation && (
        <>
          <View style={{
            position: "absolute",
            top: "50%",
            left: "50%",
            marginTop: -12,
            marginLeft: -12,
            pointerEvents: "none",
            zIndex: 10,
          }}>
            <DotMarker status="purple" size={24} />
          </View>

          <SafeAreaView
            edges={["bottom"]}
            style={{ position: "absolute", bottom: 0, left: 0, right: 0 }}
          >
            <View style={{ padding: 20, gap: 10, alignItems: "center" }}>
              <Pressable
                onPress={() => {
                  if (Platform.OS !== "web") {
                    Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
                  }
                  setIsSettingLocation(false);
                  setRestaurantBeingMoved(null);
                }}
                style={{
                  backgroundColor: "#1a1a1a",
                  paddingVertical: 10,
                  paddingHorizontal: 28,
                  borderRadius: 20,
                  borderWidth: 1,
                  borderColor: "#3a3a3a",
                }}
              >
                <Text
                  style={{
                    fontFamily: "BricolageGrotesque_700Bold",
                    color: "#f5f5f5",
                    fontSize: 15,
                  }}
                >
                  Cancel
                </Text>
              </Pressable>
              <Pressable
                onPress={async () => {
                  if (Platform.OS !== "web") {
                    Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Medium);
                  }
                  let lat: number;
                  let lng: number;
                  try {
                    const camera = await mapRef.current?.getCamera();
                    lat = camera?.center?.latitude ?? mapCenter.latitude;
                    lng = camera?.center?.longitude ?? mapCenter.longitude;
                  } catch {
                    lat = mapCenter.latitude;
                    lng = mapCenter.longitude;
                  }

                  if (!lat || !lng) {
                    Alert.alert("Error", "Could not determine map center coordinates. Please try again.");
                    return;
                  }

                  if (restaurantBeingMoved) {
                    try {
                      const { error } = await supabase
                        .from("restaurants")
                        .update({ lat, long: lng })
                        .eq("id", Number(restaurantBeingMoved.id));
                      if (error) throw error;
                      setIsSettingLocation(false);
                      setRestaurantBeingMoved(null);
                    } catch (err: any) {
                      Alert.alert("Error", err.message || "Failed to update location.");
                    }
                  } else {
                    setIsSettingLocation(false);
                    setNewRestCoords({ lat, lng });
                    setShowAddModal(true);
                  }
                }}
                style={{
                  backgroundColor: "#A855F7",
                  paddingVertical: 16,
                  borderRadius: 16,
                  alignItems: "center",
                  alignSelf: "stretch",
                  shadowColor: "#A855F7",
                  shadowOffset: { width: 0, height: 4 },
                  shadowOpacity: 0.4,
                  shadowRadius: 8,
                  elevation: 6,
                }}
              >
                <Text
                  style={{
                    fontFamily: "BricolageGrotesque_700Bold",
                    color: "#ffffff",
                    fontSize: 18,
                  }}
                >
                  Set Location
                </Text>
              </Pressable>
            </View>
          </SafeAreaView>
        </>
      )}

      {/* Add Restaurant Modal */}
      {showAddModal && newRestCoords && (
        <AddRestaurantModal
          coords={newRestCoords}
          onClose={() => setShowAddModal(false)}
          onSuccess={() => {
            setShowAddModal(false);
          }}
        />
      )}
    </View>
  );
}

// ==========================================
// ZOOMED IN MARKER — iOS only
// ==========================================
function ZoomedInMarker({ restaurant, isClosed }: { restaurant: UIRestaurant; isClosed?: boolean }) {
  const displayStatus = (isClosed ? 'darkgrey' : restaurant.waitStatus) as typeof restaurant.waitStatus;
  return (
    <View
      style={{
        alignItems: "flex-start",
        backgroundColor: "#1a1a1a",
        borderRadius: 14,
        padding: 10,
        borderWidth: 1,
        borderColor: "#2a2a2a",
        maxWidth: 220,
        shadowColor: "#000",
        shadowOffset: { width: 0, height: 2 },
        shadowOpacity: 0.35,
        shadowRadius: 6,
        elevation: 5,
      }}
    >
      <Text
        numberOfLines={1}
        style={{
          fontFamily: "BricolageGrotesque_700Bold",
          color: "#f5f5f5",
          fontSize: 13,
          letterSpacing: -0.2,
          marginBottom: 2,
        }}
      >
        {restaurant.name}
      </Text>
      <Text
        numberOfLines={1}
        style={{
          fontFamily: "Manrope_500Medium",
          color: "#999999",
          fontSize: 10,
          marginBottom: 4,
        }}
      >
        {restaurant.cuisine}
      </Text>
      <View style={{ flexDirection: "row", alignItems: "center" }}>
        <Users size={10} color="#FF9933" />
        <Text
          style={{
            fontFamily: "JetBrainsMono_600SemiBold",
            color: "#f5f5f5",
            fontSize: 10,
            marginLeft: 3,
          }}
        >
          {isClosed ? 0 : restaurant.queueLength}
        </Text>
        <Text
          style={{
            fontFamily: "Manrope_500Medium",
            color: "#999999",
            fontSize: 9,
            marginLeft: 2,
          }}
        >
          in queue
        </Text>
        <View
          style={{
            backgroundColor: STATUS_BG[displayStatus],
            borderRadius: 8,
            paddingHorizontal: 5,
            paddingVertical: 1,
            marginLeft: 8,
          }}
        >
          <Text
            style={{
              fontFamily: "JetBrainsMono_600SemiBold",
              color: STATUS_COLORS[displayStatus],
              fontSize: 9,
            }}
          >
            {displayStatus === 'darkgrey' ? 'Closed' : restaurant.waitTime < 0 ? '--m' : `${restaurant.waitTime}m`}
          </Text>
        </View>
      </View>
    </View>
  );
}

// ==========================================
// ZOOMED OUT MARKER: 3-ring pin
// outer = wait color, middle = black, center = white
// Size scales with zoom level
// ==========================================
function DotMarker({ status, size = 20, isClosed }: { status: WaitStatus | "purple"; size?: number; isClosed?: boolean }) {
  const dotColor = isClosed ? '#555555' : STATUS_COLORS[status];
  return (
    <View
      style={{
        width: size,
        height: size,
        borderRadius: size / 2,
        backgroundColor: dotColor,
        alignItems: "center",
        justifyContent: "center",
        shadowColor: "#000",
        shadowOffset: { width: 0, height: 1 },
        shadowOpacity: 0.4,
        shadowRadius: 3,
        elevation: 4,
        opacity: isClosed ? 0.65 : 1,
      }}
    >
      {/* Black middle ring */}
      <View
        style={{
          width: size * 0.6,
          height: size * 0.6,
          borderRadius: size * 0.3,
          backgroundColor: "#111111",
          alignItems: "center",
          justifyContent: "center",
        }}
      >
        {/* White center dot */}
        <View
          style={{
            width: size * 0.25,
            height: size * 0.25,
            borderRadius: size * 0.125,
            backgroundColor: "#ffffff",
          }}
        />
      </View>
    </View>
  );
}

// ==========================================
// SELECTED RESTAURANT CARD — swipe-down to dismiss
// ==========================================
const CARD_HEIGHT = 130; // approximate card height for slide animation

function SelectedRestaurantCard({
  restaurant,
  isClosed,
  onDismiss,
  onPress,
  isAdmin,
  onAdminPress,
}: {
  restaurant: UIRestaurant;
  isClosed?: boolean;
  onDismiss: () => void;
  onPress: () => void;
  isAdmin?: boolean;
  onAdminPress?: () => void;
}) {
  const translateY = useRef(new RNAnimated.Value(CARD_HEIGHT)).current;

  // Slide in on mount
  useEffect(() => {
    RNAnimated.timing(translateY, {
      toValue: 0,
      duration: 250,
      useNativeDriver: false,
    }).start();
  }, []);

  // Slide out then dismiss
  const dismiss = useCallback(() => {
    if (Platform.OS !== "web") {
      Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
    }
    RNAnimated.timing(translateY, {
      toValue: CARD_HEIGHT + 40,
      duration: 200,
      useNativeDriver: false,
    }).start(() => onDismiss());
  }, [onDismiss, translateY]);

  // PanResponder for swipe-down gesture
  const panResponder = useRef(
    PanResponder.create({
      onStartShouldSetPanResponder: () => false,
      onMoveShouldSetPanResponder: (_, g) =>
        g.dy > 10 && Math.abs(g.dy) > Math.abs(g.dx),
      onPanResponderMove: (_, g) => {
        if (g.dy > 0) {
          translateY.setValue(g.dy);
        }
      },
      onPanResponderRelease: (_, g) => {
        if (g.dy > 60 || g.vy > 0.4) {
          dismiss();
        } else {
          RNAnimated.timing(translateY, {
            toValue: 0,
            duration: 200,
            useNativeDriver: false,
          }).start();
        }
      },
    })
  ).current;

  return (
    <RNAnimated.View
      {...panResponder.panHandlers}
      style={{
        position: "absolute",
        bottom: 40,
        left: 16,
        right: 16,
        transform: [{ translateY }],
      }}
    >
      {/* Drag handle */}
      <View
        style={{
          width: 36,
          height: 4,
          borderRadius: 2,
          backgroundColor: "#555",
          alignSelf: "center",
          marginBottom: 8,
        }}
      />
      <Pressable
        onPress={onPress}
        style={{
          flexDirection: "row",
          alignItems: "center",
          backgroundColor: "#1a1a1a",
          borderRadius: 16,
          padding: 12,
          borderWidth: 1,
          borderColor: "#2a2a2a",
          shadowColor: "#000",
          shadowOffset: { width: 0, height: 4 },
          shadowOpacity: 0.4,
          shadowRadius: 8,
          elevation: 6,
        }}
      >
        {/* Image */}
        <Image
          source={{ uri: restaurant.image }}
          style={{
            width: 60,
            height: 60,
            borderRadius: 14,
            borderWidth: 1,
            borderColor: "#2a2a2a",
          }}
          resizeMode="cover"
        />

        {/* Info */}
        <View style={{ flex: 1, marginLeft: 14 }}>
          <Text
            numberOfLines={1}
            style={{
              fontFamily: "BricolageGrotesque_700Bold",
              color: "#f5f5f5",
              fontSize: 17,
              letterSpacing: -0.3,
              marginBottom: 3,
            }}
          >
            {restaurant.name}
          </Text>
          <Text
            numberOfLines={1}
            style={{
              fontFamily: "Manrope_500Medium",
              color: "#999999",
              fontSize: 12,
              marginBottom: 6,
            }}
          >
            {restaurant.cuisine}
          </Text>

          <View style={{ flexDirection: "row", alignItems: "center" }}>
            <View style={{ flexDirection: "row", alignItems: "center", marginRight: 14 }}>
              <Users size={12} color="#FF9933" />
              <Text
                style={{
                  fontFamily: "JetBrainsMono_600SemiBold",
                  color: "#f5f5f5",
                  fontSize: 12,
                  marginLeft: 4,
                }}
              >
                {isClosed ? 0 : restaurant.queueLength}
              </Text>
              <Text
                style={{
                  fontFamily: "Manrope_500Medium",
                  color: "#999999",
                  fontSize: 10,
                  marginLeft: 3,
                }}
              >
                in queue
              </Text>
            </View>
            <View style={{ flexDirection: "row", alignItems: "center" }}>
              <Clock size={12} color="#FF9933" />
              <View
                style={{
                  backgroundColor: STATUS_BG[isClosed ? 'darkgrey' : restaurant.waitStatus],
                  borderRadius: 20,
                  paddingHorizontal: 8,
                  paddingVertical: 2,
                  marginLeft: 4,
                }}
              >
                <Text
                  style={{
                    fontFamily: "JetBrainsMono_600SemiBold",
                    color: STATUS_COLORS[isClosed ? 'darkgrey' : restaurant.waitStatus],
                    fontSize: 11,
                  }}
                >
                  {isClosed
                    ? "Closed"
                    : restaurant.waitStatus === "darkgrey"
                      ? "Closed"
                      : restaurant.waitTime < 0
                        ? "-- min"
                        : `${restaurant.waitTime} min`}
                </Text>
              </View>
            </View>
          </View>
        </View>

        {/* Distance */}
        <View style={{ alignItems: "flex-end", marginLeft: 8 }}>
          <View style={{ flexDirection: "row", alignItems: "center" }}>
            <MapPin size={11} color="#999999" />
            <Text
              style={{
                fontFamily: "Manrope_500Medium",
                color: "#999999",
                fontSize: 11,
                marginLeft: 3,
              }}
            >
              {restaurant.distance}
            </Text>
          </View>
        </View>
      </Pressable>
      {isAdmin && onAdminPress && (
        <Pressable
          onPress={onAdminPress}
          style={{
            backgroundColor: "#1a1a1a",
            borderRadius: 12,
            padding: 10,
            marginTop: 8,
            borderWidth: 1,
            borderColor: "rgba(255,153,51,0.3)",
            alignItems: "center",
          }}
        >
          <Text style={{ fontFamily: "Manrope_600SemiBold", color: "#FF9933", fontSize: 13 }}>
            Admin Controls
          </Text>
        </Pressable>
      )}
    </RNAnimated.View>
  );
}

// ==========================================
// NEARBY LIST OVERLAY — animated bottom sheet
// Uses RN's built-in Animated + PanResponder
// (NOT Reanimated — avoids transform conflicts)
// ==========================================
const SCREEN_HEIGHT = Dimensions.get("window").height;
const OVERLAY_HEIGHT = SCREEN_HEIGHT * 0.35;

function NearbyListOverlay({
  restaurants,
  onClose,
  onSelect,
  closedRestaurantIds,
}: {
  restaurants: UIRestaurant[];
  onClose: () => void;
  onSelect: (r: UIRestaurant) => void;
  closedRestaurantIds: Set<string>;
}) {
  // Prefetch images for the overlay restaurants
  useEffect(() => {
    restaurants.forEach((r) => {
      if (r.image) Image.prefetch(r.image).catch(() => { });
    });
  }, [restaurants]);

  // Animated translateY — starts off-screen, slides up
  const translateY = useRef(new RNAnimated.Value(OVERLAY_HEIGHT)).current;

  // Slide in on mount — fast timing, not spring
  useEffect(() => {
    RNAnimated.timing(translateY, {
      toValue: 0,
      duration: 280,
      useNativeDriver: false,
    }).start();
  }, []);

  // Slide out and call onClose
  const dismiss = useCallback(() => {
    if (Platform.OS !== "web") {
      Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
    }
    // Animate out then close
    RNAnimated.timing(translateY, {
      toValue: OVERLAY_HEIGHT,
      duration: 200,
      useNativeDriver: false,
    }).start(() => onClose());
  }, [onClose, translateY]);

  // PanResponder for the drag handle ONLY
  const handlePanResponder = useRef(
    PanResponder.create({
      onStartShouldSetPanResponder: () => true,
      onMoveShouldSetPanResponder: () => true,
      onPanResponderMove: (_, g) => {
        if (g.dy > 0) {
          translateY.setValue(g.dy);
        }
      },
      onPanResponderRelease: (_, g) => {
        if (g.dy > 80 || g.vy > 0.4) {
          dismiss();
        } else {
          RNAnimated.timing(translateY, {
            toValue: 0,
            duration: 200,
            useNativeDriver: false,
          }).start();
        }
      },
    }),
  ).current;

  return (
    <RNAnimated.View
      style={{
        position: "absolute",
        bottom: 0,
        left: 0,
        right: 0,
        maxHeight: OVERLAY_HEIGHT,
        backgroundColor: "#1a1a1a",
        borderTopLeftRadius: 20,
        borderTopRightRadius: 20,
        paddingTop: 0,
        paddingBottom: 40,
        borderTopWidth: 1,
        borderTopColor: "#2a2a2a",
        shadowColor: "#000",
        shadowOffset: { width: 0, height: -4 },
        shadowOpacity: 0.4,
        shadowRadius: 12,
        elevation: 10,
        transform: [{ translateY }],
      }}
    >
      {/* Drag handle area — ONLY this area responds to swipe-to-dismiss */}
      <View {...handlePanResponder.panHandlers} style={{ paddingVertical: 12, alignItems: "center" }}>
        <View
          style={{
            width: 40,
            height: 5,
            borderRadius: 3,
            backgroundColor: "#555",
          }}
        />
      </View>
      {/* Header */}
      <View
        style={{
          flexDirection: "row",
          alignItems: "center",
          justifyContent: "space-between",
          paddingHorizontal: 16,
          marginBottom: 8,
        }}
      >
        <View style={{ flexDirection: "row", alignItems: "center" }}>
          <Text
            style={{
              fontFamily: "BricolageGrotesque_700Bold",
              color: "#f5f5f5",
              fontSize: 18,
            }}
          >
            Nearby Restaurants
          </Text>
          <View style={{
            marginLeft: 8,
            backgroundColor: "rgba(255,153,51,0.15)",
            borderWidth: 1,
            borderColor: "#FF9933",
            borderRadius: 6,
            paddingHorizontal: 6,
            paddingVertical: 2
          }}>
            <Text style={{ color: "#FF9933", fontFamily: "JetBrainsMono_600SemiBold", fontSize: 12 }}>
              {restaurants.length}
            </Text>
          </View>
        </View>
        <Pressable
          onPress={dismiss}
          style={{
            backgroundColor: "#2a2a2a",
            borderRadius: 14,
            paddingHorizontal: 12,
            paddingVertical: 5,
          }}
        >
          <Text
            style={{
              fontFamily: "Manrope_600SemiBold",
              color: "#FF9933",
              fontSize: 13,
            }}
          >
            Close
          </Text>
        </Pressable>
      </View>
      {/* Scrollable restaurant list */}
      <ScrollView
        style={{ paddingHorizontal: 16 }}
        showsVerticalScrollIndicator={false}
      >
        {/* Sort: open first, closed last */}
        {[...restaurants]
          .sort((a, b) => {
            const aClosed = closedRestaurantIds.has(a.id) ? 1 : 0;
            const bClosed = closedRestaurantIds.has(b.id) ? 1 : 0;
            return aClosed - bClosed;
          })
          .map((r, i) => {
            const isClosed = closedRestaurantIds.has(r.id);
            const displayStatus = (isClosed ? 'darkgrey' : r.waitStatus) as typeof r.waitStatus;
            return (<Pressable
              key={r.id}
              onPress={() => {
                if (Platform.OS !== "web") {
                  Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
                }
                onSelect(r);
              }}
              style={{
                flexDirection: "row",
                alignItems: "center",
                paddingVertical: 12,
                borderTopWidth: i > 0 ? 1 : 0,
                borderTopColor: "#2a2a2a",
              }}
            >
              {/* Image */}
              <Image
                source={{ uri: r.image }}
                style={{
                  width: 48,
                  height: 48,
                  borderRadius: 12,
                  borderWidth: 1,
                  borderColor: "#2a2a2a",
                }}
                resizeMode="cover"
              />
              {/* Info */}
              <View style={{ flex: 1, marginLeft: 12 }}>
                <Text
                  numberOfLines={1}
                  style={{
                    fontFamily: "BricolageGrotesque_700Bold",
                    color: "#f5f5f5",
                    fontSize: 15,
                    letterSpacing: -0.2,
                    marginBottom: 2,
                  }}
                >
                  {r.name}
                </Text>
                <Text
                  numberOfLines={1}
                  style={{
                    fontFamily: "Manrope_500Medium",
                    color: "#999999",
                    fontSize: 12,
                  }}
                >
                  {r.cuisine}
                </Text>
              </View>
              {/* Wait badge */}
              <View
                style={{
                  backgroundColor: STATUS_BG[displayStatus],
                  borderRadius: 12,
                  paddingHorizontal: 8,
                  paddingVertical: 3,
                  marginLeft: 8,
                }}
              >
                <Text
                  style={{
                    fontFamily: "JetBrainsMono_600SemiBold",
                    color: STATUS_COLORS[displayStatus],
                    fontSize: 11,
                  }}
                >
                  {displayStatus === 'darkgrey' ? 'Closed' : r.waitTime < 0 ? '--' : `${r.waitTime}m`}
                </Text>
              </View>
              {/* Distance */}
              <View style={{ marginLeft: 8 }}>
                <Text
                  style={{
                    fontFamily: "Manrope_500Medium",
                    color: "#999999",
                    fontSize: 11,
                  }}
                >
                  {r.distance}
                </Text>
              </View>
            </Pressable>);
          })}
      </ScrollView>
    </RNAnimated.View>
  );
}

// ==========================================
// CLUSTER MARKER: combined card for grouped restaurants
// ==========================================
function ClusterMarker({ restaurants }: { restaurants: UIRestaurant[] }) {
  return (
    <View
      style={{
        backgroundColor: "#1a1a1a",
        borderRadius: 14,
        padding: 10,
        borderWidth: 1,
        borderColor: "#FF9933",
        width: 200,
        shadowColor: "#000",
        shadowOffset: { width: 0, height: 2 },
        shadowOpacity: 0.35,
        shadowRadius: 6,
        elevation: 5,
      }}
    >
      {/* Header */}
      <View
        style={{
          flexDirection: "row",
          alignItems: "center",
          marginBottom: 8,
        }}
      >
        <View
          style={{
            backgroundColor: "rgba(255, 153, 51, 0.2)",
            borderRadius: 10,
            paddingHorizontal: 8,
            paddingVertical: 2,
          }}
        >
          <Text
            style={{
              fontFamily: "JetBrainsMono_600SemiBold",
              color: "#FF9933",
              fontSize: 11,
            }}
          >
            {restaurants.length} Nearby
          </Text>
        </View>
      </View>

      {/* List of restaurants (max 4) */}
      {restaurants.slice(0, 4).map((r, i) => (
        <View
          key={r.id}
          style={{
            flexDirection: "row",
            alignItems: "center",
            paddingVertical: 4,
            borderTopWidth: i > 0 ? 1 : 0,
            borderTopColor: "#2a2a2a",
          }}
        >
          {/* Status dot */}
          <View
            style={{
              width: 6,
              height: 6,
              borderRadius: 3,
              backgroundColor: STATUS_COLORS[r.waitStatus],
              marginRight: 6,
            }}
          />
          <Text
            numberOfLines={1}
            style={{
              fontFamily: "Manrope_600SemiBold",
              color: "#f5f5f5",
              fontSize: 11,
              flex: 1,
            }}
          >
            {r.name}
          </Text>
          <View
            style={{
              backgroundColor: STATUS_BG[r.waitStatus],
              borderRadius: 6,
              paddingHorizontal: 4,
              paddingVertical: 1,
              marginLeft: 4,
            }}
          >
            <Text
              style={{
                fontFamily: "JetBrainsMono_600SemiBold",
                color: STATUS_COLORS[r.waitStatus],
                fontSize: 9,
              }}
            >
              {r.waitStatus === 'darkgrey' ? 'Closed' : r.waitTime < 0 ? '--m' : `${r.waitTime}m`}
            </Text>
          </View>
        </View>
      ))}
      {restaurants.length > 4 && (
        <Text
          style={{
            fontFamily: "Manrope_500Medium",
            color: "#666",
            fontSize: 10,
            textAlign: "center",
            marginTop: 4,
          }}
        >
          +{restaurants.length - 4} more
        </Text>
      )}
    </View>
  );
}

// ==========================================
// MAP SEARCH OVERLAY — search restaurants, pan map to selection
// ==========================================
function MapSearchOverlay({
  restaurants,
  closedRestaurantIds,
  onClose,
  onSelect,
}: {
  restaurants: UIRestaurant[];
  closedRestaurantIds: Set<string>;
  onClose: () => void;
  onSelect: (r: UIRestaurant) => void;
}) {
  const insets = useSafeAreaInsets();
  const [query, setQuery] = useState("");
  type SortOption = "none" | "waitTime" | "distance";
  const [sortBy, setSortBy] = useState<SortOption>("none");
  const inputRef = useRef<TextInput>(null);

  const parseDistance = (d: string | undefined) => parseFloat((d ?? "").replace(/[^0-9.]/g, "")) || Infinity;

  useEffect(() => {
    const timer = setTimeout(() => inputRef.current?.focus(), 300);
    return () => clearTimeout(timer);
  }, []);

  const results = useMemo(() => {
    let list = [...restaurants];
    if (query.trim()) {
      const q = query.toLowerCase().trim();
      list = list.filter(
        (r) =>
          r.name.toLowerCase().includes(q) ||
          r.cuisine.toLowerCase().includes(q)
      );
    }

    // Primary: open first, closed last
    // Secondary: selected sort option within each group
    list.sort((a, b) => {
      const aClosed = closedRestaurantIds.has(a.id) ? 1 : 0;
      const bClosed = closedRestaurantIds.has(b.id) ? 1 : 0;
      if (aClosed !== bClosed) return aClosed - bClosed;

      // Secondary sort within the same open/closed group
      if (sortBy === "waitTime") return a.waitTime - b.waitTime;
      if (sortBy === "distance") return parseDistance(a.distance || "0") - parseDistance(b.distance || "0");
      return a.name.localeCompare(b.name);
    });

    return list;
  }, [query, sortBy, restaurants]);

  return (
    <Animated.View
      entering={FadeIn.duration(200)}
      exiting={FadeOut.duration(150)}
      style={{
        position: "absolute",
        top: 0,
        left: 0,
        right: 0,
        bottom: 0,
        backgroundColor: "#0f0f0f",
        zIndex: 1000,
      }}
    >
      {/* Search Header */}
      <View
        style={{
          paddingTop: insets.top + 8,
          paddingHorizontal: 16,
          paddingBottom: 12,
          backgroundColor: "#0f0f0f",
          borderBottomWidth: 1,
          borderBottomColor: "#1a1a1a",
        }}
      >
        <View style={{ flexDirection: "row", alignItems: "center" }}>
          <View
            style={{
              flex: 1,
              flexDirection: "row",
              alignItems: "center",
              backgroundColor: "#1a1a1a",
              borderRadius: 16,
              borderWidth: 1.5,
              borderColor: "#FF9933",
              paddingHorizontal: 14,
              height: 50,
            }}
          >
            <Search size={20} color="#FF9933" />
            <TextInput
              ref={inputRef}
              value={query}
              onChangeText={setQuery}
              placeholder="Search restaurants..."
              placeholderTextColor="#666666"
              autoCapitalize="none"
              autoCorrect={false}
              returnKeyType="search"
              style={{
                flex: 1,
                marginLeft: 10,
                fontFamily: "Manrope_500Medium",
                color: "#f5f5f5",
                fontSize: 16,
                height: 50,
              }}
            />
            {query.length > 0 && (
              <Pressable onPress={() => setQuery("")} hitSlop={8}>
                <X size={16} color="#999999" />
              </Pressable>
            )}
          </View>
          <Pressable
            onPress={() => {
              if (Platform.OS !== "web") {
                Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
              }
              onClose();
            }}
            style={{ marginLeft: 12, paddingVertical: 8, paddingHorizontal: 4 }}
          >
            <Text
              style={{
                fontFamily: "Manrope_600SemiBold",
                color: "#FF9933",
                fontSize: 15,
              }}
            >
              Cancel
            </Text>
          </Pressable>
        </View>

        {/* Sort Bar */}
        <View
          style={{
            flexDirection: "row",
            alignItems: "center",
            marginTop: 12,
          }}
        >
          <ArrowUpDown size={14} color="#999999" />
          <Text
            style={{
              fontFamily: "Manrope_500Medium",
              color: "#999999",
              fontSize: 12,
              marginLeft: 6,
              marginRight: 10,
            }}
          >
            Sort by
          </Text>
          <Pressable
            onPress={() => {
              if (Platform.OS !== "web") Haptics.selectionAsync();
              setSortBy((prev) => (prev === "waitTime" ? "none" : "waitTime"));
            }}
            style={{
              backgroundColor: sortBy === "waitTime" ? "rgba(255, 153, 51, 0.2)" : "#1a1a1a",
              borderRadius: 20,
              paddingHorizontal: 14,
              paddingVertical: 7,
              marginRight: 8,
              borderWidth: 1,
              borderColor: sortBy === "waitTime" ? "#FF9933" : "#2a2a2a",
            }}
          >
            <View style={{ flexDirection: "row", alignItems: "center" }}>
              <Clock size={12} color={sortBy === "waitTime" ? "#FF9933" : "#999999"} />
              <Text
                style={{
                  fontFamily: "Manrope_600SemiBold",
                  color: sortBy === "waitTime" ? "#FF9933" : "#999999",
                  fontSize: 12,
                  marginLeft: 5,
                }}
              >
                Wait Time
              </Text>
            </View>
          </Pressable>
          <Pressable
            onPress={() => {
              if (Platform.OS !== "web") Haptics.selectionAsync();
              setSortBy((prev) => (prev === "distance" ? "none" : "distance"));
            }}
            style={{
              backgroundColor: sortBy === "distance" ? "rgba(255, 153, 51, 0.2)" : "#1a1a1a",
              borderRadius: 20,
              paddingHorizontal: 14,
              paddingVertical: 7,
              borderWidth: 1,
              borderColor: sortBy === "distance" ? "#FF9933" : "#2a2a2a",
            }}
          >
            <View style={{ flexDirection: "row", alignItems: "center" }}>
              <MapPin size={12} color={sortBy === "distance" ? "#FF9933" : "#999999"} />
              <Text
                style={{
                  fontFamily: "Manrope_600SemiBold",
                  color: sortBy === "distance" ? "#FF9933" : "#999999",
                  fontSize: 12,
                  marginLeft: 5,
                }}
              >
                Distance
              </Text>
            </View>
          </Pressable>
        </View>
      </View>

      {/* Results */}
      <ScrollView
        showsVerticalScrollIndicator={false}
        contentContainerStyle={{
          paddingHorizontal: 16,
          paddingTop: 8,
          paddingBottom: insets.bottom + 40,
        }}
        keyboardShouldPersistTaps="handled"
        keyboardDismissMode="on-drag"
      >
        {query.trim() !== "" && results.length === 0 ? (
          <Animated.View
            entering={FadeInDown.duration(300)}
            style={{
              alignItems: "center",
              justifyContent: "center",
              paddingVertical: 60,
            }}
          >
            <Text style={{ fontSize: 40, marginBottom: 12 }}>🔍</Text>
            <Text
              style={{
                fontFamily: "BricolageGrotesque_700Bold",
                color: "#f5f5f5",
                fontSize: 18,
                textAlign: "center",
                marginBottom: 6,
              }}
            >
              No results found
            </Text>
            <Text
              style={{
                fontFamily: "Manrope_500Medium",
                color: "#999999",
                fontSize: 14,
                textAlign: "center",
              }}
            >
              Try a different search term
            </Text>
          </Animated.View>
        ) : (
          <View>
            <Text
              style={{
                fontFamily: "Manrope_600SemiBold",
                color: "#999999",
                fontSize: 12,
                marginTop: 4,
                marginBottom: 12,
                textTransform: "uppercase",
                letterSpacing: 1,
              }}
            >
              {query.trim()
                ? `${results.length} result${results.length !== 1 ? "s" : ""}`
                : "All Restaurants"}
            </Text>
            {results.map((r, index) => (
              <Animated.View
                key={r.id}
                entering={FadeInDown.duration(200)}
              >
                <Pressable
                  onPress={() => {
                    if (Platform.OS !== "web") {
                      Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
                    }
                    onSelect(r);
                  }}
                  style={{
                    flexDirection: "row",
                    alignItems: "center",
                    backgroundColor: "#1a1a1a",
                    borderRadius: 16,
                    padding: 12,
                    marginBottom: 10,
                    borderWidth: 1,
                    borderColor: "#2a2a2a",
                  }}
                >
                  {/* Image */}
                  <Image
                    source={{ uri: r.image }}
                    style={{
                      width: 52,
                      height: 52,
                      borderRadius: 12,
                      borderWidth: 1,
                      borderColor: "#2a2a2a",
                    }}
                    resizeMode="cover"
                  />
                  {/* Info */}
                  <View style={{ flex: 1, marginLeft: 12 }}>
                    <Text
                      numberOfLines={1}
                      style={{
                        fontFamily: "BricolageGrotesque_700Bold",
                        color: "#f5f5f5",
                        fontSize: 16,
                        letterSpacing: -0.3,
                        marginBottom: 2,
                      }}
                    >
                      {r.name}
                    </Text>
                    <Text
                      numberOfLines={1}
                      style={{
                        fontFamily: "Manrope_500Medium",
                        color: "#999999",
                        fontSize: 12,
                        marginBottom: 4,
                      }}
                    >
                      {r.cuisine}
                    </Text>
                    <View style={{ flexDirection: "row", alignItems: "center" }}>
                      {(() => {
                        const isClosed = closedRestaurantIds.has(r.id);
                        const displayStatus = isClosed ? "darkgrey" : r.waitStatus;
                        return (
                          <>
                            <Clock size={11} color={isClosed ? "#888888" : "#FF9933"} />
                            <View
                              style={{
                                backgroundColor: STATUS_BG[displayStatus],
                                borderRadius: 8,
                                paddingHorizontal: 6,
                                paddingVertical: 1,
                                marginLeft: 4,
                              }}
                            >
                              <Text
                                style={{
                                  fontFamily: "JetBrainsMono_600SemiBold",
                                  color: STATUS_COLORS[displayStatus],
                                  fontSize: 10,
                                }}
                              >
                                {isClosed
                                  ? "Closed"
                                  : r.waitTime < 0
                                    ? "-- min"
                                    : `${r.waitTime} min`}
                              </Text>
                            </View>
                          </>
                        );
                      })()}
                    </View>
                  </View>
                  {/* Distance */}
                  <View style={{ marginLeft: 8 }}>
                    <View style={{ flexDirection: "row", alignItems: "center" }}>
                      <MapPin size={11} color="#999999" />
                      <Text
                        style={{
                          fontFamily: "Manrope_500Medium",
                          color: "#999999",
                          fontSize: 11,
                          marginLeft: 3,
                        }}
                      >
                        {r.distance}
                      </Text>
                    </View>
                  </View>
                </Pressable>
              </Animated.View>
            ))}
          </View>
        )}
      </ScrollView>
    </Animated.View>
  );
}
