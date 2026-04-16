import React, { useMemo, useState } from "react";
import { View, Image, FlatList, Text, NativeSyntheticEvent, NativeScrollEvent } from "react-native";
import { Camera } from "lucide-react-native";
import type { RestaurantMediaSlide } from "@/lib/restaurant-media";

type Props = {
  defaultImage: string;
  slides?: RestaurantMediaSlide[];
  height: number;
  borderRadius: number;
  includeDefaultStarter?: boolean;
};

export function RestaurantMediaFrame({ defaultImage, slides, height, borderRadius, includeDefaultStarter = true }: Props) {
  const defaultImageUri = (defaultImage ?? "").trim();

  const usableSlides = useMemo(() => {
    const list = (slides ?? []).filter((s) => !!s.imageUrl);
    return list.length > 0 ? list : [];
  }, [slides]);

  const renderSlides = useMemo(() => {
    if (usableSlides.length === 0) {
      return [{ id: "default", imageUrl: defaultImageUri, menuItemName: null } as any];
    }
    if (includeDefaultStarter) {
      return [
        { id: "default-starter", imageUrl: defaultImageUri, menuItemName: null } as any,
        ...usableSlides,
      ];
    }
    return usableSlides;
  }, [usableSlides, defaultImageUri, includeDefaultStarter]);

  const hasCarousel = renderSlides.length > 1;

  const [activeIndex, setActiveIndex] = useState(0);
  const [width, setWidth] = useState(0);

  const onScrollEnd = (e: NativeSyntheticEvent<NativeScrollEvent>) => {
    if (!hasCarousel || width <= 0) return;
    const x = e.nativeEvent.contentOffset.x;
    const idx = Math.round(x / width);
    setActiveIndex(Math.max(0, Math.min(renderSlides.length - 1, idx)));
  };

  return (
    <View
      onLayout={(e) => setWidth(e.nativeEvent.layout.width)}
      style={{ height, borderRadius, overflow: "hidden", backgroundColor: "#242424", position: "relative" }}
    >
      {hasCarousel ? (
        <FlatList
          horizontal
          pagingEnabled
          bounces={false}
          data={renderSlides}
          keyExtractor={(item) => item.id}
          showsHorizontalScrollIndicator={false}
          onMomentumScrollEnd={onScrollEnd}
          decelerationRate="fast"
          renderItem={({ item }) => (
            <View style={{ width: width || "100%", height: "100%" }}>
              {item.imageUrl ? (
                <Image
                  source={{ uri: item.imageUrl }}
                  style={{ width: "100%", height: "100%" }}
                  resizeMode="cover"
                />
              ) : (
                <View style={{ width: "100%", height: "100%", backgroundColor: "#1b1b1b", alignItems: "center", justifyContent: "center", gap: 6 }}>
                  <Camera size={22} color="#7a7a7a" />
                  <Text style={{ fontFamily: "Manrope_700Bold", color: "#8a8a8a", fontSize: 11 }}>
                    No image available
                  </Text>
                </View>
              )}
              {item.menuItemName ? (
                <View
                  style={{
                    position: "absolute",
                    top: 10,
                    right: 10,
                    backgroundColor: "rgba(90,90,90,0.96)",
                    borderRadius: 10,
                    paddingHorizontal: 9,
                    paddingVertical: 5,
                    borderWidth: 1,
                    borderColor: "rgba(215,215,215,0.4)",
                  }}
                >
                  <Text
                    numberOfLines={1}
                    style={{
                      color: "#F3F4F6",
                      fontSize: 12,
                      fontFamily: "Manrope_700Bold",
                      maxWidth: 190,
                    }}
                  >
                    {item.menuItemName}
                  </Text>
                </View>
              ) : null}
            </View>
          )}
        />
      ) : (
        <View style={{ width: "100%", height: "100%" }}>
          {renderSlides[0].imageUrl ? (
            <Image
              source={{ uri: renderSlides[0].imageUrl }}
              style={{ width: "100%", height: "100%" }}
              resizeMode="cover"
            />
          ) : (
            <View style={{ width: "100%", height: "100%", backgroundColor: "#1b1b1b", alignItems: "center", justifyContent: "center", gap: 6 }}>
              <Camera size={22} color="#7a7a7a" />
              <Text style={{ fontFamily: "Manrope_700Bold", color: "#8a8a8a", fontSize: 11 }}>
                No image available
              </Text>
            </View>
          )}
          {renderSlides[0]?.menuItemName ? (
            <View
              style={{
                position: "absolute",
                top: 10,
                right: 10,
                backgroundColor: "rgba(90,90,90,0.96)",
                borderRadius: 10,
                paddingHorizontal: 9,
                paddingVertical: 5,
                borderWidth: 1,
                borderColor: "rgba(215,215,215,0.4)",
              }}
            >
              <Text
                numberOfLines={1}
                style={{
                  color: "#F3F4F6",
                  fontSize: 12,
                  fontFamily: "Manrope_700Bold",
                  maxWidth: 190,
                }}
              >
                {renderSlides[0].menuItemName}
              </Text>
            </View>
          ) : null}
        </View>
      )}

      {hasCarousel ? (
        <View
          style={{
            position: "absolute",
            bottom: 12,
            left: 0,
            right: 0,
            alignItems: "center",
          }}
        >
          <View
            style={{
              flexDirection: "row",
              backgroundColor: "rgba(15,15,15,0.72)",
              borderRadius: 999,
              paddingHorizontal: 9,
              paddingVertical: 5,
              gap: 7,
            }}
          >
            {renderSlides.map((_, index) => (
              <View
                key={`dot-${index}`}
                style={{
                  width: 6.3,
                  height: 6.3,
                  borderRadius: 4,
                  backgroundColor: index === activeIndex ? "#f5f5f5" : "rgba(245,245,245,0.45)",
                }}
              />
            ))}
          </View>
        </View>
      ) : null}
    </View>
  );
}
