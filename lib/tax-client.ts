import { supabase } from "@/lib/supabase";

export async function fetchCartTaxQuote(restaurantId: number, items: Array<{ price_cents: number; quantity: number; stripe_tax_code: string }>): Promise<number> {
  if (!restaurantId || !items.length) return 0;
  
  const { data, error } = await supabase.functions.invoke("quote-cart-tax", {
    body: {
      restaurant_id: restaurantId,
      line_items: items,
    },
  });

  if (error) {
    console.warn("Failed to fetch tax quote from server. Falling back to 0 temporarily.", error);
    return 0;
  }

  if (data && typeof data === "object" && "error" in data && (data as { error?: string }).error) {
    console.warn("quote-cart-tax returned error:", (data as { error: string }).error);
    return 0;
  }

  return typeof data?.tax_amount_exclusive === "number" ? data.tax_amount_exclusive : 0;
}
