/**
 * Module-level flag to temporarily suppress AuthGate redirects.
 * Used during inline password reset / email verification flows
 * where verifyOtp creates a session but we don't want to navigate yet.
 */
export const authGateFlags = {
  /** When true, AuthGate will not redirect from auth → home. */
  suppressRedirect: false,
};
