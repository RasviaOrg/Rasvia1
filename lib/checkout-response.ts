type AnyRecord = Record<string, any>;

function nonEmptyString(value: unknown): string | null {
  return typeof value === "string" && value.trim().length > 0 ? value.trim() : null;
}

function safePreview(payload: unknown): string {
  try {
    const serialized = JSON.stringify(payload);
    if (!serialized) return "";
    return serialized.length > 400 ? `${serialized.slice(0, 400)}...` : serialized;
  } catch {
    return "";
  }
}

export function getCheckoutUrlOrThrow(payload: unknown): string {
  const data = (payload ?? {}) as AnyRecord;

  const checkoutUrl =
    nonEmptyString(data.url) ??
    nonEmptyString(data.checkout_url) ??
    nonEmptyString(data.data?.url) ??
    nonEmptyString(data.data?.checkout_url);

  if (checkoutUrl) return checkoutUrl;

  const serverError =
    nonEmptyString(data.error) ??
    nonEmptyString(data.message) ??
    nonEmptyString(data.data?.error) ??
    nonEmptyString(data.data?.message);

  if (serverError) {
    throw new Error(serverError);
  }

  const preview = safePreview(payload);
  throw new Error(
    preview
      ? `Checkout service did not return a URL. Response: ${preview}`
      : "Checkout service did not return a URL."
  );
}
