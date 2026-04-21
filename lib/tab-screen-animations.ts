import { FadeInDown, FadeIn, FadeOut } from "react-native-reanimated";

/** Shared tab mount / switch — quick spring so each main tab feels snappy. */
export const TAB_SCREEN_ENTERING = FadeInDown.duration(380)
  .springify()
  .damping(19)
  .stiffness(205);

/** Loading veil — keep in sync with `LoadingBlurOverlay`. */
export const LOADING_BLUR_ENTERING = FadeIn.duration(400);
export const LOADING_BLUR_EXITING = FadeOut.duration(450);
