import { mapsApiKey } from "@/lib/env";

/**
 * CARTO's free "Voyager" basemap - muted enough that the coral pins and
 * route lines stay the thing your eye lands on. Always the light set: the
 * app is pinned to light mode (data-theme="light" in the root layout)
 * regardless of device preference, so a dark basemap would mismatch an
 * otherwise all-light app.
 *
 * CARTO now requires a (free, no-signup, 5M-requests/month) key for this
 * tile set - without one, tiles still load but render with a visible
 * "API KEY REQUIRED" watermark baked into the image itself. Shared here so
 * OrderTrackingMap and MerchantLocationMap can't drift onto two different
 * URLs or attribution strings.
 */
export const CARTO_TILE_URL =
  "https://{s}.basemaps.cartocdn.com/rastertiles/voyager/{z}/{x}/{y}{r}.png" +
  (mapsApiKey ? `?key=${mapsApiKey}` : "");

export const CARTO_ATTRIBUTION =
  '&copy; <a href="https://carto.com/attributions">CARTO</a> &copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> contributors';
