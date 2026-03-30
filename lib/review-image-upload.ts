import { supabase } from "@/lib/supabase";
import { extFromUri, mimeForImageExt } from "@/lib/menu-image-upload";

function base64ToArrayBuffer(b64: string): ArrayBuffer {
  const binary = globalThis.atob(b64);
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i);
  return bytes.buffer;
}

/**
 * Read a local asset URI into bytes. fetch()+arrayBuffer works for many URIs;
 * on some iOS library assets the response is empty — fall back to expo-file-system.
 */
async function readUriAsArrayBuffer(uri: string): Promise<ArrayBuffer> {
  try {
    const response = await fetch(uri);
    if (response.ok) {
      const buf = await response.arrayBuffer();
      if (buf.byteLength > 0) return buf;
    }
  } catch {
    // ph:// and some URIs fail fetch — try file read below
  }

  try {
    const FileSystem = await import("expo-file-system/legacy");
    const b64 = await FileSystem.readAsStringAsync(uri, {
      encoding: FileSystem.EncodingType.Base64,
    });
    const buf = base64ToArrayBuffer(b64);
    if (buf.byteLength === 0) throw new Error("empty");
    return buf;
  } catch {
    throw new Error(
      "Could not read the photo. Try choosing a different image or pick from Photos again."
    );
  }
}

function extAndContentType(uri: string, mimeHint?: string | null): { ext: string; contentType: string } {
  let ext = extFromUri(uri);
  const m = mimeHint?.toLowerCase() ?? "";
  if (m === "image/heic" || m === "image/heif") ext = "heic";
  const contentType =
    mimeHint && /^image\//i.test(mimeHint) ? mimeHint : mimeForImageExt(ext);
  return { ext, contentType };
}

/**
 * Uploads to `review_images` bucket under `review-photos/{restaurantId}/...`.
 */
export async function uploadReviewPhotoToStorage(
  restaurantId: string,
  assetUri: string,
  mimeHint?: string | null
): Promise<string> {
  const { ext, contentType } = extAndContentType(assetUri, mimeHint);
  const fileName = `review-photos/${restaurantId}/${Date.now()}-${Math.random().toString(36).slice(2)}.${ext}`;

  const arrayBuffer = await readUriAsArrayBuffer(assetUri);

  const { data, error } = await supabase.storage
    .from("review_images")
    .upload(fileName, arrayBuffer, { upsert: true, contentType });

  if (error || !data) {
    throw new Error(error?.message ?? "Upload failed — check Storage bucket review_images and policies.");
  }

  const { data: urlData } = supabase.storage.from("review_images").getPublicUrl(data.path);
  return urlData.publicUrl;
}
