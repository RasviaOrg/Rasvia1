-- Idempotent staff join: reuse active membership, rotate token, handle concurrent inserts.

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

  IF v_member_id IS NULL THEN
    v_token := encode(gen_random_bytes(32), 'base64');
    v_hash := public._party_hash_token(v_token);

    BEGIN
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
    EXCEPTION
      WHEN unique_violation THEN
        SELECT id INTO v_member_id
        FROM public.party_members
        WHERE session_id = p_session_id AND user_id = v_uid AND left_at IS NULL
        LIMIT 1;

        IF v_member_id IS NULL THEN
          RAISE;
        END IF;
    END;
  END IF;

  v_token := encode(gen_random_bytes(32), 'base64');
  v_hash := public._party_hash_token(v_token);

  UPDATE public.party_members
    SET role = 'host',
        display_name = v_name,
        last_seen_at = now(),
        member_token_hash = v_hash
    WHERE id = v_member_id;

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
