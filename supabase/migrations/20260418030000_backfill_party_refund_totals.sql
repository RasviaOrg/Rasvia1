-- 20260418030000_backfill_party_refund_totals.sql
--
-- Historical reconciliation: the old `party_mark_refunded` RPC only flipped the
-- party_payments row and never touched the owning order. As a result
-- `orders.refunded_amount_cents` / `orders.refunded_at` / `orders.status` are
-- stale for any party order that was refunded before the 2026-04-18 rollout.
--
-- This migration brings them back in sync so the dashboard's "already
-- refunded" detection (and the per-order totals in Reports) reflects reality.

-- 1. Compute the total refunded amount for each party order as the sum of its
--    refunded party_payments. We use amount_cents from party_payments itself
--    since refunds there always equalled the full payment amount.
WITH per_order AS (
  SELECT
    o.id                                AS order_id,
    COALESCE(SUM(pp.amount_cents), 0)   AS refunded_cents,
    MAX(COALESCE(pp.updated_at, pp.paid_at)) AS last_refunded_at
  FROM public.orders o
  JOIN public.party_payments pp
    ON pp.session_id = o.party_session_id::uuid
   AND pp.status     = 'refunded'
  WHERE o.party_session_id IS NOT NULL
  GROUP BY o.id
)
-- Only touch the refund tracking columns — `orders.status` has a CHECK
-- constraint that predates 'refunded' as a value on some databases, so we let
-- the dashboard derive "fully refunded" from refunded_amount_cents vs total.
UPDATE public.orders o
SET
  refunded_amount_cents = GREATEST(o.refunded_amount_cents, per_order.refunded_cents),
  refunded_at           = COALESCE(o.refunded_at, per_order.last_refunded_at, now())
FROM per_order
WHERE o.id = per_order.order_id
  AND per_order.refunded_cents > o.refunded_amount_cents;

-- 2. For any refunded party_payment row that lacks an order_refunds audit
--    entry, insert a synthetic record so the Past Orders audit trail is
--    populated. We deliberately use 'legacy-backfill' as the refund_id so the
--    unique constraint doesn't reject real Stripe refund ids going forward.
INSERT INTO public.order_refunds (
  order_id, stripe_payment_intent_id, stripe_refund_id,
  party_payment_id, amount_cents, reason, items, refunded_by, created_at
)
SELECT
  o.id,
  pp.stripe_payment_intent,
  'legacy-backfill:' || pp.id::text,
  pp.id,
  pp.amount_cents,
  'Backfilled from party_payments.status=refunded (pre-2026-04-18).',
  '[]'::jsonb,
  NULL,
  COALESCE(pp.updated_at, pp.paid_at, now())
FROM public.party_payments pp
JOIN public.orders o
  ON o.party_session_id::uuid = pp.session_id
WHERE pp.status = 'refunded'
  AND o.party_session_id IS NOT NULL
  AND NOT EXISTS (
    SELECT 1 FROM public.order_refunds r
    WHERE r.party_payment_id = pp.id
  );
