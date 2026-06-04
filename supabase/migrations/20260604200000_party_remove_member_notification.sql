-- Notify removed guests in app_notifications (notifications tab + realtime).

CREATE OR REPLACE FUNCTION public.party_host_remove_member(
  p_session_id        uuid,
  p_member_id         uuid,
  p_token             text,
  p_target_member_id  uuid
) RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_member            public.party_members;
  v_target            public.party_members;
  v_session           public.party_sessions;
  v_pay_status        text;
  v_successor         uuid;
  v_restaurant_name   text;
BEGIN
  v_member := public._party_auth(p_session_id, p_member_id, p_token);
  IF v_member.role <> 'host' THEN
    RAISE EXCEPTION 'host_only' USING ERRCODE = '42501';
  END IF;

  IF p_target_member_id = p_member_id THEN
    RAISE EXCEPTION 'cannot_remove_self' USING ERRCODE = '22023';
  END IF;

  SELECT * INTO v_target
    FROM public.party_members
    WHERE id = p_target_member_id
      AND session_id = p_session_id
      AND left_at IS NULL;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'invalid_payer' USING ERRCODE = '22023';
  END IF;

  SELECT * INTO v_session FROM public.party_sessions WHERE id = p_session_id FOR UPDATE;

  SELECT status INTO v_pay_status FROM public.party_payments
    WHERE session_id = p_session_id AND member_id = p_target_member_id
    LIMIT 1;
  IF v_pay_status IN ('paid', 'covered') THEN
    RAISE EXCEPTION 'cannot_leave_after_paying' USING ERRCODE = '22023';
  END IF;

  UPDATE public.party_members SET left_at = now() WHERE id = p_target_member_id;

  DELETE FROM public.party_payments
    WHERE session_id = p_session_id AND member_id = p_target_member_id AND status = 'pending';

  IF v_session.status = 'open' THEN
    DELETE FROM public.party_items
      WHERE session_id = p_session_id AND added_by_member_id = p_target_member_id;
  END IF;

  IF v_target.role = 'host' THEN
    SELECT id INTO v_successor
      FROM public.party_members
      WHERE session_id = p_session_id AND left_at IS NULL AND id <> p_target_member_id
      ORDER BY joined_at ASC
      LIMIT 1;

    IF v_successor IS NOT NULL THEN
      UPDATE public.party_members SET role = 'host' WHERE id = v_successor;
      UPDATE public.party_sessions SET host_user_id = coalesce(
        (SELECT user_id FROM public.party_members WHERE id = v_successor),
        v_session.host_user_id
      ) WHERE id = p_session_id;
    ELSE
      UPDATE public.party_sessions
        SET status = 'cancelled', cancelled_at = now()
        WHERE id = p_session_id;
    END IF;
  END IF;

  SELECT name INTO v_restaurant_name
    FROM public.restaurants
    WHERE id = v_session.restaurant_id;

  IF v_target.user_id IS NOT NULL THEN
    INSERT INTO public.app_notifications (user_id, type, title, message, metadata)
    VALUES (
      v_target.user_id,
      'group_removed',
      'Removed from group',
      'You were removed from the order at ' || coalesce(v_restaurant_name, 'the restaurant') || '.',
      jsonb_build_object(
        'sessionId', p_session_id::text,
        'restaurantId', v_session.restaurant_id::text,
        'restaurantName', coalesce(v_restaurant_name, 'Restaurant'),
        'entryId', p_session_id::text,
        'partySize', 0
      )
    );
  END IF;

  PERFORM public.touch_party_session_activity(p_session_id);

  RETURN jsonb_build_object('ok', true, 'removed_member_id', p_target_member_id);
END;
$$;
