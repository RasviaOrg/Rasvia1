import React from "react";
import { View, Text, Pressable } from "react-native";
import Animated, { FadeIn } from "react-native-reanimated";
import type { FilterType } from "@/data/mockData";

interface FilterBarProps {
  activeFilter: FilterType;
  onFilterChange: (filter: FilterType) => void;
}

const filters: { label: string; value: FilterType; color?: string }[] = [
  { label: "All", value: "all" },
  { label: "≤15 min", value: "green", color: "#22C55E" },
  { label: "15-30 min", value: "amber", color: "#F59E0B" },
  { label: "30+ min", value: "red", color: "#EF4444" },
];

export function FilterBar({ activeFilter, onFilterChange }: FilterBarProps) {
  return (
    <Animated.View entering={FadeIn.delay(200).duration(400)}>
      <View style={{ paddingHorizontal: 20, flexDirection: "row", justifyContent: "space-between" }}>
        {filters.map((filter, index) => {
          const isActive = activeFilter === filter.value;
          return (
            <Pressable
              key={filter.value}
              onPress={() => onFilterChange(filter.value)}
              style={[
                {
                  flex: 1,
                  minHeight: 38,
                  paddingHorizontal: 8,
                  paddingVertical: 8,
                  borderRadius: 20,
                  marginRight: index < filters.length - 1 ? 8 : 0,
                  borderWidth: 1,
                  borderColor: isActive
                    ? filter.color || "#FF9933"
                    : "#333333",
                  backgroundColor: isActive
                    ? `${filter.color || "#FF9933"}20`
                    : "#1a1a1a",
                },
              ]}
            >
              <View className="flex-row items-center justify-center">
                {filter.color && (
                  <View
                    style={{
                      width: 8,
                      height: 8,
                      borderRadius: 4,
                      backgroundColor: filter.color,
                      marginRight: 6,
                    }}
                  />
                )}
                <Text
                  style={{
                    fontFamily: "Manrope_600SemiBold",
                    color: isActive ? filter.color || "#FF9933" : "#999999",
                    fontSize: 12,
                  }}
                >
                  {filter.label}
                </Text>
              </View>
            </Pressable>
          );
        })}
      </View>
    </Animated.View>
  );
}
