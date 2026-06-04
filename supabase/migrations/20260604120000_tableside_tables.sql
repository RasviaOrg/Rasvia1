-- Tableside QR: persisted per-table short codes (/t/{code}) + partner CRUD RPCs.

-- ── 1. Schema ───────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS public.restaurant_tableside_tables (
  id            uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  restaurant_id bigint NOT NULL REFERENCES public.restaurants(id) ON DELETE CASCADE,
  code          text NOT NULL,
  display_name  text NOT NULL,
  sort_order    integer NOT NULL DEFAULT 0,
  created_at    timestamptz NOT NULL DEFAULT timezone('utc', now()),
  CONSTRAINT restaurant_tableside_tables_code_format
    CHECK (code ~ '^[A-Za-z0-9]{6,8}$'),
  CONSTRAINT restaurant_tableside_tables_display_name_nonempty
    CHECK (char_length(trim(display_name)) > 0),
  CONSTRAINT restaurant_tableside_tables_code_unique UNIQUE (code)
);

CREATE UNIQUE INDEX IF NOT EXISTS restaurant_tableside_tables_name_per_restaurant_unique
  ON public.restaurant_tableside_tables (restaurant_id, lower(trim(display_name)));

CREATE INDEX IF NOT EXISTS restaurant_tableside_tables_restaurant_id_idx
  ON public.restaurant_tableside_tables (restaurant_id, sort_order, created_at);

COMMENT ON TABLE public.restaurant_tableside_tables IS
  'Fixed tableside self-serve QR definitions; code is immutable, display_name is editable.';

ALTER TABLE public.restaurant_tableside_tables ENABLE ROW LEVEL SECURITY;

CREATE POLICY restaurant_tableside_tables_select_staff
  ON public.restaurant_tableside_tables
  FOR SELECT
  TO authenticated
  USING (
    public.is_platform_admin()
    OR restaurant_id = public.get_my_restaurant_id()
    OR EXISTS (
      SELECT 1 FROM public.restaurants r
      WHERE r.id = restaurant_tableside_tables.restaurant_id
        AND r.owner_id = auth.uid()
    )
  );

-- ── 2. Helpers ────────────────────────────────────────────────────────────────
CREATE OR REPLACE FUNCTION public._tableside_can_manage_restaurant(p_restaurant_id bigint)
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT
    auth.uid() IS NOT NULL
    AND (
      public.is_platform_admin()
      OR p_restaurant_id = public.get_my_restaurant_id()
      OR EXISTS (
        SELECT 1 FROM public.restaurants r
        WHERE r.id = p_restaurant_id AND r.owner_id = auth.uid()
      )
    );
$$;

CREATE OR REPLACE FUNCTION public._normalize_tableside_display_name(p_raw text)
RETURNS text
LANGUAGE plpgsql
IMMUTABLE
AS $$
DECLARE
  v_normalized text;
BEGIN
  v_normalized := trim(regexp_replace(coalesce(p_raw, ''), '\s+', ' ', 'g'));
  IF v_normalized = '' THEN
    RETURN NULL;
  END IF;
  IF length(v_normalized) > 32 THEN
    v_normalized := substring(v_normalized, 1, 32);
  END IF;
  RETURN v_normalized;
END;
$$;

CREATE OR REPLACE FUNCTION public._generate_tableside_code()
RETURNS text
LANGUAGE plpgsql
VOLATILE
SET search_path = public
AS $$
DECLARE
  v_chars  text := 'ABCDEFGHJKLMNPQRSTUVWXYZabcdefghjkmnpqrstuvwxyz23456789';
  v_code   text;
  v_i      integer;
  v_attempt integer := 0;
BEGIN
  LOOP
    v_code := '';
    FOR v_i IN 1..7 LOOP
      v_code := v_code || substr(v_chars, 1 + floor(random() * length(v_chars))::integer, 1);
    END LOOP;
    EXIT WHEN NOT EXISTS (
      SELECT 1 FROM public.restaurant_tableside_tables t WHERE t.code = v_code
    );
    v_attempt := v_attempt + 1;
    IF v_attempt > 64 THEN
      RAISE EXCEPTION 'code_generation_failed' USING ERRCODE = '53000';
    END IF;
  END LOOP;
  RETURN v_code;
END;
$$;

CREATE OR REPLACE FUNCTION public._tableside_table_to_jsonb(p_row public.restaurant_tableside_tables)
RETURNS jsonb
LANGUAGE sql
IMMUTABLE
AS $$
  SELECT jsonb_build_object(
    'id', p_row.id,
    'restaurant_id', p_row.restaurant_id,
    'code', p_row.code,
    'display_name', p_row.display_name,
    'sort_order', p_row.sort_order,
    'created_at', p_row.created_at
  );
$$;

-- ── 3. Resolve by short code (public via edge) ────────────────────────────────
CREATE OR REPLACE FUNCTION public.tableside_resolve_by_code(p_code text)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_code text;
  v_row  public.restaurant_tableside_tables%ROWTYPE;
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

  RETURN public.tableside_resolve_session(v_row.restaurant_id, v_row.display_name);
END;
$$;

REVOKE ALL ON FUNCTION public.tableside_resolve_by_code(text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.tableside_resolve_by_code(text) TO service_role;
GRANT EXECUTE ON FUNCTION public.tableside_resolve_by_code(text) TO anon;
GRANT EXECUTE ON FUNCTION public.tableside_resolve_by_code(text) TO authenticated;

-- ── 4. Partner CRUD RPCs ──────────────────────────────────────────────────────
CREATE OR REPLACE FUNCTION public.list_tableside_tables(p_restaurant_id bigint)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  IF NOT public._tableside_can_manage_restaurant(p_restaurant_id) THEN
    RAISE EXCEPTION 'not_allowed' USING ERRCODE = '42501';
  END IF;

  RETURN COALESCE(
    (
      SELECT jsonb_agg(public._tableside_table_to_jsonb(t) ORDER BY t.sort_order, t.created_at)
      FROM public.restaurant_tableside_tables t
      WHERE t.restaurant_id = p_restaurant_id
    ),
    '[]'::jsonb
  );
END;
$$;

GRANT EXECUTE ON FUNCTION public.list_tableside_tables(bigint) TO authenticated;

CREATE OR REPLACE FUNCTION public.create_tableside_table(
  p_restaurant_id bigint,
  p_display_name  text
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_name text;
  v_row  public.restaurant_tableside_tables%ROWTYPE;
  v_max  constant integer := 200;
  v_count integer;
BEGIN
  IF NOT public._tableside_can_manage_restaurant(p_restaurant_id) THEN
    RAISE EXCEPTION 'not_allowed' USING ERRCODE = '42501';
  END IF;

  v_name := public._normalize_tableside_display_name(p_display_name);
  IF v_name IS NULL THEN
    RAISE EXCEPTION 'display_name_required' USING ERRCODE = '22023';
  END IF;

  SELECT count(*)::integer INTO v_count
    FROM public.restaurant_tableside_tables
    WHERE restaurant_id = p_restaurant_id;
  IF v_count >= v_max THEN
    RAISE EXCEPTION 'table_limit_reached' USING ERRCODE = '22023';
  END IF;

  INSERT INTO public.restaurant_tableside_tables (restaurant_id, code, display_name, sort_order)
  VALUES (p_restaurant_id, public._generate_tableside_code(), v_name, v_count)
  RETURNING * INTO v_row;

  RETURN public._tableside_table_to_jsonb(v_row);
EXCEPTION
  WHEN unique_violation THEN
    RAISE EXCEPTION 'duplicate_display_name' USING ERRCODE = '23505';
END;
$$;

GRANT EXECUTE ON FUNCTION public.create_tableside_table(bigint, text) TO authenticated;

CREATE OR REPLACE FUNCTION public.create_tableside_tables_bulk(
  p_restaurant_id bigint,
  p_names         text[]
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_name   text;
  v_raw    text;
  v_row    public.restaurant_tableside_tables%ROWTYPE;
  v_out    jsonb := '[]'::jsonb;
  v_max    constant integer := 200;
  v_count  integer;
  v_added  integer := 0;
  v_seen   text[] := ARRAY[]::text[];
  v_key    text;
BEGIN
  IF NOT public._tableside_can_manage_restaurant(p_restaurant_id) THEN
    RAISE EXCEPTION 'not_allowed' USING ERRCODE = '42501';
  END IF;

  IF p_names IS NULL OR array_length(p_names, 1) IS NULL THEN
    RETURN '[]'::jsonb;
  END IF;

  SELECT count(*)::integer INTO v_count
    FROM public.restaurant_tableside_tables
    WHERE restaurant_id = p_restaurant_id;

  FOREACH v_raw IN ARRAY p_names LOOP
    v_name := public._normalize_tableside_display_name(v_raw);
    IF v_name IS NULL THEN
      CONTINUE;
    END IF;
    v_key := lower(v_name);
    IF v_key = ANY (v_seen) THEN
      CONTINUE;
    END IF;
    v_seen := array_append(v_seen, v_key);

    IF v_count + v_added >= v_max THEN
      EXIT;
    END IF;

    BEGIN
      INSERT INTO public.restaurant_tableside_tables (restaurant_id, code, display_name, sort_order)
      VALUES (p_restaurant_id, public._generate_tableside_code(), v_name, v_count + v_added)
      RETURNING * INTO v_row;
      v_out := v_out || public._tableside_table_to_jsonb(v_row);
      v_added := v_added + 1;
    EXCEPTION
      WHEN unique_violation THEN
        NULL;
    END;
  END LOOP;

  RETURN v_out;
END;
$$;

GRANT EXECUTE ON FUNCTION public.create_tableside_tables_bulk(bigint, text[]) TO authenticated;

CREATE OR REPLACE FUNCTION public.update_tableside_table_name(
  p_table_id      uuid,
  p_display_name  text
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_name text;
  v_row  public.restaurant_tableside_tables%ROWTYPE;
BEGIN
  v_name := public._normalize_tableside_display_name(p_display_name);
  IF v_name IS NULL THEN
    RAISE EXCEPTION 'display_name_required' USING ERRCODE = '22023';
  END IF;

  SELECT * INTO v_row
    FROM public.restaurant_tableside_tables
    WHERE id = p_table_id;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'table_not_found' USING ERRCODE = 'P0002';
  END IF;

  IF NOT public._tableside_can_manage_restaurant(v_row.restaurant_id) THEN
    RAISE EXCEPTION 'not_allowed' USING ERRCODE = '42501';
  END IF;

  UPDATE public.restaurant_tableside_tables
    SET display_name = v_name
    WHERE id = p_table_id
    RETURNING * INTO v_row;

  RETURN public._tableside_table_to_jsonb(v_row);
EXCEPTION
  WHEN unique_violation THEN
    RAISE EXCEPTION 'duplicate_display_name' USING ERRCODE = '23505';
END;
$$;

GRANT EXECUTE ON FUNCTION public.update_tableside_table_name(uuid, text) TO authenticated;

CREATE OR REPLACE FUNCTION public.delete_tableside_table(p_table_id uuid)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_row public.restaurant_tableside_tables%ROWTYPE;
BEGIN
  SELECT * INTO v_row
    FROM public.restaurant_tableside_tables
    WHERE id = p_table_id;

  IF NOT FOUND THEN
    RETURN;
  END IF;

  IF NOT public._tableside_can_manage_restaurant(v_row.restaurant_id) THEN
    RAISE EXCEPTION 'not_allowed' USING ERRCODE = '42501';
  END IF;

  DELETE FROM public.restaurant_tableside_tables WHERE id = p_table_id;
END;
$$;

GRANT EXECUTE ON FUNCTION public.delete_tableside_table(uuid) TO authenticated;

CREATE OR REPLACE FUNCTION public.delete_all_tableside_tables(p_restaurant_id bigint)
RETURNS integer
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_deleted integer;
BEGIN
  IF NOT public._tableside_can_manage_restaurant(p_restaurant_id) THEN
    RAISE EXCEPTION 'not_allowed' USING ERRCODE = '42501';
  END IF;

  DELETE FROM public.restaurant_tableside_tables
    WHERE restaurant_id = p_restaurant_id;

  GET DIAGNOSTICS v_deleted = ROW_COUNT;
  RETURN v_deleted;
END;
$$;

GRANT EXECUTE ON FUNCTION public.delete_all_tableside_tables(bigint) TO authenticated;
