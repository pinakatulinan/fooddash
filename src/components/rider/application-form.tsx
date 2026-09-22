"use client";

import * as React from "react";
import { useRouter } from "next/navigation";
import { createClient } from "@/lib/supabase/client";
import { friendlyError, cn } from "@/lib/utils";
import { normalisePhone, displayPhone } from "@/lib/format";
import { Button } from "@/components/ui/button";
import { Field, Input } from "@/components/ui/input";
import { PAYOUT_METHODS, VEHICLE_LABELS, needsPlate } from "@/lib/domain/rider-documents";
import type { VehicleType } from "@/lib/types/domain";

export interface ApplicationValues {
  vehicle: VehicleType;
  plate_number: string;
  home_zone_id: string;
  date_of_birth: string;
  address_line1: string;
  barangay: string;
  city: string;
  emergency_contact_name: string;
  emergency_contact_phone: string;
  payout_method: string;
  payout_account_name: string;
  payout_account_number: string;
}

const BLANK: ApplicationValues = {
  vehicle: "motorcycle",
  plate_number: "",
  home_zone_id: "",
  date_of_birth: "",
  address_line1: "",
  barangay: "",
  city: "",
  emergency_contact_name: "",
  emergency_contact_phone: "",
  payout_method: "gcash",
  payout_account_name: "",
  payout_account_number: "",
};

const SELECT_CLASS = "h-11 w-full rounded-md border border-line bg-card px-3 text-base";

/**
 * Everything ops needs to decide on a rider besides the documents themselves.
 * Validation here is only a courtesy - submit_rider_application (0015) is the
 * authority and re-checks every field, including the age limit and that an
 * emergency contact is not the rider's own number.
 *
 * `maxDob` comes from the server (18 years before today) rather than being
 * computed here, since reading the clock during render is impure and would
 * also make the server and client disagree across midnight.
 */
export function RiderApplicationForm({
  zones,
  initial,
  maxDob,
  submitLabel,
}: {
  zones: { id: string; name: string }[];
  initial: Partial<ApplicationValues> | null;
  maxDob: string;
  submitLabel: string;
}) {
  const router = useRouter();
  const [values, setValues] = React.useState<ApplicationValues>({
    ...BLANK,
    ...initial,
    // Stored E.164 -> what the person types and expects to read back.
    emergency_contact_phone: initial?.emergency_contact_phone
      ? displayPhone(initial.emergency_contact_phone)
      : "",
    home_zone_id: initial?.home_zone_id ?? zones[0]?.id ?? "",
  });
  const [accepted, setAccepted] = React.useState(Boolean(initial));
  const [submitting, setSubmitting] = React.useState(false);
  const [error, setError] = React.useState<string | null>(null);

  const set = <K extends keyof ApplicationValues>(key: K, value: ApplicationValues[K]) =>
    setValues((v) => ({ ...v, [key]: value }));

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setError(null);

    const emergencyPhone = normalisePhone(values.emergency_contact_phone);
    if (!emergencyPhone) {
      setError("Enter a valid Philippine mobile number for your emergency contact.");
      return;
    }

    setSubmitting(true);
    const supabase = createClient();
    const { error: rpcError } = await supabase.rpc("submit_rider_application", {
      p_vehicle: values.vehicle,
      p_plate_number: needsPlate(values.vehicle) ? values.plate_number : null,
      p_home_zone_id: values.home_zone_id,
      p_date_of_birth: values.date_of_birth,
      p_address_line1: values.address_line1,
      p_barangay: values.barangay || null,
      p_city: values.city,
      p_emergency_contact_name: values.emergency_contact_name,
      p_emergency_contact_phone: emergencyPhone,
      p_payout_method: values.payout_method,
      p_payout_account_name: values.payout_account_name,
      p_payout_account_number: values.payout_account_number,
      p_accepted_terms: accepted,
    });
    setSubmitting(false);

    if (rpcError) {
      setError(friendlyError(rpcError));
      return;
    }
    router.refresh();
  }

  return (
    <form onSubmit={handleSubmit} className="space-y-8">
      <fieldset>
        <legend className="mb-3 text-sm font-bold tracking-wide text-fg-muted uppercase">Your vehicle</legend>
        <div className="grid grid-cols-2 gap-2">
          {(Object.keys(VEHICLE_LABELS) as VehicleType[]).map((v) => (
            <label
              key={v}
              className={cn(
                "cursor-pointer rounded-lg border px-3 py-3 text-center text-sm font-semibold transition-colors",
                values.vehicle === v
                  ? "border-primary bg-coral-tint text-header-fg"
                  : "border-line hover:bg-surface-raised",
              )}
            >
              <input
                type="radio"
                name="vehicle"
                value={v}
                checked={values.vehicle === v}
                onChange={() => set("vehicle", v)}
                className="sr-only"
              />
              {VEHICLE_LABELS[v]}
            </label>
          ))}
        </div>

        <div className="mt-4 space-y-4">
          {needsPlate(values.vehicle) && (
            <Field label="Plate number" required>
              {({ id, describedBy }) => (
                <Input
                  id={id}
                  aria-describedby={describedBy}
                  value={values.plate_number}
                  onChange={(e) => set("plate_number", e.target.value)}
                  placeholder="NCR 1234"
                  autoCapitalize="characters"
                  required
                />
              )}
            </Field>
          )}
          <Field label="Zone you will deliver in" required>
            {({ id, describedBy }) => (
              <select
                id={id}
                aria-describedby={describedBy}
                value={values.home_zone_id}
                onChange={(e) => set("home_zone_id", e.target.value)}
                className={SELECT_CLASS}
                required
              >
                {zones.map((z) => (
                  <option key={z.id} value={z.id}>
                    {z.name}
                  </option>
                ))}
              </select>
            )}
          </Field>
        </div>
      </fieldset>

      <fieldset className="space-y-4">
        <legend className="mb-3 text-sm font-bold tracking-wide text-fg-muted uppercase">About you</legend>
        <Field label="Date of birth" hint="You must be at least 18." required>
          {({ id, describedBy }) => (
            <Input
              id={id}
              aria-describedby={describedBy}
              type="date"
              max={maxDob}
              value={values.date_of_birth}
              onChange={(e) => set("date_of_birth", e.target.value)}
              required
            />
          )}
        </Field>
        <Field label="Home address" required>
          {({ id, describedBy }) => (
            <Input
              id={id}
              aria-describedby={describedBy}
              value={values.address_line1}
              onChange={(e) => set("address_line1", e.target.value)}
              placeholder="House no., street"
              autoComplete="street-address"
              required
            />
          )}
        </Field>
        <div className="grid grid-cols-2 gap-3">
          <Field label="Barangay">
            {({ id, describedBy }) => (
              <Input
                id={id}
                aria-describedby={describedBy}
                value={values.barangay}
                onChange={(e) => set("barangay", e.target.value)}
              />
            )}
          </Field>
          <Field label="City" required>
            {({ id, describedBy }) => (
              <Input
                id={id}
                aria-describedby={describedBy}
                value={values.city}
                onChange={(e) => set("city", e.target.value)}
                required
              />
            )}
          </Field>
        </div>
      </fieldset>

      <fieldset className="space-y-4">
        <legend className="mb-3 text-sm font-bold tracking-wide text-fg-muted uppercase">Emergency contact</legend>
        <Field label="Full name" required>
          {({ id, describedBy }) => (
            <Input
              id={id}
              aria-describedby={describedBy}
              value={values.emergency_contact_name}
              onChange={(e) => set("emergency_contact_name", e.target.value)}
              required
            />
          )}
        </Field>
        <Field label="Mobile number" hint="Someone we can call if something goes wrong on a delivery." required>
          {({ id, describedBy }) => (
            <Input
              id={id}
              aria-describedby={describedBy}
              type="tel"
              inputMode="tel"
              value={values.emergency_contact_phone}
              onChange={(e) => set("emergency_contact_phone", e.target.value)}
              placeholder="0917 123 4567"
              required
            />
          )}
        </Field>
      </fieldset>

      <fieldset className="space-y-4">
        <legend className="mb-3 text-sm font-bold tracking-wide text-fg-muted uppercase">Where we pay you</legend>
        <Field label="Payout method" required>
          {({ id, describedBy }) => (
            <select
              id={id}
              aria-describedby={describedBy}
              value={values.payout_method}
              onChange={(e) => set("payout_method", e.target.value)}
              className={SELECT_CLASS}
              required
            >
              {PAYOUT_METHODS.map((m) => (
                <option key={m.value} value={m.value}>
                  {m.label}
                </option>
              ))}
            </select>
          )}
        </Field>
        <Field label="Name on the account" required>
          {({ id, describedBy }) => (
            <Input
              id={id}
              aria-describedby={describedBy}
              value={values.payout_account_name}
              onChange={(e) => set("payout_account_name", e.target.value)}
              required
            />
          )}
        </Field>
        <Field
          label={values.payout_method === "bank" ? "Account number" : "Mobile number"}
          hint={values.payout_method === "bank" ? undefined : "The number your wallet is registered to."}
          required
        >
          {({ id, describedBy }) => (
            <Input
              id={id}
              aria-describedby={describedBy}
              inputMode="numeric"
              value={values.payout_account_number}
              onChange={(e) => set("payout_account_number", e.target.value)}
              placeholder={values.payout_method === "bank" ? "" : "0917 123 4567"}
              required
            />
          )}
        </Field>
      </fieldset>

      <label className="flex cursor-pointer items-start gap-3 rounded-lg border border-line bg-surface p-4">
        <input
          type="checkbox"
          checked={accepted}
          onChange={(e) => setAccepted(e.target.checked)}
          className="mt-0.5 size-4 shrink-0 accent-[var(--primary)]"
        />
        <span className="text-sm text-fg-muted">
          I agree to remit every cash-on-delivery payment I collect to FoodDash, to keep my documents
          current, and to follow the delivery safety rules.
        </span>
      </label>

      {error && (
        <p role="alert" className="rounded-md bg-danger-tint px-3 py-2 text-sm font-medium text-danger">
          {error}
        </p>
      )}

      <Button type="submit" size="lg" fullWidth loading={submitting} disabled={!accepted}>
        {submitLabel}
      </Button>
    </form>
  );
}
