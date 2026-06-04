import React, {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useState,
} from "react";
import AsyncStorage from "@react-native-async-storage/async-storage";
import {
  DarkTheme,
  DefaultTheme,
  type Theme as NavigationTheme,
} from "expo-router/react-navigation";
import {
  LayoutAnimation,
  Platform,
  UIManager,
  useColorScheme,
} from "react-native";
import { useAuth } from "./auth-context";

/** Legacy global key — migrated per-user on first login. */
const LEGACY_APPEARANCE_KEY = "rasvia.appearance.v1";

function userAppearanceKey(userId: string) {
  return `rasvia.appearance.user.${userId}`;
}

if (
  Platform.OS === "android" &&
  UIManager.setLayoutAnimationEnabledExperimental
) {
  UIManager.setLayoutAnimationEnabledExperimental(true);
}

export type AppearanceMode = "dark" | "light" | "system";

export type AppColors = {
  background: string;
  backgroundElevated: string;
  card: string;
  cardBorder: string;
  text: string;
  textSecondary: string;
  textMuted: string;
  iconMuted: string;
  /** Settings / list row icon tile */
  iconTileBg: string;
  navBar: string;
  navBarBorder: string;
  pressableBg: string;
  switchTrackOff: string;
  saffron: string;
  /** Home / discover chrome */
  homeBg: string;
  homeHeaderBg: string;
  homeSurface: string;
  homeBorder: string;
  skeleton: string;
  skeletonLine: string;
};

const darkColors: AppColors = {
  background: "#0f0f0f",
  backgroundElevated: "#18181b",
  card: "#1a1a1a",
  cardBorder: "#2a2a2a",
  text: "#f5f5f5",
  textSecondary: "#e4e4e7",
  textMuted: "#a1a1aa",
  iconMuted: "#A1A1AA",
  iconTileBg: "rgba(255,255,255,0.08)",
  navBar: "#0f0f0f",
  navBarBorder: "#202020",
  pressableBg: "#262626",
  switchTrackOff: "#333333",
  saffron: "#FF9933",
  homeBg: "#161618",
  homeHeaderBg: "#18181b",
  homeSurface: "#1c1c1f",
  homeBorder: "#2d2d32",
  skeleton: "#121212",
  skeletonLine: "#1e1e1e",
};

const lightColors: AppColors = {
  /** Lightest canvas — slightly whiter than surfaces/cards */
  background: "#fafafa",
  backgroundElevated: "#f4f4f6",
  /** Cards / elevated panels — subtle grey vs background */
  card: "#ececf0",
  cardBorder: "#d8d8dc",
  text: "#0f0f0f",
  textSecondary: "#3a3a3c",
  textMuted: "#6b7280",
  iconMuted: "#6b7280",
  iconTileBg: "rgba(0,0,0,0.06)",
  /** Match card/surfaces so the tab bar reads as part of the same grey tier */
  navBar: "#ececf0",
  navBarBorder: "#d8d8dc",
  pressableBg: "#e4e4e9",
  switchTrackOff: "#d1d1d6",
  saffron: "#FF9933",
  homeBg: "#fafafa",
  homeHeaderBg: "#fafafa",
  homeSurface: "#ececf0",
  homeBorder: "#d8d8dc",
  skeleton: "#e8e8ec",
  skeletonLine: "#d8d8dc",
};

function buildNavigationTheme(colors: AppColors, isDark: boolean): NavigationTheme {
  const base = isDark ? DarkTheme : DefaultTheme;
  return {
    ...base,
    colors: {
      ...base.colors,
      primary: colors.saffron,
      background: colors.background,
      card: colors.card,
      text: colors.text,
      border: colors.cardBorder,
      notification: colors.saffron,
    },
  };
}

type AppThemeContextValue = {
  /** User-selected appearance (may be `system`). */
  appearance: AppearanceMode;
  /** Resolved after applying system preference. */
  isDark: boolean;
  colors: AppColors;
  navigationTheme: NavigationTheme;
  setAppearance: (mode: AppearanceMode) => void;
};

const AppThemeContext = createContext<AppThemeContextValue | null>(null);

/**
 * Must render **inside** `AuthProvider` so appearance can be stored per user
 * and fall back to **system** when logged out.
 */
export function AppThemeProvider({ children }: { children: React.ReactNode }) {
  const systemColorScheme = useColorScheme();
  const { session } = useAuth();
  const userId = session?.user?.id ?? null;

  const [appearance, setAppearanceState] = useState<AppearanceMode>("system");

  useEffect(() => {
    let cancelled = false;
    (async () => {
      if (!userId) {
        LayoutAnimation.configureNext(LayoutAnimation.Presets.easeInEaseOut);
        if (!cancelled) setAppearanceState("system");
        return;
      }
      try {
        const key = userAppearanceKey(userId);
        let raw = await AsyncStorage.getItem(key);
        if (!raw) {
          const legacy = await AsyncStorage.getItem(LEGACY_APPEARANCE_KEY);
          if (legacy === "light" || legacy === "dark" || legacy === "system") {
            raw = legacy;
            await AsyncStorage.setItem(key, legacy);
          }
        }
        if (cancelled) return;
        if (raw === "light" || raw === "dark" || raw === "system") {
          setAppearanceState(raw);
        } else {
          setAppearanceState("system");
        }
      } catch {
        if (!cancelled) setAppearanceState("system");
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [userId]);

  const isDark =
    appearance === "system"
      ? systemColorScheme !== "light"
      : appearance === "dark";

  const setAppearance = useCallback(
    (mode: AppearanceMode) => {
      LayoutAnimation.configureNext(LayoutAnimation.Presets.easeInEaseOut);
      setAppearanceState(mode);
      const uid = session?.user?.id;
      if (uid) {
        void AsyncStorage.setItem(userAppearanceKey(uid), mode);
      }
    },
    [session?.user?.id]
  );

  const colors = isDark ? darkColors : lightColors;

  const value = useMemo<AppThemeContextValue>(
    () => ({
      appearance,
      isDark,
      colors,
      navigationTheme: buildNavigationTheme(colors, isDark),
      setAppearance,
    }),
    [appearance, isDark, colors, setAppearance]
  );

  return <AppThemeContext.Provider value={value}>{children}</AppThemeContext.Provider>;
}

export function useAppTheme(): AppThemeContextValue {
  const ctx = useContext(AppThemeContext);
  if (!ctx) {
    throw new Error("useAppTheme must be used within AppThemeProvider");
  }
  return ctx;
}

export { darkColors, lightColors };
