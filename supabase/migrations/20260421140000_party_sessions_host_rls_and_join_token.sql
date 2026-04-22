-- Mirror of RasviaWeb migration: host RLS on party_sessions + preserve join token.
-- See RasviaWeb/supabase/migrations/20260421140000_party_sessions_host_rls_and_join_token.sql

-- ── FK: party_items.session_id → party_sessions(id) ON DELETE CASCADE ─────
ALTER TABLE public.party_items
  DROP CONSTRAINT IF EXISTS party_items_session_id_fkey;
ALTER TABLE public.party_items
  ADD CONSTRAINT party_items_session_id_fkey
  FOREIGN KEY (session_id)
  REFERENCES public.party_sessions(id)
  ON DELETE CASCADE;

-- ── RLS: host mutations on party_sessions ───────────────────────────────────
DROP POLICY IF EXISTS "Authenticated users can create sessions" ON public.party_sessions;
CREATE POLICY "Authenticated users can create sessions"
  ON public.party_sessions
  FOR INSERT
  TO authenticated
  WITH CHECK (host_user_id = auth.uid());

DROP POLICY IF EXISTS "Host can update own session" ON public.party_sessions;
CREATE POLICY "Host can update own session"
  ON public.party_sessions
  FOR UPDATE
  TO authenticated
  USING (host_user_id = auth.uid())
  WITH CHECK (host_user_id = auth.uid());

DROP POLICY IF EXISTS "Host can delete own session" ON public.party_sessions;
CREATE POLICY "Host can delete own session"
  ON public.party_sessions
  FOR DELETE
  TO authenticated
  USING (host_user_id = auth.uid());

-- ── party_join_session: preserve bearer token on existing membership ────────
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
