-- Optional cancel reason on party sessions; notify all dining guests when a session is cancelled.

ALTER TABLE public.party_sessions
  ADD COLUMN IF NOT EXISTS cancellation_reason text;

COMMENT ON COLUMN public.party_sessions.cancellation_reason IS
  'Optional note from host/staff when cancelling; surfaced in guest notifications.';

DROP FUNCTION IF EXISTS public.party_cancel_session(uuid, uuid, text);

CREATE OR REPLACE FUNCTION public.party_cancel_session(
  p_session_id uuid,
  p_member_id  uuid,
  p_token      text,
  p_reason     text DEFAULT NULL
) RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_member            public.party_members;
  v_session           public.party_sessions;
  v_refunds           jsonb;
  v_reason_trim       text;
  v_restaurant_name   text;
  v_message           text;
  v_guest             RECORD;
BEGIN
  v_member := public._party_auth(p_session_id, p_member_id, p_token);
  SELECT * INTO v_session FROM public.party_sessions WHERE id = p_session_id FOR UPDATE;

  IF NOT public._party_is_session_manager(v_member, v_session) THEN
    RAISE EXCEPTION 'host_only' USING ERRCODE = '42501';
  END IF;

  IF v_session.status IN ('cancelled','completed') THEN
    RETURN jsonb_build_object('ok', true, 'already', true);
  END IF;

  v_reason_trim := nullif(trim(coalesce(p_reason, '')), '');

  SELECT coalesce(jsonb_agg(jsonb_build_object(
    'payment_id', id,
    'stripe_payment_intent', stripe_payment_intent,
    'amount_cents', amount_cents
  )), '[]'::jsonb) INTO v_refunds
  FROM public.party_payments
  WHERE session_id = p_session_id AND status IN ('paid','covered') AND stripe_payment_intent IS NOT NULL;

  UPDATE public.party_payments SET status = 'cancelled'
    WHERE session_id = p_session_id AND status IN ('pending');

  UPDATE public.party_sessions
    SET status = 'cancelled',
        cancelled_at = now(),
        cancellation_reason = v_reason_trim
    WHERE id = p_session_id;

  PERFORM public._rotate_tableside_qr_after_session_end(p_session_id);

  SELECT name INTO v_restaurant_name
    FROM public.restaurants
    WHERE id = v_session.restaurant_id;

  v_message := 'The order at ' || coalesce(v_restaurant_name, 'the restaurant') || ' was cancelled.';
  IF v_reason_trim IS NOT NULL THEN
    v_message := v_message || ' Reason: ' || v_reason_trim;
  END IF;

  FOR v_guest IN
    SELECT pm.user_id, pm.id
    FROM public.party_members pm
    WHERE pm.session_id = p_session_id
      AND pm.left_at IS NULL
      AND pm.user_id IS NOT NULL
      AND NOT coalesce(pm.is_tableside_staff, false)
      AND pm.id <> p_member_id
  LOOP
    INSERT INTO public.app_notifications (user_id, type, title, message, metadata)
    VALUES (
      v_guest.user_id,
      'group_cancelled',
      'Order cancelled',
      v_message,
      jsonb_build_object(
        'sessionId', p_session_id::text,
        'restaurantId', v_session.restaurant_id::text,
        'restaurantName', coalesce(v_restaurant_name, 'Restaurant'),
        'entryId', p_session_id::text,
        'partySize', 0,
        'cancellationReason', v_reason_trim
      )
    );
  END LOOP;

  RETURN jsonb_build_object('ok', true, 'refundable', v_refunds);
END;
$$;

GRANT EXECUTE ON FUNCTION public.party_cancel_session(uuid, uuid, text, text) TO anon, authenticated;
