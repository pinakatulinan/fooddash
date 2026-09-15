"use client";

import * as React from "react";
import { useRouter } from "next/navigation";
import { createClient } from "@/lib/supabase/client";
import { friendlyError } from "@/lib/utils";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Field, Input } from "@/components/ui/input";
import { Pill } from "@/components/ui/status-pill";
import { formatCentavos, formatManilaTime } from "@/lib/format";

const SURGE_DURATIONS = [
  { label: "30 min", minutes: 30 },
  { label: "1 hour", minutes: 60 },
  { label: "2 hours", minutes: 120 },
  { label: "4 hours", minutes: 240 },
];

/** No selection made this session - surge is left exactly as it already is. */
type SurgeAction = "unchanged" | "clear" | number;

interface Zone {
  id: string;
  name: string;
  city: string;
  is_active: boolean;
  base_fee_centavos: number;
  surge_multiplier: number;
  surge_until: string | null;
}

/**
 * update_service_zone() (0011) treats surge as three-way, not a plain
 * overwrite: editing the base fee alone must not silently end or restart
 * whatever surge is already running. "unchanged" here is what makes that
 * true on this side - it is the default, and stays the default unless the
 * admin actually presses a duration or "Clear surge".
 *
 * surge_until itself is always resolved from a minute count against the
 * database's own clock, the same reason pause_store's p_minutes is - this
 * component only ever sends how long, never a timestamp it built itself.
 */
export function ZoneEditor({ zone }: { zone: Zone }) {
  const router = useRouter();
  const [editing, setEditing] = React.useState(false);
  const [isActive, setIsActive] = React.useState(zone.is_active);
  const [baseFee, setBaseFee] = React.useState(String(zone.base_fee_centavos / 100));
  const [surgeMultiplier, setSurgeMultiplier] = React.useState(String(zone.surge_multiplier));
  const [surgeAction, setSurgeAction] = React.useState<SurgeAction>("unchanged");
  const [note, setNote] = React.useState("");
  const [submitting, setSubmitting] = React.useState(false);
  const [error, setError] = React.useState<string | null>(null);

  const hasLiveSurge = zone.surge_until !== null;

  async function submit(payload: {
    is_active: boolean;
    base_fee_centavos: number;
    surge_multiplier: number;
    surge_minutes: number | null;
    clear_surge: boolean;
    note: string | null;
  }) {
    setSubmitting(true);
    setError(null);
    const supabase = createClient();
    const { error: rpcError } = await supabase.rpc("update_service_zone", {
      p_zone_id: zone.id,
      p_is_active: payload.is_active,
      p_base_fee_centavos: payload.base_fee_centavos,
      p_surge_multiplier: payload.surge_multiplier,
      p_surge_minutes: payload.surge_minutes,
      p_clear_surge: payload.clear_surge,
      p_note: payload.note,
    });
    setSubmitting(false);

    if (rpcError) {
      setError(friendlyError(rpcError));
      return false;
    }
    router.refresh();
    return true;
  }

  async function save() {
    const fee = Math.round(parseFloat(baseFee || "0") * 100);
    const multiplier = parseFloat(surgeMultiplier || "1");
    if (!Number.isFinite(fee) || fee < 0) {
      setError("Base fee must be a valid, non-negative amount.");
      return;
    }
    if (typeof surgeAction === "number" && (!Number.isFinite(multiplier) || multiplier <= 0)) {
      setError("Surge multiplier must be a positive number.");
      return;
    }

    const ok = await submit({
      is_active: isActive,
      base_fee_centavos: fee,
      surge_multiplier: multiplier,
      surge_minutes: typeof surgeAction === "number" ? surgeAction : null,
      clear_surge: surgeAction === "clear",
      note: note.trim() || null,
    });
    if (ok) setEditing(false);
  }

  // Every field here is draft state for one edit session - if it outlived
  // the session, a leftover surge duration from an edit the admin already
  // saved (and moved on from) would silently get re-applied the next time
  // they open the form to change something unrelated, like the base fee.
  function openEdit() {
    setIsActive(zone.is_active);
    setBaseFee(String(zone.base_fee_centavos / 100));
    setSurgeMultiplier(String(zone.surge_multiplier));
    setSurgeAction("unchanged");
    setNote("");
    setError(null);
    setEditing(true);
  }

  return (
    <Card>
      <div className="space-y-3 p-4">
        <div className="flex items-start justify-between gap-3">
          <div>
            <p className="font-bold">{zone.name}</p>
            <p className="text-sm text-fg-muted">{zone.city}</p>
          </div>
          <div className="flex shrink-0 items-center gap-2">
            <Pill tone={zone.is_active ? "success" : "neutral"}>{zone.is_active ? "Active" : "Inactive"}</Pill>
            {hasLiveSurge && <Pill tone="danger">{Number(zone.surge_multiplier).toFixed(2)}× surge</Pill>}
          </div>
        </div>

        {!editing ? (
          <div className="flex flex-wrap items-center justify-between gap-2">
            <p className="text-sm text-fg-muted">
              Base fee {formatCentavos(zone.base_fee_centavos)}
              {hasLiveSurge && <> · surge until {formatManilaTime(zone.surge_until!)}</>}
            </p>
            <div className="flex gap-2">
              {hasLiveSurge && (
                <Button
                  size="sm"
                  variant="ghost"
                  loading={submitting}
                  onClick={() =>
                    submit({
                      is_active: zone.is_active,
                      base_fee_centavos: zone.base_fee_centavos,
                      surge_multiplier: 1,
                      surge_minutes: null,
                      clear_surge: true,
                      note: "cleared surge",
                    })
                  }
                >
                  Clear surge
                </Button>
              )}
              <Button size="sm" variant="secondary" onClick={openEdit}>
                Edit
              </Button>
            </div>
          </div>
        ) : (
          <div className="space-y-3 border-t border-line pt-3">
            <label className="flex items-center gap-2 text-sm font-semibold">
              <input type="checkbox" checked={isActive} onChange={(e) => setIsActive(e.target.checked)} className="size-4" />
              Zone active
            </label>

            <div className="grid grid-cols-2 gap-3">
              <Field label="Base fee (₱)">
                {({ id }) => (
                  <Input
                    id={id}
                    type="number"
                    min="0"
                    step="0.01"
                    value={baseFee}
                    onChange={(e) => setBaseFee(e.target.value)}
                  />
                )}
              </Field>
              <Field label="Surge multiplier">
                {({ id }) => (
                  <Input
                    id={id}
                    type="number"
                    min="0.01"
                    step="0.05"
                    value={surgeMultiplier}
                    onChange={(e) => setSurgeMultiplier(e.target.value)}
                    disabled={surgeAction === "unchanged" || surgeAction === "clear"}
                  />
                )}
              </Field>
            </div>

            <div>
              <p className="mb-1.5 text-sm font-semibold">
                Surge {hasLiveSurge ? "(currently running)" : ""}
              </p>
              <div className="flex flex-wrap gap-2">
                {SURGE_DURATIONS.map((d) => (
                  <Button
                    key={d.minutes}
                    type="button"
                    size="sm"
                    variant={surgeAction === d.minutes ? "primary" : "secondary"}
                    onClick={() => setSurgeAction(d.minutes)}
                  >
                    {d.label}
                  </Button>
                ))}
                <Button
                  type="button"
                  size="sm"
                  variant={surgeAction === "clear" ? "danger" : "secondary"}
                  onClick={() => setSurgeAction("clear")}
                >
                  Clear surge
                </Button>
              </div>
              {surgeAction === "unchanged" && (
                <p className="mt-1 text-xs text-fg-muted">Not touching surge - leaving it as it is.</p>
              )}
            </div>

            <Input
              value={note}
              onChange={(e) => setNote(e.target.value)}
              placeholder="Why? (optional, goes in the audit log)"
            />

            {error && (
              <p role="alert" className="text-sm font-medium text-danger">
                {error}
              </p>
            )}

            <div className="flex gap-2">
              <Button size="sm" loading={submitting} onClick={save}>
                Save
              </Button>
              <Button
                size="sm"
                variant="ghost"
                onClick={() => {
                  setEditing(false);
                  setSurgeAction("unchanged");
                  setError(null);
                }}
              >
                Cancel
              </Button>
            </div>
          </div>
        )}
      </div>
    </Card>
  );
}
