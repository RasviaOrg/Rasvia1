-- Allow restaurant owners to manage hours for their own restaurant.
-- This complements existing staff/admin policies.

DROP POLICY IF EXISTS "owner_read_own_restaurant_hours" ON public.restaurant_hours;
CREATE POLICY "owner_read_own_restaurant_hours"
  ON public.restaurant_hours
  FOR SELECT
  USING (
    restaurant_id IN (
      SELECT id
      FROM public.restaurants
      WHERE owner_id = auth.uid()
    )
    OR EXISTS (
      SELECT 1
      FROM public.profiles
      WHERE id = auth.uid() AND role = 'admin'
    )
  );

DROP POLICY IF EXISTS "owner_insert_own_restaurant_hours" ON public.restaurant_hours;
CREATE POLICY "owner_insert_own_restaurant_hours"
  ON public.restaurant_hours
  FOR INSERT
  WITH CHECK (
    restaurant_id IN (
      SELECT id
      FROM public.restaurants
      WHERE owner_id = auth.uid()
    )
    OR EXISTS (
      SELECT 1
      FROM public.profiles
      WHERE id = auth.uid() AND role = 'admin'
    )
  );

DROP POLICY IF EXISTS "owner_delete_own_restaurant_hours" ON public.restaurant_hours;
CREATE POLICY "owner_delete_own_restaurant_hours"
  ON public.restaurant_hours
  FOR DELETE
  USING (
    restaurant_id IN (
      SELECT id
      FROM public.restaurants
      WHERE owner_id = auth.uid()
    )
    OR EXISTS (
      SELECT 1
      FROM public.profiles
      WHERE id = auth.uid() AND role = 'admin'
    )
  );

DROP POLICY IF EXISTS "owner_update_own_restaurant_hours" ON public.restaurant_hours;
CREATE POLICY "owner_update_own_restaurant_hours"
  ON public.restaurant_hours
  FOR UPDATE
  USING (
    restaurant_id IN (
      SELECT id
      FROM public.restaurants
      WHERE owner_id = auth.uid()
    )
    OR EXISTS (
      SELECT 1
      FROM public.profiles
      WHERE id = auth.uid() AND role = 'admin'
    )
  )
  WITH CHECK (
    restaurant_id IN (
      SELECT id
      FROM public.restaurants
      WHERE owner_id = auth.uid()
    )
    OR EXISTS (
      SELECT 1
      FROM public.profiles
      WHERE id = auth.uid() AND role = 'admin'
    )
  );
