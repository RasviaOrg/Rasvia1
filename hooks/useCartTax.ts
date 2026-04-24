import { useState, useEffect } from "react";
import { fetchCartTaxQuote } from "@/lib/tax-client";

export function useCartTax(
  restaurantId: number,
  items: Array<{ price_cents: number; quantity: number; stripe_tax_code: string }>,
) {
  const [taxCents, setTaxCents] = useState<number | null>(null);
  const [loading, setLoading] = useState<boolean>(true);

  useEffect(() => {
    if (!restaurantId || !items || items.length === 0) {
      setTaxCents(0);
      setLoading(false);
      return;
    }

    setLoading(true);

    const timer = setTimeout(async () => {
      try {
        const amount = await fetchCartTaxQuote(restaurantId, items);
        setTaxCents(amount);
      } catch (err) {
        console.error("useCartTax fetch error:", err);
        setTaxCents(0);
      } finally {
        setLoading(false);
      }
    }, 500);

    return () => clearTimeout(timer);
  }, [restaurantId, JSON.stringify(items)]);

  return { taxCents, loading };
}
