"use client";

import * as React from "react";
import { Plus, Trash2 } from "lucide-react";
import { createClient } from "@/lib/supabase/client";
import { friendlyError } from "@/lib/utils";
import { Button } from "@/components/ui/button";
import { Field, Input, Textarea } from "@/components/ui/input";
import { MenuItemImageUpload } from "./menu-item-image-upload";
import type { EditableCategory, EditableMenuItem } from "./menu-types";

let localId = 0;
/** Client-only key for a not-yet-saved group/option row - never sent to the database. */
function nextLocalId() {
  localId += 1;
  return `new-${localId}`;
}

interface DraftOption {
  key: string;
  name: string;
  price_delta: string;
  is_available: boolean;
}

interface DraftGroup {
  key: string;
  name: string;
  min_select: string;
  max_select: string;
  options: DraftOption[];
}

function toDraftGroups(item: EditableMenuItem | null): DraftGroup[] {
  return (item?.option_groups ?? []).map((g) => ({
    key: g.id,
    name: g.name,
    min_select: String(g.min_select),
    max_select: String(g.max_select),
    options: g.options.map((o) => ({
      key: o.id,
      name: o.name,
      price_delta: String(o.price_delta_centavos / 100),
      is_available: o.is_available,
    })),
  }));
}

/**
 * Create or edit one menu item, including its option groups.
 *
 * Option groups are replaced wholesale on save rather than diffed row by row
 * (delete every existing group for this item, insert the form's current
 * state fresh). menu_items itself is never deleted - past orders reference
 * it - but option_groups/options carry no such history: order_item_options
 * snapshots the name and price at order time and only sets its option_id to
 * null if the row disappears, so replacing them costs nothing but a live
 * cart's exact selection, which is an acceptable trade for not having to
 * write a matching/diffing engine for this.
 */
export function ItemForm({
  merchantId,
  categories,
  item,
  nextSortOrder,
  onDone,
  onCancel,
}: {
  merchantId: string;
  categories: EditableCategory[];
  /** null when creating a new item. */
  item: EditableMenuItem | null;
  nextSortOrder: number;
  onDone: () => void;
  onCancel: () => void;
}) {
  const [name, setName] = React.useState(item?.name ?? "");
  const [description, setDescription] = React.useState(item?.description ?? "");
  const [categoryId, setCategoryId] = React.useState(item?.category_id ?? "");
  const [price, setPrice] = React.useState(item ? String(item.base_price_centavos / 100) : "");
  const [prepTime, setPrepTime] = React.useState(
    item?.prep_time_minutes != null ? String(item.prep_time_minutes) : "",
  );
  const [isPopular, setIsPopular] = React.useState(item?.is_popular ?? false);
  const [groups, setGroups] = React.useState<DraftGroup[]>(() => toDraftGroups(item));
  const [saving, setSaving] = React.useState(false);
  const [error, setError] = React.useState<string | null>(null);

  function addGroup() {
    setGroups((gs) => [...gs, { key: nextLocalId(), name: "", min_select: "0", max_select: "1", options: [] }]);
  }
  function removeGroup(key: string) {
    setGroups((gs) => gs.filter((g) => g.key !== key));
  }
  function updateGroup(key: string, patch: Partial<DraftGroup>) {
    setGroups((gs) => gs.map((g) => (g.key === key ? { ...g, ...patch } : g)));
  }
  function addOption(groupKey: string) {
    setGroups((gs) =>
      gs.map((g) =>
        g.key === groupKey
          ? { ...g, options: [...g.options, { key: nextLocalId(), name: "", price_delta: "0", is_available: true }] }
          : g,
      ),
    );
  }
  function removeOption(groupKey: string, optionKey: string) {
    setGroups((gs) =>
      gs.map((g) => (g.key === groupKey ? { ...g, options: g.options.filter((o) => o.key !== optionKey) } : g)),
    );
  }
  function updateOption(groupKey: string, optionKey: string, patch: Partial<DraftOption>) {
    setGroups((gs) =>
      gs.map((g) =>
        g.key === groupKey
          ? { ...g, options: g.options.map((o) => (o.key === optionKey ? { ...o, ...patch } : o)) }
          : g,
      ),
    );
  }

  async function handleSave(e: React.FormEvent) {
    e.preventDefault();
    const priceCentavos = Math.round(parseFloat(price || "0") * 100);
    if (!name.trim()) {
      setError("Give the item a name.");
      return;
    }
    if (!Number.isFinite(priceCentavos) || priceCentavos < 0) {
      setError("Price must be a valid, non-negative amount.");
      return;
    }
    for (const g of groups) {
      if (!g.name.trim()) {
        setError("Every option group needs a name.");
        return;
      }
      if (Number(g.min_select) > Number(g.max_select)) {
        setError(`"${g.name}" has a minimum higher than its maximum.`);
        return;
      }
    }

    setSaving(true);
    setError(null);
    const supabase = createClient();

    const itemFields = {
      merchant_id: merchantId,
      category_id: categoryId || null,
      name: name.trim(),
      description: description.trim() || null,
      base_price_centavos: priceCentavos,
      prep_time_minutes: prepTime ? Number(prepTime) : null,
      is_popular: isPopular,
    };

    let itemId = item?.id ?? null;
    if (itemId) {
      const { error: updateError } = await supabase.from("menu_items").update(itemFields).eq("id", itemId);
      if (updateError) {
        setSaving(false);
        setError(friendlyError(updateError));
        return;
      }
      // Replace every existing option group wholesale - see the file comment.
      const { error: deleteError } = await supabase.from("option_groups").delete().eq("menu_item_id", itemId);
      if (deleteError) {
        setSaving(false);
        setError(friendlyError(deleteError));
        return;
      }
    } else {
      const { data: inserted, error: insertError } = await supabase
        .from("menu_items")
        .insert({ ...itemFields, sort_order: nextSortOrder })
        .select("id")
        .single();
      if (insertError || !inserted) {
        setSaving(false);
        setError(friendlyError(insertError));
        return;
      }
      itemId = inserted.id;
    }

    for (let gi = 0; gi < groups.length; gi++) {
      const g = groups[gi];
      const { data: insertedGroup, error: groupError } = await supabase
        .from("option_groups")
        .insert({
          menu_item_id: itemId,
          name: g.name.trim(),
          min_select: Number(g.min_select) || 0,
          max_select: Number(g.max_select) || 1,
          sort_order: gi,
        })
        .select("id")
        .single();
      if (groupError || !insertedGroup) {
        setSaving(false);
        setError(friendlyError(groupError));
        return;
      }

      if (g.options.length > 0) {
        const { error: optionsError } = await supabase.from("options").insert(
          g.options.map((o, oi) => ({
            option_group_id: insertedGroup.id,
            name: o.name.trim() || "Option",
            price_delta_centavos: Math.round(parseFloat(o.price_delta || "0") * 100),
            is_available: o.is_available,
            sort_order: oi,
          })),
        );
        if (optionsError) {
          setSaving(false);
          setError(friendlyError(optionsError));
          return;
        }
      }
    }

    setSaving(false);
    onDone();
  }

  return (
    <form onSubmit={handleSave} className="space-y-4 rounded-md border border-line bg-surface p-4">
      {item ? (
        <MenuItemImageUpload merchantId={merchantId} itemId={item.id} currentUrl={item.image_url} />
      ) : (
        <p className="text-xs text-fg-muted">You can add a photo once the item is saved.</p>
      )}

      <Field label="Name" required>
        {({ id }) => <Input id={id} value={name} onChange={(e) => setName(e.target.value)} required />}
      </Field>

      <Field label="Description">
        {({ id }) => (
          <Textarea id={id} value={description} onChange={(e) => setDescription(e.target.value)} rows={2} />
        )}
      </Field>

      <div className="grid grid-cols-2 gap-3">
        <Field label="Price (₱)" required>
          {({ id }) => (
            <Input
              id={id}
              type="number"
              min="0"
              step="0.01"
              inputMode="decimal"
              value={price}
              onChange={(e) => setPrice(e.target.value)}
              required
            />
          )}
        </Field>
        <Field label="Category">
          {({ id }) => (
            <select
              id={id}
              value={categoryId}
              onChange={(e) => setCategoryId(e.target.value)}
              className="h-11 w-full rounded-md border border-line bg-card px-3 text-base"
            >
              <option value="">Uncategorized</option>
              {categories.map((c) => (
                <option key={c.id} value={c.id}>
                  {c.name}
                </option>
              ))}
            </select>
          )}
        </Field>
      </div>

      <div className="grid grid-cols-2 gap-3">
        <Field label="Prep time (minutes)" hint="Optional - leave blank to use the store default.">
          {({ id }) => (
            <Input
              id={id}
              type="number"
              min="0"
              inputMode="numeric"
              value={prepTime}
              onChange={(e) => setPrepTime(e.target.value)}
            />
          )}
        </Field>
        <label className="mt-7 flex items-center gap-2 text-sm font-semibold">
          <input
            type="checkbox"
            checked={isPopular}
            onChange={(e) => setIsPopular(e.target.checked)}
            className="size-4"
          />
          Mark as popular
        </label>
      </div>

      <div className="space-y-3 border-t border-line pt-4">
        <div className="flex items-center justify-between">
          <h4 className="text-sm font-bold tracking-wide text-fg-muted uppercase">
            Option groups <span className="font-normal normal-case">(size, add-ons...)</span>
          </h4>
          <Button type="button" size="sm" variant="secondary" onClick={addGroup}>
            <Plus className="size-4" /> Group
          </Button>
        </div>

        {groups.map((g) => (
          <div key={g.key} className="space-y-2 rounded-md border border-line bg-card p-3">
            <div className="flex items-end gap-2">
              <div className="flex-1">
                <Field label="Group name">
                  {({ id }) => (
                    <Input
                      id={id}
                      value={g.name}
                      onChange={(e) => updateGroup(g.key, { name: e.target.value })}
                      placeholder="Size"
                    />
                  )}
                </Field>
              </div>
              <div className="w-16">
                <Field label="Min">
                  {({ id }) => (
                    <Input
                      id={id}
                      type="number"
                      min="0"
                      value={g.min_select}
                      onChange={(e) => updateGroup(g.key, { min_select: e.target.value })}
                    />
                  )}
                </Field>
              </div>
              <div className="w-16">
                <Field label="Max">
                  {({ id }) => (
                    <Input
                      id={id}
                      type="number"
                      min="0"
                      value={g.max_select}
                      onChange={(e) => updateGroup(g.key, { max_select: e.target.value })}
                    />
                  )}
                </Field>
              </div>
              <Button
                type="button"
                size="sm"
                variant="ghost"
                className="text-danger"
                onClick={() => removeGroup(g.key)}
                aria-label={`Remove ${g.name || "this group"}`}
              >
                <Trash2 className="size-4" />
              </Button>
            </div>

            <div className="space-y-1.5 pl-3">
              {g.options.map((o) => (
                <div key={o.key} className="flex items-center gap-2">
                  <Input
                    aria-label="Option name"
                    value={o.name}
                    onChange={(e) => updateOption(g.key, o.key, { name: e.target.value })}
                    placeholder="Large"
                    className="h-9 flex-1"
                  />
                  <Input
                    aria-label="Price change"
                    type="number"
                    step="0.01"
                    value={o.price_delta}
                    onChange={(e) => updateOption(g.key, o.key, { price_delta: e.target.value })}
                    className="h-9 w-24"
                  />
                  <label className="flex shrink-0 items-center gap-1 text-xs text-fg-muted">
                    <input
                      type="checkbox"
                      checked={o.is_available}
                      onChange={(e) => updateOption(g.key, o.key, { is_available: e.target.checked })}
                    />
                    Available
                  </label>
                  <Button
                    type="button"
                    size="sm"
                    variant="ghost"
                    className="text-danger"
                    onClick={() => removeOption(g.key, o.key)}
                    aria-label="Remove option"
                  >
                    <Trash2 className="size-3.5" />
                  </Button>
                </div>
              ))}
              <Button type="button" size="sm" variant="ghost" onClick={() => addOption(g.key)}>
                <Plus className="size-3.5" /> Option
              </Button>
            </div>
          </div>
        ))}
      </div>

      {error && (
        <p role="alert" className="text-sm font-medium text-danger">
          {error}
        </p>
      )}

      <div className="flex gap-2 border-t border-line pt-4">
        <Button type="submit" loading={saving} className="flex-1">
          {item ? "Save changes" : "Add item"}
        </Button>
        <Button type="button" variant="ghost" onClick={onCancel}>
          Cancel
        </Button>
      </div>
    </form>
  );
}
