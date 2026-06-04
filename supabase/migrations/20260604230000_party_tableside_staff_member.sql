-- Tableside staff: fixed display name, flagged member row, excluded from guest ledger/UI.

ALTER TABLE public.party_members
  ADD COLUMN IF NOT EXISTS is_tableside_staff boolean NOT NULL DEFAULT false;

COMMENT ON COLUMN public.party_members.is_tableside_staff IS
  'Restaurant dashboard staff on a tableside/menu_qr session; not a paying guest.';

UPDATE public.party_members pm
SET is_tableside_staff = true,
    display_name = 'Staff'
FROM public.party_sessions ps
WHERE ps.id = pm.session_id
  AND pm.left_at IS NULL
  AND pm.user_id IS NOT NULL
  AND (coalesce(ps.self_serve, false) OR coalesce(ps.staff_managed, false))
  AND public._user_may_access_tableside_staff(ps.restaurant_id, pm.user_id);

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
  v_role text;
  v_join_role text;
BEGIN
  IF v_uid IS NULL THEN
    RAISE EXCEPTION 'not_authenticated' USING ERRCODE = '22023';
  END IF;

  IF trim(coalesce(p_display_name, '')) = '' THEN
    RAISE EXCEPTION 'display_name_required' USING ERRCODE = '22023';
  END IF;

  SELECT * INTO v_session FROM public.party_sessions WHERE id = p_session_id;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'session_not_found' USING ERRCODE = 'P0002';
  END IF;

  IF NOT public._user_may_access_tableside_staff(v_session.restaurant_id, v_uid) THEN
    RAISE EXCEPTION 'unauthorized' USING ERRCODE = '42501';
  END IF;

  IF v_session.source IS DISTINCT FROM 'menu_qr'::public.party_session_source
     AND coalesce(v_session.staff_managed, false) = false
     AND coalesce(v_session.self_serve, false) = false THEN
    RAISE EXCEPTION 'host_only' USING ERRCODE = '42501';
  END IF;

  v_join_role := CASE
    WHEN coalesce(v_session.self_serve, false) THEN 'member'
    WHEN coalesce(v_session.staff_managed, false) THEN 'host'
    ELSE 'member'
  END;

  SELECT id, role INTO v_member_id, v_role
  FROM public.party_members
  WHERE session_id = p_session_id AND user_id = v_uid AND left_at IS NULL
  LIMIT 1;

  IF v_member_id IS NULL THEN
    v_token := encode(gen_random_bytes(32), 'base64');
    v_hash := public._party_hash_token(v_token);

    BEGIN
      INSERT INTO public.party_members (
        session_id, user_id, display_name, role, member_token_hash, client_platform, is_tableside_staff
      )
      VALUES (p_session_id, v_uid, 'Staff', v_join_role, v_hash, 'web', true)
      RETURNING id INTO v_member_id;

      PERFORM public.touch_party_session_activity(p_session_id);

      RETURN jsonb_build_object(
        'member_id', v_member_id,
        'member_token', v_token,
        'role', v_join_role,
        'session_id', p_session_id,
        'display_name', 'Staff'
      );
    EXCEPTION
      WHEN unique_violation THEN
        SELECT id, role INTO v_member_id, v_role
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
    SET display_name = 'Staff',
        is_tableside_staff = true,
        last_seen_at = now(),
        member_token_hash = v_hash,
        client_platform = 'web'
    WHERE id = v_member_id;

  SELECT role INTO v_role FROM public.party_members WHERE id = v_member_id;

  PERFORM public.touch_party_session_activity(p_session_id);

  RETURN jsonb_build_object(
    'member_id', v_member_id,
    'member_token', v_token,
    'role', v_role,
    'session_id', p_session_id,
    'display_name', 'Staff'
  );
END;
$$;

CREATE OR REPLACE FUNCTION public._party_compute_ledger(p_session_id uuid)
RETURNS TABLE (member_id uuid, amount_cents integer)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_session    public.party_sessions;
  v_mode       text;
  v_host_id    uuid;
  v_skip_host  boolean;
  v_member_ids uuid[];
  v_amounts    integer[];
  v_n          integer;
  v_total      integer;
  v_base       integer;
  v_remainder  integer;
  i            integer;
  r            RECORD;
  v_line_cents integer;
  v_payers     uuid[];
  v_payer_n    integer;
  v_payer_base integer;
  v_payer_rem  integer;
  j            integer;
  v_pid        uuid;
  v_pidx       integer;
  v_fallback   uuid;
BEGIN
  SELECT * INTO v_session FROM public.party_sessions WHERE id = p_session_id;
  v_mode      := v_session.payment_mode;
  v_skip_host := coalesce(v_session.staff_managed, false);

  SELECT id INTO v_host_id FROM public.party_members
    WHERE session_id = p_session_id AND role = 'host' AND left_at IS NULL
    ORDER BY joined_at ASC LIMIT 1;

  IF v_skip_host AND v_host_id IS NOT NULL THEN
    SELECT array_agg(m.id ORDER BY m.joined_at) INTO v_member_ids
      FROM public.party_members m
      WHERE m.session_id = p_session_id
        AND m.left_at IS NULL
        AND m.id <> v_host_id
        AND NOT coalesce(m.is_tableside_staff, false);
  ELSE
    SELECT array_agg(m.id ORDER BY m.joined_at) INTO v_member_ids
      FROM public.party_members m
      WHERE m.session_id = p_session_id
        AND m.left_at IS NULL
        AND NOT coalesce(m.is_tableside_staff, false);
  END IF;

  v_n := coalesce(array_length(v_member_ids, 1), 0);
  IF v_n = 0 THEN RETURN; END IF;

  IF v_skip_host THEN
    v_fallback := v_member_ids[1];
  ELSE
    IF v_host_id IS NOT NULL AND v_host_id = ANY(v_member_ids) THEN
      v_fallback := v_host_id;
    ELSE
      v_fallback := v_member_ids[1];
    END IF;
  END IF;

  v_amounts := array_fill(0, ARRAY[v_n]);

  SELECT coalesce(sum(round(coalesce(mi.price,0) * coalesce(pi.quantity,1) * 100))::integer, 0) INTO v_total
    FROM public.party_items pi
    LEFT JOIN public.menu_items mi ON mi.id = pi.menu_item_id
    WHERE pi.session_id = p_session_id;

  IF v_mode = 'host_pays' THEN
    IF v_skip_host THEN
      IF v_total > 0 THEN
        v_base      := v_total / v_n;
        v_remainder := v_total - v_base * v_n;
        FOR i IN 1..v_n LOOP
          v_amounts[i] := v_base + CASE WHEN i <= v_remainder THEN 1 ELSE 0 END;
        END LOOP;
      END IF;
    ELSE
      FOR i IN 1..v_n LOOP
        IF v_member_ids[i] = v_host_id THEN
          v_amounts[i] := v_total;
          EXIT;
        END IF;
      END LOOP;
    END IF;

  ELSIF v_mode = 'equal_split' THEN
    IF v_total > 0 THEN
      v_base      := v_total / v_n;
      v_remainder := v_total - v_base * v_n;
      FOR i IN 1..v_n LOOP
        v_amounts[i] := v_base + CASE WHEN i <= v_remainder THEN 1 ELSE 0 END;
      END LOOP;
    END IF;

  ELSIF v_mode = 'per_person' OR v_mode = 'split' THEN
    FOR r IN
      SELECT pi.quantity, pi.added_by_member_id, pi.split_member_ids, mi.price
        FROM public.party_items pi
        LEFT JOIN public.menu_items mi ON mi.id = pi.menu_item_id
        WHERE pi.session_id = p_session_id
    LOOP
      v_line_cents := round(coalesce(r.price,0) * coalesce(r.quantity,1) * 100)::integer;
      IF v_line_cents <= 0 THEN CONTINUE; END IF;

      IF coalesce(array_length(r.split_member_ids, 1), 0) >= 1 THEN
        v_payers := r.split_member_ids;
      ELSIF r.added_by_member_id IS NOT NULL THEN
        v_payers := ARRAY[r.added_by_member_id];
      ELSE
        v_payers := ARRAY[v_fallback];
      END IF;

      v_payer_n    := array_length(v_payers, 1);
      v_payer_base := v_line_cents / v_payer_n;
      v_payer_rem  := v_line_cents - v_payer_base * v_payer_n;

      FOR j IN 1..v_payer_n LOOP
        v_pid := v_payers[j];
        v_pidx := array_position(v_member_ids, v_pid);
        IF v_pidx IS NULL THEN
          v_pidx := array_position(v_member_ids, v_fallback);
        END IF;
        IF v_pidx IS NULL THEN CONTINUE; END IF;
        v_amounts[v_pidx] := v_amounts[v_pidx] + v_payer_base + CASE WHEN j <= v_payer_rem THEN 1 ELSE 0 END;
      END LOOP;
    END LOOP;

  ELSIF v_mode = 'assigned' OR v_mode = 'assign' THEN
    FOR r IN
      SELECT pi.quantity, pi.added_by_member_id, pi.assigned_payer_id, mi.price
        FROM public.party_items pi
        LEFT JOIN public.menu_items mi ON mi.id = pi.menu_item_id
        WHERE pi.session_id = p_session_id
    LOOP
      v_line_cents := round(coalesce(r.price,0) * coalesce(r.quantity,1) * 100)::integer;
      IF v_line_cents <= 0 THEN CONTINUE; END IF;
      v_pid := coalesce(r.assigned_payer_id, r.added_by_member_id, v_fallback);
      v_pidx := array_position(v_member_ids, v_pid);
      IF v_pidx IS NULL THEN
        v_pidx := array_position(v_member_ids, v_fallback);
      END IF;
      IF v_pidx IS NULL THEN CONTINUE; END IF;
      v_amounts[v_pidx] := v_amounts[v_pidx] + v_line_cents;
    END LOOP;

  ELSE
    RAISE EXCEPTION 'invalid_payment_mode' USING ERRCODE = '22023';
  END IF;

  FOR i IN 1..v_n LOOP
    member_id := v_member_ids[i];
    amount_cents := v_amounts[i];
    RETURN NEXT;
  END LOOP;
  RETURN;
END;
$$;
