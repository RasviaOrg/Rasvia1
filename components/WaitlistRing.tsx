import React, { useEffect } from "react";
import { View, Text, Dimensions } from "react-native";
import Animated, {
  useSharedValue,
  useAnimatedStyle,
  withTiming,
  Easing,
  withRepeat,
  withSequence,
  FadeIn,
} from "react-native-reanimated";
import Svg, { Circle } from "react-native-svg";

const AnimatedCircle = Animated.createAnimatedComponent(Circle);

interface WaitlistRingProps {
  position: number;
  totalInQueue: number;
  estimatedMinutes: number;
  restaurantName: string;
}

export function WaitlistRing({
  position,
  totalInQueue,
  estimatedMinutes,
  restaurantName,
}: WaitlistRingProps) {
  const progress = useSharedValue(0);
  const pulseScale = useSharedValue(1);

  const size = 240;
  const strokeWidth = 10;
  const radius = (size - strokeWidth) / 2;
  const circumference = 2 * Math.PI * radius;

  const progressPercent = totalInQueue > 0
    ? Math.min(1, Math.max(0, (totalInQueue - position + 1) / totalInQueue))
    : 0;

  useEffect(() => {
    progress.value = withTiming(progressPercent, {
      duration: 1500,
      easing: Easing.bezierFn(0.25, 0.1, 0.25, 1),
    });

    pulseScale.value = withRepeat(
      withSequence(
        withTiming(1.02, { duration: 1500 }),
        withTiming(1.0, { duration: 1500 })
      ),
      -1,
      true
    );
  }, [progressPercent]);

  const pulseStyle = useAnimatedStyle(() => ({
    transform: [{ scale: pulseScale.value }],
  }));

  const strokeDashoffset = circumference * (1 - progressPercent);

  return (
    <Animated.View
      entering={FadeIn.duration(800)}
      style={[pulseStyle]}
      className="items-center justify-center"
    >
      <View style={{ width: size, height: size, position: "relative" }}>
        {/* Background glow */}
        <View
          style={{
            position: "absolute",
            top: "50%",
            left: "50%",
            width: size * 0.6,
            height: size * 0.6,
            marginLeft: -(size * 0.3),
            marginTop: -(size * 0.3),
            borderRadius: size,
            backgroundColor: "rgba(255, 153, 51, 0.08)",
            shadowColor: "#FF9933",
            shadowOffset: { width: 0, height: 0 },
            shadowOpacity: 0.3,
            shadowRadius: 40,
          }}
        />

        <Svg width={size} height={size}>
          {/* Background track */}
          <Circle
            cx={size / 2}
            cy={size / 2}
            r={radius}
            stroke="#2a2a2a"
            strokeWidth={strokeWidth}
            fill="none"
          />
          {/* Progress ring */}
          <Circle
            cx={size / 2}
            cy={size / 2}
            r={radius}
            stroke="#FF9933"
            strokeWidth={strokeWidth}
            fill="none"
            strokeDasharray={circumference}
            strokeDashoffset={strokeDashoffset}
            strokeLinecap="round"
            transform={`rotate(-90 ${size / 2} ${size / 2})`}
          />
        </Svg>

        {/* Center content */}
        <View
          className="absolute items-center justify-center"
          style={{
            top: 0,
            left: 0,
            right: 0,
            bottom: 0,
          }}
        >
          <Text
            style={{
              fontFamily: "JetBrainsMono_600SemiBold",
              color: "#FF9933",
              fontSize: 56,
              lineHeight: 60,
            }}
          >
            #{position}
          </Text>
          <Text
            style={{
              fontFamily: "Manrope_500Medium",
              color: "#999999",
              fontSize: 14,
              marginTop: 2,
            }}
          >
            in queue
          </Text>
        </View>
      </View>

      {/* Est. time */}
      <View className="items-center mt-6">
        <Text
          style={{
            fontFamily: "Manrope_500Medium",
            color: "#999999",
            fontSize: 14,
          }}
        >
          Estimated wait
        </Text>
        <Text
          style={{
            fontFamily: "JetBrainsMono_600SemiBold",
            color: "#f5f5f5",
            fontSize: 32,
            marginTop: 2,
          }}
        >
          {estimatedMinutes} min
        </Text>
      </View>
    </Animated.View>
  );
}
