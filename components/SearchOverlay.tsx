import React, { useState, useMemo, useCallback, useRef, useEffect } from "react";
import {
  View,
  Text,
  TextInput,
  Pressable,
  ScrollView,
  Platform,
  Image,
} from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { useRouter } from "expo-router";
import { X, Search, Users, Clock, MapPin, ArrowUpDown } from "lucide-react-native";
import Animated, {
  FadeIn,
  FadeInDown,
  FadeOut,
} from "react-native-reanimated";
import * as Haptics from "expo-haptics";
import { WaitBadge } from "@/components/WaitBadge";
import { supabase } from "@/lib/supabase";
import { type UIRestaurant, mapSupabaseToUI, type SupabaseRestaurant, haversineDistance } from "@/lib/restaurant-types";
import { useLocation } from "@/lib/location-context";
import { useAdminMode } from "@/hooks/useAdminMode";
import { useClosedRestaurantIds } from "@/hooks/useClosedRestaurantIds";

// --- Trie-based prefix search for efficient matching ---

interface TrieNode {
  children: Map<string, TrieNode>;
  restaurantIds: Set<string>;
}

function createTrieNode(): TrieNode {
  return { children: new Map(), restaurantIds: new Set() };
}

function buildTrie(items: UIRestaurant[]): TrieNode {
  const root = createTrieNode();

  for (const restaurant of items) {
    const words = restaurant.name.toLowerCase().split(/\s+/);
    for (const word of words) {
      let node = root;
      for (const char of word) {
        if (!node.children.has(char)) {
          node.children.set(char, createTrieNode());
        }
        node = node.children.get(char)!;
        node.restaurantIds.add(restaurant.id);
      }
    }
    let node = root;
    for (const char of restaurant.name.toLowerCase()) {
      if (!node.children.has(char)) {
        node.children.set(char, createTrieNode());
      }
      node = node.children.get(char)!;
      node.restaurantIds.add(restaurant.id);
    }
  }

  return root;
}

function searchTrie(root: TrieNode, query: string): Set<string> {
  const normalizedQuery = query.toLowerCase().trim();
  if (!normalizedQuery) return new Set();

  let node = root;
  for (const char of normalizedQuery) {
    if (!node.children.has(char)) {
      return new Set();
    }
    node = node.children.get(char)!;
  }
  return node.restaurantIds;
}

function parseDistance(d: string | undefined): number {
  return parseFloat((d ?? "").replace(/[^0-9.]/g, "")) || Infinity;
}

type SortOption = "none" | "waitTime" | "distance";

interface SearchOverlayProps {
  onClose: () => void;
}

export function SearchOverlay({ onClose }: SearchOverlayProps) {
  const router = useRouter();
  const { userCoords } = useLocation();
  const { isAdmin } = useAdminMode();
  const closedRestaurantIds = useClosedRestaurantIds();
  const insets = useSafeAreaInsets();
  const [query, setQuery] = useState("");
  const [sortBy, setSortBy] = useState<SortOption>("none");
  const inputRef = useRef<TextInput>(null);

  // Fetch restaurants from Supabase
  const [restaurants, setRestaurants] = useState<UIRestaurant[]>([]);
  const [loading, setLoading] = useState(true);
  const [restaurantTrie, setRestaurantTrie] = useState<TrieNode>(createTrieNode());
  const [restaurantMap, setRestaurantMap] = useState<Map<string, UIRestaurant>>(new Map());

  useEffect(() => {
    async function fetchRestaurants() {
      try {
        const restaurantRes = await supabase
          .from('restaurants')
          .select('*')
          .order('name', { ascending: true });

        if (restaurantRes.error) throw restaurantRes.error;

        if (restaurantRes.data) {
          const uiRestaurants = restaurantRes.data
            .map((r: SupabaseRestaurant) => {
              return mapSupabaseToUI(r, userCoords);
            })
            .filter((r) => isAdmin || r.isEnabled);
          setRestaurants(uiRestaurants);
          setRestaurantTrie(buildTrie(uiRestaurants));
          setRestaurantMap(new Map(uiRestaurants.map((r) => [r.id, r])));
        }
      } catch (error) {
        console.error('Error fetching restaurants for search:', error);
      } finally {
        setLoading(false);
      }
    }
    fetchRestaurants();
  }, []);

  // Recalculate distances when userCoords arrives after initial fetch
  useEffect(() => {
    if (!userCoords) return;
    setRestaurants((prev) => {
      const updated = prev.map((r) => {
        if (r.lat == null || r.long == null) return r;
        const dist = haversineDistance(
          userCoords.latitude, userCoords.longitude, r.lat, r.long,
        );
        return { ...r, distance: `${dist.toFixed(1)} mi` };
      });
      setRestaurantMap(new Map(updated.map((r) => [r.id, r])));
      return updated;
    });
  }, [userCoords]);

  useEffect(() => {
    const timer = setTimeout(() => {
      inputRef.current?.focus();
    }, 400);
    return () => clearTimeout(timer);
  }, []);


  const results = useMemo(() => {
    let list: UIRestaurant[];
    if (!query.trim()) {
      list = [...restaurants];
    } else {
      const matchIds = searchTrie(restaurantTrie, query);
      list = Array.from(matchIds)
        .map((id) => restaurantMap.get(id))
        .filter((r): r is UIRestaurant => r != null);
    }

    if (sortBy === "waitTime") {
      list.sort((a, b) => {
        const aw = a.isComingSoon ? Number.POSITIVE_INFINITY : a.waitTime;
        const bw = b.isComingSoon ? Number.POSITIVE_INFINITY : b.waitTime;
        return aw - bw;
      });
    } else if (sortBy === "distance") {
      list.sort((a, b) => parseDistance(a.distance) - parseDistance(b.distance));
    } else {
      list.sort((a, b) => a.name.localeCompare(b.name));
    }

    return list;
  }, [query, sortBy, restaurants, restaurantTrie, restaurantMap]);

  const handleResultPress = useCallback(
    (id: string) => {
      if (Platform.OS !== "web") {
        Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
      }
      onClose();
      router.push(`/restaurant/${id}` as any);
    },
    [router, onClose]
  );

  const handleSortPress = useCallback(
    (option: SortOption) => {
      if (Platform.OS !== "web") {
        Haptics.selectionAsync();
      }
      setSortBy((prev) => (prev === option ? "none" : option));
    },
    []
  );

  const isSearchEmpty = query.trim() !== "" && results.length === 0;

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
        <View
          style={{
            flexDirection: "row",
            alignItems: "center",
          }}
        >
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
            style={{
              marginLeft: 12,
              paddingVertical: 8,
              paddingHorizontal: 4,
            }}
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
            onPress={() => handleSortPress("waitTime")}
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
            onPress={() => handleSortPress("distance")}
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
        {isSearchEmpty ? (
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
            {results.map((restaurant, index) => (
              <SearchResultCard
                key={restaurant.id}
                restaurant={{
                  ...restaurant,
                  // Apply real-time hour-based closed status
                  waitStatus: (closedRestaurantIds.has(restaurant.id) || restaurant.isComingSoon)
                    ? "darkgrey"
                    : restaurant.waitStatus,
                }}
                index={index}
                onPress={() => handleResultPress(restaurant.id)}
              />
            ))}
          </View>
        )}
      </ScrollView>
    </Animated.View>
  );
}

function SearchResultCard({
  restaurant,
  index,
  onPress,
}: {
  restaurant: UIRestaurant;
  index: number;
  onPress: () => void;
}) {
  return (
    <Animated.View entering={FadeInDown.duration(220)}>
      <Pressable
        onPress={onPress}
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
                {restaurant.queueLength}
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
            {restaurant.waitStatus === "darkgrey" ? (
              <View style={{ flexDirection: "row", alignItems: "center" }}>
                <Clock size={12} color="#999999" />
                <View style={{ backgroundColor: "rgba(153,153,153,0.15)", borderRadius: 20, paddingHorizontal: 8, paddingVertical: 2, marginLeft: 4 }}>
                  <Text style={{ fontFamily: "JetBrainsMono_600SemiBold", color: "#999999", fontSize: 10 }}>{restaurant.isComingSoon ? "Coming soon" : "Closed"}</Text>
                </View>
              </View>
            ) : (
              <View style={{ flexDirection: "row", alignItems: "center" }}>
                <Clock size={12} color="#FF9933" />
                <WaitBadge
                  waitTime={restaurant.waitTime}
                  status={restaurant.waitStatus}
                  size="sm"
                />
              </View>
            )}
          </View>
        </View>

        <View style={{ alignItems: "flex-end" }}>
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
    </Animated.View>
  );
}
