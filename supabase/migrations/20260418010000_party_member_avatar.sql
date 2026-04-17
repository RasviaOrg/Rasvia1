-- ============================================================================
-- Party members avatar snapshot
-- ----------------------------------------------------------------------------
-- The web and app group-order UIs want to show each member's profile
-- picture. `profiles` is RLS-locked to "read own profile" (and unauthenticated
-- guests on the web can't read it at all), so we can't JOIN to it from the
-- client.
--
-- Instead we denormalize a lightweight `avatar_url` snapshot onto
-- `party_members`, populated at join time from the authenticated user's
-- profile. Row-level policies on `party_members` are already "public read"
-- scoped to a session id, which matches how the rest of the party UI works.
-- ============================================================================

ALTER TABLE public.party_members
  ADD COLUMN IF NOT EXISTS avatar_url text;

COMMENT ON COLUMN public.party_members.avatar_url IS
  'Snapshot of profiles.avatar_url captured at join time so the group order '
  'UI can render the member''s picture without a profiles JOIN (which RLS '
  'prevents for non-self rows and unauthenticated guests).';

-- Backfill any existing members that have a linked profile avatar.
UPDATE public.party_members m
   SET avatar_url = p.avatar_url
  FROM public.profiles p
 WHERE m.user_id = p.id
   AND (m.avatar_url IS NULL OR m.avatar_url = '')
   AND p.avatar_url IS NOT NULL;

-- ─────────────────────────────────────────────────────────────────────────────
-- party_join_session — capture avatar_url alongside display name / token
--
-- Mirrors the v2_fixes version (20260417150000_party_v2_fixes.sql) so we
-- preserve:
--   * search_path = public, extensions  (pgcrypto lives in `extensions` on
--     Supabase; a naive `SET search_path = public` breaks `gen_random_bytes`
--     and causes `function gen_random_bytes(integer) does not exist` at join
--     time).
--   * the `session_cancelled` error code for the new overhauled flow.
--   * the schema-tolerant fallback for `gen_random_bytes` so the RPC keeps
--     working even on older databases where pgcrypto lives in `public`.
-- We only add the avatar_url snapshot on top.
-- ─────────────────────────────────────────────────────────────────────────────

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
  v_avatar    text;
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
          -- Last resort: derive from two random values combined with clock.
          v_token := md5(random()::text || clock_timestamp()::text) ||
                     md5(random()::text || clock_timestamp()::text);
      END;
  END;

  v_hash := public._party_hash_token(v_token);

  IF v_uid IS NOT NULL THEN
    SELECT avatar_url INTO v_avatar FROM public.profiles WHERE id = v_uid;
  END IF;

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
          avatar_url        = coalesce(v_avatar, avatar_url),
          role              = CASE WHEN v_role = 'host' THEN 'host' ELSE role END
      WHERE id = v_member_id;
  ELSE
    INSERT INTO public.party_members (session_id, user_id, display_name, role, member_token_hash, avatar_url)
    VALUES (p_session_id, v_uid, v_name, v_role, v_hash, v_avatar)
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

GRANT EXECUTE ON FUNCTION public.party_join_session(uuid, text) TO anon, authenticated;
