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

/** Kitchen has not started — user may still self-cancel (home banner, My Orders, etc.). */
export function canSelfCancelOrderStatus(status: string | null | undefined): boolean {
  return SELF_CANCEL_STATUSES.has(String(status ?? "").toLowerCase());
}

/**
 * Host/guest party-session cancel — only while the session is still in checkout
 * and the linked kitchen ticket (if any) is still in the initial pending stage.
 */
export function canCancelPartySession(
  sessionStatus: string,
  kitchenOrderStatus?: string | null,
): boolean {
  const st = String(sessionStatus ?? "").toLowerCase();
  if (["cancelled", "completed", "submitted"].includes(st)) return false;
  if (!["open", "locked", "paying"].includes(st)) return false;
  if (kitchenOrderStatus != null && String(kitchenOrderStatus).length > 0) {
    return canSelfCancelOrderStatus(kitchenOrderStatus);
  }
  return true;
}

/**
 * Detect the specific PostgREST error we get when `orders.cancelled_at` is
 * missing from the connected Supabase project. The very first deploys of the
 * orders system didn't ship that column; we added it in
 * `20260419210000_orders_cancelled_at.sql`. Before that migration has been
 * applied, the client needs to gracefully retry the UPDATE without it so the
 * user can still cancel their order.
 */
function isCancelledAtMissing(err: any): boolean {
  if (!err) return false;
  const code = err?.code ?? err?.details?.code;
  const message = typeof err?.message === "string" ? err.message : "";
  return code === "42703" && /cancelled_at/i.test(message);
}

let legacyCancelledAtWarned = false;
function warnLegacyCancelledAtOnce() {
  if (legacyCancelledAtWarned) return;
  legacyCancelledAtWarned = true;
  // eslint-disable-next-line no-console
  console.warn(
    "[order-cancel] `cancelled_at` column not found on public.orders — " +
      "falling back to status-only update. Apply migration 20260419210000 " +
      "and run `NOTIFY pgrst, 'reload schema';` to silence this warning.",
  );
}

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
    const isPendingUnpaid = canSelfCancelOrderStatus(status) && !hasStripeIntent;

    if (!isCashPath && !isPendingUnpaid) {
      return { ok: false, reason: "paid_card" };
    }

    const nowIso = new Date().toISOString();
    let { error: updErr, data: updData } = await supabase
      .from("orders")
      .update({ status: "cancelled", cancelled_at: nowIso })
      .eq("id", orderId)
      .select("id")
      .maybeSingle();

    // Legacy schema: the `cancelled_at` column hasn't been added yet. Retry
    // with just the status so the user actually gets their order cancelled.
    if (updErr && isCancelledAtMissing(updErr)) {
      warnLegacyCancelledAtOnce();
      const retry = await supabase
        .from("orders")
        .update({ status: "cancelled" })
        .eq("id", orderId)
        .select("id")
        .maybeSingle();
      updErr = retry.error;
      updData = retry.data as any;
    }

    if (updErr) {
      return { ok: false, reason: "network", message: updErr.message };
    }

    // Defensive: if RLS silently filtered the update out, `updData` will be
    // null. Treat that as an authorization failure so the user at least sees a
    // useful message instead of thinking everything went through.
    if (!updData) {
      return {
        ok: false,
        reason: "unauthorized",
        message: "Supabase RLS blocked the cancel update. Check orders policy.",
      };
    }

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
