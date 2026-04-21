/**
 * Nominatim (OpenStreetMap) search restricted to Texas, USA.
 *
 * Docs: https://nominatim.org/release-docs/develop/api/Search/
 * - `countrycodes=us` limits to the United States.
 * - `viewbox=min_lon,max_lat,max_lon,min_lat` + `bounded=1` restricts results to the bounding box (Texas).
 *
 * **Biasing toward specific cities (not implemented):** Nominatim does not have a "preferred cities"
 * list. Practical options are:
 * - Use a **smaller viewbox** around a metro area (soft bias with `bounded=0`, or hard filter with `bounded=1`).
 * - Pass **lat/lon** of a center point; some deployments support ranking by distance (check your Nominatim version).
 * - **Post-sort** client-side: boost known city names or distances from user/home coords.
 * - Use a **different geocoder** (Google Places, Mapbox) that supports region/component filters.
 */

/** Texas bounding box (WGS84): min lon, max lat, max lon, min lat — padded slightly */
export const TEXAS_VIEWBOX = "-106.75,36.55,-93.40,25.75";

export function buildTexasNominatimSearchUrl(query: string): string {
  const params = new URLSearchParams({
    format: "json",
    addressdetails: "1",
    limit: "8",
    countrycodes: "us",
    viewbox: TEXAS_VIEWBOX,
    bounded: "1",
    q: query,
  });
  return `https://nominatim.openstreetmap.org/search?${params.toString()}`;
}

/** Keep only results whose structured address is Texas (when address is present). */
export function nominatimResultInTexas(r: {
  address?: Record<string, string | undefined>;
  display_name?: string;
}): boolean {
  const state = (r.address?.state ?? "").toLowerCase();
  if (state) {
    return state.includes("texas") || state === "tx";
  }
  const dn = (r.display_name ?? "").toLowerCase();
  return dn.includes("texas") || dn.includes(", tx");
}
