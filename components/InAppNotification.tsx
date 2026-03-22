import React, { useEffect, useState } from "react";
import { View, Text, Pressable, Dimensions } from "react-native";
import Animated, {
    useAnimatedStyle,
    useSharedValue,
    withSpring,
    withTiming,
    runOnJS,
} from "react-native-reanimated";
import { Gesture, GestureDetector } from "react-native-gesture-handler";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { AlertCircle, CheckCircle, Info, X, BellRing, Utensils } from "lucide-react-native";

let SCREEN_WIDTH = Dimensions.get("window").width;
Dimensions.addEventListener("change", ({ window }) => { SCREEN_WIDTH = window.width; });

type NotificationType = "error" | "success" | "info" | "table_ready" | "seated";

interface InAppNotificationProps {
    visible: boolean;
    message: string;
    type?: NotificationType;
    onDismiss: () => void;
    autoDismiss?: boolean;
    duration?: number;
}

export function InAppNotification({
    visible,
    message,
    type = "error",
    onDismiss,
    autoDismiss = true,
    duration = 4000,
}: InAppNotificationProps) {
    const insets = useSafeAreaInsets();
    const translateY = useSharedValue(-200);
    const opacity = useSharedValue(0);

    const [renderVisible, setRenderVisible] = useState(visible);

    useEffect(() => {
        if (visible) {
            setRenderVisible(true);
            translateY.value = withSpring(0, {
                damping: 25,
                stiffness: 150,
            });
            opacity.value = withTiming(1, { duration: 200 });

            if (autoDismiss) {
                const timer = setTimeout(() => {
                    handleDismiss();
                }, duration);
                return () => clearTimeout(timer);
            }
        } else if (renderVisible) {
            translateY.value = withTiming(-200, { duration: 250 }, () => {
                runOnJS(setRenderVisible)(false);
            });
            opacity.value = withTiming(0, { duration: 250 });
        }
    }, [visible, autoDismiss, duration]);

    const handleDismiss = () => {
        translateY.value = withTiming(-200, { duration: 250 }, () => {
            runOnJS(onDismiss)();
        });
        opacity.value = withTiming(0, { duration: 250 });
    };

    const panGesture = Gesture.Pan()
        .onUpdate((event) => {
            if (event.translationY < 0) {
                translateY.value = event.translationY;
            }
        })
        .onEnd((event) => {
            if (event.translationY < -50 || event.velocityY < -500) {
                translateY.value = withTiming(-200, { duration: 200 }, () => {
                    runOnJS(onDismiss)();
                });
                opacity.value = withTiming(0, { duration: 200 });
            } else {
                translateY.value = withSpring(0);
            }
        });

    const animatedStyle = useAnimatedStyle(() => ({
        transform: [{ translateY: translateY.value }],
        opacity: opacity.value,
    }));

    const getNotificationConfig = () => {
        switch (type) {
            case "table_ready":
            case "success":
                return {
                    icon: BellRing,
                    color: "#FFFFFF",
                    bgColor: "#16A34A",
                    borderColor: "#15803D",
                };
            case "seated":
            case "info":
                return {
                    icon: Utensils,
                    color: "#FFFFFF",
                    bgColor: "#2563EB",
                    borderColor: "#1D4ED8",
                };
            case "error":
            default:
                return {
                    icon: AlertCircle,
                    color: "#FFFFFF",
                    bgColor: "#DC2626",
                    borderColor: "#B91C1C",
                };
        }
    };

    const config = getNotificationConfig();
    const Icon = config.icon;

    if (!renderVisible) return null;

    return (
        <GestureDetector gesture={panGesture}>
            <Animated.View
                style={[
                    animatedStyle,
                    {
                        position: "absolute",
                        top: insets.top + 10,
                        left: 16,
                        right: 16,
                        zIndex: 9999,
                        backgroundColor: config.bgColor,
                        borderRadius: 16,
                        borderWidth: 1,
                        borderColor: config.borderColor,
                        padding: 16,
                        flexDirection: "row",
                        alignItems: "center",
                        shadowColor: "#000",
                        shadowOffset: { width: 0, height: 4 },
                        shadowOpacity: 0.3,
                        shadowRadius: 12,
                        elevation: 10,
                    },
                ]}
            >
                <View
                    style={{
                        width: 36,
                        height: 36,
                        borderRadius: 18,
                        backgroundColor: "rgba(255, 255, 255, 0.25)",
                        alignItems: "center",
                        justifyContent: "center",
                        marginRight: 12,
                    }}
                >
                    <Icon size={20} color="#FFFFFF" />
                </View>
                <Text
                    style={{
                        flex: 1,
                        fontFamily: "BricolageGrotesque_700Bold",
                        color: "#FFFFFF",
                        fontSize: 15,
                        lineHeight: 21,
                        letterSpacing: -0.2,
                    }}
                >
                    {message}
                </Text>
            </Animated.View>
        </GestureDetector>
    );
}
