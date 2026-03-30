-- Restaurant owners are tied via restaurants.owner_id; they may have no restaurant_staff row.
-- Previous helpers only looked at restaurant_staff, so owners could not SELECT restaurant_staff / roles / team.

CREATE OR REPLACE FUNCTION public.get_my_restaurant_id()
RETURNS bigint
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT COALESCE(
    (SELECT restaurant_id FROM restaurant_staff WHERE user_id = auth.uid() LIMIT 1),
    (SELECT id FROM restaurants WHERE owner_id = auth.uid() LIMIT 1)
  );
$$;

COMMENT ON FUNCTION public.get_my_restaurant_id() IS
  'Restaurant id for the current user: staff assignment, else owned restaurant via owner_id.';

CREATE OR REPLACE FUNCTION public.am_i_restaurant_admin()
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT EXISTS (
    SELECT 1 FROM restaurant_staff
    WHERE user_id = auth.uid()
      AND (role = 'admin' OR role = 'owner')
  )
  OR EXISTS (
    SELECT 1 FROM restaurants WHERE owner_id = auth.uid()
  );
$$;

COMMENT ON FUNCTION public.am_i_restaurant_admin() IS
  'True if user is admin/owner in restaurant_staff OR owns a restaurant row.';

-- Allow owners and same-restaurant staff to read peer profiles (names/emails on team lists).
DROP POLICY IF EXISTS "Team can read peer profiles at restaurant" ON public.profiles;

CREATE POLICY "Team can read peer profiles at restaurant"
  ON public.profiles
  FOR SELECT
  TO authenticated
  USING (
    EXISTS (
      SELECT 1 FROM restaurant_staff rs_target
      WHERE rs_target.user_id = profiles.id
        AND (
          EXISTS (
            SELECT 1 FROM restaurant_staff rs_me
            WHERE rs_me.user_id = auth.uid()
              AND rs_me.restaurant_id = rs_target.restaurant_id
          )
          OR EXISTS (
            SELECT 1 FROM restaurants r
            WHERE r.id = rs_target.restaurant_id
              AND r.owner_id = auth.uid()
          )
        )
    )
  );
