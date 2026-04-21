/**
 * Trending / hero horizontal carousel on the home feed.
 * Cards were nearly full-bleed; we cap width slightly inside the screen for breathing room.
 */
export const HERO_CAROUSEL_WIDTH_SUBTRACT = 72;
/** Space between peeking cards */
export const HERO_CARD_ITEM_GAP = 16;
/** FlatList content padding (matches visual side inset with card width) */
export const HERO_FLATLIST_PADDING_H = 24;

export function heroCardWidth(screenWidth: number): number {
  return Math.max(260, screenWidth - HERO_CAROUSEL_WIDTH_SUBTRACT);
}

export function heroCarouselSnapInterval(screenWidth: number): number {
  return heroCardWidth(screenWidth) + HERO_CARD_ITEM_GAP;
}
