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
} from "@react-navigation/native";

const STORAGE_KEY = "rasvia.appearance.v1";

export type AppearanceMode = "dark" | "light";

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
  background: "#f2f2f7",
  backgroundElevated: "#ffffff",
  card: "#ffffff",
  cardBorder: "#d1d1d6",
  text: "#0f0f0f",
  textSecondary: "#3a3a3c",
  textMuted: "#6b7280",
  iconMuted: "#6b7280",
  iconTileBg: "rgba(0,0,0,0.06)",
  navBar: "#ffffff",
  navBarBorder: "#c6c6c8",
  pressableBg: "#e5e5ea",
  switchTrackOff: "#d1d1d6",
  saffron: "#FF9933",
  homeBg: "#e8e8ed",
  homeHeaderBg: "#ffffff",
  homeSurface: "#ffffff",
  homeBorder: "#d1d1d6",
  skeleton: "#e5e5ea",
  skeletonLine: "#d1d1d6",
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
  appearance: AppearanceMode;
  isDark: boolean;
  colors: AppColors;
  navigationTheme: NavigationTheme;
  setAppearance: (mode: AppearanceMode) => void;
};

const AppThemeContext = createContext<AppThemeContextValue | null>(null);

export function AppThemeProvider({ children }: { children: React.ReactNode }) {
  const [appearance, setAppearanceState] = useState<AppearanceMode>("dark");

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const raw = await AsyncStorage.getItem(STORAGE_KEY);
        if (cancelled) return;
        if (raw === "light" || raw === "dark") {
          setAppearanceState(raw);
        }
      } catch {
        /* ignore */
      }
    })();
    return () => {
      cancelled = true;
    };
  }, []);

  const setAppearance = useCallback((mode: AppearanceMode) => {
    setAppearanceState(mode);
    void AsyncStorage.setItem(STORAGE_KEY, mode);
  }, []);

  const isDark = appearance === "dark";
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
