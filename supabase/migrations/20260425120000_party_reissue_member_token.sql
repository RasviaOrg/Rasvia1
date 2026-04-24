-- Re-issue a plaintext member_token when the authenticated user already has a
-- party_members row but lost local storage (e.g. new device). Rotates
-- member_token_hash — other clients using the old bearer will need to rejoin.
CREATE OR REPLACE FUNCTION public.party_reissue_member_token(p_session_id uuid)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, extensions
AS $$
DECLARE
  v_uid   uuid := auth.uid();
  v_mid   uuid;
  v_token text;
  v_hash  text;
  v_role  text;
  v_name  text;
BEGIN
  IF v_uid IS NULL THEN
    RAISE EXCEPTION 'not_authenticated' USING ERRCODE = '28000';
  END IF;

  SELECT id, role, display_name
  INTO v_mid, v_role, v_name
  FROM public.party_members
  WHERE session_id = p_session_id
    AND user_id = v_uid
    AND left_at IS NULL
  LIMIT 1;

  IF v_mid IS NULL THEN
    RAISE EXCEPTION 'no_active_membership' USING ERRCODE = 'P0001';
  END IF;

  v_token := encode(gen_random_bytes(32), 'base64');
  v_hash  := public._party_hash_token(v_token);

  UPDATE public.party_members
  SET member_token_hash = v_hash,
      last_seen_at = now()
  WHERE id = v_mid;

  RETURN jsonb_build_object(
    'member_id',    v_mid,
    'member_token', v_token,
    'role',         v_role,
    'session_id',   p_session_id,
    'display_name', v_name
  );
END;
$$;

GRANT EXECUTE ON FUNCTION public.party_reissue_member_token(uuid) TO authenticated;
