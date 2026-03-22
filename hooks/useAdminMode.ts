import { useState, useEffect } from "react";
import { supabase } from "../lib/supabase";
import { useAuth } from "../lib/auth-context";

export function useAdminMode() {
  const { session } = useAuth();
  const [isAdmin, setIsAdmin] = useState(false);
  const [isRestaurantOwner, setIsRestaurantOwner] = useState(false);
  const [ownedRestaurantId, setOwnedRestaurantId] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    async function checkAdminStatus() {
      if (!session?.user?.id) {
        setIsAdmin(false);
        setIsRestaurantOwner(false);
        setOwnedRestaurantId(null);
        setLoading(false);
        return;
      }

      try {
        const { data, error } = await supabase
          .from("profiles")
          .select("role")
          .eq("id", session.user.id)
          .maybeSingle();

        if (error) {
          console.error("Error fetching role:", error.message);
          setIsAdmin(false);
          setIsRestaurantOwner(false);
        } else if (data && data.role === "admin") {
          setIsAdmin(true);
          setIsRestaurantOwner(false);
        } else if (data && data.role === "restaurant_owner") {
          setIsAdmin(false);
          setIsRestaurantOwner(true);
          // Fetch which restaurant this user owns
          const { data: restData } = await supabase
            .from("restaurants")
            .select("id")
            .eq("owner_id", session.user.id)
            .maybeSingle();
          setOwnedRestaurantId(restData ? String(restData.id) : null);
        } else {
          setIsAdmin(false);
          setIsRestaurantOwner(false);
          setOwnedRestaurantId(null);
        }
      } catch (error) {
        console.error("Caught error checking admin status:", error);
        setIsAdmin(false);
        setIsRestaurantOwner(false);
        setOwnedRestaurantId(null);
      } finally {
        setLoading(false);
      }
    }

    checkAdminStatus();
  }, [session?.user?.id]);

  return { isAdmin, isRestaurantOwner, ownedRestaurantId, loading };
}
