/**
 * Order cancellation helper.
 *
 * Policy (per product): a user can self-cancel an order only when the kitchen
 * hasn't started it yet AND there isn't a successfully captured Stripe
 * payment. For everything else (paid card, already preparing, etc.) the UI
 * surfaces a "Contact the restaurant to cancel" path using the restaurant's
 * phone number.
 *
 * Returns:
 *   { ok: true }                     — order was flipped to `cancelled`.
 *   { ok: false, reason: "paid_card" } — user can't cancel; prompt to call.
 *   { ok: false, reason: "not_found" | "already_terminal" | "network" } —
 *     various defensive fallbacks.
 */

import { supabase } from "./supabase";

export type CancelReason =
  | "paid_card"
  | "not_found"
  | "already_terminal"
  | "network"
  | "unauthorized";

export type CancelResult =
  | { ok: true }
  | { ok: false; reason: CancelReason; message?: string };

const TERMINAL_STATUSES = new Set([
  "cancelled",
  "completed",
  "refunded",
  "voided",
]);

/** Statuses that a user is still allowed to self-cancel (cash path). */
const SELF_CANCEL_STATUSES = new Set(["pending", "pending_payment"]);

export async function cancelOrder(orderId: string): Promise<CancelResult> {
  if (!orderId) return { ok: false, reason: "not_found" };

  try {
    const { data, error } = await supabase
      .from("orders")
      .select("id, status, payment_method, stripe_payment_intent_id, created_by")
      .eq("id", orderId)
      .maybeSingle();

    if (error) return { ok: false, reason: "network", message: error.message };
    if (!data) return { ok: false, reason: "not_found" };

    const status = String((data as any).status ?? "").toLowerCase();
    if (TERMINAL_STATUSES.has(status)) {
      return { ok: false, reason: "already_terminal" };
    }

    const paymentMethod = String((data as any).payment_method ?? "").toLowerCase();
    const hasStripeIntent = Boolean((data as any).stripe_payment_intent_id);

    // Self-cancel is allowed when:
    //  - the order is still pending AND not backed by a captured Stripe charge
    //  - OR the order is cash-only
    const isCashPath = paymentMethod === "cash";
    const isPendingUnpaid = SELF_CANCEL_STATUSES.has(status) && !hasStripeIntent;

    if (!isCashPath && !isPendingUnpaid) {
      return { ok: false, reason: "paid_card" };
    }

    const { error: updErr } = await supabase
      .from("orders")
      .update({ status: "cancelled", cancelled_at: new Date().toISOString() })
      .eq("id", orderId);

    if (updErr) return { ok: false, reason: "network", message: updErr.message };
    return { ok: true };
  } catch (err: any) {
    return { ok: false, reason: "network", message: err?.message };
  }
}

/** Build a human-friendly message for when we can't self-cancel. */
export function cancelErrorMessage(
  reason: CancelReason,
  restaurantName?: string | null,
): { title: string; message: string } {
  switch (reason) {
    case "paid_card":
      return {
        title: "Contact the restaurant",
        message: restaurantName
          ? `This order was already paid by card. Please contact ${restaurantName} directly to cancel and refund.`
          : "This order was already paid by card. Please contact the restaurant directly to cancel and refund.",
      };
    case "already_terminal":
      return {
        title: "Can't cancel",
        message: "This order has already been cancelled or completed.",
      };
    case "not_found":
      return {
        title: "Order not found",
        message: "We couldn't find that order anymore.",
      };
    case "unauthorized":
      return {
        title: "Not allowed",
        message: "You don't have permission to cancel this order.",
      };
    case "network":
    default:
      return {
        title: "Couldn't cancel",
        message: "Please check your connection and try again.",
      };
  }
}
