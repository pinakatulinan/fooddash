"use client";

import * as React from "react";
import { useRouter } from "next/navigation";
import { createClient } from "@/lib/supabase/client";
import { friendlyError } from "@/lib/utils";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";

/**
 * One platform_settings row, editable in place.
 *
 * update_platform_setting() (0011) is the only path that can actually write
 * this table - RLS has no write policy for anyone, admin included, so this
 * component's job is purely to build the right jsonb value and call it.
 * dispatch_mode is special-cased to a select: it's read back with an exact
 * string match against 'auto' (auto_dispatch_ready_orders, 0008), so a typo
 * a free-text field would happily accept could silently turn dispatch off.
 */
export function SettingRow({
  settingKey,
  value,
  description,
}: {
  settingKey: string;
  value: unknown;
  description: string | null;
}) {
  const router = useRouter();
  const [editing, setEditing] = React.useState(false);
  const [draft, setDraft] = React.useState(() => stringifyForInput(value));
  const [note, setNote] = React.useState("");
  const [submitting, setSubmitting] = React.useState(false);
  const [error, setError] = React.useState<string | null>(null);

  const kind = settingKey === "dispatch_mode" ? "mode" : typeof value === "boolean" ? "boolean" : typeof value;

  async function save() {
    let parsed: unknown;
    if (kind === "mode") {
      parsed = draft;
    } else if (kind === "boolean") {
      parsed = draft === "true";
    } else if (kind === "number") {
      parsed = Number(draft);
      if (!Number.isFinite(parsed)) {
        setError("Enter a valid number.");
        return;
      }
    } else {
      parsed = draft;
    }

    setSubmitting(true);
    setError(null);
    const supabase = createClient();
    const { error: rpcError } = await supabase.rpc("update_platform_setting", {
      p_key: settingKey,
      p_value: parsed,
      p_note: note.trim() || null,
    });
    setSubmitting(false);

    if (rpcError) {
      setError(friendlyError(rpcError));
      return;
    }
    setEditing(false);
    setNote("");
    router.refresh();
  }

  if (!editing) {
    return (
      <div className="px-4 py-3">
        <div className="flex items-baseline justify-between gap-4">
          <dt className="font-mono text-sm font-semibold">{settingKey}</dt>
          <div className="flex items-center gap-3">
            <dd className="font-mono text-sm font-bold tabular-nums">{JSON.stringify(value)}</dd>
            <Button size="sm" variant="ghost" onClick={() => setEditing(true)}>
              Edit
            </Button>
          </div>
        </div>
        {description && <p className="mt-1 text-xs text-fg-muted">{description}</p>}
      </div>
    );
  }

  return (
    <div className="space-y-2 px-4 py-3">
      <dt className="font-mono text-sm font-semibold">{settingKey}</dt>
      {description && <p className="text-xs text-fg-muted">{description}</p>}

      {kind === "mode" ? (
        <select
          aria-label={`Value for ${settingKey}`}
          value={draft}
          onChange={(e) => setDraft(e.target.value)}
          className="h-10 w-full max-w-xs rounded-md border border-line bg-card px-3 text-sm"
        >
          <option value="manual">manual</option>
          <option value="auto">auto</option>
        </select>
      ) : kind === "boolean" ? (
        <select
          aria-label={`Value for ${settingKey}`}
          value={draft}
          onChange={(e) => setDraft(e.target.value)}
          className="h-10 w-full max-w-xs rounded-md border border-line bg-card px-3 text-sm"
        >
          <option value="true">true</option>
          <option value="false">false</option>
        </select>
      ) : (
        <Input
          aria-label={`Value for ${settingKey}`}
          value={draft}
          onChange={(e) => setDraft(e.target.value)}
          type={kind === "number" ? "number" : "text"}
          step={kind === "number" ? "any" : undefined}
          className="max-w-xs"
        />
      )}

      <Input
        aria-label="Reason for this change"
        value={note}
        onChange={(e) => setNote(e.target.value)}
        placeholder="Why? (optional, goes in the audit log)"
        className="max-w-sm"
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
            setDraft(stringifyForInput(value));
            setError(null);
          }}
        >
          Cancel
        </Button>
      </div>
    </div>
  );
}

function stringifyForInput(value: unknown): string {
  return typeof value === "string" ? value : JSON.stringify(value);
}
