"use client";

import * as React from "react";
import { ImagePlus } from "lucide-react";
import { createClient } from "@/lib/supabase/client";
import { uploadPublicImage, ALLOWED_IMAGE_TYPES } from "@/lib/upload";
import { friendlyError } from "@/lib/utils";
import { Button } from "@/components/ui/button";

const MAX_BYTES = 5 * 1024 * 1024;

/**
 * Only ever shown for an existing item - the storage path convention
 * (menu-images/<merchant_id>/<item_id>) needs the item's real id, which
 * doesn't exist yet for one still being created in this same form.
 */
export function MenuItemImageUpload({
  merchantId,
  itemId,
  currentUrl,
}: {
  merchantId: string;
  itemId: string;
  currentUrl: string | null;
}) {
  const inputRef = React.useRef<HTMLInputElement>(null);
  const [uploading, setUploading] = React.useState(false);
  const [error, setError] = React.useState<string | null>(null);
  const [preview, setPreview] = React.useState(currentUrl);

  async function handleChange(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    e.target.value = "";
    if (!file) return;

    setUploading(true);
    setError(null);
    try {
      const url = await uploadPublicImage("menu-images", `${merchantId}/${itemId}`, file, MAX_BYTES);
      const supabase = createClient();
      const { error: updateError } = await supabase.from("menu_items").update({ image_url: url }).eq("id", itemId);
      if (updateError) throw updateError;

      setPreview(url);
    } catch (err) {
      setError(friendlyError(err));
    } finally {
      setUploading(false);
    }
  }

  return (
    <div className="flex items-center gap-3">
      <div className="grid size-16 shrink-0 place-items-center overflow-hidden rounded-md border border-line bg-surface">
        {preview ? (
          // eslint-disable-next-line @next/next/no-img-element
          <img src={preview} alt="" className="size-full object-cover" />
        ) : (
          <ImagePlus aria-hidden className="size-5 text-fg-muted" />
        )}
      </div>
      <div>
        <Button
          type="button"
          size="sm"
          variant="secondary"
          loading={uploading}
          onClick={() => inputRef.current?.click()}
        >
          {preview ? "Change photo" : "Add photo"}
        </Button>
        <input
          ref={inputRef}
          type="file"
          accept={ALLOWED_IMAGE_TYPES.join(",")}
          onChange={handleChange}
          className="hidden"
          aria-label="Item photo"
        />
        {error && (
          <p role="alert" className="mt-1 text-xs font-medium text-danger">
            {error}
          </p>
        )}
      </div>
    </div>
  );
}
