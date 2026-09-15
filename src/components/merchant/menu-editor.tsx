"use client";

import * as React from "react";
import { useRouter } from "next/navigation";
import { Pencil, Plus, Trash2 } from "lucide-react";
import { createClient } from "@/lib/supabase/client";
import { friendlyError, cn } from "@/lib/utils";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Pill } from "@/components/ui/status-pill";
import { formatCentavos, formatDelta } from "@/lib/format";
import { ItemForm } from "./item-form";
import type { EditableCategory, EditableMenuItem } from "./menu-types";

const UNCATEGORIZED = "__uncategorized__";

/**
 * The merchant's own menu: categories and items, added/edited/archived here
 * directly against the tables (RLS already grants a merchant member full
 * read-write on their own menu tree - no RPC needed for a plain CRUD form).
 *
 * Categories and items come in as props from the server page and are never
 * copied into local state - a mutation just calls router.refresh() and lets
 * the next server render hand back the real row. Local state here is only
 * ever "what form is open right now."
 */
export function MenuEditor({
  merchantId,
  categories,
  items,
}: {
  merchantId: string;
  categories: EditableCategory[];
  items: EditableMenuItem[];
}) {
  const router = useRouter();
  const [error, setError] = React.useState<string | null>(null);
  const [addingCategory, setAddingCategory] = React.useState(false);
  const [newCategoryName, setNewCategoryName] = React.useState("");
  const [renamingId, setRenamingId] = React.useState<string | null>(null);
  const [renameValue, setRenameValue] = React.useState("");
  const [addingItem, setAddingItem] = React.useState(false);
  const [editingItemId, setEditingItemId] = React.useState<string | null>(null);
  const [busy, setBusy] = React.useState<string | null>(null);

  const supabase = createClient();
  function refresh() {
    router.refresh();
  }
  function reportError(err: unknown) {
    setError(friendlyError(err));
  }

  async function addCategory() {
    if (!newCategoryName.trim()) return;
    setBusy("add-category");
    const nextSort = categories.reduce((max, c) => Math.max(max, c.sort_order), -1) + 1;
    const { error: err } = await supabase
      .from("menu_categories")
      .insert({ merchant_id: merchantId, name: newCategoryName.trim(), sort_order: nextSort });
    setBusy(null);
    if (err) return reportError(err);
    setNewCategoryName("");
    setAddingCategory(false);
    refresh();
  }

  async function renameCategory(id: string) {
    if (!renameValue.trim()) return;
    setBusy(id);
    const { error: err } = await supabase
      .from("menu_categories")
      .update({ name: renameValue.trim() })
      .eq("id", id);
    setBusy(null);
    if (err) return reportError(err);
    setRenamingId(null);
    refresh();
  }

  async function toggleCategoryActive(category: EditableCategory) {
    setBusy(category.id);
    const { error: err } = await supabase
      .from("menu_categories")
      .update({ is_active: !category.is_active })
      .eq("id", category.id);
    setBusy(null);
    if (err) return reportError(err);
    refresh();
  }

  async function deleteCategory(category: EditableCategory) {
    if (!window.confirm(`Delete "${category.name}"? Its items move to Uncategorized, not deleted.`)) return;
    setBusy(category.id);
    const { error: err } = await supabase.from("menu_categories").delete().eq("id", category.id);
    setBusy(null);
    if (err) return reportError(err);
    refresh();
  }

  async function toggleAvailable(item: EditableMenuItem) {
    setBusy(item.id);
    const { error: err } = await supabase
      .from("menu_items")
      .update({ is_available: !item.is_available })
      .eq("id", item.id);
    setBusy(null);
    if (err) return reportError(err);
    refresh();
  }

  async function archiveItem(item: EditableMenuItem) {
    if (!window.confirm(`Remove "${item.name}" from the menu? Past orders keep referencing it either way.`)) return;
    setBusy(item.id);
    const { error: err } = await supabase
      .from("menu_items")
      .update({ archived_at: new Date().toISOString() })
      .eq("id", item.id);
    setBusy(null);
    if (err) return reportError(err);
    refresh();
  }

  const nextItemSort = items.reduce((max, i) => Math.max(max, i.sort_order), -1) + 1;
  const groups = [
    ...categories.map((c) => ({ id: c.id, name: c.name, is_active: c.is_active, category: c as EditableCategory | null })),
    { id: UNCATEGORIZED, name: "Uncategorized", is_active: true, category: null },
  ].map((g) => ({ ...g, items: items.filter((i) => (i.category_id ?? UNCATEGORIZED) === g.id) }));

  return (
    <div className="space-y-8">
      <div className="flex flex-wrap justify-end gap-2">
        <Button size="sm" variant="secondary" onClick={() => setAddingCategory((v) => !v)}>
          <Plus className="size-4" /> Category
        </Button>
        <Button size="sm" onClick={() => setAddingItem((v) => !v)}>
          <Plus className="size-4" /> Item
        </Button>
      </div>

      {error && (
        <p role="alert" className="rounded-md bg-danger-tint px-4 py-3 text-sm font-medium text-danger">
          {error}
        </p>
      )}

      {addingCategory && (
        <div className="flex items-end gap-2 rounded-md border border-line bg-surface p-4">
          <div className="flex-1">
            <label htmlFor="new-category" className="mb-1.5 block text-sm font-semibold">
              New category name
            </label>
            <Input
              id="new-category"
              value={newCategoryName}
              onChange={(e) => setNewCategoryName(e.target.value)}
              placeholder="Rice meals"
              autoFocus
            />
          </div>
          <Button loading={busy === "add-category"} onClick={addCategory}>
            Add
          </Button>
          <Button variant="ghost" onClick={() => setAddingCategory(false)}>
            Cancel
          </Button>
        </div>
      )}

      {addingItem && (
        <ItemForm
          merchantId={merchantId}
          categories={categories}
          item={null}
          nextSortOrder={nextItemSort}
          onDone={() => {
            setAddingItem(false);
            refresh();
          }}
          onCancel={() => setAddingItem(false)}
        />
      )}

      {groups.map((g) => {
        if (g.items.length === 0 && g.id === UNCATEGORIZED) return null;
        return (
          <section key={g.id}>
            <div className="mb-3 flex items-center gap-2">
              {renamingId === g.id ? (
                <>
                  <Input
                    value={renameValue}
                    onChange={(e) => setRenameValue(e.target.value)}
                    className="h-9 max-w-xs"
                    autoFocus
                  />
                  <Button size="sm" loading={busy === g.id} onClick={() => renameCategory(g.id)}>
                    Save
                  </Button>
                  <Button size="sm" variant="ghost" onClick={() => setRenamingId(null)}>
                    Cancel
                  </Button>
                </>
              ) : (
                <>
                  <h2 className="text-sm font-bold tracking-wide text-fg-muted uppercase">{g.name}</h2>
                  {!g.is_active && <Pill tone="neutral">Hidden</Pill>}
                  {g.category && (
                    <div className="ml-auto flex gap-1">
                      <button
                        type="button"
                        onClick={() => {
                          setRenamingId(g.id);
                          setRenameValue(g.name);
                        }}
                        aria-label={`Rename ${g.name}`}
                        className="rounded-sm p-1.5 text-fg-muted hover:bg-surface-raised hover:text-fg"
                      >
                        <Pencil className="size-3.5" />
                      </button>
                      <Button
                        size="sm"
                        variant="ghost"
                        loading={busy === g.category.id}
                        onClick={() => toggleCategoryActive(g.category!)}
                      >
                        {g.is_active ? "Hide" : "Unhide"}
                      </Button>
                      <button
                        type="button"
                        onClick={() => deleteCategory(g.category!)}
                        aria-label={`Delete ${g.name}`}
                        className="rounded-sm p-1.5 text-danger hover:bg-danger-tint"
                      >
                        <Trash2 className="size-3.5" />
                      </button>
                    </div>
                  )}
                </>
              )}
            </div>

            {g.items.length === 0 ? (
              <p className="text-sm text-fg-muted">No items in this category yet.</p>
            ) : (
              <ul className="space-y-2">
                {g.items.map((item) =>
                  editingItemId === item.id ? (
                    <li key={item.id}>
                      <ItemForm
                        merchantId={merchantId}
                        categories={categories}
                        item={item}
                        nextSortOrder={nextItemSort}
                        onDone={() => {
                          setEditingItemId(null);
                          refresh();
                        }}
                        onCancel={() => setEditingItemId(null)}
                      />
                    </li>
                  ) : (
                    <li key={item.id}>
                      <Card className={cn(!item.is_available && "opacity-60")}>
                        <div className="flex items-start gap-4 p-4">
                          {item.image_url && (
                            // eslint-disable-next-line @next/next/no-img-element
                            <img
                              src={item.image_url}
                              alt=""
                              className="size-16 shrink-0 rounded-md border border-line object-cover"
                            />
                          )}
                          <div className="min-w-0 flex-1">
                            <div className="flex flex-wrap items-center gap-2">
                              <h3 className="font-bold">{item.name}</h3>
                              {item.is_popular && (
                                <Pill tone="active" showDot={false}>
                                  Popular
                                </Pill>
                              )}
                              {!item.is_available && <Pill tone="danger">Sold out</Pill>}
                            </div>
                            {item.description && (
                              <p className="mt-1 text-sm text-fg-muted">{item.description}</p>
                            )}
                            {item.option_groups.map((og) => (
                              <p key={og.id} className="mt-2 text-xs text-fg-muted">
                                <span className="font-semibold">{og.name}</span> ({og.min_select}–{og.max_select}):{" "}
                                {og.options
                                  .map(
                                    (o) =>
                                      `${o.name}${
                                        o.price_delta_centavos ? ` ${formatDelta(o.price_delta_centavos)}` : ""
                                      }`,
                                  )
                                  .join(", ")}
                              </p>
                            ))}
                          </div>
                          <p className="shrink-0 font-bold tabular-nums">
                            {formatCentavos(item.base_price_centavos)}
                          </p>
                        </div>
                        <div className="flex flex-wrap gap-2 border-t border-line px-4 py-3">
                          <Button
                            size="sm"
                            variant="secondary"
                            loading={busy === item.id}
                            onClick={() => toggleAvailable(item)}
                          >
                            {item.is_available ? "Mark sold out" : "Mark available"}
                          </Button>
                          <Button size="sm" variant="ghost" onClick={() => setEditingItemId(item.id)}>
                            <Pencil className="size-3.5" /> Edit
                          </Button>
                          <Button
                            size="sm"
                            variant="ghost"
                            className="text-danger"
                            loading={busy === item.id}
                            onClick={() => archiveItem(item)}
                          >
                            <Trash2 className="size-3.5" /> Remove
                          </Button>
                        </div>
                      </Card>
                    </li>
                  ),
                )}
              </ul>
            )}
          </section>
        );
      })}
    </div>
  );
}
