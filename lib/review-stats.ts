import { supabase } from "./supabase";

export interface ReviewStats {
  restaurantId: string;
  count: number;
  /** Weighted average 1-5, or 0 when there are no reviews */
  average: number;
}

/** Fetch review stats (count + average) for a single restaurant. */
export async function fetchReviewStats(restaurantId: string): Promise<ReviewStats> {
  const { data, error } = await supabase
    .from("restaurant_reviews")
    .select("rating")
    .eq("restaurant_id", restaurantId);

  if (error || !data || data.length === 0) {
    return { restaurantId, count: 0, average: 0 };
  }

  const count = data.length;
  const average = data.reduce((sum: number, r: { rating: number }) => sum + r.rating, 0) / count;
  return { restaurantId, count, average: Math.round(average * 10) / 10 };
}

/**
 * Fetch review stats for multiple restaurants in a single round trip.
 * Returns a Map keyed by restaurantId (as string).
 */
export async function fetchBatchReviewStats(
  restaurantIds: string[]
): Promise<Map<string, ReviewStats>> {
  const map = new Map<string, ReviewStats>();
  if (!restaurantIds.length) return map;

  const { data, error } = await supabase
    .from("restaurant_reviews")
    .select("restaurant_id, rating")
    .in("restaurant_id", restaurantIds);

  if (error || !data) return map;

  // Group ratings by restaurant_id
  const groups = new Map<string, number[]>();
  for (const row of data as { restaurant_id: number; rating: number }[]) {
    const id = String(row.restaurant_id);
    if (!groups.has(id)) groups.set(id, []);
    groups.get(id)!.push(row.rating);
  }

  for (const id of restaurantIds) {
    const ratings = groups.get(id) ?? [];
    const count = ratings.length;
    const average = count
      ? Math.round((ratings.reduce((s, r) => s + r, 0) / count) * 10) / 10
      : 0;
    map.set(id, { restaurantId: id, count, average });
  }

  return map;
}
