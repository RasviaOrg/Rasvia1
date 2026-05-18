/**
 * useLayout — single source of truth for adaptive layout in Rasvia.
 *
 * Rules:
 * - Consume this hook (or useWindowDimensions) inside components. NEVER call
 *   Dimensions.get() at module scope for layout measurements.
 * - getColumns() takes *container* width, not window width — critical in two-
 *   pane layouts where a pane is narrower than the full window.
 *
 * Size classes mirror Apple's adaptive layout language:
 *   compact   < 600   — phones, iPad 1/3 Split View
 *   medium    600–899 — iPad portrait, iPad 1/2 Split View
 *   expanded  ≥ 900   — iPad landscape, iPad 2/3 Split View, Stage Manager wide
 */
import { useMemo } from "react";
import { useWindowDimensions } from "react-native";

export type SizeClass = "compact" | "medium" | "expanded";
export type NavMode = "bottom" | "rail";

export type LayoutInfo = {
  width: number;
  height: number;
  isLandscape: boolean;
  sizeClass: SizeClass;
  /** Maximum width for the primary content column. Compact = full width. */
  contentMaxWidth: number;
  /** Horizontal page gutter in points. */
  gutter: number;
  /** Navigation chrome mode driven by sizeClass. */
  navMode: NavMode;
  /** Rail width when navMode = "rail", otherwise 0. */
  navRailWidth: number;
  /**
   * Compute ideal column count for a grid given a container width and the
   * minimum card width. Always returns at least 1.
   *
   * Use containerWidth (the pane the grid lives in), NOT the window width,
   * so two-pane layouts get the right count per pane.
   */
  getColumns(containerWidth: number, minCardWidth: number): number;
};

function getSizeClass(width: number): SizeClass {
  if (width < 600) return "compact";
  if (width < 900) return "medium";
  return "expanded";
}

export const NAV_RAIL_WIDTH = 72;

export function useLayout(): LayoutInfo {
  const { width, height } = useWindowDimensions();

  return useMemo<LayoutInfo>(() => {
    const sizeClass = getSizeClass(width);
    const isLandscape = width > height;
    const navMode: NavMode = sizeClass === "compact" ? "bottom" : "rail";
    const navRailWidth = navMode === "rail" ? NAV_RAIL_WIDTH : 0;

    let contentMaxWidth: number;
    let gutter: number;
    switch (sizeClass) {
      case "expanded":
        contentMaxWidth = 1100;
        gutter = 24;
        break;
      case "medium":
        contentMaxWidth = 760;
        gutter = 20;
        break;
      default:
        contentMaxWidth = width;
        gutter = 16;
    }

    const getColumns = (containerWidth: number, minCardWidth: number): number => {
      if (minCardWidth <= 0) return 1;
      return Math.max(1, Math.floor(containerWidth / minCardWidth));
    };

    return {
      width,
      height,
      isLandscape,
      sizeClass,
      contentMaxWidth,
      gutter,
      navMode,
      navRailWidth,
      getColumns,
    };
  }, [width, height]);
}

/** Stable reference — consume in non-component helpers only when you already
 *  have sizeClass from context/props; never call Dimensions.get() instead. */
export function sizeClassFromWidth(width: number): SizeClass {
  return getSizeClass(width);
}
