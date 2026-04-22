-- Team role management 403: `restaurant_staff` RLS resolves the caller's
-- "current restaurant" via `get_my_restaurant_id()`, which returns only the
-- first restaurant an owner holds (ORDER BY id ASC LIMIT 1). Owners of more
-- than one restaurant who switched to any other via the dashboard's
-- RestaurantSwitcher failed to insert/update/delete rows whose
-- `restaurant_id` didn't match their "primary" one.
--
-- Rewrite the policies to check ownership / admin-role on the target
-- restaurant_id itself instead of a single session-wide one. Platform admins
-- (profiles.role = 'admin') retain full access.

CREATE OR REPLACE FUNCTION public.can_manage_restaurant_staff(p_restaurant_id bigint)
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
SET row_security = off
AS $$
  SELECT
    auth.uid() IS NOT NULL AND (
      EXISTS (
        SELECT 1 FROM public.restaurants r
        WHERE r.id = p_restaurant_id AND r.owner_id = auth.uid()
      )
      OR EXISTS (
        SELECT 1 FROM public.restaurant_staff rs
        WHERE rs.restaurant_id = p_restaurant_id
          AND rs.user_id = auth.uid()
          AND rs.role IN ('owner','admin')
      )
      OR EXISTS (
        SELECT 1 FROM public.profiles p
        WHERE p.id = auth.uid() AND p.role = 'admin'
      )
    );
$$;

GRANT EXECUTE ON FUNCTION public.can_manage_restaurant_staff(bigint) TO anon, authenticated;

CREATE OR REPLACE FUNCTION public.is_member_of_restaurant(p_restaurant_id bigint)
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
SET row_security = off
AS $$
  SELECT
    auth.uid() IS NOT NULL AND (
      EXISTS (
        SELECT 1 FROM public.restaurants r
        WHERE r.id = p_restaurant_id AND r.owner_id = auth.uid()
      )
      OR EXISTS (
        SELECT 1 FROM public.restaurant_staff rs
        WHERE rs.restaurant_id = p_restaurant_id AND rs.user_id = auth.uid()
      )
      OR EXISTS (
        SELECT 1 FROM public.profiles p
        WHERE p.id = auth.uid() AND p.role = 'admin'
      )
    );
$$;

GRANT EXECUTE ON FUNCTION public.is_member_of_restaurant(bigint) TO anon, authenticated;

DROP POLICY IF EXISTS "Owners can manage staff" ON public.restaurant_staff;
DROP POLICY IF EXISTS "Staff can view restaurant team" ON public.restaurant_staff;

CREATE POLICY "Team members can view their team"
  ON public.restaurant_staff
  FOR SELECT
  TO authenticated
  USING (public.is_member_of_restaurant(restaurant_id));

CREATE POLICY "Owners/admins can add staff"
  ON public.restaurant_staff
  FOR INSERT
  TO authenticated
  WITH CHECK (public.can_manage_restaurant_staff(restaurant_id));

CREATE POLICY "Owners/admins can update staff"
  ON public.restaurant_staff
  FOR UPDATE
  TO authenticated
  USING (public.can_manage_restaurant_staff(restaurant_id))
  WITH CHECK (public.can_manage_restaurant_staff(restaurant_id));

CREATE POLICY "Owners/admins can remove staff"
  ON public.restaurant_staff
  FOR DELETE
  TO authenticated
  USING (public.can_manage_restaurant_staff(restaurant_id));
