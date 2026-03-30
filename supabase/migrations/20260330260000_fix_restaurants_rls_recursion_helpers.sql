-- UPDATE on restaurants evaluates every permissive UPDATE policy (OR). "Staff can update own
-- restaurant" subqueries restaurant_staff; those RLS policies use get_my_restaurant_id(), which
-- SELECTs restaurants under RLS. Restaurants SELECT policies include "Staff can see own restaurant",
-- which subqueries restaurant_staff again → infinite recursion on "restaurants".
-- SET row_security = off lets these SECURITY DEFINER helpers read staff/ownership rows without
-- re-entering RLS (same idea as is_platform_admin for profiles).

CREATE OR REPLACE FUNCTION public.get_my_restaurant_id()
RETURNS bigint
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
SET row_security = off
AS $$
  SELECT COALESCE(
    (SELECT restaurant_id FROM restaurant_staff WHERE user_id = auth.uid() LIMIT 1),
    (SELECT id FROM restaurants WHERE owner_id = auth.uid() LIMIT 1)
  );
$$;

COMMENT ON FUNCTION public.get_my_restaurant_id() IS
  'Restaurant id for the current user: staff assignment, else owned restaurant via owner_id. row_security=off avoids RLS recursion.';

CREATE OR REPLACE FUNCTION public.am_i_restaurant_admin()
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
SET row_security = off
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
  'True if user is admin/owner in restaurant_staff OR owns a restaurant row. row_security=off avoids RLS recursion.';
