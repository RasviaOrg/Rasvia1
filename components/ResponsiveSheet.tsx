/**
 * ResponsiveSheet — adaptive modal container.
 *
 * mode="bottom"  → full-width bottom sheet (phone default)
 * mode="center"  → centered card overlay (medium sizeClass default)
 * mode="side"    → right-anchored side panel (expanded sizeClass)
 *
 * When sizeClass is not overridden the component picks the appropriate mode
 * automatically:
 *   compact  → bottom
 *   medium   → center
 *   expanded → side (for drawers) or center (for dialogs, via forceCenterOnExpanded)
 *
 * All consumers get keyboard avoidance, safe-area insets, and consistent
 * overlay treatment for free.
 */
import React from "react";
import {
  View,
  Pressable,
  ScrollView,
  KeyboardAvoidingView,
  Platform,
  StyleSheet,
  useWindowDimensions,
} from "react-native";
import Animated, {
  FadeIn,
  FadeOut,
  SlideInDown,
  SlideInRight,
  SlideOutDown,
  SlideOutRight,
  ZoomIn,
  ZoomOut,
} from "react-native-reanimated";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { useLayout } from "@/lib/use-layout";
import { useAppTheme } from "@/lib/app-theme";

export type SheetMode = "bottom" | "center" | "side";

interface ResponsiveSheetProps {
  /** Control visibility externally. */
  visible: boolean;
  /** Called when the overlay or back is pressed. */
  onClose: () => void;
  /** Header slot — rendered above a divider at the top of the sheet. */
  header?: React.ReactNode;
  /** Main scrollable body content. */
  body: React.ReactNode;
  /** Footer slot — rendered below a divider, not scrollable. */
  footer?: React.ReactNode;
  /**
   * Max height of the sheet as a fraction of the window height (default 0.88).
   * Only applies to bottom and center modes.
   */
  maxHeightFraction?: number;
  /**
   * Max width for center / side modes (default 640 center, 420 side).
   * Ignored in bottom mode.
   */
  maxWidth?: number;
  /**
   * Force center mode on expanded sizeClass (e.g. for alert-style dialogs).
   * When false (default), expanded uses "side".
   */
  forceCenterOnExpanded?: boolean;
  /** Override the auto-detected mode. */
  mode?: SheetMode;
  /** If true, the body ScrollView is disabled and body fills naturally. */
  noScroll?: boolean;
}

const AnimatedPressable = Animated.createAnimatedComponent(Pressable);

export function ResponsiveSheet({
  visible,
  onClose,
  header,
  body,
  footer,
  maxHeightFraction = 0.88,
  maxWidth,
  forceCenterOnExpanded = false,
  mode: modeProp,
  noScroll = false,
}: ResponsiveSheetProps) {
  const { colors, isDark } = useAppTheme();
  const { sizeClass } = useLayout();
  const insets = useSafeAreaInsets();
  const { height: windowHeight } = useWindowDimensions();

  const resolvedMode: SheetMode =
    modeProp ??
    (sizeClass === "compact"
      ? "bottom"
      : sizeClass === "medium"
        ? "center"
        : forceCenterOnExpanded
          ? "center"
          : "side");

  const sheetMaxWidth =
    maxWidth ??
    (resolvedMode === "side" ? 440 : 640);

  const overlayBg = isDark ? "rgba(0,0,0,0.82)" : "rgba(0,0,0,0.4)";

  const sheetBg = colors.card;
  const dividerColor = colors.cardBorder;

  if (!visible) return null;

  const sheetStyle =
    resolvedMode === "bottom"
      ? styles.sheetBottom
      : resolvedMode === "center"
        ? [styles.sheetCenter, { maxWidth: sheetMaxWidth }]
        : [styles.sheetSide, { maxWidth: sheetMaxWidth }];

  const entering =
    resolvedMode === "bottom"
      ? SlideInDown.duration(420).springify()
      : resolvedMode === "center"
        ? ZoomIn.duration(260)
        : SlideInRight.duration(340).springify();

  const exiting =
    resolvedMode === "bottom"
      ? SlideOutDown.duration(300)
      : resolvedMode === "center"
        ? ZoomOut.duration(200)
        : SlideOutRight.duration(280);

  const maxH = windowHeight * maxHeightFraction;

  const BodyWrapper = noScroll ? View : ScrollView;
  const bodyWrapperProps = noScroll
    ? { style: { flexShrink: 1 } }
    : {
        showsVerticalScrollIndicator: false,
        keyboardShouldPersistTaps: "handled" as const,
        contentContainerStyle: {
          paddingBottom:
            resolvedMode === "bottom" ? Math.max(insets.bottom, 8) : 16,
        },
      };

  return (
    <AnimatedPressable
      entering={FadeIn.duration(200)}
      exiting={FadeOut.duration(200)}
      onPress={onClose}
      style={[
        StyleSheet.absoluteFill,
        styles.overlay,
        { backgroundColor: overlayBg, zIndex: 1000 },
        resolvedMode === "side" && styles.overlaySideJustify,
      ]}
    >
      <KeyboardAvoidingView
        behavior={Platform.OS === "ios" ? "padding" : "height"}
        style={
          resolvedMode === "side"
            ? styles.kavSide
            : resolvedMode === "center"
              ? styles.kavCenter
              : styles.kavBottom
        }
        pointerEvents="box-none"
      >
        <Animated.View
          entering={entering}
          exiting={exiting}
          onStartShouldSetResponder={() => true}
          onTouchEnd={(e) => e.stopPropagation()}
          style={[
            sheetStyle,
            {
              backgroundColor: sheetBg,
              maxHeight:
                resolvedMode === "side" ? windowHeight : maxH,
              borderTopColor: dividerColor,
              borderLeftColor: dividerColor,
            },
          ]}
        >
          {header ? (
            <>
              <View style={{ paddingHorizontal: 20, paddingTop: resolvedMode === "bottom" ? 12 : 20, paddingBottom: 12 }}>
                {header}
              </View>
              <View style={{ height: 1, backgroundColor: dividerColor }} />
            </>
          ) : null}

          <BodyWrapper {...(bodyWrapperProps as any)}>
            <View style={{ paddingHorizontal: 20, paddingTop: 16 }}>
              {body}
            </View>
          </BodyWrapper>

          {footer ? (
            <>
              <View style={{ height: 1, backgroundColor: dividerColor }} />
              <View
                style={{
                  paddingHorizontal: 20,
                  paddingTop: 12,
                  paddingBottom:
                    resolvedMode === "bottom"
                      ? Math.max(insets.bottom, 12)
                      : 20,
                }}
              >
                {footer}
              </View>
            </>
          ) : resolvedMode === "bottom" && insets.bottom > 0 ? (
            <View style={{ height: insets.bottom }} />
          ) : null}
        </Animated.View>
      </KeyboardAvoidingView>
    </AnimatedPressable>
  );
}

const styles = StyleSheet.create({
  overlay: {
    justifyContent: "flex-end",
    alignItems: "stretch",
  },
  overlaySideJustify: {
    justifyContent: "flex-end",
    alignItems: "flex-end",
  },
  sheetBottom: {
    width: "100%",
    borderTopLeftRadius: 24,
    borderTopRightRadius: 24,
    borderTopWidth: 1,
    overflow: "hidden",
  },
  sheetCenter: {
    width: "90%",
    alignSelf: "center",
    borderRadius: 20,
    borderWidth: 1,
    overflow: "hidden",
    marginBottom: "auto",
    marginTop: "auto",
  },
  sheetSide: {
    height: "100%",
    borderLeftWidth: 1,
    overflow: "hidden",
  },
  kavBottom: {
    justifyContent: "flex-end",
  },
  kavCenter: {
    flex: 1,
    justifyContent: "center",
    alignItems: "center",
    paddingHorizontal: 16,
  },
  kavSide: {
    flex: 1,
    alignItems: "flex-end",
  },
});
