export type EdgeFunctionErrorDetails = {
  message: string;
  status?: number;
  statusText?: string;
  body?: string;
  originalMessage?: string;
};

export function isInvalidJwtEdgeFunctionError(details: EdgeFunctionErrorDetails): boolean {
  const combined = `${details.message} ${details.body ?? ''} ${details.originalMessage ?? ''}`.toLowerCase();
  return details.status === 401 && combined.includes('invalid jwt');
}

function parseMessageFromBody(rawBody: string): string {
  try {
    const parsed = JSON.parse(rawBody);
    if (typeof parsed?.error === 'string' && parsed.error.trim()) return parsed.error.trim();
    if (typeof parsed?.message === 'string' && parsed.message.trim()) return parsed.message.trim();
  } catch {
    // Keep raw text fallback.
  }

  return rawBody.trim();
}

export async function parseEdgeFunctionError(
  error: unknown,
  fallbackMessage = 'Request failed. Please try again.'
): Promise<EdgeFunctionErrorDetails> {
  const err = error as any;
  const details: EdgeFunctionErrorDetails = {
    message: fallbackMessage,
    originalMessage: typeof err?.message === 'string' ? err.message : undefined,
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
          const parsedBodyMessage = parseMessageFromBody(rawBody);
          if (parsedBodyMessage) {
            details.message = parsedBodyMessage;
          }
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
