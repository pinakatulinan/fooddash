"use client";

import * as React from "react";
import { MapPin, X } from "lucide-react";
import { createClient } from "@/lib/supabase/client";
import { FavoriteButton } from "@/components/customer/favorite-button";
import { MerchantLocationMap } from "@/components/customer/merchant-location-map";

/**
 * Replaces the logo/notification/cart the shared top bar would otherwise show
 * on a store page (see customer-top-bar's HIDDEN_ON_PREFIX) with the two
 * things actually relevant here: where is this place, and do I want to save
 * it. The map coordinates are fetched lazily, on first tap, rather than on
 * page load - most visits never open it, and merchant_public_location is a
 * network round trip a store page's initial render has no need to pay for.
 */
export function StoreHeaderActions({
  merchantId,
  merchantName,
  initialFavorited,
}: {
  merchantId: string;
  merchantName: string;
  initialFavorited: boolean;
}) {
  const [open, setOpen] = React.useState(false);
  const [coords, setCoords] = React.useState<{ lat: number; lng: number } | null>(null);
  const [status, setStatus] = React.useState<"idle" | "loading" | "error">("idle");

  async function showMap() {
    setOpen(true);
    if (coords || status === "loading") return;
    setStatus("loading");
    const supabase = createClient();
    const { data, error } = await supabase
      .rpc("merchant_public_location", { p_merchant_id: merchantId })
      .maybeSingle();
    if (error || !data || data.lat == null || data.lng == null) {
      setStatus("error");
    } else {
      setCoords({ lat: data.lat, lng: data.lng });
      setStatus("idle");
    }
  }

  return (
    <>
      <div className="flex shrink-0 items-center gap-2.5">
        <button
          type="button"
          onClick={showMap}
          aria-label={`Show ${merchantName} on the map`}
          className="grid size-10.5 place-items-center rounded-full bg-card text-fg shadow-card hover:brightness-95"
        >
          <MapPin aria-hidden className="size-5" />
        </button>
        <FavoriteButton
          merchantId={merchantId}
          initialFavorited={initialFavorited}
          className="size-10.5 bg-card text-primary shadow-card hover:bg-card hover:brightness-95"
        />
      </div>

      {open && (
        <div
          className="fixed inset-0 z-50 flex items-end justify-center bg-black/50 sm:items-center"
          onClick={() => setOpen(false)}
        >
          <div
            role="dialog"
            aria-modal="true"
            aria-label={`${merchantName}'s location`}
            className="w-full max-w-lg rounded-t-lg bg-card p-4 shadow-pop sm:rounded-lg"
            onClick={(e) => e.stopPropagation()}
          >
            <div className="mb-3 flex items-center justify-between gap-3">
              <h2 className="min-w-0 truncate font-bold">{merchantName}</h2>
              <button
                type="button"
                onClick={() => setOpen(false)}
                aria-label="Close"
                className="grid size-8 shrink-0 place-items-center rounded-pill hover:bg-surface-raised"
              >
                <X aria-hidden className="size-4" />
              </button>
            </div>

            {status === "loading" ? (
              <div className="grid h-72 place-items-center text-sm text-fg-muted">Loading map…</div>
            ) : status === "error" || !coords ? (
              <div className="grid h-72 place-items-center px-6 text-center text-sm text-fg-muted">
                We don&apos;t have a precise pin for this store yet.
              </div>
            ) : (
              <MerchantLocationMap lat={coords.lat} lng={coords.lng} name={merchantName} />
            )}
          </div>
        </div>
      )}
    </>
  );
}
