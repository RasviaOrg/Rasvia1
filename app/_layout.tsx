import {
  DarkTheme,
  ThemeProvider,
} from "@react-navigation/native";
import { Stack, useRouter, useSegments } from "expo-router";
import * as SplashScreen from "expo-splash-screen";
import { StatusBar } from "expo-status-bar";
import { useEffect, useState } from "react";
import { View, ActivityIndicator, Platform, Alert, LogBox, Image, Text } from "react-native";

// Remote push token registration is unavailable in Expo Go SDK 53+.
// Rasvia only uses local (scheduled) notifications so this is harmless.
LogBox.ignoreLogs([
  "expo-notifications: Android Push notifications (remote notifications)",
]);
import * as Haptics from "expo-haptics";
import * as Linking from "expo-linking";
import * as WebBrowser from "expo-web-browser";
import { SafeAreaProvider } from "react-native-safe-area-context";
import { GestureHandlerRootView } from "react-native-gesture-handler";
import "react-native-reanimated";
import "../global.css";
import {
  useFonts as useBricolage,
  BricolageGrotesque_800ExtraBold,
  BricolageGrotesque_700Bold,
} from "@expo-google-fonts/bricolage-grotesque";
import {
  useFonts as useManrope,
  Manrope_500Medium,
  Manrope_600SemiBold,
  Manrope_700Bold,
} from "@expo-google-fonts/manrope";
import {
  useFonts as useJetBrains,
  JetBrainsMono_600SemiBold,
} from "@expo-google-fonts/jetbrains-mono";
import { AuthProvider, useAuth } from "@/lib/auth-context";
import { LocationProvider } from "@/lib/location-context";
import { NotificationsProvider, useNotifications } from "@/lib/notifications-context";
import { InAppNotification } from "@/components/InAppNotification";
import { BrandedLoader } from "@/components/BrandedLoader";

SplashScreen.preventAutoHideAsync();

const rasviaTheme = {
  ...DarkTheme,
  colors: {
    ...DarkTheme.colors,
    background: "#0f0f0f",
    card: "#1a1a1a",
    text: "#f5f5f5",
    border: "#333333",
    primary: "#FF9933",
  },
};

// ==========================================
// GLOBAL TABLE-READY BANNER
// ==========================================
function GlobalTableReadyBanner() {
  const { tableReadyAlert, clearTableReadyAlert, seatedAlert, clearSeatedAlert } = useNotifications();

  useEffect(() => {
    if (tableReadyAlert && Platform.OS !== "web") {
      Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
    }
  }, [tableReadyAlert]);

  useEffect(() => {
    if (seatedAlert && Platform.OS !== "web") {
      Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
    }
  }, [seatedAlert]);

  // Show seated (blue) banner on top if present, otherwise table ready (green)
  if (seatedAlert) {
    return (
      <InAppNotification
        visible
        message={`Enjoy your meal at ${seatedAlert.restaurantName}!`}
        type="seated"
        onDismiss={clearSeatedAlert}
        duration={8000}
      />
    );
  }

  return (
    <InAppNotification
      visible={!!tableReadyAlert}
      message={tableReadyAlert ? `Your table is ready at ${tableReadyAlert.restaurantName}` : ""}
      type="table_ready"
      onDismiss={clearTableReadyAlert}
      duration={8000}
    />
  );
}

// ==========================================
// AUTH GATE: Redirects based on session
// ==========================================
function AuthGate() {
  const { session, loading, needsOnboarding } = useAuth();
  const segments = useSegments();
  const router = useRouter();
  const [showSlowLoadHint, setShowSlowLoadHint] = useState(false);

  useEffect(() => {
    if (!loading) {
      setShowSlowLoadHint(false);
      return;
    }
    const timer = setTimeout(() => setShowSlowLoadHint(true), 4000);
    return () => clearTimeout(timer);
  }, [loading]);

  useEffect(() => {
    if (loading) return;

    const inAuthScreen = segments[0] === "auth";
    const inOnboarding = segments[0] === "onboarding";
    // Allow unauthenticated access to legal pages and email-verify landing
    const inPublicRoute = inAuthScreen || (segments[0] as string) === "terms" || (segments[0] as string) === "privacy" || (segments[0] as string) === "email-verify";

    if (!session && !inPublicRoute) {
      router.replace("/auth");
    } else if (session && inAuthScreen) {
      if (needsOnboarding) {
        router.replace("/onboarding");
      } else {
        router.replace("/");
      }
    } else if (session && needsOnboarding && !inOnboarding) {
      router.replace("/onboarding");
    } else if (session && !needsOnboarding && inOnboarding) {
      router.replace("/");
    }
  }, [session, loading, needsOnboarding, segments]);

  // ── Global deep link handler for checkout/cancel & error ──
  useEffect(() => {
    const handleUrl = (event: { url: string }) => {
      const { path, queryParams } = Linking.parse(event.url);

      if (path === 'checkout/cancel') {
        if (Platform.OS !== 'web') Haptics.notificationAsync(Haptics.NotificationFeedbackType.Warning);
        Alert.alert(
          'Payment Cancelled',
          'Your payment was not processed. No charges were made.',
          [{ text: 'OK', onPress: () => router.replace('/') }],
        );
      } else if (path === 'checkout/error') {
        const reason = (queryParams as any)?.reason || 'unknown';
        if (Platform.OS !== 'web') Haptics.notificationAsync(Haptics.NotificationFeedbackType.Error);
        Alert.alert(
          'Payment Error',
          reason === 'payment_incomplete'
            ? 'Your payment could not be confirmed. Please try again.'
            : `Something went wrong. Please try again.`,
          [{ text: 'OK', onPress: () => router.replace('/') }],
        );
      } else if (path === 'order-confirmation') {
        // Dismiss the in-app browser sheet that Stripe checkout was in
        try { WebBrowser.dismissBrowser(); } catch { }
        const params = queryParams as any;
        // Small delay to let browser dismissal complete before navigation
        setTimeout(() => {
          router.replace({
            pathname: '/order-confirmation' as any,
            params: {
              order_id: params?.order_id || '',
              restaurant_name: params?.restaurant_name || '',
              order_type: params?.order_type || 'dine_in',
              total: params?.total || '0',
              party_session_id: params?.party_session_id || '',
            },
          });
        }, 300);
      }
    };

    const subscription = Linking.addEventListener('url', handleUrl);
    Linking.getInitialURL().then(url => {
      if (url) handleUrl({ url });
    });

    return () => subscription.remove();
  }, [router]);

  // Block ALL rendering until auth state is known
  if (loading) {
    return (
      <View style={{ flex: 1, backgroundColor: "#0f0f0f", alignItems: "center", justifyContent: "center" }}>
        <Image
          source={require("../assets/images/rasvia-icon.png")}
          style={{ width: 72, height: 72, marginBottom: 18 }}
          resizeMode="contain"
        />
        <ActivityIndicator size="large" color="#FF9933" />
        {showSlowLoadHint && (
          <View style={{ marginTop: 14 }}>
            <Text style={{ color: "#9ca3af", fontSize: 12, fontFamily: "Manrope_500Medium" }}>
              Taking longer than expected...
            </Text>
          </View>
        )}
      </View>
    );
  }

  return (
    <Stack
      screenOptions={({ route }) => ({
        headerShown: !route.name.startsWith("tempobook"),
        contentStyle: { backgroundColor: "#0f0f0f" },
        animation: "slide_from_right",
      })}
    >
      <Stack.Screen name="auth" options={{ headerShown: false, animation: "fade" }} />
      <Stack.Screen name="email-verify" options={{ headerShown: false, animation: "fade" }} />
      <Stack.Screen name="onboarding" options={{ headerShown: false, animation: "fade" }} />
      <Stack.Screen name="index" options={{ headerShown: false, animation: "fade" }} />
      <Stack.Screen
        name="restaurant/[id]"
        options={{ headerShown: false, animation: "slide_from_right" }}
      />
      <Stack.Screen
        name="cuisine/[name]"
        options={{ headerShown: false, animation: "slide_from_right" }}
      />
      <Stack.Screen
        name="discover/[section]"
        options={{ headerShown: false, animation: "slide_from_right" }}
      />
      <Stack.Screen
        name="waitlist/[id]"
        options={{ headerShown: false, animation: "slide_from_bottom" }}
      />
      <Stack.Screen
        name="profile"
        options={{ headerShown: false, animation: "slide_from_right" }}
      />
      <Stack.Screen
        name="map"
        options={{ headerShown: false, animation: "slide_from_right" }}
      />
      <Stack.Screen
        name="admin-pulse"
        options={{ headerShown: false, animation: "slide_from_bottom" }}
      />
      <Stack.Screen
        name="admin-orders"
        options={{ headerShown: false, animation: "slide_from_bottom" }}
      />
      <Stack.Screen
        name="admin-portal"
        options={{ headerShown: false, animation: "slide_from_right" }}
      />
      <Stack.Screen
        name="admin-users"
        options={{ headerShown: false, animation: "slide_from_right" }}
      />
      <Stack.Screen
        name="admin-menu-images"
        options={{ headerShown: false, animation: "slide_from_right" }}
      />
      <Stack.Screen
        name="join/[id]"
        options={{ headerShown: false, animation: "slide_from_bottom" }}
      />
      <Stack.Screen
        name="favorites"
        options={{ headerShown: false, animation: "slide_from_right" }}
      />
      <Stack.Screen
        name="my-orders"
        options={{ headerShown: false, animation: "slide_from_right" }}
      />
      <Stack.Screen
        name="order-confirmation"
        options={{ headerShown: false, animation: "slide_from_bottom" }}
      />
      <Stack.Screen
        name="terms"
        options={{ headerShown: false, animation: "slide_from_right" }}
      />
      <Stack.Screen
        name="privacy"
        options={{ headerShown: false, animation: "slide_from_right" }}
      />
    </Stack>
  );
}

export default function RootLayout() {
  const [bricolageLoaded, bricolageError] = useBricolage({
    BricolageGrotesque_800ExtraBold,
    BricolageGrotesque_700Bold,
  });

  const [manropeLoaded, manropeError] = useManrope({
    Manrope_500Medium,
    Manrope_600SemiBold,
    Manrope_700Bold,
  });

  const [jetbrainsLoaded, jetbrainsError] = useJetBrains({
    JetBrainsMono_600SemiBold,
  });

  const fontsReady =
    (bricolageLoaded || bricolageError) &&
    (manropeLoaded || manropeError) &&
    (jetbrainsLoaded || jetbrainsError);

  useEffect(() => {
    if (fontsReady) {
      SplashScreen.hideAsync();
    }
  }, [fontsReady]);

  if (!fontsReady) {
    return <BrandedLoader message="Loading Rasvia..." />;
  }

  return (
    <GestureHandlerRootView style={{ flex: 1, backgroundColor: "#0f0f0f" }}>
      <SafeAreaProvider>
        <ThemeProvider value={rasviaTheme}>
          <StatusBar style="light" />
          <AuthProvider>
            <LocationProvider>
              <NotificationsProvider>
                <AuthGate />
                <GlobalTableReadyBanner />
              </NotificationsProvider>
            </LocationProvider>
          </AuthProvider>
        </ThemeProvider>
      </SafeAreaProvider>
    </GestureHandlerRootView>
  );
}
