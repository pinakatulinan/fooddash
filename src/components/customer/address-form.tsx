"use client";

import * as React from "react";
import { useRouter } from "next/navigation";
import { LocateFixed, MapPinCheck } from "lucide-react";
import { createClient } from "@/lib/supabase/client";
import { friendlyError } from "@/lib/utils";
import { normalisePhone } from "@/lib/format";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Field, Input, Textarea } from "@/components/ui/input";

/**
 * Add a delivery address without a maps provider.
 *
 * `addresses.location` is a required geography point - quote_delivery and
 * the whole discovery/dispatch distance model depend on it, so an address
 * cannot exist without one. Rather than block address creation on picking a
 * paid maps API, this uses the browser's own Geolocation API for the pin and
 * plain text fields for everything else. That split is not a workaround: it
 * is the design the schema already assumes - the pin drives routing, the text
 * is what a rider actually reads at the gate (see migration 0002).
 */
export function AddressForm({
  userId,
  isFirstAddress,
  next,
}: {
  userId: string;
  isFirstAddress: boolean;
  next: string;
}) {
  const router = useRouter();

  const [label, setLabel] = React.useState("Home");
  const [recipientName, setRecipientName] = React.useState("");
  const [recipientPhone, setRecipientPhone] = React.useState("");
  const [line1, setLine1] = React.useState("");
  const [barangay, setBarangay] = React.useState("");
  const [city, setCity] = React.useState("Quezon City");
  const [province, setProvince] = React.useState("Metro Manila");
  const [landmark, setLandmark] = React.useState("");
  const [notes, setNotes] = React.useState("");
  const [makeDefault, setMakeDefault] = React.useState(isFirstAddress);

  const [coords, setCoords] = React.useState<{ lat: number; lng: number } | null>(null);
  const [locating, setLocating] = React.useState(false);
  const [locateError, setLocateError] = React.useState<string | null>(null);

  const [submitting, setSubmitting] = React.useState(false);
  const [error, setError] = React.useState<string | null>(null);
  const [phoneError, setPhoneError] = React.useState<string | null>(null);

  function useCurrentLocation() {
    if (!("geolocation" in navigator)) {
      setLocateError("This browser cannot share your location. Enter the address manually.");
      return;
    }
    setLocating(true);
    setLocateError(null);
    navigator.geolocation.getCurrentPosition(
      (pos) => {
        setCoords({ lat: pos.coords.latitude, lng: pos.coords.longitude });
        setLocating(false);
      },
      (geoError) => {
        setLocating(false);
        setLocateError(
          geoError.code === geoError.PERMISSION_DENIED
            ? "Location access was denied. Allow it in your browser's site settings to continue."
            : "Could not get your location. Check your connection and try again.",
        );
      },
      { enableHighAccuracy: true, timeout: 10_000 },
    );
  }

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    setPhoneError(null);

    if (!coords) {
      setLocateError("Share your location so riders can find this address.");
      return;
    }

    let normalisedPhone: string | null = null;
    if (recipientPhone.trim()) {
      normalisedPhone = normalisePhone(recipientPhone);
      if (!normalisedPhone) {
        setPhoneError("That does not look like a Philippine mobile number.");
        return;
      }
    }

    setSubmitting(true);
    const supabase = createClient();

    // The unique partial index allows at most one default address per user,
    // so replacing it is a clear-then-set, not something a single insert can
    // express. Both writes are scoped to this user by the addresses_own RLS
    // policy regardless of what runs the query.
    if (makeDefault) {
      const { error: clearError } = await supabase
        .from("addresses")
        .update({ is_default: false })
        .eq("is_default", true);
      if (clearError) {
        setError(friendlyError(clearError));
        setSubmitting(false);
        return;
      }
    }

    const { error: insertError } = await supabase.from("addresses").insert({
      user_id: userId,
      label: label.trim() || "Home",
      recipient_name: recipientName.trim() || null,
      recipient_phone: normalisedPhone,
      line1: line1.trim(),
      barangay: barangay.trim() || null,
      city: city.trim(),
      province: province.trim() || null,
      landmark: landmark.trim() || null,
      delivery_notes: notes.trim() || null,
      is_default: makeDefault,
      // EWKT text - Postgres' geography input function parses this directly,
      // the same as it would a value typed at a psql prompt.
      location: `SRID=4326;POINT(${coords.lng} ${coords.lat})`,
    });

    if (insertError) {
      setError(friendlyError(insertError));
      setSubmitting(false);
      return;
    }

    router.push(next);
    router.refresh();
  }

  return (
    <form onSubmit={handleSubmit} className="space-y-6 px-4 py-6">
      <section aria-labelledby="location-heading">
        <h2 id="location-heading" className="mb-3 text-sm font-bold tracking-wide text-fg-muted uppercase">
          Location
        </h2>
        <Card>
          <div className="p-4">
            <p className="text-sm text-fg-muted">
              This sets the pin your rider navigates to. It is separate from the address text below,
              which is what they read at the gate.
            </p>
            <Button
              type="button"
              variant={coords ? "secondary" : "primary"}
              onClick={useCurrentLocation}
              loading={locating}
              className="mt-3"
            >
              {coords ? (
                <>
                  <MapPinCheck aria-hidden className="size-4" /> Location captured
                </>
              ) : (
                <>
                  <LocateFixed aria-hidden className="size-4" /> Use my current location
                </>
              )}
            </Button>
            {coords && (
              <p className="mt-2 font-mono text-xs text-fg-muted">
                {coords.lat.toFixed(5)}, {coords.lng.toFixed(5)}
              </p>
            )}
            {locateError && (
              <p role="alert" className="mt-2 text-sm font-medium text-danger">
                {locateError}
              </p>
            )}
          </div>
        </Card>
      </section>

      <section aria-labelledby="details-heading">
        <h2 id="details-heading" className="mb-3 text-sm font-bold tracking-wide text-fg-muted uppercase">
          Address details
        </h2>
        <div className="space-y-4">
          <Field label="Label" required>
            {({ id, describedBy }) => (
              <Input
                id={id}
                aria-describedby={describedBy}
                value={label}
                onChange={(e) => setLabel(e.target.value)}
                placeholder="Home, Work, ..."
                required
              />
            )}
          </Field>

          <Field label="House / unit / street" required>
            {({ id, describedBy }) => (
              <Input
                id={id}
                aria-describedby={describedBy}
                value={line1}
                onChange={(e) => setLine1(e.target.value)}
                placeholder="24 Maginhawa Street"
                required
              />
            )}
          </Field>

          <div className="grid grid-cols-2 gap-4">
            <Field label="Barangay">
              {({ id, describedBy }) => (
                <Input
                  id={id}
                  aria-describedby={describedBy}
                  value={barangay}
                  onChange={(e) => setBarangay(e.target.value)}
                />
              )}
            </Field>
            <Field label="City" required>
              {({ id, describedBy }) => (
                <Input
                  id={id}
                  aria-describedby={describedBy}
                  value={city}
                  onChange={(e) => setCity(e.target.value)}
                  required
                />
              )}
            </Field>
          </div>

          <Field label="Province">
            {({ id, describedBy }) => (
              <Input
                id={id}
                aria-describedby={describedBy}
                value={province}
                onChange={(e) => setProvince(e.target.value)}
              />
            )}
          </Field>

          <Field
            label="Landmark"
            hint="How a rider actually finds the door — a gate colour, a nearby store."
          >
            {({ id, describedBy }) => (
              <Input
                id={id}
                aria-describedby={describedBy}
                value={landmark}
                onChange={(e) => setLandmark(e.target.value)}
                placeholder="Blue gate beside the sari-sari store"
              />
            )}
          </Field>

          <div className="grid grid-cols-2 gap-4">
            <Field label="Recipient name">
              {({ id, describedBy }) => (
                <Input
                  id={id}
                  aria-describedby={describedBy}
                  value={recipientName}
                  onChange={(e) => setRecipientName(e.target.value)}
                />
              )}
            </Field>
            <Field label="Recipient mobile" error={phoneError}>
              {({ id, describedBy }) => (
                <Input
                  id={id}
                  aria-describedby={describedBy}
                  type="tel"
                  inputMode="tel"
                  value={recipientPhone}
                  onChange={(e) => setRecipientPhone(e.target.value)}
                  placeholder="0917 123 4567"
                  invalid={Boolean(phoneError)}
                />
              )}
            </Field>
          </div>

          <Field label="Delivery notes" hint="Gate code, floor, anything a rider should know.">
            {({ id, describedBy }) => (
              <Textarea
                id={id}
                aria-describedby={describedBy}
                value={notes}
                onChange={(e) => setNotes(e.target.value)}
                rows={2}
              />
            )}
          </Field>

          {!isFirstAddress && (
            <label className="flex items-center gap-2.5 text-sm font-medium">
              <input
                type="checkbox"
                checked={makeDefault}
                onChange={(e) => setMakeDefault(e.target.checked)}
                className="size-4 rounded border-line accent-primary"
              />
              Set as my default delivery address
            </label>
          )}
        </div>
      </section>

      {error && (
        <p role="alert" className="rounded-md bg-danger-tint px-4 py-3 text-sm text-danger">
          {error}
        </p>
      )}

      <Button type="submit" size="lg" fullWidth loading={submitting}>
        Save address
      </Button>
    </form>
  );
}
