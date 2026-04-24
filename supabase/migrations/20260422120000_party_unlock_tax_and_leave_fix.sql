-- Fix unlock / leave: members with $0 and status `covered` (no one paid on their
-- behalf) from host_pays or empty ledger must not be treated as "already paid".
-- Also clear tax_cents when returning to the open cart.
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
  UPDATE public.party_sessions
    SET status = 'open', locked_at = NULL, subtotal_cents = 0, total_cents = 0, tax_cents = 0
    WHERE id = p_session_id;
  RETURN jsonb_build_object('ok', true);
END;
$$;

CREATE OR REPLACE FUNCTION public.party_leave(
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
  v_pay_status text;
  v_pay_covered_by uuid;
  v_pay_amount integer;
  v_successor uuid;
BEGIN
  v_member := public._party_auth(p_session_id, p_member_id, p_token);
  SELECT * INTO v_session FROM public.party_sessions WHERE id = p_session_id FOR UPDATE;

  SELECT status, covered_by_member_id, coalesce(amount_cents, 0)
    INTO v_pay_status, v_pay_covered_by, v_pay_amount
    FROM public.party_payments
    WHERE session_id = p_session_id AND member_id = p_member_id
    LIMIT 1;

  IF v_pay_status = 'paid' OR
     (v_pay_status = 'covered' AND (v_pay_covered_by IS NOT NULL OR v_pay_amount > 0)) THEN
    RAISE EXCEPTION 'cannot_leave_after_paying' USING ERRCODE = '22023';
  END IF;

  UPDATE public.party_members SET left_at = now() WHERE id = p_member_id;

  DELETE FROM public.party_payments
    WHERE session_id = p_session_id AND member_id = p_member_id AND status = 'pending';

  IF v_session.status = 'open' THEN
    DELETE FROM public.party_items
      WHERE session_id = p_session_id AND added_by_member_id = p_member_id;
  END IF;

  IF v_member.role = 'host' THEN
    SELECT id INTO v_successor
      FROM public.party_members
      WHERE session_id = p_session_id AND left_at IS NULL AND id <> p_member_id
      ORDER BY joined_at ASC
      LIMIT 1;

    IF v_successor IS NOT NULL THEN
      UPDATE public.party_members SET role = 'host' WHERE id = v_successor;
      UPDATE public.party_sessions SET host_user_id = coalesce(
        (SELECT user_id FROM public.party_members WHERE id = v_successor),
        v_session.host_user_id
      ) WHERE id = p_session_id;
    ELSE
      UPDATE public.party_sessions SET status = 'cancelled', cancelled_at = now() WHERE id = p_session_id;
    END IF;
  END IF;

  RETURN jsonb_build_object('ok', true);
END;
$$;

-- Atomically set final per-member amounts and session tax (after client-side quote).
CREATE OR REPLACE FUNCTION public.party_apply_session_tax(
  p_session_id uuid,
  p_member_id  uuid,
  p_token      text,
  p_amounts    jsonb,
  p_tax_cents  integer
) RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_member   public.party_members;
  v_session  public.party_sessions;
  v_sub      integer;
  v_exp      integer;
  v_sum      bigint;
  v_rec      RECORD;
BEGIN
  v_member := public._party_auth(p_session_id, p_member_id, p_token);
  IF v_member.role <> 'host' THEN
    RAISE EXCEPTION 'host_only' USING ERRCODE = '42501';
  END IF;
  SELECT * INTO v_session FROM public.party_sessions WHERE id = p_session_id FOR UPDATE;
  IF v_session.status NOT IN ('locked', 'paying') THEN
    RAISE EXCEPTION 'session_not_open' USING ERRCODE = '22023';
  END IF;

  v_sub := coalesce(v_session.subtotal_cents, 0);
  v_exp := v_sub + coalesce(p_tax_cents, 0);

  SELECT coalesce(sum((t.v)::integer), 0) INTO v_sum
    FROM jsonb_each_text(p_amounts) AS t(k, v);
  IF v_sum IS DISTINCT FROM v_exp THEN
    RAISE EXCEPTION 'amount_mismatch' USING ERRCODE = '22023';
  END IF;

  FOR v_rec IN
    SELECT t.k::uuid AS m, t.v::text::integer AS a
    FROM jsonb_each_text(p_amounts) AS t(k, v)
  LOOP
    UPDATE public.party_payments pp
    SET
      amount_cents = v_rec.a,
      status = CASE
        WHEN pp.status IN ('paid', 'refunded') THEN pp.status
        WHEN v_rec.a = 0 THEN 'covered'
        WHEN pp.status = 'covered' OR pp.status = 'pending' THEN 'pending'
        ELSE pp.status
      END,
      updated_at = now()
    WHERE pp.session_id = p_session_id AND pp.member_id = v_rec.m
      AND pp.status NOT IN ('paid', 'refunded');
  END LOOP;

  UPDATE public.party_sessions
    SET tax_cents = greatest(0, coalesce(p_tax_cents, 0)),
        total_cents = v_sub + greatest(0, coalesce(p_tax_cents, 0))
    WHERE id = p_session_id;

  RETURN jsonb_build_object('ok', true, 'subtotal_cents', v_sub, 'tax_cents', p_tax_cents);
END;
$$;

GRANT EXECUTE ON FUNCTION public.party_apply_session_tax(uuid, uuid, text, jsonb, integer) TO anon, authenticated, service_role;
