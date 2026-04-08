-- Community menu image moderation + notifications helpers.
-- These SECURITY DEFINER RPCs bypass app_notifications "insert own" RLS
-- so admins and submitters can both receive notification rows.

CREATE OR REPLACE FUNCTION public.notify_menu_image_submission(
  p_submission_id uuid
)
RETURNS boolean
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_uid uuid := auth.uid();
  v_submission public.community_menu_images;
  v_restaurant_name text;
  v_menu_item_name text;
BEGIN
  IF v_uid IS NULL THEN
    RAISE EXCEPTION 'Authentication required';
  END IF;

  SELECT *
    INTO v_submission
  FROM public.community_menu_images
  WHERE id = p_submission_id
  LIMIT 1;

  IF v_submission.id IS NULL THEN
    RAISE EXCEPTION 'Submission not found';
  END IF;

  IF v_submission.submitted_by IS DISTINCT FROM v_uid THEN
    RAISE EXCEPTION 'Not allowed';
  END IF;

  SELECT r.name, mi.name
    INTO v_restaurant_name, v_menu_item_name
  FROM public.menu_items mi
  INNER JOIN public.restaurants r ON r.id = mi.restaurant_id
  WHERE mi.id = v_submission.menu_item_id
  LIMIT 1;

  INSERT INTO public.app_notifications (user_id, type, title, message, metadata)
  VALUES (
    v_submission.submitted_by,
    'menu_image_submitted',
    'Photo submission received',
    format(
      'Your photo for %s at %s is pending admin review.',
      COALESCE(v_menu_item_name, 'menu item'),
      COALESCE(v_restaurant_name, 'Restaurant')
    ),
    jsonb_build_object(
      'submissionId', v_submission.id,
      'restaurantId', v_submission.restaurant_id,
      'restaurantName', v_restaurant_name,
      'menuItemId', v_submission.menu_item_id,
      'menuItemName', v_menu_item_name
    )
  );

  INSERT INTO public.app_notifications (user_id, type, title, message, metadata)
  SELECT
    p.id,
    'menu_image_request_new',
    'Menu image request',
    format(
      '%s submitted a photo for %s at %s.',
      COALESCE(v_submission.submitter_name, 'A user'),
      COALESCE(v_menu_item_name, 'menu item'),
      COALESCE(v_restaurant_name, 'Restaurant')
    ),
    jsonb_build_object(
      'submissionId', v_submission.id,
      'restaurantId', v_submission.restaurant_id,
      'restaurantName', v_restaurant_name,
      'menuItemId', v_submission.menu_item_id,
      'menuItemName', v_menu_item_name,
      'submitterName', v_submission.submitter_name
    )
  FROM public.profiles p
  WHERE COALESCE(lower(trim(public.profile_role_for_user(p.id))), '') = 'admin';

  RETURN true;
END;
$$;

CREATE OR REPLACE FUNCTION public.review_menu_image_submission(
  p_submission_id uuid,
  p_action text,
  p_note text DEFAULT NULL
)
RETURNS public.community_menu_images
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_uid uuid := auth.uid();
  v_action text := lower(trim(COALESCE(p_action, '')));
  v_clean_note text := NULLIF(trim(COALESCE(p_note, '')), '');
  v_submission public.community_menu_images;
  v_restaurant_name text;
  v_menu_item_name text;
BEGIN
  IF v_uid IS NULL THEN
    RAISE EXCEPTION 'Authentication required';
  END IF;

  IF NOT public.is_platform_admin() THEN
    RAISE EXCEPTION 'Only admins can review menu image submissions';
  END IF;

  IF v_action NOT IN ('approved', 'rejected') THEN
    RAISE EXCEPTION 'Invalid action';
  END IF;

  UPDATE public.community_menu_images
  SET
    status = v_action,
    admin_note = v_clean_note,
    reviewed_at = now(),
    reviewed_by = v_uid
  WHERE id = p_submission_id
  RETURNING * INTO v_submission;

  IF v_submission.id IS NULL THEN
    RAISE EXCEPTION 'Submission not found';
  END IF;

  IF v_action = 'approved' THEN
    UPDATE public.menu_items
    SET image_url = v_submission.image_url
    WHERE id = v_submission.menu_item_id;
  END IF;

  SELECT r.name, mi.name
    INTO v_restaurant_name, v_menu_item_name
  FROM public.menu_items mi
  INNER JOIN public.restaurants r ON r.id = mi.restaurant_id
  WHERE mi.id = v_submission.menu_item_id
  LIMIT 1;

  IF v_submission.submitted_by IS NOT NULL THEN
    INSERT INTO public.app_notifications (user_id, type, title, message, metadata)
    VALUES (
      v_submission.submitted_by,
      CASE WHEN v_action = 'approved' THEN 'menu_image_approved' ELSE 'menu_image_rejected' END,
      CASE WHEN v_action = 'approved' THEN 'Photo approved' ELSE 'Photo declined' END,
      CASE
        WHEN v_action = 'approved' THEN format(
          'Your menu photo for %s at %s was approved.',
          COALESCE(v_menu_item_name, 'menu item'),
          COALESCE(v_restaurant_name, 'Restaurant')
        )
        ELSE format(
          'Your menu photo for %s at %s was declined%s',
          COALESCE(v_menu_item_name, 'menu item'),
          COALESCE(v_restaurant_name, 'Restaurant'),
          CASE WHEN v_clean_note IS NULL THEN '.' ELSE format('. Reason: %s', v_clean_note) END
        )
      END,
      jsonb_build_object(
        'submissionId', v_submission.id,
        'restaurantId', v_submission.restaurant_id,
        'restaurantName', v_restaurant_name,
        'menuItemId', v_submission.menu_item_id,
        'menuItemName', v_menu_item_name,
        'adminNote', v_clean_note
      )
    );
  END IF;

  INSERT INTO public.app_notifications (user_id, type, title, message, metadata)
  SELECT
    p.id,
    CASE WHEN v_action = 'approved' THEN 'menu_image_approved' ELSE 'menu_image_rejected' END,
    CASE WHEN v_action = 'approved' THEN 'Menu image approved' ELSE 'Menu image declined' END,
    CASE
      WHEN v_action = 'approved' THEN format(
        '%s at %s was approved.',
        COALESCE(v_menu_item_name, 'menu item'),
        COALESCE(v_restaurant_name, 'Restaurant')
      )
      ELSE format(
        '%s at %s was declined%s',
        COALESCE(v_menu_item_name, 'menu item'),
        COALESCE(v_restaurant_name, 'Restaurant'),
        CASE WHEN v_clean_note IS NULL THEN '.' ELSE format('. Reason: %s', v_clean_note) END
      )
    END,
    jsonb_build_object(
      'submissionId', v_submission.id,
      'restaurantId', v_submission.restaurant_id,
      'restaurantName', v_restaurant_name,
      'menuItemId', v_submission.menu_item_id,
      'menuItemName', v_menu_item_name,
      'adminNote', v_clean_note
    )
  FROM public.profiles p
  WHERE COALESCE(lower(trim(public.profile_role_for_user(p.id))), '') = 'admin'
    AND p.id <> v_uid;

  RETURN v_submission;
END;
$$;

GRANT EXECUTE ON FUNCTION public.notify_menu_image_submission(uuid) TO authenticated;
GRANT EXECUTE ON FUNCTION public.review_menu_image_submission(uuid, text, text) TO authenticated;
