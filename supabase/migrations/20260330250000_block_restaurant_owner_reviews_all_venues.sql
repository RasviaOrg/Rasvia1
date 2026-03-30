-- Restaurant owners (profiles.role) cannot leave reviews on any venue, including competitors.
-- Still block reviewing a venue you own via restaurants.owner_id (profile may lag).
-- Uses profile_role_for_user() to avoid subquery recursion on profiles.

DROP POLICY IF EXISTS "reviews_insert_own" ON public.restaurant_reviews;

CREATE POLICY "reviews_insert_own"
  ON public.restaurant_reviews FOR INSERT
  WITH CHECK (
    auth.uid() = user_id
    AND COALESCE(lower(trim(public.profile_role_for_user(auth.uid()))), '') <> 'restaurant_owner'
    AND NOT EXISTS (
      SELECT 1 FROM public.restaurants r
      WHERE r.id = restaurant_id
        AND r.owner_id = auth.uid()
    )
  );
