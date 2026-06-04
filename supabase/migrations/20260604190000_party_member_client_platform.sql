-- Track whether a guest joined via the mobile app or the website.
-- Host transfer is only allowed to members on the app.

ALTER TABLE public.party_members
  ADD COLUMN IF NOT EXISTS client_platform text;

ALTER TABLE public.party_members
  DROP CONSTRAINT IF EXISTS party_members_client_platform_check;

ALTER TABLE public.party_members
  ADD CONSTRAINT party_members_client_platform_check
  CHECK (client_platform IS NULL OR client_platform IN ('app', 'web'));

COMMENT ON COLUMN public.party_members.client_platform IS
  'app = Rasvia mobile app join bridge; web = browser. Host must be app.';

CREATE OR REPLACE FUNCTION public.party_join_session(
  p_session_id        uuid,
  p_display_name      text,
  p_client_platform   text DEFAULT 'web'
) RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, extensions
AS $$
DECLARE
  v_session        public.party_sessions;
  v_uid            uuid := auth.uid();
  v_member_id      uuid;
  v_token          text;
  v_hash           text;
  v_role           text := 'member';
  v_name           text;
  v_role_out       text;
  v_avatar         text;
  v_platform       text;
BEGIN
  v_name := trim(coalesce(p_display_name, ''));
  IF v_name = '' THEN
    RAISE EXCEPTION 'display_name_required' USING ERRCODE = '22023';
  END IF;
  IF length(v_name) > 80 THEN v_name := substring(v_name, 1, 80); END IF;

  v_platform := CASE WHEN lower(trim(coalesce(p_client_platform, 'web'))) = 'app' THEN 'app' ELSE 'web' END;

  SELECT * INTO v_session FROM public.party_sessions WHERE id = p_session_id FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'session_not_found' USING ERRCODE = 'P0002'; END IF;
  IF v_session.status IN ('cancelled', 'completed') THEN
    RAISE EXCEPTION 'session_closed' USING ERRCODE = '22023';
  END IF;

  IF v_uid IS NOT NULL AND v_uid = v_session.host_user_id THEN
    v_role := 'host';
  END IF;

  IF coalesce(v_session.self_serve, false) AND NOT EXISTS (
    SELECT 1 FROM public.party_members
    WHERE session_id = p_session_id AND role = 'host' AND left_at IS NULL
  ) THEN
    v_role := 'host';
  END IF;

  IF v_uid IS NOT NULL THEN
    v_avatar := (SELECT avatar_url FROM public.profiles WHERE id = v_uid);
  END IF;

  IF v_uid IS NOT NULL THEN
    SELECT id INTO v_member_id
    FROM public.party_members
    WHERE session_id = p_session_id AND user_id = v_uid AND left_at IS NULL
    LIMIT 1;
  END IF;

  IF v_member_id IS NOT NULL THEN
    UPDATE public.party_members
      SET display_name = v_name,
          last_seen_at = now(),
          avatar_url = coalesce(v_avatar, avatar_url),
          client_platform = CASE
            WHEN v_platform = 'app' THEN 'app'
            ELSE coalesce(client_platform, 'web')
          END,
          role = CASE WHEN v_role = 'host' THEN 'host' ELSE role END
      WHERE id = v_member_id;
    SELECT role INTO v_role_out FROM public.party_members WHERE id = v_member_id;
    RETURN jsonb_build_object(
      'member_id', v_member_id,
      'member_token', NULL,
      'role', v_role_out,
      'session_id', p_session_id,
      'display_name', v_name,
      'client_platform', (SELECT client_platform FROM public.party_members WHERE id = v_member_id)
    );
  END IF;

  v_token := encode(gen_random_bytes(32), 'base64');
  v_hash := public._party_hash_token(v_token);

  INSERT INTO public.party_members (
    session_id, user_id, display_name, role, member_token_hash, avatar_url, client_platform
  )
  VALUES (p_session_id, v_uid, v_name, v_role, v_hash, v_avatar, v_platform)
  RETURNING id INTO v_member_id;

  RETURN jsonb_build_object(
    'member_id', v_member_id,
    'member_token', v_token,
    'role', v_role,
    'session_id', p_session_id,
    'display_name', v_name,
    'client_platform', v_platform
  );
END;
$$;

GRANT EXECUTE ON FUNCTION public.party_join_session(uuid, text, text) TO anon, authenticated;

CREATE OR REPLACE FUNCTION public.party_host_transfer_host(
  p_session_id          uuid,
  p_member_id           uuid,
  p_token               text,
  p_new_host_member_id  uuid
) RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_member   public.party_members;
  v_new_host public.party_members;
  v_session  public.party_sessions;
BEGIN
  v_member := public._party_auth(p_session_id, p_member_id, p_token);
  IF v_member.role <> 'host' THEN
    RAISE EXCEPTION 'host_only' USING ERRCODE = '42501';
  END IF;

  IF p_new_host_member_id = p_member_id THEN
    RETURN jsonb_build_object('ok', true, 'host_member_id', p_member_id);
  END IF;

  SELECT * INTO v_new_host
    FROM public.party_members
    WHERE id = p_new_host_member_id
      AND session_id = p_session_id
      AND left_at IS NULL;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'invalid_payer' USING ERRCODE = '22023';
  END IF;

  IF coalesce(v_new_host.client_platform, 'web') <> 'app' THEN
    RAISE EXCEPTION 'host_requires_app' USING ERRCODE = '22023';
  END IF;

  SELECT * INTO v_session FROM public.party_sessions WHERE id = p_session_id FOR UPDATE;

  UPDATE public.party_members
    SET role = 'member'
    WHERE session_id = p_session_id AND role = 'host' AND left_at IS NULL;

  UPDATE public.party_members
    SET role = 'host'
    WHERE id = p_new_host_member_id;

  UPDATE public.party_sessions
    SET host_user_id = v_new_host.user_id
    WHERE id = p_session_id;

  PERFORM public.touch_party_session_activity(p_session_id);

  RETURN jsonb_build_object('ok', true, 'host_member_id', p_new_host_member_id);
END;
$$;

GRANT EXECUTE ON FUNCTION public.party_host_transfer_host(uuid, uuid, text, uuid)
  TO anon, authenticated;

-- Staff dashboard joins are always web.
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
      INSERT INTO public.party_members (
        session_id, user_id, display_name, role, member_token_hash, client_platform
      )
      VALUES (p_session_id, v_uid, v_name, 'host', v_hash, 'web')
      RETURNING id INTO v_member_id;

      UPDATE public.party_members
        SET role = 'member'
        WHERE session_id = p_session_id
          AND role = 'host'
          AND left_at IS NULL
          AND id <> v_member_id;

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
    SET role = 'member'
    WHERE session_id = p_session_id
      AND role = 'host'
      AND left_at IS NULL
      AND id <> v_member_id;

  UPDATE public.party_members
    SET role = 'host',
        display_name = v_name,
        last_seen_at = now(),
        member_token_hash = v_hash,
        client_platform = 'web'
    WHERE id = v_member_id;

  UPDATE public.party_sessions
    SET host_user_id = v_uid
    WHERE id = p_session_id;

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
