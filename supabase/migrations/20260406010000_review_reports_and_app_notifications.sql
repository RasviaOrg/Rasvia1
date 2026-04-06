-- Review moderation workflows for owner/admin + cross-account app notifications.

CREATE TABLE IF NOT EXISTS public.app_notifications (
  id bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  user_id uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  type text NOT NULL,
  title text NOT NULL DEFAULT '',
  message text,
  metadata jsonb NOT NULL DEFAULT '{}'::jsonb,
  read_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS app_notifications_user_created_idx
  ON public.app_notifications (user_id, created_at DESC);

CREATE INDEX IF NOT EXISTS app_notifications_user_unread_idx
  ON public.app_notifications (user_id)
  WHERE read_at IS NULL;

ALTER TABLE public.app_notifications ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "app_notifications_select_own" ON public.app_notifications;
CREATE POLICY "app_notifications_select_own"
  ON public.app_notifications FOR SELECT
  TO authenticated
  USING (auth.uid() = user_id);

DROP POLICY IF EXISTS "app_notifications_insert_own" ON public.app_notifications;
CREATE POLICY "app_notifications_insert_own"
  ON public.app_notifications FOR INSERT
  TO authenticated
  WITH CHECK (auth.uid() = user_id);

DROP POLICY IF EXISTS "app_notifications_update_own" ON public.app_notifications;
CREATE POLICY "app_notifications_update_own"
  ON public.app_notifications FOR UPDATE
  TO authenticated
  USING (auth.uid() = user_id)
  WITH CHECK (auth.uid() = user_id);

DROP POLICY IF EXISTS "app_notifications_delete_own" ON public.app_notifications;
CREATE POLICY "app_notifications_delete_own"
  ON public.app_notifications FOR DELETE
  TO authenticated
  USING (auth.uid() = user_id);

CREATE TABLE IF NOT EXISTS public.review_reports (
  id bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  review_id bigint NOT NULL REFERENCES public.restaurant_reviews(id) ON DELETE CASCADE,
  restaurant_id bigint NOT NULL REFERENCES public.restaurants(id) ON DELETE CASCADE,
  owner_user_id uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  status text NOT NULL DEFAULT 'pending'
    CHECK (status IN ('pending', 'declined')),
  reason text,
  admin_message text,
  reviewed_by uuid REFERENCES auth.users(id) ON DELETE SET NULL,
  reviewed_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS review_reports_restaurant_idx
  ON public.review_reports (restaurant_id, created_at DESC);

CREATE INDEX IF NOT EXISTS review_reports_owner_idx
  ON public.review_reports (owner_user_id, created_at DESC);

CREATE INDEX IF NOT EXISTS review_reports_status_idx
  ON public.review_reports (status, created_at DESC);

CREATE UNIQUE INDEX IF NOT EXISTS review_reports_one_pending_idx
  ON public.review_reports (review_id, owner_user_id)
  WHERE status = 'pending';

CREATE OR REPLACE FUNCTION public.touch_review_reports_updated_at()
RETURNS trigger
LANGUAGE plpgsql
AS $$
BEGIN
  NEW.updated_at = now();
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_review_reports_updated_at ON public.review_reports;
CREATE TRIGGER trg_review_reports_updated_at
BEFORE UPDATE ON public.review_reports
FOR EACH ROW
EXECUTE FUNCTION public.touch_review_reports_updated_at();

ALTER TABLE public.review_reports ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "review_reports_select_owner_or_admin" ON public.review_reports;
CREATE POLICY "review_reports_select_owner_or_admin"
  ON public.review_reports FOR SELECT
  TO authenticated
  USING (
    owner_user_id = auth.uid()
    OR public.is_platform_admin()
  );

DROP POLICY IF EXISTS "review_reports_insert_owner" ON public.review_reports;
CREATE POLICY "review_reports_insert_owner"
  ON public.review_reports FOR INSERT
  TO authenticated
  WITH CHECK (
    auth.uid() = owner_user_id
    AND EXISTS (
      SELECT 1
      FROM public.restaurant_reviews rr
      INNER JOIN public.restaurants r ON r.id = rr.restaurant_id
      WHERE rr.id = review_id
        AND rr.restaurant_id = restaurant_id
        AND r.owner_id = auth.uid()
    )
  );

DROP POLICY IF EXISTS "review_reports_update_admin_only" ON public.review_reports;
CREATE POLICY "review_reports_update_admin_only"
  ON public.review_reports FOR UPDATE
  TO authenticated
  USING (public.is_platform_admin())
  WITH CHECK (public.is_platform_admin());

DROP POLICY IF EXISTS "review_reports_delete_admin_only" ON public.review_reports;
CREATE POLICY "review_reports_delete_admin_only"
  ON public.review_reports FOR DELETE
  TO authenticated
  USING (public.is_platform_admin());

CREATE OR REPLACE FUNCTION public.submit_review_report(
  p_review_id bigint,
  p_reason text DEFAULT NULL
)
RETURNS public.review_reports
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_uid uuid := auth.uid();
  v_existing public.review_reports;
  v_inserted public.review_reports;
  v_restaurant_id bigint;
  v_restaurant_name text;
  v_rating smallint;
  v_owner_name text;
  v_clean_reason text;
BEGIN
  IF v_uid IS NULL THEN
    RAISE EXCEPTION 'Authentication required';
  END IF;

  SELECT rr.restaurant_id, rr.rating, r.name
    INTO v_restaurant_id, v_rating, v_restaurant_name
  FROM public.restaurant_reviews rr
  INNER JOIN public.restaurants r ON r.id = rr.restaurant_id
  WHERE rr.id = p_review_id
  LIMIT 1;

  IF v_restaurant_id IS NULL THEN
    RAISE EXCEPTION 'Review not found';
  END IF;

  IF NOT EXISTS (
    SELECT 1
    FROM public.restaurants r
    WHERE r.id = v_restaurant_id
      AND r.owner_id = v_uid
  ) THEN
    RAISE EXCEPTION 'Only the restaurant owner can report this review';
  END IF;

  SELECT *
    INTO v_existing
  FROM public.review_reports
  WHERE review_id = p_review_id
    AND owner_user_id = v_uid
    AND status = 'pending'
  LIMIT 1;

  IF v_existing.id IS NOT NULL THEN
    RETURN v_existing;
  END IF;

  v_clean_reason := NULLIF(trim(COALESCE(p_reason, '')), '');

  INSERT INTO public.review_reports (
    review_id,
    restaurant_id,
    owner_user_id,
    status,
    reason
  ) VALUES (
    p_review_id,
    v_restaurant_id,
    v_uid,
    'pending',
    v_clean_reason
  )
  RETURNING * INTO v_inserted;

  SELECT COALESCE(NULLIF(trim(full_name), ''), email, 'Restaurant Owner')
    INTO v_owner_name
  FROM public.profiles
  WHERE id = v_uid
  LIMIT 1;

  v_owner_name := COALESCE(v_owner_name, 'Restaurant Owner');

  INSERT INTO public.app_notifications (user_id, type, title, message, metadata)
  VALUES (
    v_uid,
    'review_report_submitted',
    'Review report submitted',
    format(
      'You reported a %s-star review at %s. Admins will review it soon.',
      v_rating,
      COALESCE(v_restaurant_name, 'your restaurant')
    ),
    jsonb_build_object(
      'reportId', v_inserted.id,
      'reviewId', p_review_id,
      'restaurantId', v_restaurant_id,
      'restaurantName', v_restaurant_name,
      'rating', v_rating,
      'reason', v_clean_reason
    )
  );

  INSERT INTO public.app_notifications (user_id, type, title, message, metadata)
  SELECT
    p.id,
    'review_report_new',
    'New review report',
    format(
      '%s reported a %s-star review at %s.',
      v_owner_name,
      v_rating,
      COALESCE(v_restaurant_name, 'restaurant')
    ),
    jsonb_build_object(
      'reportId', v_inserted.id,
      'reviewId', p_review_id,
      'restaurantId', v_restaurant_id,
      'restaurantName', v_restaurant_name,
      'rating', v_rating,
      'ownerUserId', v_uid,
      'ownerName', v_owner_name,
      'reason', v_clean_reason
    )
  FROM public.profiles p
  WHERE COALESCE(lower(trim(public.profile_role_for_user(p.id))), '') = 'admin';

  RETURN v_inserted;
END;
$$;

CREATE OR REPLACE FUNCTION public.decline_review_report(
  p_report_id bigint,
  p_message text DEFAULT NULL
)
RETURNS public.review_reports
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_uid uuid := auth.uid();
  v_report public.review_reports;
  v_restaurant_name text;
  v_rating smallint;
  v_clean_message text;
BEGIN
  IF v_uid IS NULL THEN
    RAISE EXCEPTION 'Authentication required';
  END IF;

  IF NOT public.is_platform_admin() THEN
    RAISE EXCEPTION 'Only admins can decline review reports';
  END IF;

  v_clean_message := NULLIF(trim(COALESCE(p_message, '')), '');

  UPDATE public.review_reports
  SET
    status = 'declined',
    admin_message = v_clean_message,
    reviewed_by = v_uid,
    reviewed_at = now()
  WHERE id = p_report_id
  RETURNING * INTO v_report;

  IF v_report.id IS NULL THEN
    RAISE EXCEPTION 'Review report not found';
  END IF;

  SELECT r.name, rr.rating
    INTO v_restaurant_name, v_rating
  FROM public.restaurant_reviews rr
  INNER JOIN public.restaurants r ON r.id = rr.restaurant_id
  WHERE rr.id = v_report.review_id
  LIMIT 1;

  INSERT INTO public.app_notifications (user_id, type, title, message, metadata)
  VALUES (
    v_report.owner_user_id,
    'review_report_declined',
    'Review report declined',
    COALESCE(
      format(
        'Your report for a %s-star review at %s was declined. Reason: %s',
        v_rating,
        COALESCE(v_restaurant_name, 'your restaurant'),
        v_clean_message
      ),
      format(
        'Your report for a %s-star review at %s was declined.',
        v_rating,
        COALESCE(v_restaurant_name, 'your restaurant')
      )
    ),
    jsonb_build_object(
      'reportId', v_report.id,
      'reviewId', v_report.review_id,
      'restaurantId', v_report.restaurant_id,
      'restaurantName', v_restaurant_name,
      'rating', v_rating,
      'adminMessage', v_clean_message,
      'resolvedBy', v_uid,
      'resolution', 'declined'
    )
  );

  RETURN v_report;
END;
$$;

CREATE OR REPLACE FUNCTION public.delete_review_report(
  p_report_id bigint
)
RETURNS boolean
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_uid uuid := auth.uid();
  v_report public.review_reports;
  v_restaurant_name text;
  v_rating smallint;
BEGIN
  IF v_uid IS NULL THEN
    RAISE EXCEPTION 'Authentication required';
  END IF;

  IF NOT public.is_platform_admin() THEN
    RAISE EXCEPTION 'Only admins can delete review reports';
  END IF;

  SELECT *
    INTO v_report
  FROM public.review_reports
  WHERE id = p_report_id
  LIMIT 1;

  IF v_report.id IS NULL THEN
    RETURN false;
  END IF;

  SELECT r.name, rr.rating
    INTO v_restaurant_name, v_rating
  FROM public.restaurant_reviews rr
  INNER JOIN public.restaurants r ON r.id = rr.restaurant_id
  WHERE rr.id = v_report.review_id
  LIMIT 1;

  DELETE FROM public.review_reports
  WHERE id = p_report_id;

  INSERT INTO public.app_notifications (user_id, type, title, message, metadata)
  VALUES (
    v_report.owner_user_id,
    'review_report_deleted',
    'Review report closed',
    format(
      'Your report for a %s-star review at %s was removed by admin.',
      v_rating,
      COALESCE(v_restaurant_name, 'your restaurant')
    ),
    jsonb_build_object(
      'reportId', v_report.id,
      'reviewId', v_report.review_id,
      'restaurantId', v_report.restaurant_id,
      'restaurantName', v_restaurant_name,
      'rating', v_rating,
      'resolvedBy', v_uid,
      'resolution', 'deleted'
    )
  );

  RETURN true;
END;
$$;

GRANT EXECUTE ON FUNCTION public.submit_review_report(bigint, text) TO authenticated;
GRANT EXECUTE ON FUNCTION public.decline_review_report(bigint, text) TO authenticated;
GRANT EXECUTE ON FUNCTION public.delete_review_report(bigint) TO authenticated;
