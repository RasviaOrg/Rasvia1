/**
 * Home Cache
 *
 * Lightweight, in-memory cache for the home screen so that switching tabs
 * (which remounts the home stack screen) re-renders instantly using the
 * previously fetched data. The cache survives for the lifetime of the JS
 * runtime — i.e. until the app is closed.
 *
 * Realtime subscriptions in the home screen and other contexts continue to
 * push fresh data into the cache, so the cached values stay current even
 * when nobody is rendering them.
 */

import type { UIRestaurant } from "./restaurant-types";
import type { RestaurantMediaSlide } from "./restaurant-media";

interface HomeCacheState {
  restaurants: UIRestaurant[];
  restaurantsAt: number;
  restaurantMediaById: Record<string, RestaurantMediaSlide[]>;
  favoriteRestaurantIds: number[];
  recentlyViewedIds: number[];
  announcementBanner: string;
  userDietaryType: string;
  userRestrictedDays: string[];
  ownerId: string | null;
}

const cache: HomeCacheState = {
  restaurants: [],
  restaurantsAt: 0,
  restaurantMediaById: {},
  favoriteRestaurantIds: [],
  recentlyViewedIds: [],
  announcementBanner: "",
  userDietaryType: "",
  userRestrictedDays: [],
  ownerId: null,
};

// Restaurants are considered fresh for 5 minutes. After that we still use
// the cached value (so the screen renders immediately) but trigger a
// background refresh.
export const HOME_RESTAURANT_FRESH_MS = 5 * 60 * 1000;

export function getHomeCacheRestaurants() {
  return cache.restaurants;
}

export function setHomeCacheRestaurants(list: UIRestaurant[]) {
  cache.restaurants = list;
  cache.restaurantsAt = Date.now();
}

export function patchHomeCacheRestaurant(updated: UIRestaurant) {
  cache.restaurants = cache.restaurants.map((r) =>
    r.id === updated.id ? updated : r,
  );
}

export function isHomeCacheRestaurantsFresh() {
  return (
    cache.restaurants.length > 0 &&
    Date.now() - cache.restaurantsAt < HOME_RESTAURANT_FRESH_MS
  );
}

export function getHomeCacheMedia() {
  return cache.restaurantMediaById;
}

export function setHomeCacheMedia(media: Record<string, RestaurantMediaSlide[]>) {
  cache.restaurantMediaById = media;
}

export function getHomeCacheFavorites() {
  return cache.favoriteRestaurantIds;
}

export function setHomeCacheFavorites(ids: number[], ownerId: string | null) {
  cache.favoriteRestaurantIds = ids;
  cache.ownerId = ownerId;
}

export function getHomeCacheRecentlyViewed() {
  return cache.recentlyViewedIds;
}

export function setHomeCacheRecentlyViewed(ids: number[]) {
  cache.recentlyViewedIds = ids;
}

export function getHomeCacheAnnouncement() {
  return cache.announcementBanner;
}

export function setHomeCacheAnnouncement(text: string) {
  cache.announcementBanner = text;
}

export function getHomeCacheDietary() {
  return {
    userDietaryType: cache.userDietaryType,
    userRestrictedDays: cache.userRestrictedDays,
  };
}

export function setHomeCacheDietary(type: string, restrictedDays: string[]) {
  cache.userDietaryType = type;
  cache.userRestrictedDays = restrictedDays;
}

export function getHomeCacheOwnerId() {
  return cache.ownerId;
}

/** Drop user-scoped cached data. Called when the signed-in user changes. */
export function clearUserHomeCache() {
  cache.favoriteRestaurantIds = [];
  cache.recentlyViewedIds = [];
  cache.userDietaryType = "";
  cache.userRestrictedDays = [];
  cache.ownerId = null;
}
