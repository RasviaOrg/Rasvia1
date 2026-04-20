import { supabase } from "@/lib/supabase";

export type UserCartOrderType = "dine_in" | "takeout";

export type UserCartRow = {
  id: number;
  user_id: string;
  restaurant_id: number;
  menu_item_id: number;
  quantity: number;
  order_type: UserCartOrderType;
};

export type UserCartListItem = {
  id: number;
  restaurantId: number;
  restaurantName: string;
  restaurantImage: string | null;
  menuItemId: number;
  itemName: string;
  itemImage: string | null;
  unitPrice: number;
  quantity: number;
  subtotal: number;
  orderType: UserCartOrderType;
};

export async function upsertUserCartItem(params: {
  userId: string;
  restaurantId: number;
  menuItemId: number;
  quantity: number;
  orderType?: UserCartOrderType;
}) {
  const { userId, restaurantId, menuItemId, quantity } = params;
  const orderType: UserCartOrderType = params.orderType ?? "dine_in";
  if (!userId) throw new Error("Missing user id");
  if (!Number.isFinite(restaurantId) || !Number.isFinite(menuItemId)) {
    throw new Error("Invalid cart item reference");
  }

  if (quantity <= 0) {
    const { error } = await supabase
      .from("user_cart_items")
      .delete()
      .eq("user_id", userId)
      .eq("restaurant_id", restaurantId)
      .eq("menu_item_id", menuItemId)
      .eq("order_type", orderType);
    if (error) throw error;
    return;
  }

  const { error } = await supabase.from("user_cart_items").upsert(
    {
      user_id: userId,
      restaurant_id: restaurantId,
      menu_item_id: menuItemId,
      quantity,
      order_type: orderType,
    },
    {
      onConflict: "user_id,restaurant_id,menu_item_id,order_type",
    }
  );
  if (error) throw error;
}

export async function fetchUserCartList(userId: string): Promise<UserCartListItem[]> {
  if (!userId) return [];

  const { data: cartRows, error: cartError } = await supabase
    .from("user_cart_items")
    .select("id, restaurant_id, menu_item_id, quantity, order_type")
    .eq("user_id", userId)
    .order("updated_at", { ascending: false });
  if (cartError) throw cartError;

  const rows = (cartRows ?? []) as Array<{
    id: number;
    restaurant_id: number;
    menu_item_id: number;
    quantity: number;
    order_type: string | null;
  }>;
  if (rows.length === 0) return [];

  const restaurantIds = Array.from(new Set(rows.map((r) => Number(r.restaurant_id)).filter((v) => Number.isFinite(v))));
  const menuItemIds = Array.from(new Set(rows.map((r) => Number(r.menu_item_id)).filter((v) => Number.isFinite(v))));

  const [{ data: restaurants, error: restaurantsError }, { data: menuItems, error: menuItemsError }] = await Promise.all([
    supabase
      .from("restaurants")
      .select("id, name, image_url")
      .in("id", restaurantIds),
    supabase
      .from("menu_items")
      .select("id, name, image_url, price, restaurant_id")
      .in("id", menuItemIds),
  ]);

  if (restaurantsError) throw restaurantsError;
  if (menuItemsError) throw menuItemsError;

  const restaurantMap = new Map<number, { id: number; name: string; image_url: string | null }>();
  for (const row of ((restaurants ?? []) as any[])) {
    restaurantMap.set(Number(row.id), {
      id: Number(row.id),
      name: String(row.name ?? "Restaurant"),
      image_url: row.image_url ? String(row.image_url) : null,
    });
  }

  const menuItemMap = new Map<number, { id: number; restaurant_id: number; name: string; image_url: string | null; price: number }>();
  for (const row of ((menuItems ?? []) as any[])) {
    menuItemMap.set(Number(row.id), {
      id: Number(row.id),
      restaurant_id: Number(row.restaurant_id),
      name: String(row.name ?? "Menu Item"),
      image_url: row.image_url ? String(row.image_url) : null,
      price: Number(row.price ?? 0),
    });
  }

  const list: UserCartListItem[] = [];
  for (const row of rows) {
    const menuItem = menuItemMap.get(Number(row.menu_item_id));
    const restaurant = restaurantMap.get(Number(row.restaurant_id));
    if (!menuItem || !restaurant) continue;

    const quantity = Math.max(1, Number(row.quantity ?? 1));
    const unitPrice = Number(menuItem.price ?? 0);
    const orderType: UserCartOrderType = row.order_type === "takeout" ? "takeout" : "dine_in";
    list.push({
      id: Number(row.id),
      restaurantId: Number(restaurant.id),
      restaurantName: restaurant.name,
      restaurantImage: restaurant.image_url,
      menuItemId: Number(menuItem.id),
      itemName: menuItem.name,
      itemImage: menuItem.image_url,
      unitPrice,
      quantity,
      subtotal: unitPrice * quantity,
      orderType,
    });
  }

  return list;
}

/**
 * Clear every cart item a user has for a single restaurant. Called after a
 * successful checkout so the cart doesn't still show the items that were
 * just ordered. Safe to call with unknown ids — invalid inputs no-op.
 */
export async function clearUserCartForRestaurant(
  userId: string,
  restaurantId: number,
  orderType?: UserCartOrderType,
): Promise<void> {
  if (!userId || !Number.isFinite(restaurantId)) return;
  let q = supabase
    .from("user_cart_items")
    .delete()
    .eq("user_id", userId)
    .eq("restaurant_id", restaurantId);
  if (orderType) q = q.eq("order_type", orderType);
  const { error } = await q;
  if (error) throw error;
}

export async function fetchRestaurantCartRows(userId: string, restaurantId: number) {
  if (!userId || !Number.isFinite(restaurantId)) return [];
  const { data, error } = await supabase
    .from("user_cart_items")
    .select("id, restaurant_id, menu_item_id, quantity, order_type")
    .eq("user_id", userId)
    .eq("restaurant_id", restaurantId);
  if (error) throw error;
  return (data ?? []) as Array<{
    id: number;
    restaurant_id: number;
    menu_item_id: number;
    quantity: number;
    order_type: string | null;
  }>;
}

