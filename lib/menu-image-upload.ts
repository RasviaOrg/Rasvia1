import { supabase } from "@/lib/supabase";

/** Picker result — include mime when available (expo-image-picker). */
export type PickedImage = { uri: string; mimeType?: string | null };

export function extFromUri(uri: string): string {
  const clean = uri.split("?")[0];
  const m = clean.match(/\.([a-zA-Z0-9]+)$/);
  return m ? m[1].toLowerCase() : "jpg";
}

export function mimeForImageExt(ext: string): string {
  const e = ext.toLowerCase();
  if (e === "jpg" || e === "jpeg") return "image/jpeg";
  if (e === "png") return "image/png";
  if (e === "webp") return "image/webp";
  if (e === "heic" || e === "heif") return "image/heic";
  return "image/jpeg";
}

/**
 * Uploads to `menu-images` bucket. Uses ArrayBuffer (reliable on React Native);
 * blob() from local file URIs is often broken/empty on iOS/Android.
 */
export async function uploadMenuImageToStorage(
  itemId: string,
  assetUri: string,
  mimeHint?: string | null
): Promise<string> {
  const ext = extFromUri(assetUri);
  const fileName = `menu_${itemId}_${Date.now()}.${ext}`;
  const contentType =
    mimeHint && /^image\//i.test(mimeHint) ? mimeHint : mimeForImageExt(ext);

  const response = await fetch(assetUri);
  if (!response.ok) {
    throw new Error(`Could not read image (HTTP ${response.status})`);
  }
  const arrayBuffer = await response.arrayBuffer();
  if (arrayBuffer.byteLength === 0) {
    throw new Error("Image file is empty — try picking the photo again.");
  }

  const { data: uploadData, error: uploadError } = await supabase.storage
    .from("menu-images")
    .upload(fileName, arrayBuffer, { upsert: true, contentType });

  if (uploadError) throw uploadError;
  const { data: urlData } = supabase.storage.from("menu-images").getPublicUrl(uploadData.path);
  return urlData.publicUrl;
}
