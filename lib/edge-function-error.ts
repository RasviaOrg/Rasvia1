export type EdgeFunctionErrorDetails = {
  message: string;
  status?: number;
  statusText?: string;
  body?: string;
  originalMessage?: string;
  /** Optional structured code returned by the edge function (e.g. `restaurant_not_linked`). */
  code?: string;
  /** Optional title the edge function wants surfaced on the client dialog. */
  title?: string;
};

export function isInvalidJwtEdgeFunctionError(details: EdgeFunctionErrorDetails): boolean {
  const combined = `${details.message} ${details.body ?? ''} ${details.originalMessage ?? ''}`.toLowerCase();
  return details.status === 401 && combined.includes('invalid jwt');
}

function parseMessageFromBody(rawBody: string): { message: string; code?: string; title?: string } {
  try {
    const parsed = JSON.parse(rawBody);
    const message = (typeof parsed?.error === 'string' && parsed.error.trim())
      || (typeof parsed?.message === 'string' && parsed.message.trim())
      || '';
    if (message) {
      return {
        message,
        code: typeof parsed?.code === 'string' ? parsed.code : undefined,
        title: typeof parsed?.title === 'string' ? parsed.title : undefined,
      };
    }
  } catch {
    // Keep raw text fallback.
  }

  return { message: rawBody.trim() };
}

export async function parseEdgeFunctionError(
  error: unknown,
  fallbackMessage = 'Request failed. Please try again.'
): Promise<EdgeFunctionErrorDetails> {
  const err = error as any;
  const details: EdgeFunctionErrorDetails = {
    message: fallbackMessage,
    originalMessage: typeof err?.message === 'string' ? err.message : undefined,
    // Inline errors (e.g. `new Error(msg)` thrown after reading `fnData.error`)
    // may carry structured hints that didn't come through the Response object.
    code: typeof err?.code === 'string' ? err.code : undefined,
    title: typeof err?.title === 'string' ? err.title : undefined,
  };

  const context = err?.context;
  if (context) {
    if (typeof context?.status === 'number') details.status = context.status;
    if (typeof context?.statusText === 'string') details.statusText = context.statusText;

    try {
      const readable = typeof context?.clone === 'function' ? context.clone() : context;
      if (typeof readable?.text === 'function') {
        const rawBody = await readable.text();
        if (rawBody?.trim()) {
          details.body = rawBody;
          const parsed = parseMessageFromBody(rawBody);
          if (parsed.message) details.message = parsed.message;
          if (parsed.code) details.code = parsed.code;
          if (parsed.title) details.title = parsed.title;
        }
      }
    } catch {
      // If body parsing fails, we still return status + original message.
    }

    if (details.message === fallbackMessage && typeof details.status === 'number') {
      const suffix = details.statusText ? ` ${details.statusText}` : '';
      details.message = `Edge Function request failed (HTTP ${details.status}${suffix}).`;
    }
  }

  if (details.message === fallbackMessage && details.originalMessage?.trim()) {
    details.message = details.originalMessage;
  }

  return details;
}
