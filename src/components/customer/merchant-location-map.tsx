"use client";

import * as React from "react";
import "leaflet/dist/leaflet.css";
import type { Map as LeafletMap } from "leaflet";

/**
 * A single pin on a map - the store page's "where is this place" view.
 * Deliberately not OrderTrackingMap: that one draws a rider, a route and a
 * dropoff, none of which apply here, and forcing this into that component
 * would mean threading a pile of null props through it for no reason.
 *
 * Same "import leaflet inside the effect" trick as OrderTrackingMap: the
 * library touches `window` at module-evaluation time, which would crash the
 * server render this "use client" component still gets for its initial HTML.
 */
export function MerchantLocationMap({ lat, lng, name }: { lat: number; lng: number; name: string }) {
  const containerRef = React.useRef<HTMLDivElement>(null);
  const mapRef = React.useRef<LeafletMap | null>(null);

  React.useEffect(() => {
    if (!containerRef.current || mapRef.current) return;
    let cancelled = false;

    (async () => {
      const L = (await import("leaflet")).default;
      if (cancelled || !containerRef.current || mapRef.current) return;

      const map = L.map(containerRef.current, { zoomControl: false }).setView([lat, lng], 16);
      mapRef.current = map;

      // Same CARTO Voyager basemap as OrderTrackingMap - always the light
      // set, since the app is pinned to light mode regardless of device
      // preference.
      L.tileLayer("https://{s}.basemaps.cartocdn.com/rastertiles/voyager/{z}/{x}/{y}{r}.png", {
        attribution:
          '&copy; <a href="https://carto.com/attributions">CARTO</a> &copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> contributors',
        maxZoom: 20,
      }).addTo(map);
      L.control.zoom({ position: "bottomright" }).addTo(map);

      L.marker([lat, lng], {
        icon: L.divIcon({
          className: "",
          html: '<div class="grid place-items-center rounded-pill border-2 border-line bg-surface shadow-md" style="width:36px;height:36px;font-size:19.8px">🏬</div>',
          iconSize: [36, 36],
          iconAnchor: [18, 18],
        }),
      })
        .addTo(map)
        .bindTooltip(name);

      // A modal's entrance transition and a map created inside it don't
      // agree on the container's size at that exact moment - invalidateSize
      // once after the tile layer settles fixes the "half-grey map" this
      // would otherwise produce.
      window.requestAnimationFrame(() => mapRef.current?.invalidateSize());
    })();

    return () => {
      cancelled = true;
      mapRef.current?.remove();
      mapRef.current = null;
    };
  }, [lat, lng, name]);

  return (
    <div
      ref={containerRef}
      className="h-72 w-full overflow-hidden rounded-md border border-line bg-surface-raised"
      aria-label={`Map showing ${name}'s location`}
    />
  );
}
