import { useState, useEffect, useCallback } from "react";
import * as SecureStore from 'expo-secure-store';
import { supabase } from "../lib/supabase";
import { useAuth } from "../lib/auth-context";

const ADMIN_OWNER_RESTAURANT_KEY = "rasvia:admin-owner-restaurant:v1";

export function useAdminMode() {
  const { session } = useAuth();
  const [isAdmin, setIsAdmin] = useState(false);
  const [isRestaurantOwner, setIsRestaurantOwner] = useState(false);
  const [ownedRestaurantId, setOwnedRestaurantId] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [adminOwnerRestaurantId, setAdminOwnerRestaurantIdState] = useState<string | null>(null);

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
            fallbackStaff?.restaurant_id != null ? String(fallbackStaff.restaurant_id) : null,
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

  useEffect(() => {
    if (!session?.user?.id) {
      setAdminOwnerRestaurantIdState(null);
      return;
    }
    if (!isAdmin) {
      setAdminOwnerRestaurantIdState(null);
      return;
    }
    (async () => {
      try {
        const raw = await SecureStore.getItemAsync(ADMIN_OWNER_RESTAURANT_KEY);
        if (raw === null || raw === "") {
          setAdminOwnerRestaurantIdState(null);
        } else {
          setAdminOwnerRestaurantIdState(raw);
        }
      } catch {
        setAdminOwnerRestaurantIdState(null);
      }
    })();
  }, [session?.user?.id, isAdmin]);

  const setAdminOwnerRestaurantId = useCallback((id: string | null) => {
    setAdminOwnerRestaurantIdState(id);
    void (async () => {
      try {
        if (id == null) {
          await SecureStore.deleteItemAsync(ADMIN_OWNER_RESTAURANT_KEY);
        } else {
          await SecureStore.setItemAsync(ADMIN_OWNER_RESTAURANT_KEY, id);
        }
      } catch {
        /* ignore */
      }
    })();
  }, []);

  /** Restaurant whose owner dashboard to show: admins pick explicitly; owners use their linked venue. */
  const effectiveOwnerRestaurantId = isAdmin ? adminOwnerRestaurantId : ownedRestaurantId;

  return {
    isAdmin,
    isRestaurantOwner,
    ownedRestaurantId,
    loading,
    adminOwnerRestaurantId,
    setAdminOwnerRestaurantId,
    effectiveOwnerRestaurantId,
  };
}
