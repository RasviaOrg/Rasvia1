import { supabase } from "./supabase";
import type { User } from "@supabase/supabase-js";

function firstNonEmpty(...values: Array<string | null | undefined>): string | null {
  for (const value of values) {
    const trimmed = value?.trim();
    if (trimmed) return trimmed;
  }
  return null;
}

function normalizedPhone(raw: string | null | undefined): string | null {
  if (!raw) return null;
  const digits = raw.replace(/\D/g, "").trim();
  return digits.length > 0 ? digits : null;
}

export async function upsertProfileFromAuthUser(user: User): Promise<void> {
  const meta = (user.user_metadata ?? {}) as Record<string, any>;

  const fullName = firstNonEmpty(
    meta.full_name,
    [meta.first_name, meta.last_name].filter(Boolean).join(" "),
    meta.name
  );

  const avatarUrl = firstNonEmpty(
    meta.avatar_url,
    meta.picture,
    meta.profile_image_url
  );

  const phoneNumber = normalizedPhone(meta.phone_number ?? user.phone);

  const { error } = await supabase.from("profiles").upsert(
    {
      id: user.id,
      email: user.email ?? null,
      full_name: fullName,
      avatar_url: avatarUrl,
      phone_number: phoneNumber,
      updated_at: new Date().toISOString(),
    },
    { onConflict: "id" }
  );

  if (error) {
    throw error;
  }
}
