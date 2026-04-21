import React, { createContext, useCallback, useContext, useMemo, useState } from "react";

type RestaurantBottomNavContextValue = {
  forceShowRestaurantBottomNav: boolean;
  setForceShowRestaurantBottomNav: (v: boolean) => void;
};

const RestaurantBottomNavContext = createContext<RestaurantBottomNavContextValue | null>(null);

export function RestaurantBottomNavProvider({ children }: { children: React.ReactNode }) {
  const [forceShowRestaurantBottomNav, setState] = useState(false);
  const setForceShowRestaurantBottomNav = useCallback((v: boolean) => {
    setState(v);
  }, []);
  const value = useMemo(
    () => ({ forceShowRestaurantBottomNav, setForceShowRestaurantBottomNav }),
    [forceShowRestaurantBottomNav, setForceShowRestaurantBottomNav],
  );
  return (
    <RestaurantBottomNavContext.Provider value={value}>{children}</RestaurantBottomNavContext.Provider>
  );
}

export function useRestaurantBottomNav(): RestaurantBottomNavContextValue {
  const ctx = useContext(RestaurantBottomNavContext);
  if (!ctx) {
    throw new Error("useRestaurantBottomNav must be used within RestaurantBottomNavProvider");
  }
  return ctx;
}
