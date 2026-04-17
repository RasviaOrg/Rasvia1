-- ============================================================================
-- GROUP ORDER BRIDGE OVERHAUL  (schema_version = 2)
-- ----------------------------------------------------------------------------
-- New tables: party_members, party_payments
-- New columns on party_sessions (lifecycle + frozen totals + schema_version)
-- New columns on party_items   (split_member_ids, assigned_payer_id, added_by_member_id)
-- New SECURITY DEFINER RPCs for all party session mutations
-- Backfill: existing open sessions stay on schema_version=1 and use legacy path
-- ============================================================================

-- ── Extensions ──────────────────────────────────────────────────────────────
CREATE EXTENSION IF NOT EXISTS pgcrypto;

-- ────────────────────────────────────────────────────────────────────────────
-- 1. party_sessions — lifecycle columns and wider payment_mode check
-- ────────────────────────────────────────────────────────────────────────────

ALTER TABLE public.party_sessions
  ADD COLUMN IF NOT EXISTS schema_version   integer NOT NULL DEFAULT 1,
  ADD COLUMN IF NOT EXISTS locked_at        timestamptz,
  ADD COLUMN IF NOT EXISTS subtotal_cents   integer NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS tax_cents        integer NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS total_cents      integer NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS cancelled_at     timestamptz,
  ADD COLUMN IF NOT EXISTS submitted_order_id bigint REFERENCES public.orders(id);

-- Expand payment_mode to support 5 modes; keep legacy values as aliases.
ALTER TABLE public.party_sessions
  DROP CONSTRAINT IF EXISTS party_sessions_payment_mode_check;

ALTER TABLE public.party_sessions
  ADD CONSTRAINT party_sessions_payment_mode_check
  CHECK (payment_mode IN (
    'host_pays', 'equal_split', 'per_person', 'assigned',
    'split', 'assign'  -- legacy aliases (schema_version=1)
  ));

COMMENT ON COLUMN public.party_sessions.schema_version IS
  '1 = legacy flow (string names, special_requests splits). 2 = new overhauled group order flow with party_members/party_payments.';
COMMENT ON COLUMN public.party_sessions.locked_at IS
  'Timestamp when host locked the cart and froze totals.';
COMMENT ON COLUMN public.party_sessions.total_cents IS
  'Frozen total in cents at time of lock. Used by all payment computations.';
COMMENT ON COLUMN public.party_sessions.submitted_order_id IS
  'ID of the consolidated orders row created once the ledger is fully settled.';

-- Accept new session status values (open, locked, paying, submitted, completed, cancelled)
-- No CHECK constraint on status currently — we validate in RPCs.

-- ────────────────────────────────────────────────────────────────────────────
-- 2. party_members — explicit membership (host + guests + authed users)
-- ────────────────────────────────────────────────────────────────────────────

CREATE TABLE IF NOT EXISTS public.party_members (
  id                uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  session_id        uuid NOT NULL REFERENCES public.party_sessions(id) ON DELETE CASCADE,
  user_id           uuid REFERENCES auth.users(id) ON DELETE SET NULL,
  display_name      text NOT NULL,
  role              text NOT NULL DEFAULT 'member',
  member_token_hash text NOT NULL,  -- sha256 of the bearer token returned once on join
  joined_at         timestamptz NOT NULL DEFAULT now(),
  last_seen_at      timestamptz NOT NULL DEFAULT now(),
  left_at           timestamptz,
  CONSTRAINT party_members_role_check CHECK (role IN ('host','member'))
);

CREATE INDEX IF NOT EXISTS idx_party_members_session ON public.party_members (session_id) WHERE left_at IS NULL;
CREATE INDEX IF NOT EXISTS idx_party_members_user    ON public.party_members (session_id, user_id) WHERE user_id IS NOT NULL AND left_at IS NULL;
CREATE UNIQUE INDEX IF NOT EXISTS uniq_party_members_session_user
  ON public.party_members (session_id, user_id)
  WHERE user_id IS NOT NULL AND left_at IS NULL;

COMMENT ON TABLE  public.party_members IS 'Explicit membership for a party_sessions row. One host + any number of members. Bearer token authenticates guest mutations.';
COMMENT ON COLUMN public.party_members.member_token_hash IS 'sha256 hex of the opaque member_token returned once on join. Used to authorize RPC mutations.';
COMMENT ON COLUMN public.party_members.role IS 'host or member. Only one host per session (the creator).';

ALTER TABLE public.party_members ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "party_members_public_read" ON public.party_members;
CREATE POLICY "party_members_public_read"
  ON public.party_members
  FOR SELECT
  USING (true);
-- No direct INSERT/UPDATE/DELETE policies — all mutations go through SECURITY DEFINER RPCs.

-- ────────────────────────────────────────────────────────────────────────────
-- 3. party_items — new split / assigned columns linked to party_members
-- ────────────────────────────────────────────────────────────────────────────

ALTER TABLE public.party_items
  ADD COLUMN IF NOT EXISTS added_by_member_id  uuid REFERENCES public.party_members(id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS split_member_ids    uuid[] NOT NULL DEFAULT '{}',
  ADD COLUMN IF NOT EXISTS assigned_payer_id   uuid REFERENCES public.party_members(id) ON DELETE SET NULL;

CREATE INDEX IF NOT EXISTS idx_party_items_added_by_member ON public.party_items (added_by_member_id);
CREATE INDEX IF NOT EXISTS idx_party_items_assigned_payer  ON public.party_items (assigned_payer_id);

COMMENT ON COLUMN public.party_items.added_by_member_id IS 'Normalized FK replacement for added_by_name in schema_version=2 sessions.';
COMMENT ON COLUMN public.party_items.split_member_ids   IS 'Per-item equal split across these member ids. Empty array = no per-item split.';
COMMENT ON COLUMN public.party_items.assigned_payer_id  IS 'Used when session.payment_mode = assigned. Overrides added_by_member_id for billing.';

-- Ensure UPDATE/DELETE policies exist for the legacy flow too.
DROP POLICY IF EXISTS "party_items_public_update" ON public.party_items;
CREATE POLICY "party_items_public_update"
  ON public.party_items FOR UPDATE USING (true) WITH CHECK (true);

DROP POLICY IF EXISTS "party_items_public_delete" ON public.party_items;
CREATE POLICY "party_items_public_delete"
  ON public.party_items FOR DELETE USING (true);

-- ────────────────────────────────────────────────────────────────────────────
-- 4. party_payments — the settlement ledger
-- ────────────────────────────────────────────────────────────────────────────

CREATE TABLE IF NOT EXISTS public.party_payments (
  id                    uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  session_id            uuid NOT NULL REFERENCES public.party_sessions(id) ON DELETE CASCADE,
  member_id             uuid NOT NULL REFERENCES public.party_members(id)  ON DELETE CASCADE,
  amount_cents          integer NOT NULL,
  status                text NOT NULL DEFAULT 'pending',
  stripe_session_id     text UNIQUE,
  stripe_payment_intent text,
  order_id              bigint REFERENCES public.orders(id) ON DELETE SET NULL,
  paid_at               timestamptz,
  covered_by_member_id  uuid REFERENCES public.party_members(id) ON DELETE SET NULL,
  failure_reason        text,
  created_at            timestamptz NOT NULL DEFAULT now(),
  updated_at            timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT party_payments_status_check
    CHECK (status IN ('pending','paid','refunded','covered','failed','cancelled')),
  CONSTRAINT party_payments_amount_check
    CHECK (amount_cents >= 0)
);

CREATE UNIQUE INDEX IF NOT EXISTS uniq_party_payments_session_member
  ON public.party_payments (session_id, member_id);
CREATE INDEX IF NOT EXISTS idx_party_payments_session ON public.party_payments (session_id);
CREATE INDEX IF NOT EXISTS idx_party_payments_status  ON public.party_payments (status);

COMMENT ON TABLE  public.party_payments IS 'Settlement ledger for schema_version=2 party sessions. One row per member. Webhook is the source of truth for status transitions.';
COMMENT ON COLUMN public.party_payments.covered_by_member_id IS 'Set when another member (usually host) paid this row on the original member''s behalf.';

CREATE OR REPLACE FUNCTION public.set_party_payments_updated_at()
RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  NEW.updated_at = now();
  RETURN NEW;
END;
$$;
DROP TRIGGER IF EXISTS trg_party_payments_updated_at ON public.party_payments;
CREATE TRIGGER trg_party_payments_updated_at BEFORE UPDATE ON public.party_payments
  FOR EACH ROW EXECUTE FUNCTION public.set_party_payments_updated_at();

ALTER TABLE public.party_payments ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "party_payments_public_read" ON public.party_payments;
CREATE POLICY "party_payments_public_read"
  ON public.party_payments
  FOR SELECT
  USING (true);

-- ────────────────────────────────────────────────────────────────────────────
-- 5. Helper functions — token auth + JSON serialization
-- ────────────────────────────────────────────────────────────────────────────

CREATE OR REPLACE FUNCTION public._party_hash_token(p_token text)
RETURNS text LANGUAGE sql IMMUTABLE AS $$
  SELECT encode(digest(p_token, 'sha256'), 'hex');
$$;

CREATE OR REPLACE FUNCTION public._party_auth(
  p_session_id uuid,
  p_member_id  uuid,
  p_token      text
) RETURNS public.party_members
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_member public.party_members;
BEGIN
  IF p_session_id IS NULL OR p_member_id IS NULL OR p_token IS NULL OR length(p_token) = 0 THEN
    RAISE EXCEPTION 'unauthorized' USING ERRCODE = '28000';
  END IF;

  SELECT * INTO v_member
  FROM public.party_members
  WHERE id = p_member_id
    AND session_id = p_session_id
    AND member_token_hash = public._party_hash_token(p_token)
    AND left_at IS NULL
  LIMIT 1;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'unauthorized' USING ERRCODE = '28000';
  END IF;

  UPDATE public.party_members SET last_seen_at = now() WHERE id = v_member.id;
  RETURN v_member;
END;
$$;

CREATE OR REPLACE FUNCTION public._party_session_snapshot(p_session_id uuid)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_session jsonb;
  v_members jsonb;
  v_items   jsonb;
  v_payments jsonb;
BEGIN
  SELECT to_jsonb(s) INTO v_session
  FROM public.party_sessions s
  WHERE s.id = p_session_id;

  IF v_session IS NULL THEN
    RAISE EXCEPTION 'session_not_found' USING ERRCODE = 'P0002';
  END IF;

  SELECT coalesce(jsonb_agg(to_jsonb(m) ORDER BY m.joined_at), '[]'::jsonb) INTO v_members
  FROM public.party_members m
  WHERE m.session_id = p_session_id AND m.left_at IS NULL;

  SELECT coalesce(
    jsonb_agg(
      jsonb_build_object(
        'id', i.id,
        'session_id', i.session_id,
        'menu_item_id', i.menu_item_id,
        'added_by_name', i.added_by_name,
        'added_by_member_id', i.added_by_member_id,
        'added_by_user_id', i.added_by_user_id,
        'quantity', i.quantity,
        'special_requests', i.special_requests,
        'split_member_ids', i.split_member_ids,
        'assigned_payer_id', i.assigned_payer_id,
        'created_at', i.created_at,
        'menu_item', jsonb_build_object(
          'id', mi.id,
          'name', mi.name,
          'description', mi.description,
          'price', mi.price,
          'image_url', mi.image_url,
          'is_vegetarian', mi.is_vegetarian
        )
      ) ORDER BY i.created_at
    ), '[]'::jsonb
  ) INTO v_items
  FROM public.party_items i
  LEFT JOIN public.menu_items mi ON mi.id = i.menu_item_id
  WHERE i.session_id = p_session_id;

  SELECT coalesce(jsonb_agg(to_jsonb(p) ORDER BY p.created_at), '[]'::jsonb) INTO v_payments
  FROM public.party_payments p
  WHERE p.session_id = p_session_id;

  RETURN jsonb_build_object(
    'session', v_session,
    'members', v_members,
    'items',   v_items,
    'payments', v_payments
  );
END;
$$;

-- ────────────────────────────────────────────────────────────────────────────
-- 6. Join / leave RPCs
-- ────────────────────────────────────────────────────────────────────────────

CREATE OR REPLACE FUNCTION public.party_join_session(
  p_session_id   uuid,
  p_display_name text
) RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_session   public.party_sessions;
  v_uid       uuid := auth.uid();
  v_member_id uuid;
  v_token     text;
  v_hash      text;
  v_role      text := 'member';
  v_name      text;
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

  v_token := encode(gen_random_bytes(32), 'base64');
  v_hash  := public._party_hash_token(v_token);

  IF v_uid IS NOT NULL THEN
    SELECT id INTO v_member_id
    FROM public.party_members
    WHERE session_id = p_session_id AND user_id = v_uid AND left_at IS NULL
    LIMIT 1;
  END IF;

  IF v_member_id IS NOT NULL THEN
    UPDATE public.party_members
      SET display_name = v_name,
          member_token_hash = v_hash,
          last_seen_at = now(),
          role = CASE WHEN v_role = 'host' THEN 'host' ELSE role END
      WHERE id = v_member_id;
  ELSE
    INSERT INTO public.party_members (session_id, user_id, display_name, role, member_token_hash)
    VALUES (p_session_id, v_uid, v_name, v_role, v_hash)
    RETURNING id INTO v_member_id;
  END IF;

  RETURN jsonb_build_object(
    'member_id',    v_member_id,
    'member_token', v_token,
    'role',         v_role,
    'session_id',   p_session_id,
    'display_name', v_name
  );
END;
$$;

CREATE OR REPLACE FUNCTION public.party_leave(
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
  v_pay_status text;
  v_successor uuid;
BEGIN
  v_member := public._party_auth(p_session_id, p_member_id, p_token);
  SELECT * INTO v_session FROM public.party_sessions WHERE id = p_session_id FOR UPDATE;

  -- If the session is already paying and this member has a paid/covered row, they cannot leave.
  SELECT status INTO v_pay_status FROM public.party_payments
    WHERE session_id = p_session_id AND member_id = p_member_id
    LIMIT 1;
  IF v_pay_status IN ('paid','covered') THEN
    RAISE EXCEPTION 'cannot_leave_after_paying' USING ERRCODE = '22023';
  END IF;

  UPDATE public.party_members SET left_at = now() WHERE id = p_member_id;

  -- Remove their unpaid pending payment row if any
  DELETE FROM public.party_payments
    WHERE session_id = p_session_id AND member_id = p_member_id AND status = 'pending';

  -- Remove their items only while session is still open
  IF v_session.status = 'open' THEN
    DELETE FROM public.party_items
      WHERE session_id = p_session_id AND added_by_member_id = p_member_id;
  END IF;

  -- Host leaves: promote oldest remaining member; if none, cancel session.
  IF v_member.role = 'host' THEN
    SELECT id INTO v_successor
      FROM public.party_members
      WHERE session_id = p_session_id AND left_at IS NULL AND id <> p_member_id
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

  RETURN jsonb_build_object('ok', true);
END;
$$;

-- ────────────────────────────────────────────────────────────────────────────
-- 7. Cart mutation RPCs (authenticated by member_token)
-- ────────────────────────────────────────────────────────────────────────────

CREATE OR REPLACE FUNCTION public.party_add_item(
  p_session_id   uuid,
  p_member_id    uuid,
  p_token        text,
  p_menu_item_id bigint,
  p_quantity     integer DEFAULT 1,
  p_notes        text DEFAULT NULL
) RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_member  public.party_members;
  v_session public.party_sessions;
  v_menu    public.menu_items;
  v_qty     integer;
  v_item_id uuid;
  v_existing uuid;
BEGIN
  v_member := public._party_auth(p_session_id, p_member_id, p_token);
  SELECT * INTO v_session FROM public.party_sessions WHERE id = p_session_id;
  IF v_session.status <> 'open' THEN
    RAISE EXCEPTION 'session_not_open' USING ERRCODE = '22023';
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
      AND added_by_member_id = p_member_id
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
      p_session_id, p_menu_item_id, v_member.display_name, v_member.user_id,
      v_member.id, v_qty, p_notes
    ) RETURNING id INTO v_item_id;
  END IF;

  RETURN jsonb_build_object('item_id', v_item_id);
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
  v_member  public.party_members;
  v_session public.party_sessions;
  v_item    public.party_items;
  v_qty     integer;
BEGIN
  v_member := public._party_auth(p_session_id, p_member_id, p_token);
  SELECT * INTO v_session FROM public.party_sessions WHERE id = p_session_id;
  IF v_session.status <> 'open' THEN
    RAISE EXCEPTION 'session_not_open' USING ERRCODE = '22023';
  END IF;
  SELECT * INTO v_item FROM public.party_items WHERE id = p_item_id AND session_id = p_session_id;
  IF NOT FOUND THEN RAISE EXCEPTION 'item_not_found' USING ERRCODE = 'P0002'; END IF;

  -- Only the adder or the host can modify
  IF v_member.role <> 'host' AND v_item.added_by_member_id IS DISTINCT FROM v_member.id THEN
    RAISE EXCEPTION 'forbidden' USING ERRCODE = '42501';
  END IF;

  v_qty := greatest(0, least(coalesce(p_quantity, 0), 25));
  IF v_qty = 0 THEN
    DELETE FROM public.party_items WHERE id = p_item_id;
  ELSE
    UPDATE public.party_items SET quantity = v_qty WHERE id = p_item_id;
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
  v_member public.party_members;
  v_session public.party_sessions;
  v_item   public.party_items;
BEGIN
  v_member := public._party_auth(p_session_id, p_member_id, p_token);
  SELECT * INTO v_session FROM public.party_sessions WHERE id = p_session_id;
  IF v_session.status <> 'open' THEN
    RAISE EXCEPTION 'session_not_open' USING ERRCODE = '22023';
  END IF;
  SELECT * INTO v_item FROM public.party_items WHERE id = p_item_id AND session_id = p_session_id;
  IF NOT FOUND THEN RAISE EXCEPTION 'item_not_found' USING ERRCODE = 'P0002'; END IF;

  IF v_member.role <> 'host' AND v_item.added_by_member_id IS DISTINCT FROM v_member.id THEN
    RAISE EXCEPTION 'forbidden' USING ERRCODE = '42501';
  END IF;

  DELETE FROM public.party_items WHERE id = p_item_id;
  RETURN jsonb_build_object('ok', true);
END;
$$;

-- Per-item equal split across selected member ids (host only)
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
  IF v_member.role <> 'host' THEN
    RAISE EXCEPTION 'host_only' USING ERRCODE = '42501';
  END IF;
  SELECT * INTO v_session FROM public.party_sessions WHERE id = p_session_id;
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
  IF v_member.role <> 'host' THEN
    RAISE EXCEPTION 'host_only' USING ERRCODE = '42501';
  END IF;
  SELECT * INTO v_session FROM public.party_sessions WHERE id = p_session_id;
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

-- Host sets the session-wide payment mode (host_pays / equal_split / per_person / assigned)
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
  IF v_member.role <> 'host' THEN
    RAISE EXCEPTION 'host_only' USING ERRCODE = '42501';
  END IF;
  IF p_mode NOT IN ('host_pays','equal_split','per_person','assigned') THEN
    RAISE EXCEPTION 'invalid_payment_mode' USING ERRCODE = '22023';
  END IF;
  SELECT * INTO v_session FROM public.party_sessions WHERE id = p_session_id;
  IF v_session.status NOT IN ('open','locked') THEN
    RAISE EXCEPTION 'session_locked_or_closed' USING ERRCODE = '22023';
  END IF;
  UPDATE public.party_sessions SET payment_mode = p_mode WHERE id = p_session_id;
  RETURN jsonb_build_object('ok', true);
END;
$$;

-- ────────────────────────────────────────────────────────────────────────────
-- 8. Lock / unlock — compute totals and build the ledger
-- ────────────────────────────────────────────────────────────────────────────

CREATE OR REPLACE FUNCTION public._party_compute_ledger(p_session_id uuid)
RETURNS TABLE (member_id uuid, amount_cents integer)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_session   public.party_sessions;
  v_mode      text;
  v_host_id   uuid;
  v_member_ids uuid[];
  v_amounts    integer[];
  v_n         integer;
  v_total     integer;
  v_base      integer;
  v_remainder integer;
  i           integer;
  r           RECORD;
  v_line_cents integer;
  v_payers     uuid[];
  v_payer_n    integer;
  v_payer_base integer;
  v_payer_rem  integer;
  j            integer;
  v_pid        uuid;
  v_pidx       integer;
BEGIN
  SELECT * INTO v_session FROM public.party_sessions WHERE id = p_session_id;
  v_mode := v_session.payment_mode;

  SELECT array_agg(m.id ORDER BY m.joined_at) INTO v_member_ids
    FROM public.party_members m
    WHERE m.session_id = p_session_id AND m.left_at IS NULL;

  v_n := coalesce(array_length(v_member_ids, 1), 0);
  IF v_n = 0 THEN RETURN; END IF;

  SELECT id INTO v_host_id FROM public.party_members
    WHERE session_id = p_session_id AND role = 'host' AND left_at IS NULL
    ORDER BY joined_at ASC LIMIT 1;
  IF v_host_id IS NULL THEN v_host_id := v_member_ids[1]; END IF;

  v_amounts := array_fill(0, ARRAY[v_n]);

  SELECT coalesce(sum(round(coalesce(mi.price,0) * coalesce(pi.quantity,1) * 100))::integer, 0) INTO v_total
    FROM public.party_items pi
    LEFT JOIN public.menu_items mi ON mi.id = pi.menu_item_id
    WHERE pi.session_id = p_session_id;

  IF v_mode = 'host_pays' THEN
    FOR i IN 1..v_n LOOP
      IF v_member_ids[i] = v_host_id THEN
        v_amounts[i] := v_total;
        EXIT;
      END IF;
    END LOOP;

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
        v_payers := ARRAY[v_host_id];
      END IF;

      v_payer_n    := array_length(v_payers, 1);
      v_payer_base := v_line_cents / v_payer_n;
      v_payer_rem  := v_line_cents - v_payer_base * v_payer_n;

      FOR j IN 1..v_payer_n LOOP
        v_pid := v_payers[j];
        v_pidx := array_position(v_member_ids, v_pid);
        IF v_pidx IS NULL THEN
          v_pidx := array_position(v_member_ids, v_host_id);
        END IF;
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
      v_pid := coalesce(r.assigned_payer_id, r.added_by_member_id, v_host_id);
      v_pidx := array_position(v_member_ids, v_pid);
      IF v_pidx IS NULL THEN
        v_pidx := array_position(v_member_ids, v_host_id);
      END IF;
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
  IF v_member.role <> 'host' THEN
    RAISE EXCEPTION 'host_only' USING ERRCODE = '42501';
  END IF;

  SELECT * INTO v_session FROM public.party_sessions WHERE id = p_session_id FOR UPDATE;
  IF v_session.status = 'locked' THEN
    -- already locked; return current state
    RETURN public._party_session_snapshot(p_session_id);
  END IF;
  IF v_session.status <> 'open' THEN
    RAISE EXCEPTION 'session_not_open' USING ERRCODE = '22023';
  END IF;

  -- Require at least one item
  IF NOT EXISTS (SELECT 1 FROM public.party_items WHERE session_id = p_session_id) THEN
    RAISE EXCEPTION 'empty_cart' USING ERRCODE = '22023';
  END IF;

  -- Compute ledger
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
  IF v_member.role <> 'host' THEN
    RAISE EXCEPTION 'host_only' USING ERRCODE = '42501';
  END IF;
  SELECT * INTO v_session FROM public.party_sessions WHERE id = p_session_id FOR UPDATE;
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

-- ────────────────────────────────────────────────────────────────────────────
-- 9. Payment settlement RPCs (called by stripe-webhook / edge fns via service role)
-- ────────────────────────────────────────────────────────────────────────────

-- Attach a Stripe Checkout Session id to a party_payments row before redirecting.
CREATE OR REPLACE FUNCTION public.party_attach_checkout(
  p_session_id       uuid,
  p_member_id        uuid,
  p_stripe_session_id text,
  p_expected_amount_cents integer,
  p_coverer_member_id uuid DEFAULT NULL
) RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_row public.party_payments;
BEGIN
  SELECT * INTO v_row FROM public.party_payments
    WHERE session_id = p_session_id AND member_id = p_member_id FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'payment_not_found' USING ERRCODE = 'P0002';
  END IF;
  IF v_row.status IN ('paid','covered','refunded') THEN
    RAISE EXCEPTION 'already_paid' USING ERRCODE = '22023';
  END IF;
  IF v_row.amount_cents <> p_expected_amount_cents THEN
    RAISE EXCEPTION 'amount_mismatch' USING ERRCODE = '22023';
  END IF;

  UPDATE public.party_payments
    SET stripe_session_id = p_stripe_session_id,
        covered_by_member_id = p_coverer_member_id,
        status = 'pending'
    WHERE id = v_row.id;

  UPDATE public.party_sessions
    SET status = CASE WHEN status = 'locked' THEN 'paying' ELSE status END
    WHERE id = p_session_id;

  RETURN jsonb_build_object('payment_id', v_row.id);
END;
$$;

-- Called by stripe-webhook on checkout.session.completed.
-- Marks the payment paid; if all are resolved, creates the consolidated order.
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
BEGIN
  SELECT * INTO v_row FROM public.party_payments
    WHERE stripe_session_id = p_stripe_session_id FOR UPDATE;
  IF NOT FOUND THEN
    -- Idempotency: webhook replay after we've already processed.
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

  -- Check whether every pending row is resolved.
  SELECT count(*) INTO v_unresolved
    FROM public.party_payments
    WHERE session_id = v_row.session_id
      AND status IN ('pending','failed','cancelled');

  IF v_unresolved > 0 THEN
    RETURN jsonb_build_object('ok', true, 'settled', true, 'fully_settled', false, 'session_id', v_row.session_id);
  END IF;

  -- All paid/covered — build consolidated order (idempotent on submitted_order_id).
  IF v_session.submitted_order_id IS NOT NULL THEN
    RETURN jsonb_build_object('ok', true, 'settled', true, 'fully_settled', true,
                              'session_id', v_row.session_id,
                              'order_id', v_session.submitted_order_id);
  END IF;

  SELECT coalesce(sum(amount_cents), 0) INTO v_total
    FROM public.party_payments WHERE session_id = v_row.session_id;

  SELECT m.display_name INTO v_host_name FROM public.party_members m
    WHERE m.session_id = v_row.session_id AND m.role = 'host'
    ORDER BY m.joined_at LIMIT 1;

  INSERT INTO public.orders (
    restaurant_id, order_type, status, meal_period, subtotal, tip_amount,
    payment_method, party_session_id, customer_name, created_by
  ) VALUES (
    v_session.restaurant_id, 'dine_in', 'pending', 'dinner',
    (v_total::numeric / 100.0), 0, 'card',
    v_row.session_id::text, coalesce(v_host_name, 'Group Order'),
    coalesce(v_session.host_user_id::text, 'group')
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
  UPDATE public.party_sessions
    SET status = 'submitted', submitted_at = now()::text, submitted_order_id = v_order_id
    WHERE id = v_row.session_id;

  -- Legacy mirror
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

CREATE OR REPLACE FUNCTION public.party_fail_payment(
  p_stripe_session_id text,
  p_reason            text DEFAULT 'failed'
) RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_row public.party_payments;
BEGIN
  SELECT * INTO v_row FROM public.party_payments WHERE stripe_session_id = p_stripe_session_id FOR UPDATE;
  IF NOT FOUND THEN
    RETURN jsonb_build_object('ok', true, 'updated', false);
  END IF;
  IF v_row.status IN ('paid','covered','refunded') THEN
    RETURN jsonb_build_object('ok', true, 'updated', false);
  END IF;
  UPDATE public.party_payments
    SET status = 'failed',
        stripe_session_id = NULL,
        failure_reason = left(coalesce(p_reason, 'failed'), 120)
    WHERE id = v_row.id;
  RETURN jsonb_build_object('ok', true, 'updated', true);
END;
$$;

-- ────────────────────────────────────────────────────────────────────────────
-- 10. Cancel / timeout reaper
-- ────────────────────────────────────────────────────────────────────────────

-- Host cancels session; returns a list of paid payments that still require refund.
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

  RETURN jsonb_build_object('ok', true, 'refundable', v_refunds);
END;
$$;

-- Mark a paid payment as refunded (called by cancel edge function after Stripe refund).
CREATE OR REPLACE FUNCTION public.party_mark_refunded(p_payment_id uuid)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  UPDATE public.party_payments
    SET status = 'refunded'
    WHERE id = p_payment_id AND status IN ('paid','covered');
  RETURN jsonb_build_object('ok', true);
END;
$$;

-- Timeout reaper: called by cron or on-demand. Expires pending payments older than threshold.
CREATE OR REPLACE FUNCTION public.party_reap_stale_payments(p_minutes integer DEFAULT 30)
RETURNS integer
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_count integer;
BEGIN
  WITH expired AS (
    UPDATE public.party_payments
      SET status = 'failed',
          failure_reason = 'timeout',
          stripe_session_id = NULL
      WHERE status = 'pending'
        AND stripe_session_id IS NOT NULL
        AND updated_at < now() - (p_minutes || ' minutes')::interval
      RETURNING id
  )
  SELECT count(*) INTO v_count FROM expired;
  RETURN coalesce(v_count, 0);
END;
$$;

-- ────────────────────────────────────────────────────────────────────────────
-- 11. Permissions: expose RPCs to anon/authenticated; helpers stay internal
-- ────────────────────────────────────────────────────────────────────────────

GRANT EXECUTE ON FUNCTION public.party_join_session(uuid, text)                        TO anon, authenticated;
GRANT EXECUTE ON FUNCTION public.party_leave(uuid, uuid, text)                         TO anon, authenticated;
GRANT EXECUTE ON FUNCTION public.party_add_item(uuid, uuid, text, bigint, integer, text) TO anon, authenticated;
GRANT EXECUTE ON FUNCTION public.party_update_item(uuid, uuid, text, uuid, integer)    TO anon, authenticated;
GRANT EXECUTE ON FUNCTION public.party_remove_item(uuid, uuid, text, uuid)             TO anon, authenticated;
GRANT EXECUTE ON FUNCTION public.party_set_item_split(uuid, uuid, text, uuid, uuid[])  TO anon, authenticated;
GRANT EXECUTE ON FUNCTION public.party_assign_item_payer(uuid, uuid, text, uuid, uuid) TO anon, authenticated;
GRANT EXECUTE ON FUNCTION public.party_set_payment_mode(uuid, uuid, text, text)        TO anon, authenticated;
GRANT EXECUTE ON FUNCTION public.party_lock_session(uuid, uuid, text)                  TO anon, authenticated;
GRANT EXECUTE ON FUNCTION public.party_unlock_session(uuid, uuid, text)                TO anon, authenticated;
GRANT EXECUTE ON FUNCTION public.party_cancel_session(uuid, uuid, text)                TO anon, authenticated;

-- settlement RPCs only for service_role
REVOKE ALL ON FUNCTION public.party_attach_checkout(uuid, uuid, text, integer, uuid)   FROM PUBLIC;
REVOKE ALL ON FUNCTION public.party_settle_payment(text, text)                         FROM PUBLIC;
REVOKE ALL ON FUNCTION public.party_fail_payment(text, text)                           FROM PUBLIC;
REVOKE ALL ON FUNCTION public.party_mark_refunded(uuid)                                FROM PUBLIC;
REVOKE ALL ON FUNCTION public.party_reap_stale_payments(integer)                       FROM PUBLIC;

GRANT EXECUTE ON FUNCTION public.party_attach_checkout(uuid, uuid, text, integer, uuid) TO service_role;
GRANT EXECUTE ON FUNCTION public.party_settle_payment(text, text)                       TO service_role;
GRANT EXECUTE ON FUNCTION public.party_fail_payment(text, text)                         TO service_role;
GRANT EXECUTE ON FUNCTION public.party_mark_refunded(uuid)                              TO service_role;
GRANT EXECUTE ON FUNCTION public.party_reap_stale_payments(integer)                     TO service_role;

-- ────────────────────────────────────────────────────────────────────────────
-- 12. Backfill: synthesize party_members for existing open sessions
-- ────────────────────────────────────────────────────────────────────────────
-- For any open session without members yet, we leave schema_version=1 so the
-- legacy client + create-checkout v1 path continues to work.  New sessions
-- created by the new client will set schema_version=2 via party_lock_session.
