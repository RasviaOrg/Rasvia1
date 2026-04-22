-- Staff-managed (tableside) group orders: the restaurant waiter is _only_ a
-- host — they are not a dining guest. The waiter must never owe money on the
-- ledger or be counted in the "split evenly" headcount. This migration
-- rewrites `_party_compute_ledger` to exclude the host whenever
-- `party_sessions.staff_managed = true`.
--
-- Items in a staff-managed session are always attributed to a guest via the
-- `party_host_add_item_for` RPC, so normal per_person / assigned items already
-- credit the right guest. This migration just keeps the host out of the
-- division for `equal_split`, and redirects orphan items (no guest attribution)
-- to the first guest instead of the host.

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

  -- Identify the host first so we can exclude them from the member list when
  -- `staff_managed = true` (the waiter shouldn't owe anything).
  SELECT id INTO v_host_id FROM public.party_members
    WHERE session_id = p_session_id AND role = 'host' AND left_at IS NULL
    ORDER BY joined_at ASC LIMIT 1;

  IF v_skip_host AND v_host_id IS NOT NULL THEN
    SELECT array_agg(m.id ORDER BY m.joined_at) INTO v_member_ids
      FROM public.party_members m
      WHERE m.session_id = p_session_id AND m.left_at IS NULL AND m.id <> v_host_id;
  ELSE
    SELECT array_agg(m.id ORDER BY m.joined_at) INTO v_member_ids
      FROM public.party_members m
      WHERE m.session_id = p_session_id AND m.left_at IS NULL;
  END IF;

  v_n := coalesce(array_length(v_member_ids, 1), 0);
  IF v_n = 0 THEN RETURN; END IF;

  -- Fallback target for orphan items (no attribution). In a staff-managed
  -- session the fallback is the first guest, not the waiter.
  IF v_skip_host THEN
    v_fallback := v_member_ids[1];
  ELSE
    v_fallback := coalesce(v_host_id, v_member_ids[1]);
  END IF;

  v_amounts := array_fill(0, ARRAY[v_n]);

  SELECT coalesce(sum(round(coalesce(mi.price,0) * coalesce(pi.quantity,1) * 100))::integer, 0) INTO v_total
    FROM public.party_items pi
    LEFT JOIN public.menu_items mi ON mi.id = pi.menu_item_id
    WHERE pi.session_id = p_session_id;

  IF v_mode = 'host_pays' THEN
    IF v_skip_host THEN
      -- "Host pays" doesn't make sense for a waiter — fall back to splitting
      -- evenly between guests so we never attribute the full bill to staff.
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
