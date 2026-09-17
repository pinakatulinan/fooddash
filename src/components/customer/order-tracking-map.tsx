"use client";

import * as React from "react";
import "leaflet/dist/leaflet.css";
import type { Map as LeafletMap, Marker as LeafletMarker, Polyline as LeafletPolyline } from "leaflet";

interface Point {
  lat: number;
  lng: number;
}

interface RiderPoint extends Point {
  first_name: string;
}

/** Straight-line, not a routed distance - there is no directions provider
 * configured (see order-tracking-map's own history). Good enough for "which
 * way and roughly how far," not for an ETA. */
function distanceMeters(a: Point, b: Point): number {
  const R = 6_371_000;
  const toRad = (d: number) => (d * Math.PI) / 180;
  const dLat = toRad(b.lat - a.lat);
  const dLng = toRad(b.lng - a.lng);
  const s =
    Math.sin(dLat / 2) ** 2 + Math.cos(toRad(a.lat)) * Math.cos(toRad(b.lat)) * Math.sin(dLng / 2) ** 2;
  return R * 2 * Math.atan2(Math.sqrt(s), Math.sqrt(1 - s));
}

function formatDistance(m: number): string {
  return m < 1000 ? `${Math.round(m)} m` : `${(m / 1000).toFixed(1)} km`;
}

/**
 * `leaflet` touches `window` at module-evaluation time (browser/retina
 * detection), which crashes the server render every "use client" component
 * still gets for its initial HTML. Loading it inside the effect - which only
 * ever runs after mount - keeps the import out of that server pass entirely,
 * without needing a separate next/dynamic(..., { ssr: false }) wrapper.
 *
 * Store and dropoff pins are drawn once on mount; the rider pin is created
 * lazily the first time a position arrives and then just moved in place, so
 * re-renders driven by the page's `RealtimeRefresh` (see order tracking page)
 * glide the marker to its new spot rather than rebuilding the whole map.
 */
export function OrderTrackingMap({
  merchant,
  dropoff,
  rider,
  highlightTarget,
}: {
  merchant: Point & { name: string };
  dropoff: Point | null;
  rider: RiderPoint | null;
  /** Rider-side only: draws a dashed line from the rider to this point and
   * shows the straight-line distance, so "which way do I go" doesn't require
   * a directions provider this project doesn't have configured. */
  highlightTarget?: "merchant" | "dropoff";
}) {
  const containerRef = React.useRef<HTMLDivElement>(null);
  const mapRef = React.useRef<LeafletMap | null>(null);
  const riderMarkerRef = React.useRef<LeafletMarker | null>(null);
  const routeLineRef = React.useRef<LeafletPolyline | null>(null);
  const [distanceLabel, setDistanceLabel] = React.useState<string | null>(null);

  const target = highlightTarget === "merchant" ? merchant : highlightTarget === "dropoff" ? dropoff : null;

  React.useEffect(() => {
    if (!containerRef.current || mapRef.current) return;
    let cancelled = false;

    (async () => {
      const L = (await import("leaflet")).default;
      if (cancelled || !containerRef.current || mapRef.current) return;

      const map = L.map(containerRef.current, { zoomControl: false });
      mapRef.current = map;

      // CARTO's free basemaps (no key) instead of raw OSM tiles - Voyager
      // is muted enough that the coral pins and route line stay the thing
      // your eye lands on, and it swaps to the dark set automatically so a
      // light basemap never sits inside an otherwise-dark theme.
      const isDark = window.matchMedia?.("(prefers-color-scheme: dark)").matches ?? false;
      L.tileLayer(
        `https://{s}.basemaps.cartocdn.com/rastertiles/${isDark ? "dark_all" : "voyager"}/{z}/{x}/{y}{r}.png`,
        {
          attribution:
            '&copy; <a href="https://carto.com/attributions">CARTO</a> &copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> contributors',
          maxZoom: 20,
        },
      ).addTo(map);
      L.control.zoom({ position: "bottomright" }).addTo(map);

      const pin = (emoji: string, size: number) =>
        L.divIcon({
          className: "",
          html: `<div class="grid place-items-center rounded-pill border-2 border-line bg-surface shadow-md" style="width:${size}px;height:${size}px;font-size:${size * 0.55}px">${emoji}</div>`,
          iconSize: [size, size],
          iconAnchor: [size / 2, size / 2],
        });

      L.marker([merchant.lat, merchant.lng], { icon: pin("🏬", 32) }).addTo(map).bindTooltip(merchant.name);

      const bounds = L.latLngBounds([[merchant.lat, merchant.lng]]);
      if (dropoff) {
        L.marker([dropoff.lat, dropoff.lng], { icon: pin("📍", 32) }).addTo(map);
        bounds.extend([dropoff.lat, dropoff.lng]);
      }
      if (rider) {
        riderMarkerRef.current = L.marker([rider.lat, rider.lng], { icon: pin("🏍️", 36) })
          .addTo(map)
          .bindTooltip(rider.first_name);
        bounds.extend([rider.lat, rider.lng]);
      }

      map.fitBounds(bounds, { padding: [32, 32], maxZoom: 16 });
    })();

    return () => {
      cancelled = true;
      mapRef.current?.remove();
      mapRef.current = null;
      riderMarkerRef.current = null;
      routeLineRef.current = null;
    };
    // Deliberately mount once on the store/dropoff pair - see the rider effect
    // below for how a moving rider is kept in sync without rebuilding this.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [merchant.lat, merchant.lng, dropoff?.lat, dropoff?.lng]);

  React.useEffect(() => {
    const map = mapRef.current;
    if (!map || !rider) return;

    (async () => {
      const L = (await import("leaflet")).default;
      if (!mapRef.current) return;

      if (riderMarkerRef.current) {
        riderMarkerRef.current.setLatLng([rider.lat, rider.lng]);
      } else {
        riderMarkerRef.current = L.marker([rider.lat, rider.lng], {
          icon: L.divIcon({
            className: "",
            html: `<div class="grid place-items-center rounded-pill border-2 border-line bg-surface shadow-md" style="width:36px;height:36px;font-size:19.8px">🏍️</div>`,
            iconSize: [36, 36],
            iconAnchor: [18, 18],
          }),
        })
          .addTo(map)
          .bindTooltip(rider.first_name);
        map.fitBounds(map.getBounds().extend([rider.lat, rider.lng]), { maxZoom: 16 });
      }

      if (target) {
        const line: [number, number][] = [
          [rider.lat, rider.lng],
          [target.lat, target.lng],
        ];
        if (routeLineRef.current) {
          routeLineRef.current.setLatLngs(line);
        } else {
          routeLineRef.current = L.polyline(line, {
            color: "var(--color-primary, #D85A30)",
            weight: 3,
            dashArray: "6 8",
            opacity: 0.8,
          }).addTo(map);
        }
        setDistanceLabel(formatDistance(distanceMeters(rider, target)));
      }
    })();
  }, [rider, target]);

  return (
    <div className="relative">
      <div
        ref={containerRef}
        className="h-56 w-full overflow-hidden rounded-md border border-line bg-surface-raised"
        aria-label={rider ? `Live map showing ${rider.first_name}'s location` : "Map showing the store and delivery address"}
      />
      {target && distanceLabel && (
        <div className="absolute top-2 right-2 z-1000 rounded-pill border border-line bg-surface px-2.5 py-1 text-xs font-bold shadow-sm">
          {distanceLabel} to {highlightTarget === "merchant" ? "store" : "customer"}
        </div>
      )}
    </div>
  );
}
