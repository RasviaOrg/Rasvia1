-- Rotate restaurant_tableside_tables.code when a self-serve tableside order ends so
-- printed QR /t/{code} links from the previous round no longer open a cart.

CREATE OR REPLACE FUNCTION public._rotate_tableside_qr_after_session_end(p_session_id uuid)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_session   public.party_sessions;
  v_old_code  text;
  v_table_id  uuid;
BEGIN
  SELECT * INTO v_session FROM public.party_sessions WHERE id = p_session_id;
  IF NOT FOUND OR NOT coalesce(v_session.self_serve, false) THEN
    RETURN;
  END IF;

  v_old_code := v_session.tableside_code;

  UPDATE public.party_sessions
    SET tableside_code = NULL
    WHERE id = p_session_id;

  IF v_old_code IS NOT NULL THEN
    UPDATE public.restaurant_tableside_tables t
      SET code = public._generate_tableside_code()
      WHERE t.restaurant_id = v_session.restaurant_id
        AND t.code = v_old_code
      RETURNING t.id INTO v_table_id;
  END IF;

  IF v_table_id IS NULL AND v_session.table_label IS NOT NULL THEN
    UPDATE public.restaurant_tableside_tables t
      SET code = public._generate_tableside_code()
      WHERE t.restaurant_id = v_session.restaurant_id
        AND lower(trim(t.display_name)) = lower(trim(v_session.table_label))
      RETURNING t.id INTO v_table_id;
  END IF;
END;
$$;

COMMENT ON FUNCTION public._rotate_tableside_qr_after_session_end(uuid) IS
  'After a self-serve tableside session ends, issue a new /t/{code} for the configured table.';

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
  IF v_member.role <> 'host' THEN
    RAISE EXCEPTION 'host_only' USING ERRCODE = '42501';
  END IF;
  SELECT * INTO v_session FROM public.party_sessions WHERE id = p_session_id FOR UPDATE;
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

CREATE OR REPLACE FUNCTION public.party_settle_payment(
  p_stripe_session_id   text,
  p_stripe_payment_intent text DEFAULT NULL
) RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_row           public.party_payments;
  v_session       public.party_sessions;
  v_unresolved    integer;
  v_total         integer;
  v_order_id      bigint;
  v_host_name     text;
  v_reset         jsonb;
BEGIN
  SELECT * INTO v_row FROM public.party_payments
    WHERE stripe_session_id = p_stripe_session_id FOR UPDATE;
  IF NOT FOUND THEN
    RETURN jsonb_build_object('ok', true, 'settled', false, 'reason', 'payment_not_found');
  END IF;

  IF v_row.status IN ('paid','covered','refunded') THEN
    SELECT * INTO v_session FROM public.party_sessions WHERE id = v_row.session_id;
    RETURN jsonb_build_object('ok', true, 'settled', true, 'session_status', v_session.status, 'already', true);
  END IF;

  UPDATE public.party_payments
    SET status = CASE WHEN covered_by_member_id IS NOT NULL THEN 'covered' ELSE 'paid' END,
        paid_at = now(),
        stripe_payment_intent = coalesce(p_stripe_payment_intent, stripe_payment_intent)
    WHERE id = v_row.id;

  SELECT * INTO v_session FROM public.party_sessions WHERE id = v_row.session_id FOR UPDATE;
  UPDATE public.party_sessions
    SET status = CASE WHEN status IN ('locked','paying') THEN 'paying' ELSE status END
    WHERE id = v_row.session_id;

  SELECT count(*) INTO v_unresolved
    FROM public.party_payments
    WHERE session_id = v_row.session_id
      AND status IN ('pending','failed','cancelled');

  IF v_unresolved > 0 THEN
    RETURN jsonb_build_object('ok', true, 'settled', true, 'fully_settled', false, 'session_id', v_row.session_id);
  END IF;

  IF v_session.submitted_order_id IS NOT NULL THEN
    IF v_session.source = 'menu_qr'::public.party_session_source THEN
      v_reset := public.party_reset_menu_qr_round(v_row.session_id);
    END IF;
    RETURN jsonb_build_object('ok', true, 'settled', true, 'fully_settled', true,
                              'session_id', v_row.session_id,
                              'order_id', v_session.submitted_order_id,
                              'menu_qr_reset', v_reset);
  END IF;

  SELECT coalesce(sum(amount_cents), 0) INTO v_total
    FROM public.party_payments WHERE session_id = v_row.session_id;

  SELECT m.display_name INTO v_host_name FROM public.party_members m
    WHERE m.session_id = v_row.session_id AND m.role = 'host'
    ORDER BY m.joined_at LIMIT 1;

  INSERT INTO public.orders (
    restaurant_id, order_type, status, meal_period, subtotal, tip_amount,
    payment_method, party_session_id, customer_name, created_by, table_number
  ) VALUES (
    v_session.restaurant_id, 'dine_in', 'pending', 'dinner',
    (v_total::numeric / 100.0), 0, 'card',
    v_row.session_id::text, coalesce(v_host_name, coalesce(v_session.table_label, 'Group Order')),
    coalesce(v_session.host_user_id::text, 'group'), v_session.table_label
  ) RETURNING id INTO v_order_id;

  INSERT INTO public.order_items (order_id, menu_item_id, name, price, quantity, is_vegetarian, notes)
  SELECT v_order_id, pi.menu_item_id,
         coalesce(mi.name, 'Menu Item'),
         coalesce(mi.price, 0),
         coalesce(pi.quantity, 1),
         coalesce(mi.is_vegetarian, false),
         nullif(pi.special_requests, '')
    FROM public.party_items pi
    LEFT JOIN public.menu_items mi ON mi.id = pi.menu_item_id
    WHERE pi.session_id = v_row.session_id;

  UPDATE public.party_payments SET order_id = v_order_id WHERE session_id = v_row.session_id;

  IF v_session.source = 'menu_qr'::public.party_session_source THEN
    UPDATE public.party_sessions
      SET status = 'submitted', submitted_at = now()::text, submitted_order_id = v_order_id
      WHERE id = v_row.session_id;
    v_reset := public.party_reset_menu_qr_round(v_row.session_id);
    RETURN jsonb_build_object('ok', true, 'settled', true, 'fully_settled', true,
                              'session_id', v_row.session_id, 'order_id', v_order_id,
                              'menu_qr_reset', v_reset);
  END IF;

  UPDATE public.party_sessions
    SET status = 'submitted', submitted_at = now()::text, submitted_order_id = v_order_id
    WHERE id = v_row.session_id;

  IF coalesce(v_session.self_serve, false) THEN
    PERFORM public._rotate_tableside_qr_after_session_end(v_row.session_id);
  END IF;

  INSERT INTO public.group_orders (party_session_id, restaurant_id, items, total, submitted_at)
  SELECT v_row.session_id, v_session.restaurant_id,
         coalesce(jsonb_agg(jsonb_build_object(
           'name', coalesce(mi.name, 'Menu Item'),
           'price', coalesce(mi.price, 0),
           'quantity', coalesce(pi.quantity, 1),
           'added_by', coalesce(pm.display_name, pi.added_by_name, 'Guest')
         )), '[]'::jsonb),
         (v_total::numeric / 100.0), now()
    FROM public.party_items pi
    LEFT JOIN public.menu_items mi ON mi.id = pi.menu_item_id
    LEFT JOIN public.party_members pm ON pm.id = pi.added_by_member_id
    WHERE pi.session_id = v_row.session_id;

  RETURN jsonb_build_object('ok', true, 'settled', true, 'fully_settled', true,
                            'session_id', v_row.session_id, 'order_id', v_order_id);
END;
$$;

COMMENT ON TABLE public.restaurant_tableside_tables IS
  'Tableside QR definitions; code rotates when the active self-serve order ends (cancel or submit).';
