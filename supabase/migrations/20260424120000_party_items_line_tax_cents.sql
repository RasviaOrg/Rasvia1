-- Per-line sales tax (cents) materialized at lock; distribution follows these amounts for each-pays/assigned.
ALTER TABLE public.party_items
  ADD COLUMN IF NOT EXISTS tax_cents integer NOT NULL DEFAULT 0;

COMMENT ON COLUMN public.party_items.tax_cents IS
  'Line-level sales tax in cents, set from Stripe Tax at party lock. Source of truth for splitting tax by cart line.';

-- Clear per-line tax when the host unlocks the cart.
CREATE OR REPLACE FUNCTION public.party_unlock_session(
  p_session_id uuid,
  p_member_id  uuid,
  p_token      text
) RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_member  public.party_members;
  v_session public.party_sessions;
  v_has_paid integer;
BEGIN
  v_member := public._party_auth(p_session_id, p_member_id, p_token);
  IF v_member.role <> 'host' THEN
    RAISE EXCEPTION 'host_only' USING ERRCODE = '42501';
  END IF;
  SELECT * INTO v_session FROM public.party_sessions WHERE id = p_session_id FOR UPDATE;
  IF v_session.status NOT IN ('locked','paying') THEN
    RAISE EXCEPTION 'cannot_unlock' USING ERRCODE = '22023';
  END IF;

  SELECT count(*) INTO v_has_paid FROM public.party_payments
    WHERE session_id = p_session_id
      AND (
        status = 'paid'
        OR (status = 'covered' AND (covered_by_member_id IS NOT NULL OR coalesce(amount_cents, 0) > 0))
      );
  IF v_has_paid > 0 THEN
    RAISE EXCEPTION 'payments_in_progress' USING ERRCODE = '22023';
  END IF;

  DELETE FROM public.party_payments WHERE session_id = p_session_id AND status = 'pending';
  UPDATE public.party_items SET tax_cents = 0 WHERE session_id = p_session_id;
  UPDATE public.party_sessions
    SET status = 'open', locked_at = NULL, subtotal_cents = 0, total_cents = 0, tax_cents = 0
    WHERE id = p_session_id;
  RETURN jsonb_build_object('ok', true);
END;
$$;
