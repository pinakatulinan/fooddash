"use client";

import * as React from "react";
import { useRouter } from "next/navigation";
import { ImagePlus } from "lucide-react";
import { createClient } from "@/lib/supabase/client";
import { uploadPublicImage, ALLOWED_IMAGE_TYPES } from "@/lib/upload";
import { friendlyError } from "@/lib/utils";
import { Button } from "@/components/ui/button";

const MAX_BYTES = 5 * 1024 * 1024;

export function MerchantImageUpload({
  merchantId,
  field,
  label,
  currentUrl,
  aspect = "square",
}: {
  merchantId: string;
  field: "logo_url" | "cover_url";
  label: string;
  currentUrl: string | null;
  aspect?: "square" | "wide";
}) {
  const router = useRouter();
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
      const url = await uploadPublicImage(
        "merchant-assets",
        `${merchantId}/${field === "logo_url" ? "logo" : "cover"}`,
        file,
        MAX_BYTES,
      );
      const supabase = createClient();
      const { error: updateError } = await supabase
        .from("merchants")
        .update({ [field]: url })
        .eq("id", merchantId);
      if (updateError) throw updateError;

      setPreview(url);
      router.refresh();
    } catch (err) {
      setError(friendlyError(err));
    } finally {
      setUploading(false);
    }
  }

  return (
    <div>
      <p className="mb-1.5 text-sm font-semibold">{label}</p>
      <div className="flex items-center gap-3">
        <div
          className={`grid shrink-0 place-items-center overflow-hidden rounded-md border border-line bg-surface ${
            aspect === "square" ? "size-16" : "h-16 w-28"
          }`}
        >
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
            {preview ? "Change" : "Upload"}
          </Button>
          <input
            ref={inputRef}
            type="file"
            accept={ALLOWED_IMAGE_TYPES.join(",")}
            onChange={handleChange}
            className="hidden"
            aria-label={label}
          />
          {error && (
            <p role="alert" className="mt-1 text-xs font-medium text-danger">
              {error}
            </p>
          )}
        </div>
      </div>
    </div>
  );
}
