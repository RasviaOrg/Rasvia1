-- Allow restaurant staff to join self-serve tableside sessions as host (dashboard overlay).
-- Add host RPC to move cart lines between guests.

CREATE OR REPLACE FUNCTION public.party_staff_join_tableside(
  p_session_id uuid,
  p_display_name text
) RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, extensions
AS $$
DECLARE
  v_session public.party_sessions;
  v_uid uuid := auth.uid();
  v_member_id uuid;
  v_token text;
  v_hash text;
  v_name text;
BEGIN
  IF v_uid IS NULL THEN
    RAISE EXCEPTION 'not_authenticated' USING ERRCODE = '22023';
  END IF;

  v_name := trim(coalesce(p_display_name, ''));
  IF v_name = '' THEN
    RAISE EXCEPTION 'display_name_required' USING ERRCODE = '22023';
  END IF;

  SELECT * INTO v_session FROM public.party_sessions WHERE id = p_session_id;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'session_not_found' USING ERRCODE = 'P0002';
  END IF;

  IF NOT (
    public.is_platform_admin()
    OR v_session.restaurant_id = public.get_my_restaurant_id()
    OR EXISTS (
      SELECT 1 FROM public.restaurants r
      WHERE r.id = v_session.restaurant_id AND r.owner_id = v_uid
    )
  ) THEN
    RAISE EXCEPTION 'unauthorized' USING ERRCODE = '42501';
  END IF;

  IF v_session.source IS DISTINCT FROM 'menu_qr'::public.party_session_source
     AND coalesce(v_session.staff_managed, false) = false
     AND coalesce(v_session.self_serve, false) = false THEN
    RAISE EXCEPTION 'host_only' USING ERRCODE = '42501';
  END IF;

  SELECT id INTO v_member_id
    FROM public.party_members
    WHERE session_id = p_session_id AND user_id = v_uid AND left_at IS NULL
    LIMIT 1;

  IF v_member_id IS NOT NULL THEN
    UPDATE public.party_members
      SET role = 'host', display_name = v_name, last_seen_at = now()
      WHERE id = v_member_id;
    RETURN jsonb_build_object(
      'member_id', v_member_id,
      'member_token', null,
      'role', 'host',
      'session_id', p_session_id,
      'display_name', v_name
    );
  END IF;

  v_token := encode(gen_random_bytes(32), 'base64');
  v_hash := public._party_hash_token(v_token);

  INSERT INTO public.party_members (session_id, user_id, display_name, role, member_token_hash)
  VALUES (p_session_id, v_uid, v_name, 'host', v_hash)
  RETURNING id INTO v_member_id;

  PERFORM public.touch_party_session_activity(p_session_id);

  RETURN jsonb_build_object(
    'member_id', v_member_id,
    'member_token', v_token,
    'role', 'host',
    'session_id', p_session_id,
    'display_name', v_name
  );
END;
$$;

CREATE OR REPLACE FUNCTION public.party_host_reassign_item_member(
  p_session_id     uuid,
  p_member_id      uuid,
  p_token          text,
  p_item_id        uuid,
  p_to_member_id   uuid
) RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_member           public.party_members;
  v_to               public.party_members;
  v_session          public.party_sessions;
  v_item             public.party_items;
  v_locked_host_edit boolean := false;
BEGIN
  v_member := public._party_auth(p_session_id, p_member_id, p_token);
  IF v_member.role <> 'host' THEN
    RAISE EXCEPTION 'host_only' USING ERRCODE = '42501';
  END IF;

  SELECT * INTO v_session FROM public.party_sessions WHERE id = p_session_id;
  IF v_session.status = 'open' THEN
    NULL;
  ELSIF v_session.status = 'locked' THEN
    v_locked_host_edit := true;
    SELECT * INTO v_session FROM public.party_sessions WHERE id = p_session_id FOR UPDATE;
    IF v_session.status IS DISTINCT FROM 'locked' THEN
      RAISE EXCEPTION 'session_not_open' USING ERRCODE = '22023';
    END IF;
  ELSE
    RAISE EXCEPTION 'session_not_open' USING ERRCODE = '22023';
  END IF;

  SELECT * INTO v_to FROM public.party_members
    WHERE id = p_to_member_id AND session_id = p_session_id AND left_at IS NULL;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'invalid_payer' USING ERRCODE = '22023';
  END IF;

  SELECT * INTO v_item FROM public.party_items WHERE id = p_item_id AND session_id = p_session_id;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'item_not_found' USING ERRCODE = 'P0002';
  END IF;

  UPDATE public.party_items
    SET added_by_member_id = v_to.id,
        added_by_name = v_to.display_name,
        added_by_user_id = v_to.user_id,
        assigned_payer_id = NULL,
        split_member_ids = '{}'::uuid[]
    WHERE id = p_item_id;

  IF v_locked_host_edit THEN
    PERFORM public._party_refresh_locked_cart_ledger(p_session_id);
  END IF;

  RETURN jsonb_build_object('ok', true);
END;
$$;

GRANT EXECUTE ON FUNCTION public.party_host_reassign_item_member(uuid, uuid, text, uuid, uuid)
  TO anon, authenticated;
