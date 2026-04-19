-- ============================================================================
-- Solo order refund support
-- ----------------------------------------------------------------------------
-- Adds Stripe payment / refund tracking to the `orders` table, and exposes
-- mark_order_refunded() RPC for the refund-order edge function to call after
-- successfully issuing a Stripe refund.
--
-- Party (group) order refunds keep flowing through party_payments via the
-- existing cancel-party-session edge function and party_mark_refunded RPC.
-- ============================================================================

ALTER TABLE public.orders
  ADD COLUMN IF NOT EXISTS stripe_payment_intent_id text,
  ADD COLUMN IF NOT EXISTS stripe_charge_id         text,
  ADD COLUMN IF NOT EXISTS refunded_amount_cents    integer NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS refunded_at              timestamptz;

CREATE INDEX IF NOT EXISTS idx_orders_stripe_payment_intent
  ON public.orders (stripe_payment_intent_id)
  WHERE stripe_payment_intent_id IS NOT NULL;

CREATE INDEX IF NOT EXISTS idx_orders_stripe_charge
  ON public.orders (stripe_charge_id)
  WHERE stripe_charge_id IS NOT NULL;

COMMENT ON COLUMN public.orders.stripe_payment_intent_id IS
  'Stripe PaymentIntent id for this solo order. Persisted by stripe-webhook on checkout.session.completed.';
COMMENT ON COLUMN public.orders.stripe_charge_id IS
  'Stripe Charge id for this order (if captured).';
COMMENT ON COLUMN public.orders.refunded_amount_cents IS
  'Cumulative refunded amount in cents across one or more partial refunds.';
COMMENT ON COLUMN public.orders.refunded_at IS
  'Last time a refund was recorded against this order.';

-- ────────────────────────────────────────────────────────────────────────────
-- RPC: mark_order_refunded
-- ----------------------------------------------------------------------------
-- Called by the refund-order edge function after Stripe has accepted a refund.
-- Bumps refunded_amount_cents and (if fully refunded) flips the order's
-- status to 'cancelled' so it shows up as refunded in the dashboard.
-- service_role only — never exposed to anon/authenticated clients.
-- ────────────────────────────────────────────────────────────────────────────

CREATE OR REPLACE FUNCTION public.mark_order_refunded(
  p_order_id        bigint,
  p_amount_cents    integer,
  p_charge_id       text DEFAULT NULL
) RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $func$
DECLARE
  v_total_cents      integer;
  v_new_refunded     integer;
  v_fully            boolean;
BEGIN
  IF p_order_id IS NULL THEN
    RAISE EXCEPTION 'order_id_required' USING ERRCODE = '22023';
  END IF;
  IF coalesce(p_amount_cents, 0) <= 0 THEN
    RAISE EXCEPTION 'amount_required' USING ERRCODE = '22023';
  END IF;

  UPDATE public.orders AS o
    SET refunded_amount_cents = LEAST(
          (round(coalesce(o.subtotal, 0) * 100)::integer
           + round(coalesce(o.tip_amount, 0) * 100)::integer),
          coalesce(o.refunded_amount_cents, 0) + p_amount_cents
        ),
        refunded_at      = now(),
        stripe_charge_id = coalesce(p_charge_id, o.stripe_charge_id),
        status           = CASE
          WHEN (round(coalesce(o.subtotal, 0) * 100)::integer
                + round(coalesce(o.tip_amount, 0) * 100)::integer) > 0
           AND (coalesce(o.refunded_amount_cents, 0) + p_amount_cents)
                >= (round(coalesce(o.subtotal, 0) * 100)::integer
                    + round(coalesce(o.tip_amount, 0) * 100)::integer)
          THEN 'cancelled'
          ELSE o.status
        END
    WHERE o.id = p_order_id
    RETURNING
      (round(coalesce(o.subtotal, 0) * 100)::integer
        + round(coalesce(o.tip_amount, 0) * 100)::integer),
      o.refunded_amount_cents,
      (round(coalesce(o.subtotal, 0) * 100)::integer
        + round(coalesce(o.tip_amount, 0) * 100)::integer) > 0
        AND o.refunded_amount_cents
            >= (round(coalesce(o.subtotal, 0) * 100)::integer
                + round(coalesce(o.tip_amount, 0) * 100)::integer)
    INTO v_total_cents, v_new_refunded, v_fully;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'order_not_found' USING ERRCODE = 'P0002';
  END IF;

  RETURN jsonb_build_object(
    'ok', true,
    'order_id', p_order_id,
    'refunded_amount_cents', v_new_refunded,
    'total_cents', v_total_cents,
    'fully_refunded', coalesce(v_fully, false)
  );
END;
$func$;

REVOKE ALL ON FUNCTION public.mark_order_refunded(bigint, integer, text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.mark_order_refunded(bigint, integer, text) TO service_role;

-- ────────────────────────────────────────────────────────────────────────────
-- Extend charge.refunded webhook support to solo orders
-- ----------------------------------------------------------------------------
-- The stripe-webhook currently looks up `party_payments` by
-- `stripe_payment_intent`. Solo orders don't have that entry. We rely on the
-- edge function update to also check the `orders` table when a charge.refunded
-- event fires. No RPC needed here, but expose a lookup-friendly view so the
-- webhook can find solo orders by intent id.
-- ────────────────────────────────────────────────────────────────────────────
