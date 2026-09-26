"use client";

import * as React from "react";
import { useRouter } from "next/navigation";
import { Check, Minus, Plus } from "lucide-react";
import { createClient } from "@/lib/supabase/client";
import { friendlyError, cn } from "@/lib/utils";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/input";
import { formatCentavos, formatDelta } from "@/lib/format";
import type { MenuOptionGroup } from "@/lib/types/domain";

/**
 * The add-to-cart control for one menu item.
 *
 * It calls `add_to_cart` directly — the RPC already validates that every
 * option id genuinely belongs to this item, so there is nothing left for the
 * client to police beyond a friendlier "pick one" nudge before submitting.
 *
 * `add_to_cart` does not merge repeat calls into one line: each call inserts a
 * new cart_items row. That is why quantity is chosen up front rather than
 * incremented by re-clicking "Add" — the alternative would quietly create a
 * cart with five separate one-quantity lines of the same dish.
 */

interface Item {
  id: string;
  name: string;
  base_price_centavos: number;
  is_available: boolean;
  option_groups: MenuOptionGroup[];
}

export function AddToCartControl({ item, compact = false }: { item: Item; compact?: boolean }) {
  const router = useRouter();
  const groups = item.option_groups ?? [];
  const hasGroups = groups.length > 0;

  const [expanded, setExpanded] = React.useState(false);
  // Pre-select each single-choice group's default option, so a required group
  // like "Size" is not just possible to satisfy without a tap — it already is.
  const [selected, setSelected] = React.useState<Record<string, Set<string>>>(() => {
    const initial: Record<string, Set<string>> = {};
    for (const g of groups) {
      if (g.max_select === 1) {
        const def = g.options.find((o) => o.is_default && o.is_available);
        if (def) initial[g.id] = new Set([def.id]);
      }
    }
    return initial;
  });
  const [quantity, setQuantity] = React.useState(1);
  const [notes, setNotes] = React.useState("");
  const [submitting, setSubmitting] = React.useState(false);
  const [error, setError] = React.useState<string | null>(null);
  const [justAdded, setJustAdded] = React.useState(false);

  if (!item.is_available) return null;

  const toggle = (groupId: string, optionId: string, maxSelect: number) => {
    setSelected((prev) => {
      const current = new Set(prev[groupId] ?? []);
      if (maxSelect === 1) {
        // Single-select: choosing one always replaces whatever was picked.
        current.clear();
        current.add(optionId);
      } else if (current.has(optionId)) {
        current.delete(optionId);
      } else if (current.size < maxSelect) {
        current.add(optionId);
      }
      return { ...prev, [groupId]: current };
    });
  };

  const unmet = groups.filter((g) => (selected[g.id]?.size ?? 0) < g.min_select);
  const canSubmit = unmet.length === 0;

  const unitPrice =
    item.base_price_centavos +
    groups.reduce((sum, g) => {
      const chosen = selected[g.id] ?? new Set();
      return (
        sum + g.options.filter((o) => chosen.has(o.id)).reduce((s, o) => s + o.price_delta_centavos, 0)
      );
    }, 0);

  async function handleAdd() {
    if (!canSubmit) return;
    setSubmitting(true);
    setError(null);

    const supabase = createClient();

    // add_to_cart is granted to `authenticated` only, and this control sits on
    // the store page - which is deliberately public, so anonymous browsing
    // works. A signed-out tap would otherwise reach the RPC, get refused with
    // a bare 401, and land the visitor on a console error instead of a login
    // screen. Checked here, not inferred from the RPC's error afterwards.
    const {
      data: { user },
    } = await supabase.auth.getUser();

    if (!user) {
      setSubmitting(false);
      router.push(`/login?next=${encodeURIComponent(window.location.pathname)}`);
      return;
    }

    const optionIds = groups.flatMap((g) => [...(selected[g.id] ?? [])]);

    const attempt = async (replaceCart: boolean) =>
      supabase.rpc("add_to_cart", {
        p_menu_item_id: item.id,
        p_quantity: quantity,
        p_option_ids: optionIds,
        p_notes: notes.trim() || null,
        p_replace_cart: replaceCart,
      });

    let { error: rpcError } = await attempt(false);

    if (rpcError?.message.includes("cart_belongs_to_another_store")) {
      const ok = window.confirm(
        "Your cart has items from another store. Replace it and start a new order here?",
      );
      if (!ok) {
        setSubmitting(false);
        return;
      }
      ({ error: rpcError } = await attempt(true));
    }

    setSubmitting(false);

    if (rpcError) {
      setError(friendlyError(rpcError));
      return;
    }

    setJustAdded(true);
    setQuantity(1);
    setNotes("");
    router.refresh();
    window.setTimeout(() => setJustAdded(false), 1800);
    if (hasGroups) setExpanded(false);
  }

  // A simple item with no choices to make: a stepper and one button, no panel.
  // `compact` is the same control, just folded into a small floating cluster
  // for the image-corner placement (see MenuSection) instead of a full row.
  if (!hasGroups) {
    if (compact) {
      return (
        <div className="flex flex-col items-end gap-1">
          <div className="flex items-center gap-1 rounded-pill border border-line bg-card p-1 shadow-card">
            <button
              type="button"
              aria-label="Decrease quantity"
              onClick={() => setQuantity((v) => Math.max(1, v - 1))}
              disabled={quantity <= 1}
              className="grid size-6 place-items-center rounded-pill text-fg-muted hover:bg-surface-raised disabled:opacity-30"
            >
              <Minus aria-hidden className="size-3" />
            </button>
            <span className="w-4 text-center text-xs font-bold tabular-nums">{quantity}</span>
            <button
              type="button"
              aria-label="Increase quantity"
              onClick={() => setQuantity((v) => Math.min(20, v + 1))}
              className="grid size-6 place-items-center rounded-pill text-fg-muted hover:bg-surface-raised"
            >
              <Plus aria-hidden className="size-3" />
            </button>
            <button
              type="button"
              aria-label="Add to cart"
              onClick={handleAdd}
              disabled={submitting}
              className="ml-0.5 grid size-7 place-items-center rounded-pill bg-primary text-primary-fg transition-transform active:scale-90 disabled:opacity-60"
            >
              {justAdded ? <Check aria-hidden className="size-3.5" /> : <Plus aria-hidden className="size-3.5" />}
            </button>
          </div>
          {error && <p role="alert" className="max-w-32 text-right text-xs text-danger">{error}</p>}
        </div>
      );
    }

    return (
      <div className="flex shrink-0 items-center gap-2">
        <Stepper value={quantity} onChange={setQuantity} />
        <Button
          size="sm"
          onClick={handleAdd}
          loading={submitting}
          className="min-w-24"
        >
          {justAdded ? (
            <>
              <Check aria-hidden className="size-4" /> Added
            </>
          ) : (
            "Add"
          )}
        </Button>
        {error && (
          <p role="alert" className="text-xs text-danger">
            {error}
          </p>
        )}
      </div>
    );
  }

  return (
    <div className="w-full">
      <Button
        variant={expanded ? "secondary" : "primary"}
        size="sm"
        onClick={() => setExpanded((v) => !v)}
        aria-expanded={expanded}
      >
        {justAdded ? (
          <>
            <Check aria-hidden className="size-4" /> Added
          </>
        ) : expanded ? (
          "Cancel"
        ) : (
          "Add to cart"
        )}
      </Button>

      {expanded && (
        <div className="mt-3 space-y-4 rounded-md border border-line bg-surface p-4">
          {groups.map((group) => (
            <fieldset key={group.id}>
              <legend className="mb-2 flex items-baseline gap-2 text-sm font-semibold">
                {group.name}
                <span className="text-xs font-normal text-fg-muted">
                  {group.min_select > 0
                    ? group.max_select === group.min_select
                      ? `choose ${group.min_select}`
                      : `choose ${group.min_select}–${group.max_select}`
                    : `choose up to ${group.max_select}`}
                </span>
              </legend>
              <div className="flex flex-wrap gap-2">
                {group.options
                  .filter((o) => o.is_available)
                  .map((option) => {
                    const isSelected = selected[group.id]?.has(option.id) ?? false;
                    const atCap =
                      !isSelected && (selected[group.id]?.size ?? 0) >= group.max_select;
                    return (
                      <button
                        key={option.id}
                        type="button"
                        disabled={atCap}
                        onClick={() => toggle(group.id, option.id, group.max_select)}
                        aria-pressed={isSelected}
                        className={cn(
                          "rounded-pill border px-3 py-1.5 text-sm font-medium transition-colors",
                          "disabled:opacity-40 disabled:pointer-events-none",
                          isSelected
                            ? "border-primary bg-header text-header-fg"
                            : "border-line bg-card hover:bg-surface-raised",
                        )}
                      >
                        {option.name}
                        {option.price_delta_centavos !== 0 && (
                          <span className="ml-1 tabular-nums opacity-75">
                            {formatDelta(option.price_delta_centavos)}
                          </span>
                        )}
                      </button>
                    );
                  })}
              </div>
            </fieldset>
          ))}

          <div>
            <label htmlFor={`notes-${item.id}`} className="mb-1.5 block text-sm font-semibold">
              Special instructions <span className="font-normal text-fg-muted">(optional)</span>
            </label>
            <Textarea
              id={`notes-${item.id}`}
              value={notes}
              onChange={(e) => setNotes(e.target.value)}
              rows={2}
              placeholder="e.g. no onions, extra sauce po"
              className="min-h-0"
            />
          </div>

          <div className="flex items-center justify-between gap-3">
            <Stepper value={quantity} onChange={setQuantity} />
            <Button onClick={handleAdd} loading={submitting} disabled={!canSubmit} className="flex-1">
              Add to cart — {formatCentavos(unitPrice * quantity)}
            </Button>
          </div>

          {/* Disabled alone looked like a dead button: nothing explained why
              tapping "Add to cart" did nothing when a required group (e.g. a
              size with no default) was still unanswered. */}
          {unmet.length > 0 && (
            <p role="alert" className="text-sm font-medium text-danger">
              Choose {unmet.map((g) => `"${g.name}"`).join(" and ")} to continue.
            </p>
          )}

          {error && (
            <p role="alert" className="text-sm text-danger">
              {error}
            </p>
          )}
        </div>
      )}
    </div>
  );
}

function Stepper({ value, onChange }: { value: number; onChange: (n: number) => void }) {
  return (
    <div className="flex items-center rounded-md border border-line">
      <button
        type="button"
        aria-label="Decrease quantity"
        onClick={() => onChange(Math.max(1, value - 1))}
        className="grid size-9 place-items-center text-fg-muted hover:text-fg disabled:opacity-40"
        disabled={value <= 1}
      >
        <Minus aria-hidden className="size-3.5" />
      </button>
      <span className="w-6 text-center text-sm font-bold tabular-nums">{value}</span>
      <button
        type="button"
        aria-label="Increase quantity"
        onClick={() => onChange(Math.min(20, value + 1))}
        className="grid size-9 place-items-center text-fg-muted hover:text-fg disabled:opacity-40"
        disabled={value >= 20}
      >
        <Plus aria-hidden className="size-3.5" />
      </button>
    </div>
  );
}
