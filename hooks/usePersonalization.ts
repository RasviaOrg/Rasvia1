/**
 * usePersonalization — derives user-specific data from order history.
 *
 * Returns:
 *  - orderedRestaurantIds  : IDs of restaurants the user has ordered from (most recent first)
 *  - topCuisineTags        : cuisine tags ordered by how often the user has visited them
 *  - lastOrderByRestaurant : map of restaurantId → last order info (for "Order Again")
 */
import { useState, useEffect, useCallback } from "react";
import { supabase } from "@/lib/supabase";
import { useAuth } from "@/lib/auth-context";

export type MealPeriod = 'breakfast' | 'lunch' | 'dinner' | 'specials' | 'all_day' | null;

export interface LastOrderItem {
  name: string;
  quantity: number;
  mealPeriod: MealPeriod;
  imageUrl: string | null;
}

export interface LastOrder {
  orderId: string;
  restaurantId: string;
  restaurantName: string;
  createdAt: string;
  /** Short summary of what was ordered, e.g. "Butter Chicken, Naan (×2)" */
  itemsSummary: string;
  /** Structured items with meal period for colored display */
  items: LastOrderItem[];
  subtotal: number;
}

export interface PersonalizationData {
  /** Restaurant IDs the user has ordered from, most-recent-first, deduplicated */
  orderedRestaurantIds: string[];
  /** Cuisine tags ranked by visit frequency */
  topCuisineTags: string[];
  /** Most recent completed order per restaurant */
  lastOrderByRestaurant: Record<string, LastOrder>;
  loading: boolean;
}

export function usePersonalization(): PersonalizationData {
  const { session } = useAuth();
  const [data, setData] = useState<PersonalizationData>({
    orderedRestaurantIds: [],
    topCuisineTags: [],
    lastOrderByRestaurant: {},
    loading: true,
  });

  const fetchPersonalization = useCallback(async () => {
    const userId = session?.user?.id;
    if (!userId) {
      setData((d) => ({ ...d, loading: false }));
      return;
    }

    try {
      // Fetch user's last 30 completed/served orders, newest first
      const { data: orders, error } = await supabase
        .from("orders")
        .select(`
          id,
          restaurant_id,
          status,
          subtotal,
          created_at,
          restaurants ( name, cuisine_tags ),
          order_items ( name, quantity, menu_item_id )
        `)
        .eq("created_by", userId)
        .in("status", ["completed", "served", "active", "preparing", "ready"])
        .order("created_at", { ascending: false })
        .limit(30);

      if (error) throw error;
      if (!orders || orders.length === 0) {
        setData({ orderedRestaurantIds: [], topCuisineTags: [], lastOrderByRestaurant: {}, loading: false });
        return;
      }

      // ── Collect all unique menu_item_ids we need meal_period for ──
      const menuItemIds = new Set<number>();
      for (const o of orders) {
        const items: { menu_item_id?: number }[] = (o.order_items as any) ?? [];
        items.forEach(i => { if (i.menu_item_id) menuItemIds.add(i.menu_item_id); });
      }
      // Build maps: menu_item_id → meal_period / image_url
      const mealPeriodMap: Record<number, MealPeriod> = {};
      const menuImageMap: Record<number, string | null> = {};
      if (menuItemIds.size > 0) {
        const { data: menuRows } = await supabase
          .from("menu_items")
          .select("id, meal_times, image_url")
          .in("id", Array.from(menuItemIds));
        (menuRows ?? []).forEach((r: any) => {
          const first = Array.isArray(r.meal_times) ? r.meal_times[0] : (r.meal_times ?? null);
          mealPeriodMap[r.id] = (first ?? null) as MealPeriod;
          const rawImage = typeof r.image_url === "string" ? r.image_url.trim() : "";
          if (!rawImage) {
            menuImageMap[r.id] = null;
          } else if (/^https?:\/\//i.test(rawImage)) {
            menuImageMap[r.id] = rawImage;
          } else {
            menuImageMap[r.id] = supabase.storage.from("community-images").getPublicUrl(rawImage).data.publicUrl;
          }
        });
      }

      // ── Deduplicated restaurant IDs (most recent first) ──
      const seenIds = new Set<string>();
      const orderedRestaurantIds: string[] = [];
      for (const o of orders) {
        const rid = o.restaurant_id?.toString();
        if (rid && !seenIds.has(rid)) {
          seenIds.add(rid);
          orderedRestaurantIds.push(rid);
        }
      }

      // ── Cuisine tag frequency map ──
      const tagCount: Record<string, number> = {};
      for (const o of orders) {
        const tags: string[] = (o.restaurants as any)?.cuisine_tags ?? [];
        for (const tag of tags) {
          tagCount[tag] = (tagCount[tag] ?? 0) + 1;
        }
      }
      const topCuisineTags = Object.entries(tagCount)
        .sort((a, b) => b[1] - a[1])
        .map(([tag]) => tag)
        .slice(0, 5);

      // ── Last order per restaurant ──
      const lastOrderByRestaurant: Record<string, LastOrder> = {};
      for (const o of orders) {
        const rid = o.restaurant_id?.toString();
        if (!rid || lastOrderByRestaurant[rid]) continue; // already have the most recent

        const items: { name: string; quantity: number; menu_item_id?: number }[] = (o.order_items as any) ?? [];
        const topItems = items.slice(0, 3);
        const itemsSummary = topItems
          .map((i) => (i.quantity > 1 ? `${i.name} (×${i.quantity})` : i.name))
          .join(", ");
        const structuredItems: LastOrderItem[] = topItems.map((i) => ({
          name: i.name,
          quantity: i.quantity,
          mealPeriod: i.menu_item_id != null ? (mealPeriodMap[i.menu_item_id] ?? null) : null,
          imageUrl: i.menu_item_id != null ? (menuImageMap[i.menu_item_id] ?? null) : null,
        }));

        lastOrderByRestaurant[rid] = {
          orderId: o.id.toString(),
          restaurantId: rid,
          restaurantName: (o.restaurants as any)?.name ?? "Restaurant",
          createdAt: o.created_at,
          itemsSummary,
          items: structuredItems,
          subtotal: Number(o.subtotal),
        };
      }

      setData({ orderedRestaurantIds, topCuisineTags, lastOrderByRestaurant, loading: false });
    } catch (err) {
      console.error("usePersonalization error:", err);
      setData((d) => ({ ...d, loading: false }));
    }
  }, [session?.user?.id]);

  useEffect(() => {
    fetchPersonalization();
  }, [fetchPersonalization]);

  return data;
}
