-- Ensure restaurant owners can update their own restaurant row.
-- This covers name/address/description and lat/long updates from the app.

DROP POLICY IF EXISTS "owner_update_own_restaurant" ON public.restaurants;
CREATE POLICY "owner_update_own_restaurant"
  ON public.restaurants
  FOR UPDATE
  USING (
    owner_id = auth.uid()
    OR EXISTS (
      SELECT 1
      FROM public.profiles
      WHERE id = auth.uid() AND role = 'admin'
    )
  )
  WITH CHECK (
    owner_id = auth.uid()
    OR EXISTS (
      SELECT 1
      FROM public.profiles
      WHERE id = auth.uid() AND role = 'admin'
    )
  );
