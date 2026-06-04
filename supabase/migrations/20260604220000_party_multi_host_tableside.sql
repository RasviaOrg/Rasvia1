-- Tableside: staff join as member (no host takeover), multiple hosts allowed,
-- promote-to-host is additive; self-serve may promote web guests from the portal.

CREATE OR REPLACE FUNCTION public._user_may_access_tableside_staff(
  p_restaurant_id bigint,
  p_user_id uuid
) RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT
    public.is_platform_admin()
    OR p_restaurant_id = public.get_my_restaurant_id()
    OR EXISTS (
      SELECT 1 FROM public.restaurants r
      WHERE r.id = p_restaurant_id AND r.owner_id = p_user_id
    );
$$;

CREATE OR REPLACE FUNCTION public._party_is_session_manager(
  p_member public.party_members,
  p_session public.party_sessions
) RETURNS boolean
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  IF p_member.left_at IS NOT NULL THEN
    RETURN false;
  END IF;
  IF p_member.role = 'host' THEN
    RETURN true;
  END IF;
  IF (coalesce(p_session.self_serve, false) OR coalesce(p_session.staff_managed, false))
     AND p_member.user_id IS NOT NULL
     AND auth.uid() IS NOT NULL
     AND p_member.user_id = auth.uid()
     AND public._user_may_access_tableside_staff(p_session.restaurant_id, p_member.user_id)
  THEN
    RETURN true;
  END IF;
  RETURN false;
END;
$$;

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
  v_role text;
  v_join_role text;
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

  IF NOT public._user_may_access_tableside_staff(v_session.restaurant_id, v_uid) THEN
    RAISE EXCEPTION 'unauthorized' USING ERRCODE = '42501';
  END IF;

  IF v_session.source IS DISTINCT FROM 'menu_qr'::public.party_session_source
     AND coalesce(v_session.staff_managed, false) = false
     AND coalesce(v_session.self_serve, false) = false THEN
    RAISE EXCEPTION 'host_only' USING ERRCODE = '42501';
  END IF;

  -- Self-serve tableside: staff joins as member (guests keep host). Waiter-led menu_qr: staff is host for ledger.
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
        session_id, user_id, display_name, role, member_token_hash, client_platform
      )
      VALUES (p_session_id, v_uid, v_name, v_join_role, v_hash, 'web')
      RETURNING id INTO v_member_id;

      PERFORM public.touch_party_session_activity(p_session_id);

      RETURN jsonb_build_object(
        'member_id', v_member_id,
        'member_token', v_token,
        'role', v_join_role,
        'session_id', p_session_id,
        'display_name', v_name
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
    SET display_name = v_name,
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
    'display_name', v_name
  );
END;
$$;

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
  SELECT * INTO v_session FROM public.party_sessions WHERE id = p_session_id FOR UPDATE;

  IF NOT public._party_is_session_manager(v_member, v_session) THEN
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

  IF v_new_host.role = 'host' THEN
    RETURN jsonb_build_object('ok', true, 'host_member_id', p_new_host_member_id, 'already', true);
  END IF;

  IF NOT coalesce(v_session.self_serve, false)
     AND coalesce(v_new_host.client_platform, 'web') <> 'app' THEN
    RAISE EXCEPTION 'host_requires_app' USING ERRCODE = '22023';
  END IF;

  UPDATE public.party_members
    SET role = 'host'
    WHERE id = p_new_host_member_id;

  IF v_session.host_user_id IS NULL AND v_new_host.user_id IS NOT NULL THEN
    UPDATE public.party_sessions
      SET host_user_id = v_new_host.user_id
      WHERE id = p_session_id;
  END IF;

  PERFORM public.touch_party_session_activity(p_session_id);

  RETURN jsonb_build_object('ok', true, 'host_member_id', p_new_host_member_id);
END;
$$;

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
  v_other_hosts       integer;
BEGIN
  v_member := public._party_auth(p_session_id, p_member_id, p_token);
  SELECT * INTO v_session FROM public.party_sessions WHERE id = p_session_id FOR UPDATE;

  IF NOT public._party_is_session_manager(v_member, v_session) THEN
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
    SELECT count(*) INTO v_other_hosts
      FROM public.party_members
      WHERE session_id = p_session_id
        AND role = 'host'
        AND left_at IS NULL
        AND id <> p_target_member_id;

    IF v_other_hosts = 0 THEN
      SELECT id INTO v_successor
        FROM public.party_members
        WHERE session_id = p_session_id AND left_at IS NULL
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

CREATE OR REPLACE FUNCTION public.party_cancel_session(
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
  v_refunds jsonb;
BEGIN
  v_member := public._party_auth(p_session_id, p_member_id, p_token);
  SELECT * INTO v_session FROM public.party_sessions WHERE id = p_session_id FOR UPDATE;

  IF NOT public._party_is_session_manager(v_member, v_session) THEN
    RAISE EXCEPTION 'host_only' USING ERRCODE = '42501';
  END IF;

  IF v_session.status IN ('cancelled','completed') THEN
    RETURN jsonb_build_object('ok', true, 'already', true);
  END IF;

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
    SET status = 'cancelled', cancelled_at = now()
    WHERE id = p_session_id;

  PERFORM public._rotate_tableside_qr_after_session_end(p_session_id);

  RETURN jsonb_build_object('ok', true, 'refundable', v_refunds);
END;
$$;

-- Host-management RPCs: allow tableside staff (member role) on self-serve sessions.

CREATE OR REPLACE FUNCTION public.party_lock_session(
  p_session_id uuid,
  p_member_id  uuid,
  p_token      text
) RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_member   public.party_members;
  v_session  public.party_sessions;
  v_total    integer := 0;
  v_row      RECORD;
BEGIN
  v_member := public._party_auth(p_session_id, p_member_id, p_token);
  SELECT * INTO v_session FROM public.party_sessions WHERE id = p_session_id FOR UPDATE;

  IF NOT public._party_is_session_manager(v_member, v_session) THEN
    RAISE EXCEPTION 'host_only' USING ERRCODE = '42501';
  END IF;

  IF v_session.status = 'locked' THEN
    RETURN public._party_session_snapshot(p_session_id);
  END IF;
  IF v_session.status <> 'open' THEN
    RAISE EXCEPTION 'session_not_open' USING ERRCODE = '22023';
  END IF;

  IF NOT EXISTS (SELECT 1 FROM public.party_items WHERE session_id = p_session_id) THEN
    RAISE EXCEPTION 'empty_cart' USING ERRCODE = '22023';
  END IF;

  FOR v_row IN SELECT * FROM public._party_compute_ledger(p_session_id) LOOP
    v_total := v_total + v_row.amount_cents;
    INSERT INTO public.party_payments (session_id, member_id, amount_cents, status)
    VALUES (p_session_id, v_row.member_id, v_row.amount_cents,
            CASE WHEN v_row.amount_cents = 0 THEN 'covered' ELSE 'pending' END)
    ON CONFLICT (session_id, member_id)
    DO UPDATE SET amount_cents = EXCLUDED.amount_cents,
                  status = CASE
                    WHEN public.party_payments.status IN ('paid','covered','refunded') THEN public.party_payments.status
                    WHEN EXCLUDED.amount_cents = 0 THEN 'covered'
                    ELSE 'pending'
                  END,
                  updated_at = now();
  END LOOP;

  UPDATE public.party_sessions
    SET status         = 'locked',
        locked_at      = now(),
        subtotal_cents = v_total,
        total_cents    = v_total,
        schema_version = GREATEST(coalesce(schema_version, 1), 2)
    WHERE id = p_session_id;

  RETURN public._party_session_snapshot(p_session_id);
END;
$$;

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
  SELECT * INTO v_session FROM public.party_sessions WHERE id = p_session_id FOR UPDATE;

  IF NOT public._party_is_session_manager(v_member, v_session) THEN
    RAISE EXCEPTION 'host_only' USING ERRCODE = '42501';
  END IF;

  IF v_session.status NOT IN ('locked','paying') THEN
    RAISE EXCEPTION 'cannot_unlock' USING ERRCODE = '22023';
  END IF;

  SELECT count(*) INTO v_has_paid FROM public.party_payments
    WHERE session_id = p_session_id AND status IN ('paid','covered');
  IF v_has_paid > 0 THEN
    RAISE EXCEPTION 'payments_in_progress' USING ERRCODE = '22023';
  END IF;

  DELETE FROM public.party_payments WHERE session_id = p_session_id AND status = 'pending';
  UPDATE public.party_sessions
    SET status = 'open', locked_at = NULL, subtotal_cents = 0, total_cents = 0
    WHERE id = p_session_id;
  RETURN jsonb_build_object('ok', true);
END;
$$;

CREATE OR REPLACE FUNCTION public.party_set_payment_mode(
  p_session_id uuid,
  p_member_id  uuid,
  p_token      text,
  p_mode       text
) RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_member  public.party_members;
  v_session public.party_sessions;
BEGIN
  v_member := public._party_auth(p_session_id, p_member_id, p_token);
  SELECT * INTO v_session FROM public.party_sessions WHERE id = p_session_id;

  IF NOT public._party_is_session_manager(v_member, v_session) THEN
    RAISE EXCEPTION 'host_only' USING ERRCODE = '42501';
  END IF;

  IF p_mode NOT IN ('host_pays','equal_split','per_person','assigned') THEN
    RAISE EXCEPTION 'invalid_payment_mode' USING ERRCODE = '22023';
  END IF;
  IF v_session.status NOT IN ('open','locked') THEN
    RAISE EXCEPTION 'session_locked_or_closed' USING ERRCODE = '22023';
  END IF;

  UPDATE public.party_sessions SET payment_mode = p_mode WHERE id = p_session_id;
  RETURN jsonb_build_object('ok', true);
END;
$$;

CREATE OR REPLACE FUNCTION public.party_set_item_split(
  p_session_id uuid,
  p_member_id  uuid,
  p_token      text,
  p_item_id    uuid,
  p_member_ids uuid[]
) RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_member  public.party_members;
  v_session public.party_sessions;
  v_valid_count integer;
BEGIN
  v_member := public._party_auth(p_session_id, p_member_id, p_token);
  SELECT * INTO v_session FROM public.party_sessions WHERE id = p_session_id;

  IF NOT public._party_is_session_manager(v_member, v_session) THEN
    RAISE EXCEPTION 'host_only' USING ERRCODE = '42501';
  END IF;

  IF v_session.status NOT IN ('open','locked') THEN
    RAISE EXCEPTION 'session_locked_or_closed' USING ERRCODE = '22023';
  END IF;

  IF coalesce(array_length(p_member_ids, 1), 0) > 0 THEN
    SELECT count(*) INTO v_valid_count
      FROM public.party_members
      WHERE session_id = p_session_id
        AND left_at IS NULL
        AND id = ANY(p_member_ids);
    IF v_valid_count <> array_length(p_member_ids, 1) THEN
      RAISE EXCEPTION 'invalid_split_members' USING ERRCODE = '22023';
    END IF;
  END IF;

  UPDATE public.party_items
    SET split_member_ids = coalesce(p_member_ids, '{}'::uuid[])
    WHERE id = p_item_id AND session_id = p_session_id;
  RETURN jsonb_build_object('ok', true);
END;
$$;

CREATE OR REPLACE FUNCTION public.party_assign_item_payer(
  p_session_id uuid,
  p_member_id  uuid,
  p_token      text,
  p_item_id    uuid,
  p_payer_id   uuid
) RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_member  public.party_members;
  v_session public.party_sessions;
BEGIN
  v_member := public._party_auth(p_session_id, p_member_id, p_token);
  SELECT * INTO v_session FROM public.party_sessions WHERE id = p_session_id;

  IF NOT public._party_is_session_manager(v_member, v_session) THEN
    RAISE EXCEPTION 'host_only' USING ERRCODE = '42501';
  END IF;

  IF v_session.status NOT IN ('open','locked') THEN
    RAISE EXCEPTION 'session_locked_or_closed' USING ERRCODE = '22023';
  END IF;
  IF p_payer_id IS NOT NULL AND NOT EXISTS (
    SELECT 1 FROM public.party_members
    WHERE id = p_payer_id AND session_id = p_session_id AND left_at IS NULL
  ) THEN
    RAISE EXCEPTION 'invalid_payer' USING ERRCODE = '22023';
  END IF;
  UPDATE public.party_items
    SET assigned_payer_id = p_payer_id
    WHERE id = p_item_id AND session_id = p_session_id;
  RETURN jsonb_build_object('ok', true);
END;
$$;

CREATE OR REPLACE FUNCTION public.party_host_add_item_for(
  p_session_id     uuid,
  p_member_id      uuid,
  p_token          text,
  p_for_member_id  uuid,
  p_menu_item_id   bigint,
  p_quantity       integer DEFAULT 1,
  p_notes          text    DEFAULT NULL
) RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_member           public.party_members;
  v_for              public.party_members;
  v_session          public.party_sessions;
  v_menu             public.menu_items;
  v_qty              integer;
  v_item_id          uuid;
  v_existing         uuid;
  v_locked_host_edit boolean := false;
BEGIN
  v_member := public._party_auth(p_session_id, p_member_id, p_token);
  SELECT * INTO v_session FROM public.party_sessions WHERE id = p_session_id;

  IF NOT public._party_is_session_manager(v_member, v_session) THEN
    RAISE EXCEPTION 'host_only' USING ERRCODE = '42501';
  END IF;

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

  IF p_for_member_id IS NULL THEN
    v_for := v_member;
  ELSE
    SELECT * INTO v_for FROM public.party_members
      WHERE id = p_for_member_id AND session_id = p_session_id AND left_at IS NULL;
    IF NOT FOUND THEN
      RAISE EXCEPTION 'invalid_payer' USING ERRCODE = '22023';
    END IF;
  END IF;

  SELECT * INTO v_menu FROM public.menu_items WHERE id = p_menu_item_id;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'menu_item_not_found' USING ERRCODE = 'P0002';
  END IF;

  v_qty := greatest(1, least(coalesce(p_quantity, 1), 25));

  SELECT id INTO v_existing
    FROM public.party_items
    WHERE session_id = p_session_id
      AND menu_item_id = p_menu_item_id
      AND added_by_member_id = v_for.id
      AND coalesce(special_requests, '') = coalesce(nullif(trim(p_notes), ''), '')
    LIMIT 1;

  IF v_existing IS NOT NULL THEN
    UPDATE public.party_items SET quantity = quantity + v_qty WHERE id = v_existing;
    v_item_id := v_existing;
  ELSE
    INSERT INTO public.party_items (
      session_id, menu_item_id, added_by_member_id, added_by_name,
      added_by_user_id, quantity, special_requests
    ) VALUES (
      p_session_id, p_menu_item_id, v_for.id, v_for.display_name,
      v_for.user_id, v_qty, nullif(trim(p_notes), '')
    ) RETURNING id INTO v_item_id;
  END IF;

  IF v_locked_host_edit THEN
    PERFORM public._party_refresh_locked_cart_ledger(p_session_id);
  END IF;

  RETURN jsonb_build_object('ok', true, 'item_id', v_item_id);
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
  SELECT * INTO v_session FROM public.party_sessions WHERE id = p_session_id;

  IF NOT public._party_is_session_manager(v_member, v_session) THEN
    RAISE EXCEPTION 'host_only' USING ERRCODE = '42501';
  END IF;

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

CREATE OR REPLACE FUNCTION public.party_update_item(
  p_session_id uuid,
  p_member_id  uuid,
  p_token      text,
  p_item_id    uuid,
  p_quantity   integer
) RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_member           public.party_members;
  v_session          public.party_sessions;
  v_item             public.party_items;
  v_qty              integer;
  v_locked_host_edit boolean := false;
BEGIN
  v_member := public._party_auth(p_session_id, p_member_id, p_token);
  SELECT * INTO v_session FROM public.party_sessions WHERE id = p_session_id;

  IF v_session.status = 'open' THEN
    NULL;
  ELSIF v_session.status = 'locked'
        AND public._party_is_session_manager(v_member, v_session) THEN
    v_locked_host_edit := true;
    SELECT * INTO v_session FROM public.party_sessions WHERE id = p_session_id FOR UPDATE;
    IF v_session.status IS DISTINCT FROM 'locked' THEN
      RAISE EXCEPTION 'session_not_open' USING ERRCODE = '22023';
    END IF;
  ELSE
    RAISE EXCEPTION 'session_not_open' USING ERRCODE = '22023';
  END IF;

  SELECT * INTO v_item FROM public.party_items WHERE id = p_item_id AND session_id = p_session_id;
  IF NOT FOUND THEN RAISE EXCEPTION 'item_not_found' USING ERRCODE = 'P0002'; END IF;

  IF NOT public._party_is_session_manager(v_member, v_session)
     AND v_item.added_by_member_id IS DISTINCT FROM v_member.id THEN
    RAISE EXCEPTION 'forbidden' USING ERRCODE = '42501';
  END IF;

  v_qty := greatest(0, least(coalesce(p_quantity, 0), 25));
  IF v_qty = 0 THEN
    DELETE FROM public.party_items WHERE id = p_item_id;
  ELSE
    UPDATE public.party_items SET quantity = v_qty WHERE id = p_item_id;
  END IF;

  IF v_locked_host_edit THEN
    PERFORM public._party_refresh_locked_cart_ledger(p_session_id);
  END IF;

  RETURN jsonb_build_object('ok', true);
END;
$$;

CREATE OR REPLACE FUNCTION public.party_remove_item(
  p_session_id uuid,
  p_member_id  uuid,
  p_token      text,
  p_item_id    uuid
) RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_member           public.party_members;
  v_session          public.party_sessions;
  v_item             public.party_items;
  v_locked_host_edit boolean := false;
BEGIN
  v_member := public._party_auth(p_session_id, p_member_id, p_token);
  SELECT * INTO v_session FROM public.party_sessions WHERE id = p_session_id;

  IF v_session.status = 'open' THEN
    NULL;
  ELSIF v_session.status = 'locked'
        AND public._party_is_session_manager(v_member, v_session) THEN
    v_locked_host_edit := true;
    SELECT * INTO v_session FROM public.party_sessions WHERE id = p_session_id FOR UPDATE;
    IF v_session.status IS DISTINCT FROM 'locked' THEN
      RAISE EXCEPTION 'session_not_open' USING ERRCODE = '22023';
    END IF;
  ELSE
    RAISE EXCEPTION 'session_not_open' USING ERRCODE = '22023';
  END IF;

  SELECT * INTO v_item FROM public.party_items WHERE id = p_item_id AND session_id = p_session_id;
  IF NOT FOUND THEN RAISE EXCEPTION 'item_not_found' USING ERRCODE = 'P0002'; END IF;

  IF NOT public._party_is_session_manager(v_member, v_session)
     AND v_item.added_by_member_id IS DISTINCT FROM v_member.id THEN
    RAISE EXCEPTION 'forbidden' USING ERRCODE = '42501';
  END IF;

  DELETE FROM public.party_items WHERE id = p_item_id;

  IF v_locked_host_edit THEN
    PERFORM public._party_refresh_locked_cart_ledger(p_session_id);
  END IF;

  RETURN jsonb_build_object('ok', true);
END;
$$;

COMMENT ON COLUMN public.party_members.client_platform IS
  'app = mobile; web = browser. Non-tableside host promotion requires app.';
