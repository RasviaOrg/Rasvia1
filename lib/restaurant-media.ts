import { supabase } from "@/lib/supabase";

export const RECENTLY_VIEWED_LIMIT = 10;

export type RestaurantMediaSlide = {
  id: string;
  restaurantId: string;
  position: number;
  imageUrl: string;
  menuItemId: string | null;
  menuItemName: string | null;
};

function toNumberList(value: unknown): number[] {
  if (!Array.isArray(value)) return [];
  const seen = new Set<number>();
  const out: number[] = [];
  for (const raw of value) {
    const n = Number(raw);
    if (!Number.isFinite(n) || n <= 0) continue;
    if (seen.has(n)) continue;
    seen.add(n);
    out.push(n);
  }
  return out;
}

export function parseRecentlyViewed(value: unknown): number[] {
  return toNumberList(value).slice(0, RECENTLY_VIEWED_LIMIT);
}

export async function fetchRecentlyViewedRestaurantIds(userId: string): Promise<number[]> {
  try {
    const { data, error } = await supabase
      .from("profiles")
      .select("recently_viewed_restaurants")
      .eq("id", userId)
      .single();
    if (error) throw error;
    return parseRecentlyViewed((data as any)?.recently_viewed_restaurants);
  } catch {
    return [];
  }
}

export async function recordRecentlyViewedRestaurant(userId: string, restaurantId: number): Promise<void> {
  if (!userId || !Number.isFinite(restaurantId)) return;
  try {
    const { data, error } = await supabase
      .from("profiles")
      .select("recently_viewed_restaurants")
      .eq("id", userId)
      .single();
    if (error) throw error;

    const existing = parseRecentlyViewed((data as any)?.recently_viewed_restaurants).filter((id) => id !== restaurantId);
    const next = [restaurantId, ...existing].slice(0, RECENTLY_VIEWED_LIMIT);

    await supabase
      .from("profiles")
      .update({ recently_viewed_restaurants: next })
      .eq("id", userId);
  } catch {
    // ignore silently so viewing menu is never blocked
  }
}

function normalizeImageUrl(value: unknown): string {
  const raw = String(value ?? "").trim();
  if (!raw) return "";
  if (/^https?:\/\//i.test(raw)) return raw;
  return supabase.storage.from("restaurant-images").getPublicUrl(raw).data.publicUrl;
}

export async function fetchRestaurantMediaSlides(restaurantIds: string[]): Promise<Record<string, RestaurantMediaSlide[]>> {
  const ids = Array.from(new Set(restaurantIds.map((id) => Number(id)).filter((n) => Number.isFinite(n) && n > 0)));
  if (ids.length === 0) return {};

  try {
    const { data, error } = await supabase
      .from("restaurant_media_slides")
      .select("id, restaurant_id, position, image_url, menu_item_id, menu_items(name, image_url)")
      .in("restaurant_id", ids)
      .order("position", { ascending: true });

    if (error) throw error;

    const grouped: Record<string, RestaurantMediaSlide[]> = {};
    for (const row of (data ?? []) as any[]) {
      const restaurantId = String(row.restaurant_id ?? "");
      if (!restaurantId) continue;
      const explicitImage = normalizeImageUrl(row.image_url);
      const menuItemImage = normalizeImageUrl((row.menu_items as any)?.image_url);
      const imageUrl = explicitImage || menuItemImage;
      if (!imageUrl) continue;

      const slide: RestaurantMediaSlide = {
        id: String(row.id),
        restaurantId,
        position: Number(row.position ?? 0),
        imageUrl,
        menuItemId: row.menu_item_id ? String(row.menu_item_id) : null,
        menuItemName: (row.menu_items as any)?.name ? String((row.menu_items as any).name) : null,
      };

      if (!grouped[restaurantId]) grouped[restaurantId] = [];
      grouped[restaurantId].push(slide);
    }

    return grouped;
  } catch {
    return {};
  }
}
