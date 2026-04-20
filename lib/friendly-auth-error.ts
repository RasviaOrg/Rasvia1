/**
 * Translates raw Supabase / fetch errors into user-friendly strings so the
 * UI never has to surface "Failed to fetch" or "TypeError: Network request
 * failed" to a regular human.
 *
 * Use it in *any* auth-adjacent modal (sign in, sign up, reset password,
 * change password, email verify, OTP) — pass the caught error and an
 * optional `fallback` for unknown cases.
 */

const NETWORK_PATTERNS = [
  /failed to fetch/i,
  /network request failed/i,
  /networkerror/i,
  /load failed/i,
  /typeerror.*fetch/i,
  /timeout/i,
  /aborted/i,
  /timed out/i,
];

const RATE_LIMIT_PATTERNS = [
  /too many requests/i,
  /rate limit/i,
  /try again later/i,
];

const CREDENTIAL_PATTERNS = [
  /invalid login credentials/i,
  /invalid_credentials/i,
  /invalid email or password/i,
  /invalid_grant/i,
];

const EMAIL_TAKEN_PATTERNS = [
  /already registered/i,
  /already exists/i,
  /user already exists/i,
  /email.*taken/i,
];

const VERIFY_PATTERNS = [
  /not confirmed/i,
  /email not verified/i,
  /confirm your email/i,
];

const WEAK_PASSWORD_PATTERNS = [
  /password.*short/i,
  /weak.*password/i,
  /password.*characters/i,
];

export type FriendlyAuthError = {
  /** Single short line — safe to drop into Alert.alert title or a toast. */
  title: string;
  /** Optional longer hint. May be empty if title carries the whole message. */
  message: string;
  /** Coarse bucket so callers can branch on UX (e.g. show retry button on
   *  network errors, "Forgot password?" on credential errors, etc). */
  kind:
    | "network"
    | "rate_limit"
    | "credentials"
    | "email_taken"
    | "needs_verification"
    | "weak_password"
    | "unknown";
};

function rawMessage(err: unknown): string {
  if (!err) return "";
  if (typeof err === "string") return err;
  if (err instanceof Error) return err.message ?? "";
  if (typeof err === "object" && err && "message" in err) {
    const m = (err as any).message;
    return typeof m === "string" ? m : "";
  }
  return String(err);
}

export function friendlyAuthError(
  err: unknown,
  fallback = "Something went wrong. Please try again.",
): FriendlyAuthError {
  const msg = rawMessage(err);

  if (NETWORK_PATTERNS.some((p) => p.test(msg))) {
    return {
      title: "Can't reach Rasvia",
      message:
        "Looks like you're offline or your connection is unstable. Check your internet and give it another try.",
      kind: "network",
    };
  }

  if (RATE_LIMIT_PATTERNS.some((p) => p.test(msg))) {
    return {
      title: "Too many tries",
      message: "We've paused this for a moment to keep things secure. Please wait a few minutes and try again.",
      kind: "rate_limit",
    };
  }

  if (CREDENTIAL_PATTERNS.some((p) => p.test(msg))) {
    return {
      title: "Wrong email or password",
      message: "Double-check your details, or tap \"Forgot password\" if you'd like a reset link.",
      kind: "credentials",
    };
  }

  if (EMAIL_TAKEN_PATTERNS.some((p) => p.test(msg))) {
    return {
      title: "Account already exists",
      message: "An account with that email already exists. Try signing in instead.",
      kind: "email_taken",
    };
  }

  if (VERIFY_PATTERNS.some((p) => p.test(msg))) {
    return {
      title: "Verify your email",
      message: "Please confirm your email address with the link we sent before signing in.",
      kind: "needs_verification",
    };
  }

  if (WEAK_PASSWORD_PATTERNS.some((p) => p.test(msg))) {
    return {
      title: "Pick a stronger password",
      message: "Use at least 8 characters with a mix of letters and numbers.",
      kind: "weak_password",
    };
  }

  return {
    title: "Something went wrong",
    message: msg && msg.length < 160 ? msg : fallback,
    kind: "unknown",
  };
}

/** Convenience for sites that just want a single string to show. */
export function friendlyAuthErrorText(err: unknown, fallback?: string): string {
  const f = friendlyAuthError(err, fallback);
  return f.message ? f.message : f.title;
}
