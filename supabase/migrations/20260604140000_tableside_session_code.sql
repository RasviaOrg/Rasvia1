-- Stable tableside_code on party_sessions so /t/{code} always resolves to the same
-- open cart (survives display_name renames; fixes second guest failing to join).

ALTER TABLE public.party_sessions
  ADD COLUMN IF NOT EXISTS tableside_code text;

COMMENT ON COLUMN public.party_sessions.tableside_code IS
  'Immutable QR code from restaurant_tableside_tables; one active self-serve session per code.';

CREATE UNIQUE INDEX IF NOT EXISTS party_sessions_one_active_per_tableside_code
  ON public.party_sessions (tableside_code)
  WHERE tableside_code IS NOT NULL
    AND self_serve
    AND status IN ('open', 'locked', 'paying');

UPDATE public.party_sessions ps
SET tableside_code = t.code
FROM public.restaurant_tableside_tables t
WHERE ps.restaurant_id = t.restaurant_id
  AND lower(trim(ps.table_label)) = lower(trim(t.display_name))
  AND ps.self_serve = true
  AND ps.tableside_code IS NULL
  AND ps.status IN ('open', 'locked', 'paying');

CREATE OR REPLACE FUNCTION public.tableside_resolve_by_code(p_code text)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_code       text;
  v_row        public.restaurant_tableside_tables%ROWTYPE;
  v_normalized text;
  v_session_id uuid;
BEGIN
  v_code := trim(coalesce(p_code, ''));
  IF v_code = '' OR v_code !~ '^[A-Za-z0-9]{6,8}$' THEN
    RAISE EXCEPTION 'invalid_table_code' USING ERRCODE = '22023';
  END IF;

  SELECT * INTO v_row
    FROM public.restaurant_tableside_tables
    WHERE code = v_code;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'table_not_found' USING ERRCODE = 'P0002';
  END IF;

  v_normalized := public._normalize_tableside_display_name(v_row.display_name);
  IF v_normalized IS NULL THEN
    RAISE EXCEPTION 'table_label_required' USING ERRCODE = '22023';
  END IF;

  PERFORM pg_advisory_xact_lock(hashtext('tableside_code|' || v_code));

  SELECT id INTO v_session_id
    FROM public.party_sessions
    WHERE tableside_code = v_code
      AND self_serve
      AND status IN ('open', 'locked', 'paying')
    ORDER BY created_at DESC
    LIMIT 1;

  IF v_session_id IS NULL THEN
    SELECT id INTO v_session_id
      FROM public.party_sessions
      WHERE restaurant_id = v_row.restaurant_id
        AND table_label = v_normalized
        AND self_serve
        AND status IN ('open', 'locked', 'paying')
      ORDER BY created_at DESC
      LIMIT 1;

    IF v_session_id IS NOT NULL THEN
      UPDATE public.party_sessions
        SET tableside_code = v_code
        WHERE id = v_session_id
          AND tableside_code IS NULL;
    END IF;
  END IF;

  IF v_session_id IS NOT NULL THEN
    RETURN jsonb_build_object('session_id', v_session_id);
  END IF;

  BEGIN
    INSERT INTO public.party_sessions (
      restaurant_id,
      host_user_id,
      status,
      payment_mode,
      schema_version,
      self_serve,
      staff_managed,
      table_label,
      tableside_code
    ) VALUES (
      v_row.restaurant_id,
      NULL,
      'open',
      'per_person',
      2,
      true,
      false,
      v_normalized,
      v_code
    )
    RETURNING id INTO v_session_id;
  EXCEPTION
    WHEN unique_violation THEN
      SELECT id INTO v_session_id
        FROM public.party_sessions
        WHERE tableside_code = v_code
          AND self_serve
          AND status IN ('open', 'locked', 'paying')
        ORDER BY created_at DESC
        LIMIT 1;

      IF v_session_id IS NULL THEN
        SELECT id INTO v_session_id
          FROM public.party_sessions
          WHERE restaurant_id = v_row.restaurant_id
            AND table_label = v_normalized
            AND self_serve
            AND status IN ('open', 'locked', 'paying')
          ORDER BY created_at DESC
          LIMIT 1;
      END IF;

      IF v_session_id IS NULL THEN
        RAISE;
      END IF;
  END;

  RETURN jsonb_build_object('session_id', v_session_id);
END;
$$;
