-- Tableside self-order QR: per-table shared sessions (mirror RasviaWeb).

-- ── 1. Schema ───────────────────────────────────────────────────────────────
ALTER TABLE public.party_sessions
  ADD COLUMN IF NOT EXISTS table_label text,
  ADD COLUMN IF NOT EXISTS self_serve boolean NOT NULL DEFAULT false;

COMMENT ON COLUMN public.party_sessions.table_label IS
  'Normalized table identifier for self-serve QR sessions (e.g. "7", "Patio 3").';
COMMENT ON COLUMN public.party_sessions.self_serve IS
  'True when guests scan a fixed table QR and share one open cart without a logged-in host.';

ALTER TABLE public.party_sessions
  ALTER COLUMN host_user_id DROP NOT NULL;

CREATE UNIQUE INDEX IF NOT EXISTS party_sessions_one_active_per_table
  ON public.party_sessions (restaurant_id, table_label)
  WHERE self_serve AND status IN ('open', 'locked', 'paying');

-- ── 2. tableside_resolve_session ──────────────────────────────────────────────
CREATE OR REPLACE FUNCTION public.tableside_resolve_session(
  p_restaurant_id bigint,
  p_table_label   text
) RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_normalized text;
  v_session_id uuid;
BEGIN
  v_normalized := trim(regexp_replace(coalesce(p_table_label, ''), '\s+', ' ', 'g'));
  IF v_normalized = '' THEN
    RAISE EXCEPTION 'table_label_required' USING ERRCODE = '22023';
  END IF;
  IF length(v_normalized) > 32 THEN
    v_normalized := substring(v_normalized, 1, 32);
  END IF;

  PERFORM pg_advisory_xact_lock(hashtext(p_restaurant_id::text || '|' || v_normalized));

  IF NOT EXISTS (SELECT 1 FROM public.restaurants WHERE id = p_restaurant_id) THEN
    RAISE EXCEPTION 'restaurant_not_found' USING ERRCODE = 'P0002';
  END IF;

  SELECT id INTO v_session_id
    FROM public.party_sessions
    WHERE restaurant_id = p_restaurant_id
      AND table_label = v_normalized
      AND self_serve
      AND status IN ('open', 'locked', 'paying')
    ORDER BY created_at DESC
    LIMIT 1;

  IF v_session_id IS NOT NULL THEN
    RETURN jsonb_build_object('session_id', v_session_id);
  END IF;

  INSERT INTO public.party_sessions (
    restaurant_id,
    host_user_id,
    status,
    payment_mode,
    schema_version,
    self_serve,
    staff_managed,
    table_label
  ) VALUES (
    p_restaurant_id,
    NULL,
    'open',
    'per_person',
    2,
    true,
    false,
    v_normalized
  )
  RETURNING id INTO v_session_id;

  RETURN jsonb_build_object('session_id', v_session_id);
END;
$$;

REVOKE ALL ON FUNCTION public.tableside_resolve_session(bigint, text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.tableside_resolve_session(bigint, text) TO service_role;

-- ── 3. party_join_session (base 20260421140000 + self-serve host) ─────────────
CREATE EXTENSION IF NOT EXISTS pgcrypto WITH SCHEMA extensions;

CREATE OR REPLACE FUNCTION public.party_join_session(
  p_session_id   uuid,
  p_display_name text
) RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, extensions
AS $$
DECLARE
  v_session   public.party_sessions;
  v_uid       uuid := auth.uid();
  v_member_id uuid;
  v_token     text;
  v_hash      text;
  v_role      text := 'member';
  v_name      text;
  v_role_out  text;
BEGIN
  v_name := trim(coalesce(p_display_name, ''));
  IF v_name = '' THEN
    RAISE EXCEPTION 'display_name_required' USING ERRCODE = '22023';
  END IF;
  IF length(v_name) > 80 THEN v_name := substring(v_name, 1, 80); END IF;

  SELECT * INTO v_session FROM public.party_sessions WHERE id = p_session_id FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'session_not_found' USING ERRCODE = 'P0002'; END IF;
  IF v_session.status IN ('cancelled','completed') THEN
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
    SELECT id INTO v_member_id
    FROM public.party_members
    WHERE session_id = p_session_id AND user_id = v_uid AND left_at IS NULL
    LIMIT 1;
  END IF;

  IF v_member_id IS NOT NULL THEN
    UPDATE public.party_members
      SET display_name = v_name,
          last_seen_at = now(),
          role = CASE WHEN v_role = 'host' THEN 'host' ELSE role END
      WHERE id = v_member_id;
    SELECT role INTO v_role_out FROM public.party_members WHERE id = v_member_id;
    RETURN jsonb_build_object(
      'member_id',    v_member_id,
      'member_token', NULL,
      'role',         v_role_out,
      'session_id',   p_session_id,
      'display_name', v_name
    );
  END IF;

  v_token := encode(gen_random_bytes(32), 'base64');
  v_hash  := public._party_hash_token(v_token);

  INSERT INTO public.party_members (session_id, user_id, display_name, role, member_token_hash)
  VALUES (p_session_id, v_uid, v_name, v_role, v_hash)
  RETURNING id INTO v_member_id;

  RETURN jsonb_build_object(
    'member_id',    v_member_id,
    'member_token', v_token,
    'role',         v_role,
    'session_id',   p_session_id,
    'display_name', v_name
  );
END;
$$;

-- ── 4. party_settle_payment (menu_qr-aware base + table_number from table_label) ─
-- NOTE: This intentionally preserves the menu_qr round-reset behaviour added by
-- 20260522120000_menu_qr_table_bindings.sql. The ONLY tableside change here is
-- writing orders.table_number from the session table_label. Do NOT drop the
-- menu_qr branches or you will regress the menu-QR self-order feature.
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
