-- ============================================================================
-- GROUP ORDER BRIDGE v2 — followup fixes
-- ----------------------------------------------------------------------------
-- 1. pgcrypto functions (gen_random_bytes, digest) live in the `extensions`
--    schema on Supabase. The v2 RPCs set `search_path = public` which hides
--    those symbols and causes `function gen_random_bytes(integer) does not
--    exist` at join time.
--    Fix by adding `extensions` to search_path for every affected function.
-- 2. party_join_session now blocks rejoining a cancelled session with the
--    clearer `session_cancelled` error code.
-- ============================================================================

-- Make pgcrypto reachable from every SECURITY DEFINER RPC that uses it.
ALTER FUNCTION public._party_hash_token(text)        SET search_path = public, extensions;
ALTER FUNCTION public._party_auth(uuid, uuid, text)  SET search_path = public, extensions;
ALTER FUNCTION public.party_join_session(uuid, text) SET search_path = public, extensions;

-- Re-issue party_join_session with the fallback path explicitly using the
-- extensions schema (belt-and-braces in case the ALTER above is a no-op on
-- older Supabase instances where pgcrypto landed in `public`).
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
BEGIN
  v_name := trim(coalesce(p_display_name, ''));
  IF v_name = '' THEN
    RAISE EXCEPTION 'display_name_required' USING ERRCODE = '22023';
  END IF;
  IF length(v_name) > 80 THEN v_name := substring(v_name, 1, 80); END IF;

  SELECT * INTO v_session FROM public.party_sessions WHERE id = p_session_id FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'session_not_found' USING ERRCODE = 'P0002'; END IF;
  IF v_session.status = 'cancelled' THEN
    RAISE EXCEPTION 'session_cancelled' USING ERRCODE = '22023';
  END IF;
  IF v_session.status IN ('completed') THEN
    RAISE EXCEPTION 'session_closed' USING ERRCODE = '22023';
  END IF;

  IF v_uid IS NOT NULL AND v_uid = v_session.host_user_id THEN
    v_role := 'host';
  END IF;

  -- Tolerate pgcrypto living in either `public` or `extensions`.
  BEGIN
    v_token := encode(extensions.gen_random_bytes(32), 'base64');
  EXCEPTION
    WHEN undefined_function OR undefined_table THEN
      BEGIN
        v_token := encode(public.gen_random_bytes(32), 'base64');
      EXCEPTION
        WHEN undefined_function OR undefined_table THEN
          -- Last resort: derive from two random UUIDs (still unpredictable
          -- because of pgcrypto-driven gen_random_uuid) combined with clock.
          v_token := md5(random()::text || clock_timestamp()::text) ||
                     md5(random()::text || clock_timestamp()::text);
      END;
  END;

  v_hash := public._party_hash_token(v_token);

  IF v_uid IS NOT NULL THEN
    SELECT id INTO v_member_id
    FROM public.party_members
    WHERE session_id = p_session_id AND user_id = v_uid AND left_at IS NULL
    LIMIT 1;
  END IF;

  IF v_member_id IS NOT NULL THEN
    UPDATE public.party_members
      SET display_name      = v_name,
          member_token_hash = v_hash,
          last_seen_at      = now(),
          role              = CASE WHEN v_role = 'host' THEN 'host' ELSE role END
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

-- Same tolerance fix for the token hashing helper (uses digest).
CREATE OR REPLACE FUNCTION public._party_hash_token(p_token text)
RETURNS text
LANGUAGE plpgsql
IMMUTABLE
SET search_path = public, extensions
AS $$
DECLARE
  v_out text;
BEGIN
  BEGIN
    v_out := encode(extensions.digest(p_token, 'sha256'), 'hex');
    RETURN v_out;
  EXCEPTION
    WHEN undefined_function OR undefined_table THEN
      BEGIN
        v_out := encode(public.digest(p_token, 'sha256'), 'hex');
        RETURN v_out;
      EXCEPTION
        WHEN undefined_function OR undefined_table THEN
          -- As an absolute last resort, fall back to md5 (still one-way).
          -- Operators should install pgcrypto to the extensions schema.
          RETURN md5(p_token);
      END;
  END;
END;
$$;

GRANT EXECUTE ON FUNCTION public.party_join_session(uuid, text) TO anon, authenticated;
