-- ============================================================================
-- Orders cancelled_at column
-- ----------------------------------------------------------------------------
-- The in-app `cancelOrder()` helper writes `status = 'cancelled'` alongside a
-- `cancelled_at` timestamp so we can distinguish "actively cancelled" orders
-- from historical rows. The column was only ever added to `party_sessions`
-- during the group-order overhaul, so every attempt to self-cancel a regular
-- order has been silently failing with PostgREST 42703 and surfacing to users
-- as the generic "Couldn't cancel — check your connection" alert.
--
-- This migration simply adds the column (nullable) and refreshes the
-- PostgREST schema cache so clients see it immediately.
-- ============================================================================

ALTER TABLE public.orders
  ADD COLUMN IF NOT EXISTS cancelled_at timestamptz;

COMMENT ON COLUMN public.orders.cancelled_at IS
  'Timestamp the order flipped to status = cancelled. NULL for orders that were never cancelled.';

-- Nudge PostgREST to re-read the schema so the app can start writing this
-- column without a pod restart.
NOTIFY pgrst, 'reload schema';
