/**
 * Gate that tells `<CachedImage>` whether it's allowed to pull restaurant /
 * menu images from the server on this screen.
 *
 * Product rule (April 2026, Supabase egress cleanup):
 *   - Home feed (`/(tabs)/index`) and restaurant detail (`/restaurant/[id]`)
 *     may hit the network to fetch + cache images.
 *   - Every other surface (map, favorites, cuisine, discover, search, cart,
 *     my-orders, order-confirmation, etc.) renders from the on-disk cache
 *     only. If the asset isn't cached yet the component shows a placeholder
 *     instead of triggering egress.
 *
 * The default is `false` so new screens added in the future are safe by
 * construction; they have to opt-in explicitly.
 */

import React, { createContext, useContext } from "react";

const ImageFetchContext = createContext<boolean>(false);

export function ImageFetchProvider({
  allowFetch,
  children,
}: {
  allowFetch: boolean;
  children: React.ReactNode;
}) {
  return (
    <ImageFetchContext.Provider value={allowFetch}>
      {children}
    </ImageFetchContext.Provider>
  );
}

export function useAllowImageFetch(): boolean {
  return useContext(ImageFetchContext);
}
