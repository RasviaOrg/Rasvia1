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
        const [{ data: profileData, error: profileError }, { data: isPlatformAdmin }, { data: isRestaurantAdmin }, { data: myRestaurantId }] = await Promise.all([
          supabase
            .from("profiles")
            .select("role")
            .eq("id", session.user.id)
            .maybeSingle(),
          supabase.rpc("is_platform_admin"),
          supabase.rpc("am_i_restaurant_admin"),
          supabase.rpc("get_my_restaurant_id"),
        ]);

        if (profileError) {
          console.error("Error fetching role:", profileError.message);
        }

        const profileRole = (profileData as any)?.role as string | undefined;
        const resolvedIsAdmin = isPlatformAdmin === true || profileRole === "admin";
        const resolvedIsRestaurantOwner =
          isRestaurantAdmin === true || profileRole === "restaurant_owner";

        setIsAdmin(resolvedIsAdmin);
        setIsRestaurantOwner(resolvedIsRestaurantOwner);

        if (myRestaurantId != null) {
          setOwnedRestaurantId(String(myRestaurantId));
          return;
        }

        // Fallback for environments where helper RPCs are unavailable/misconfigured.
        const { data: fallbackOwned } = await supabase
          .from("restaurants")
          .select("id")
          .eq("owner_id", session.user.id)
          .limit(1)
          .maybeSingle();
        if (fallbackOwned?.id != null) {
          setOwnedRestaurantId(String(fallbackOwned.id));
          return;
        }

        if (resolvedIsRestaurantOwner) {
          const { data: fallbackStaff } = await supabase
            .from("restaurant_staff")
            .select("restaurant_id")
            .eq("user_id", session.user.id)
            .limit(1)
            .maybeSingle();
          setOwnedRestaurantId(
            fallbackStaff?.restaurant_id != null
              ? String(fallbackStaff.restaurant_id)
              : null
          );
          return;
        }

        setOwnedRestaurantId(null);
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
