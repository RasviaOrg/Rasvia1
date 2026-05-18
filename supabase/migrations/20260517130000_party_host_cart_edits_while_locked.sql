-- Allow hosts (including tableside staff) to void, adjust quantities, or add items
-- while the party session is `locked` but before any guest has started Stripe Checkout
-- (no stripe_session_id on party_payments). Recomputes pretax ledger shares the same
-- way as party_lock_session and clears session tax so a fresh tax quote can be applied.

CREATE OR REPLACE FUNCTION public._party_refresh_locked_cart_ledger(p_session_id uuid)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_session public.party_sessions;
  v_row     RECORD;
  v_total   integer := 0;
BEGIN
  SELECT * INTO v_session FROM public.party_sessions WHERE id = p_session_id;
  IF NOT FOUND OR v_session.status IS DISTINCT FROM 'locked' THEN
    RAISE EXCEPTION 'ledger_refresh_not_locked' USING ERRCODE = '22023';
  END IF;

  IF EXISTS (
    SELECT 1 FROM public.party_payments pp
    WHERE pp.session_id = p_session_id
      AND pp.stripe_session_id IS NOT NULL
  ) THEN
    RAISE EXCEPTION 'checkout_in_progress' USING ERRCODE = '22023';
  END IF;

  IF EXISTS (
    SELECT 1 FROM information_schema.columns c
    WHERE c.table_schema = 'public'
      AND c.table_name = 'party_items'
      AND c.column_name = 'tax_cents'
  ) THEN
    EXECUTE 'UPDATE public.party_items SET tax_cents = 0 WHERE session_id = $1'
      USING p_session_id;
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
    SET subtotal_cents = v_total,
        tax_cents      = 0,
        total_cents    = v_total
    WHERE id = p_session_id;
END;
$$;

REVOKE ALL ON FUNCTION public._party_refresh_locked_cart_ledger(uuid) FROM PUBLIC;

-- ── party_update_item: host may change qty / void (qty 0) while locked ───────

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
  ELSIF v_session.status = 'locked' AND v_member.role = 'host' THEN
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

  IF v_member.role <> 'host' AND v_item.added_by_member_id IS DISTINCT FROM v_member.id THEN
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

-- ── party_remove_item: host may remove a line while locked ──────────────────

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
  ELSIF v_session.status = 'locked' AND v_member.role = 'host' THEN
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

  IF v_member.role <> 'host' AND v_item.added_by_member_id IS DISTINCT FROM v_member.id THEN
    RAISE EXCEPTION 'forbidden' USING ERRCODE = '42501';
  END IF;

  DELETE FROM public.party_items WHERE id = p_item_id;

  IF v_locked_host_edit THEN
    PERFORM public._party_refresh_locked_cart_ledger(p_session_id);
  END IF;

  RETURN jsonb_build_object('ok', true);
END;
$$;

-- ── party_host_add_item_for: host may add while locked (tableside exceptions) ─

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
  IF NOT FOUND THEN RAISE EXCEPTION 'menu_item_not_found' USING ERRCODE = 'P0002'; END IF;
  IF v_menu.restaurant_id IS DISTINCT FROM v_session.restaurant_id THEN
    RAISE EXCEPTION 'menu_item_wrong_restaurant' USING ERRCODE = '22023';
  END IF;
  IF coalesce(v_menu.in_stock, true) = false OR coalesce(v_menu.is_available, true) = false THEN
    RAISE EXCEPTION 'menu_item_unavailable' USING ERRCODE = '22023';
  END IF;

  v_qty := greatest(1, least(coalesce(p_quantity, 1), 25));

  SELECT id INTO v_existing
    FROM public.party_items
    WHERE session_id = p_session_id
      AND menu_item_id = p_menu_item_id
      AND added_by_member_id = v_for.id
      AND coalesce(special_requests, '') = coalesce(p_notes, '')
    LIMIT 1;

  IF v_existing IS NOT NULL THEN
    UPDATE public.party_items
      SET quantity = least(25, coalesce(quantity, 1) + v_qty)
      WHERE id = v_existing;
    v_item_id := v_existing;
  ELSE
    INSERT INTO public.party_items (
      session_id, menu_item_id, added_by_name, added_by_user_id,
      added_by_member_id, quantity, special_requests
    ) VALUES (
      p_session_id, p_menu_item_id, v_for.display_name, v_for.user_id,
      v_for.id, v_qty, p_notes
    ) RETURNING id INTO v_item_id;
  END IF;

  IF v_locked_host_edit THEN
    PERFORM public._party_refresh_locked_cart_ledger(p_session_id);
  END IF;

  RETURN jsonb_build_object('item_id', v_item_id);
END;
$$;
