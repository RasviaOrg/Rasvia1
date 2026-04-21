import React from "react";
import { View, Text } from "react-native";
import { Star, ChevronRight } from "lucide-react-native";
import { CachedImage } from "@/components/CachedImage";

interface MapCalloutCardProps {
    name: string;
    rating: number;
    imageUrl: string;
}

export function MapCalloutCard({ name, rating, imageUrl }: MapCalloutCardProps) {
    return (
        <View
            style={{
                flexDirection: "row",
                alignItems: "center",
                backgroundColor: "#1a1a1a",
                borderRadius: 14,
                padding: 10,
                borderWidth: 1,
                borderColor: "#2a2a2a",
                width: 220,
            }}
        >
            {/* Thumbnail — falls back to a plain tile when the map page hasn't
                cached this restaurant's image yet (the map never fetches from
                server; images only load after the user visits home). */}
            <CachedImage
                source={{ uri: imageUrl }}
                style={{
                    width: 50,
                    height: 50,
                    borderRadius: 10,
                    backgroundColor: "#262626",
                }}
                fallback={
                    <View
                        style={{
                            width: 50,
                            height: 50,
                            borderRadius: 10,
                            backgroundColor: "#262626",
                        }}
                    />
                }
            />
            {/* Info */}
            <View style={{ flex: 1, marginLeft: 10 }}>
                <Text
                    numberOfLines={1}
                    style={{
                        fontFamily: "Manrope_700Bold",
                        color: "#f5f5f5",
                        fontSize: 14,
                    }}
                >
                    {name}
                </Text>
                <View
                    style={{
                        flexDirection: "row",
                        alignItems: "center",
                        marginTop: 3,
                    }}
                >
                    <Star size={12} color="#FF9933" fill="#FF9933" />
                    <Text
                        style={{
                            fontFamily: "Manrope_600SemiBold",
                            color: "#999999",
                            fontSize: 12,
                            marginLeft: 4,
                        }}
                    >
                        {rating.toFixed(1)}
                    </Text>
                </View>
            </View>
            {/* Arrow */}
            <ChevronRight size={18} color="#666666" />
        </View>
    );
}
