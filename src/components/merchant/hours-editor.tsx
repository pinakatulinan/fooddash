"use client";

import * as React from "react";
import { useRouter } from "next/navigation";
import { createClient } from "@/lib/supabase/client";
import { friendlyError } from "@/lib/utils";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";

const DAYS = ["Sunday", "Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday"];

export interface MerchantHour {
  day_of_week: number;
  opens_at: string;
  closes_at: string;
  closes_next_day: boolean;
}

interface DayRow {
  enabled: boolean;
  opens_at: string;
  closes_at: string;
  closes_next_day: boolean;
}

function toRows(hours: MerchantHour[]): DayRow[] {
  return Array.from({ length: 7 }, (_, day) => {
    const h = hours.find((x) => x.day_of_week === day);
    return h
      ? { enabled: true, opens_at: h.opens_at.slice(0, 5), closes_at: h.closes_at.slice(0, 5), closes_next_day: h.closes_next_day }
      : { enabled: false, opens_at: "09:00", closes_at: "21:00", closes_next_day: false };
  });
}

/**
 * merchant_hours_member_manage (0003) already grants members full RLS access
 * to their own store's rows with no column restriction, so this writes the
 * table directly rather than through an RPC - the whole week is replaced in
 * one delete-then-insert so there is never a half-saved schedule.
 */
export function MerchantHoursEditor({ merchantId, hours }: { merchantId: string; hours: MerchantHour[] }) {
  const router = useRouter();
  const [rows, setRows] = React.useState<DayRow[]>(() => toRows(hours));
  const [saving, setSaving] = React.useState(false);
  const [error, setError] = React.useState<string | null>(null);
  const [saved, setSaved] = React.useState(false);

  function update(day: number, patch: Partial<DayRow>) {
    setRows((rs) => rs.map((r, i) => (i === day ? { ...r, ...patch } : r)));
  }

  async function handleSave() {
    setError(null);
    setSaved(false);

    for (const [day, r] of rows.entries()) {
      if (r.enabled && !r.closes_next_day && r.closes_at <= r.opens_at) {
        setError(`${DAYS[day]}: closing time must be after opening time (or check "closes after midnight").`);
        return;
      }
    }

    setSaving(true);
    const supabase = createClient();
    const { error: deleteError } = await supabase.from("merchant_hours").delete().eq("merchant_id", merchantId);
    if (deleteError) {
      setSaving(false);
      setError(friendlyError(deleteError));
      return;
    }

    const toInsert = rows
      .map((r, day) => ({ ...r, day }))
      .filter((r) => r.enabled)
      .map((r) => ({
        merchant_id: merchantId,
        day_of_week: r.day,
        opens_at: r.opens_at,
        closes_at: r.closes_at,
        closes_next_day: r.closes_next_day,
      }));

    if (toInsert.length > 0) {
      const { error: insertError } = await supabase.from("merchant_hours").insert(toInsert);
      if (insertError) {
        setSaving(false);
        setError(friendlyError(insertError));
        return;
      }
    }

    setSaving(false);
    setSaved(true);
    router.refresh();
  }

  return (
    <div className="space-y-2">
      <ul className="divide-y divide-line">
        {rows.map((row, day) => (
          <li key={day} className="flex flex-wrap items-center gap-3 py-3">
            <label className="flex w-32 shrink-0 items-center gap-2 text-sm font-semibold">
              <input
                type="checkbox"
                checked={row.enabled}
                onChange={(e) => update(day, { enabled: e.target.checked })}
                className="size-4 accent-[var(--primary)]"
              />
              {DAYS[day]}
            </label>
            {row.enabled && (
              <div className="flex flex-wrap items-center gap-2">
                <Input
                  type="time"
                  value={row.opens_at}
                  onChange={(e) => update(day, { opens_at: e.target.value })}
                  className="h-9 w-28"
                />
                <span className="text-sm text-fg-muted">to</span>
                <Input
                  type="time"
                  value={row.closes_at}
                  onChange={(e) => update(day, { closes_at: e.target.value })}
                  className="h-9 w-28"
                />
                <label className="flex items-center gap-1.5 text-xs text-fg-muted">
                  <input
                    type="checkbox"
                    checked={row.closes_next_day}
                    onChange={(e) => update(day, { closes_next_day: e.target.checked })}
                    className="size-3.5 accent-[var(--primary)]"
                  />
                  Closes after midnight
                </label>
              </div>
            )}
          </li>
        ))}
      </ul>

      {error && (
        <p role="alert" className="text-sm font-medium text-danger">
          {error}
        </p>
      )}
      {saved && !error && <p className="text-sm font-medium text-accent-fg">Saved.</p>}

      <Button type="button" size="sm" loading={saving} onClick={handleSave}>
        Save hours
      </Button>
    </div>
  );
}
