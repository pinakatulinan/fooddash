"use client";

import * as React from "react";
import { useRouter } from "next/navigation";
import { LocateFixed } from "lucide-react";
import { createClient } from "@/lib/supabase/client";
import { friendlyError } from "@/lib/utils";
import { Button } from "@/components/ui/button";
import { Field, Input } from "@/components/ui/input";

export interface MerchantAddress {
  line1: string | null;
  barangay: string | null;
  city: string | null;
  province: string | null;
  postal_code: string | null;
  lat: number | null;
  lng: number | null;
}

/**
 * Address and location together, since update_merchant_address (0016) writes
 * both in one call - the geography point can't go through a raw table update
 * the text columns can (see the column grants in 0009), so it has to be set
 * from a lat/lng pair server-side.
 *
 * There is no map picker yet, just "use my current location" (accurate
 * enough when filled in from the store itself) or typing coordinates by
 * hand - a full map picker is a fair follow-up, not something this form
 * needs to block on.
 */
export function MerchantAddressForm({
  merchantId,
  initial,
}: {
  merchantId: string;
  initial: MerchantAddress;
}) {
  const router = useRouter();
  const [line1, setLine1] = React.useState(initial.line1 ?? "");
  const [barangay, setBarangay] = React.useState(initial.barangay ?? "");
  const [city, setCity] = React.useState(initial.city ?? "");
  const [province, setProvince] = React.useState(initial.province ?? "");
  const [postalCode, setPostalCode] = React.useState(initial.postal_code ?? "");
  const [lat, setLat] = React.useState(initial.lat != null ? String(initial.lat) : "");
  const [lng, setLng] = React.useState(initial.lng != null ? String(initial.lng) : "");
  const [locating, setLocating] = React.useState(false);
  const [saving, setSaving] = React.useState(false);
  const [error, setError] = React.useState<string | null>(null);
  const [saved, setSaved] = React.useState(false);

  function useCurrentLocation() {
    setError(null);
    setLocating(true);
    navigator.geolocation.getCurrentPosition(
      (pos) => {
        setLat(pos.coords.latitude.toFixed(6));
        setLng(pos.coords.longitude.toFixed(6));
        setLocating(false);
      },
      (err) => {
        setError(err.message || "Could not read your location.");
        setLocating(false);
      },
      { enableHighAccuracy: true, timeout: 10_000 },
    );
  }

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    setSaved(false);

    const parsedLat = Number(lat);
    const parsedLng = Number(lng);
    if (!lat || !lng || Number.isNaN(parsedLat) || Number.isNaN(parsedLng)) {
      setError("Set your store's location using \"Use my current location\" or by entering coordinates.");
      return;
    }

    setSaving(true);
    const supabase = createClient();
    const { error: rpcError } = await supabase.rpc("update_merchant_address", {
      p_merchant_id: merchantId,
      p_line1: line1,
      p_barangay: barangay || null,
      p_city: city,
      p_province: province || null,
      p_postal_code: postalCode || null,
      p_lat: parsedLat,
      p_lng: parsedLng,
    });
    setSaving(false);

    if (rpcError) {
      setError(friendlyError(rpcError));
      return;
    }
    setSaved(true);
    router.refresh();
  }

  return (
    <form onSubmit={handleSubmit} className="space-y-4">
      <Field label="Address" required>
        {({ id, describedBy }) => (
          <Input
            id={id}
            aria-describedby={describedBy}
            value={line1}
            onChange={(e) => setLine1(e.target.value)}
            placeholder="Unit/house no., street"
            required
          />
        )}
      </Field>
      <div className="grid grid-cols-2 gap-3">
        <Field label="Barangay">
          {({ id, describedBy }) => (
            <Input id={id} aria-describedby={describedBy} value={barangay} onChange={(e) => setBarangay(e.target.value)} />
          )}
        </Field>
        <Field label="City" required>
          {({ id, describedBy }) => (
            <Input id={id} aria-describedby={describedBy} value={city} onChange={(e) => setCity(e.target.value)} required />
          )}
        </Field>
        <Field label="Province">
          {({ id, describedBy }) => (
            <Input id={id} aria-describedby={describedBy} value={province} onChange={(e) => setProvince(e.target.value)} />
          )}
        </Field>
        <Field label="Postal code">
          {({ id, describedBy }) => (
            <Input id={id} aria-describedby={describedBy} value={postalCode} onChange={(e) => setPostalCode(e.target.value)} />
          )}
        </Field>
      </div>

      <div>
        <p className="mb-1.5 text-sm font-semibold">
          Location <span className="text-danger" aria-hidden>*</span>
        </p>
        <p className="mb-2 text-xs text-fg-muted">
          Drives delivery distance and radius — set it from inside the store, or enter coordinates.
        </p>
        <div className="grid grid-cols-2 gap-3">
          <Input inputMode="decimal" placeholder="Latitude" value={lat} onChange={(e) => setLat(e.target.value)} />
          <Input inputMode="decimal" placeholder="Longitude" value={lng} onChange={(e) => setLng(e.target.value)} />
        </div>
        <Button
          type="button"
          size="sm"
          variant="secondary"
          className="mt-2"
          loading={locating}
          onClick={useCurrentLocation}
        >
          <LocateFixed aria-hidden className="size-4" /> Use my current location
        </Button>
      </div>

      {error && (
        <p role="alert" className="text-sm font-medium text-danger">
          {error}
        </p>
      )}
      {saved && !error && <p className="text-sm font-medium text-accent-fg">Saved.</p>}

      <Button type="submit" size="sm" loading={saving}>
        Save address
      </Button>
    </form>
  );
}
