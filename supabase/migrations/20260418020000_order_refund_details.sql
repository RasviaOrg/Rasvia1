-- ============================================================================
-- Detailed refund tracking
-- ----------------------------------------------------------------------------
-- Adds a dedicated `order_refunds` table so each dashboard-issued refund is
-- auditable (who did it, why, which items, Stripe refund id) instead of only
-- storing a cumulative `refunded_amount_cents` on `orders`.
--
-- This migration is additive. The existing `mark_order_refunded(bigint, int,
-- text)` RPC keeps working; we overload it with a richer signature that the
-- updated `refund-order` edge function will call. The webhook path still uses
-- the 3-arg version.
-- ============================================================================

-- ────────────────────────────────────────────────────────────────────────────
-- 1. Columns on orders
-- ----------------------------------------------------------------------------

ALTER TABLE public.orders
  ADD COLUMN IF NOT EXISTS last_refund_reason text;

COMMENT ON COLUMN public.orders.last_refund_reason IS
  'Most recent refund reason recorded via order_refunds. Convenience cache for list views.';

-- ────────────────────────────────────────────────────────────────────────────
-- 2. order_refunds audit table
-- ----------------------------------------------------------------------------

CREATE TABLE IF NOT EXISTS public.order_refunds (
  id                       bigserial PRIMARY KEY,
  order_id                 bigint NOT NULL REFERENCES public.orders(id) ON DELETE CASCADE,
  -- For solo orders this mirrors orders.stripe_payment_intent_id; for party
  -- orders (where a single "order" can map to many party_payments) we store
  -- the party_payment row id so the audit row stays unambiguous.
  stripe_payment_intent_id text,
  stripe_refund_id         text,
  party_payment_id         uuid REFERENCES public.party_payments(id) ON DELETE SET NULL,
  amount_cents             integer NOT NULL CHECK (amount_cents > 0),
  reason                   text,
  -- jsonb array of {order_item_id: bigint, name: text, quantity: int, unit_price_cents: int}
  items                    jsonb NOT NULL DEFAULT '[]'::jsonb,
  refunded_by              uuid REFERENCES auth.users(id) ON DELETE SET NULL,
  created_at               timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_order_refunds_order     ON public.order_refunds (order_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_order_refunds_intent    ON public.order_refunds (stripe_payment_intent_id) WHERE stripe_payment_intent_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_order_refunds_stripe_rf ON public.order_refunds (stripe_refund_id)         WHERE stripe_refund_id IS NOT NULL;

COMMENT ON TABLE  public.order_refunds IS 'One row per dashboard- or webhook-issued refund. Immutable audit log.';
COMMENT ON COLUMN public.order_refunds.items IS
  'JSON array describing which items (and quantities) were refunded. Optional — free-form refunds leave this empty.';

-- ────────────────────────────────────────────────────────────────────────────
-- 3. RLS: owners & restaurant staff can read refunds for their restaurant
-- ----------------------------------------------------------------------------

ALTER TABLE public.order_refunds ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "order_refunds read for restaurant" ON public.order_refunds;

CREATE POLICY "order_refunds read for restaurant"
  ON public.order_refunds FOR SELECT
  TO authenticated
  USING (
    EXISTS (
      SELECT 1
      FROM public.orders o
      LEFT JOIN public.restaurants      r  ON r.id  = o.restaurant_id
      LEFT JOIN public.restaurant_staff rs ON rs.restaurant_id = o.restaurant_id
                                           AND rs.user_id = auth.uid()
      WHERE o.id = order_refunds.order_id
        AND (
          r.owner_id = auth.uid()
          OR rs.user_id IS NOT NULL
        )
    )
  );

-- Writes only happen via SECURITY DEFINER RPCs (service_role below).

-- ────────────────────────────────────────────────────────────────────────────
-- 4. Extended mark_order_refunded with reason + items + refund id
-- ----------------------------------------------------------------------------
-- Replaces the original 3-arg version — the new signature is strictly a
-- superset (all new params have defaults) so any existing call site that only
-- passes order_id/amount/charge_id keeps working after the webhook is
-- redeployed. We drop the old signature first so named-arg resolution is
-- unambiguous in PostgreSQL.

DROP FUNCTION IF EXISTS public.mark_order_refunded(bigint, integer, text);

CREATE OR REPLACE FUNCTION public.mark_order_refunded(
  p_order_id        bigint,
  p_amount_cents    integer,
  p_charge_id       text  DEFAULT NULL,
  p_refund_id       text  DEFAULT NULL,
  p_reason          text  DEFAULT NULL,
  p_items           jsonb DEFAULT '[]'::jsonb,
  p_refunded_by     uuid  DEFAULT NULL,
  p_payment_intent  text  DEFAULT NULL,
  p_party_payment   uuid  DEFAULT NULL
) RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $mark_order_refunded$
DECLARE
  v_subtotal          numeric  := 0;
  v_tip               numeric  := 0;
  v_prev_refunded     integer  := 0;
  v_order_intent_id   text;
  v_total_cents       integer;
  v_new_refunded      integer;
  v_fully             boolean;
  v_refund_row_id     bigint;
  v_clean_reason      text;
  v_effective_intent  text;
  v_exists            integer;
BEGIN
  IF p_order_id IS NULL THEN
    RAISE EXCEPTION 'order_id_required' USING ERRCODE = '22023';
  END IF;
  IF coalesce(p_amount_cents, 0) <= 0 THEN
    RAISE EXCEPTION 'amount_required' USING ERRCODE = '22023';
  END IF;

  -- Lock the row first. We pull individual scalar values with separate
  -- subselects to avoid multi-target SELECT INTO, which some SQL runners
  -- (notably the Supabase Studio editor) mis-parse.
  PERFORM 1 FROM public.orders WHERE id = p_order_id FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'order_not_found' USING ERRCODE = 'P0002';
  END IF;

  v_subtotal        := coalesce((SELECT subtotal              FROM public.orders WHERE id = p_order_id), 0);
  v_tip             := coalesce((SELECT tip_amount            FROM public.orders WHERE id = p_order_id), 0);
  v_prev_refunded   := coalesce((SELECT refunded_amount_cents FROM public.orders WHERE id = p_order_id), 0);
  v_order_intent_id :=          (SELECT stripe_payment_intent_id FROM public.orders WHERE id = p_order_id);

  v_total_cents  := round(v_subtotal * 100)::integer + round(v_tip * 100)::integer;
  v_new_refunded := v_prev_refunded + p_amount_cents;
  -- Only clamp against total when we actually know the total. Party orders
  -- sometimes carry subtotal=0 on the orders row (the real totals live on
  -- party_payments), so in that case we trust the caller's amount.
  IF v_total_cents > 0 AND v_new_refunded > v_total_cents THEN
    v_new_refunded := v_total_cents;
  END IF;
  v_fully := v_total_cents > 0 AND v_new_refunded >= v_total_cents;

  v_clean_reason     := nullif(trim(coalesce(p_reason, '')), '');
  v_effective_intent := coalesce(p_payment_intent, v_order_intent_id);

  UPDATE public.orders
    SET refunded_amount_cents = v_new_refunded,
        refunded_at           = now(),
        stripe_charge_id      = coalesce(p_charge_id, stripe_charge_id),
        last_refund_reason    = coalesce(v_clean_reason, last_refund_reason),
        status                = CASE WHEN v_fully THEN 'cancelled' ELSE status END
    WHERE id = p_order_id;

  -- Idempotency guard: skip audit insert if we've already recorded this
  -- stripe refund id (webhook replay + dashboard double-click).
  IF p_refund_id IS NOT NULL THEN
    v_exists := (SELECT 1 FROM public.order_refunds WHERE stripe_refund_id = p_refund_id LIMIT 1);
    IF v_exists IS NOT NULL THEN
      RETURN jsonb_build_object(
        'ok', true,
        'order_id', p_order_id,
        'refunded_amount_cents', v_new_refunded,
        'total_cents', v_total_cents,
        'fully_refunded', v_fully,
        'duplicate', true
      );
    END IF;
  END IF;

  INSERT INTO public.order_refunds (
    order_id, stripe_payment_intent_id, stripe_refund_id, party_payment_id,
    amount_cents, reason, items, refunded_by
  ) VALUES (
    p_order_id,
    v_effective_intent,
    p_refund_id,
    p_party_payment,
    p_amount_cents,
    v_clean_reason,
    coalesce(p_items, '[]'::jsonb),
    p_refunded_by
  ) RETURNING id INTO v_refund_row_id;

  RETURN jsonb_build_object(
    'ok', true,
    'order_id', p_order_id,
    'refund_id', v_refund_row_id,
    'refunded_amount_cents', v_new_refunded,
    'total_cents', v_total_cents,
    'fully_refunded', v_fully
  );
END;
$mark_order_refunded$;

REVOKE ALL    ON FUNCTION public.mark_order_refunded(bigint, integer, text, text, text, jsonb, uuid, text, uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.mark_order_refunded(bigint, integer, text, text, text, jsonb, uuid, text, uuid) TO service_role;

-- ────────────────────────────────────────────────────────────────────────────
-- 5. party_mark_refunded stays single-arg (flip status only)
-- ----------------------------------------------------------------------------
-- The dashboard refund flow writes the audit row via mark_order_refunded, so
-- party_mark_refunded just needs to flip the party_payments row's status.
-- This keeps it compatible with the webhook (which calls it with a single
-- positional argument).

CREATE OR REPLACE FUNCTION public.party_mark_refunded(p_payment_id uuid)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $party_mark_refunded$
BEGIN
  UPDATE public.party_payments
    SET status = 'refunded'
    WHERE id = p_payment_id AND status IN ('paid','covered');
  RETURN jsonb_build_object('ok', true);
END;
$party_mark_refunded$;

REVOKE ALL    ON FUNCTION public.party_mark_refunded(uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.party_mark_refunded(uuid) TO service_role;

COMMENT ON FUNCTION public.mark_order_refunded(bigint, integer, text, text, text, jsonb, uuid, text, uuid) IS
  'Dashboard-initiated refund bookkeeping: bumps orders.refunded_amount_cents, flips status if fully refunded, and appends a row to order_refunds.';

COMMENT ON FUNCTION public.party_mark_refunded(uuid) IS
  'Flips a party_payments row from paid/covered to refunded. Audit trail lives in order_refunds via mark_order_refunded().';
