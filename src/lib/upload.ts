import { createClient } from "@/lib/supabase/client";

const EXT_FOR_TYPE: Record<string, string> = {
  "image/jpeg": "jpg",
  "image/png": "png",
  "image/webp": "webp",
  "image/svg+xml": "svg",
};

export const ALLOWED_IMAGE_TYPES = Object.keys(EXT_FOR_TYPE);

export class UploadValidationError extends Error {}

/**
 * Uploads to a fixed, upserted path - one object per (merchant, purpose), not
 * one per upload - so re-uploading a logo replaces it rather than
 * accumulating orphaned files nobody ever cleans up. The bucket's own
 * file_size_limit/allowed_mime_types (0010) are the real enforcement; the
 * checks here exist to fail fast with a message before a 5MB file finishes
 * uploading only to be rejected.
 *
 * A stable path means a stable public URL, which a browser or CDN would
 * otherwise keep showing the old image for - the `?v=` query string forces
 * every caller to treat each upload as a new URL worth refetching.
 */
export async function uploadPublicImage(
  bucket: string,
  pathWithoutExt: string,
  file: File,
  maxBytes: number,
): Promise<string> {
  const ext = EXT_FOR_TYPE[file.type];
  if (!ext) {
    throw new UploadValidationError("Please upload a JPEG, PNG, or WebP image.");
  }
  if (file.size > maxBytes) {
    throw new UploadValidationError(`That file is too large - the limit is ${Math.round(maxBytes / 1024 / 1024)}MB.`);
  }

  const supabase = createClient();
  const path = `${pathWithoutExt}.${ext}`;

  // upsert only replaces an exact path match, so switching formats (a PNG
  // logo re-uploaded as JPEG) would otherwise leave the old file behind
  // forever. Best-effort: nothing downstream depends on this succeeding.
  const staleExts = Object.values(EXT_FOR_TYPE).filter((e) => e !== ext);
  await supabase.storage.from(bucket).remove(staleExts.map((e) => `${pathWithoutExt}.${e}`));

  const { error } = await supabase.storage
    .from(bucket)
    .upload(path, file, { upsert: true, cacheControl: "3600", contentType: file.type });
  if (error) throw error;

  const { data } = supabase.storage.from(bucket).getPublicUrl(path);
  return `${data.publicUrl}?v=${Date.now()}`;
}
