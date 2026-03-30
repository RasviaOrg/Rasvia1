-- Fix "infinite recursion detected in policy for relation restaurants" on UPDATE (e.g. waitlist).
-- Cause: policies like owner_update_own_restaurant used EXISTS (SELECT … FROM profiles …).
-- That re-entered profiles RLS; "Team can read peer profiles" subqueries restaurants again → loop.
-- Use is_platform_admin() (SECURITY DEFINER + profile_role_for_user) instead of raw profiles reads.
-- Harden profile_role_for_user with row_security=off so role checks never recurse through profiles RLS.

CREATE OR REPLACE FUNCTION public.profile_role_for_user(uid uuid)
RETURNS text
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
SET row_security = off
AS $$
  SELECT role::text FROM public.profiles WHERE id = uid LIMIT 1;
$$;

COMMENT ON FUNCTION public.profile_role_for_user(uuid) IS
  'Returns profiles.role for a user; row_security=off avoids RLS recursion when used from other policies.';

CREATE OR REPLACE FUNCTION public.is_platform_admin()
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT COALESCE(lower(trim(public.profile_role_for_user(auth.uid()))), '') = 'admin';
$$;

COMMENT ON FUNCTION public.is_platform_admin() IS
  'True if the current user is a platform admin. Uses profile_role_for_user with RLS off.';

-- owner / admin UPDATE (waitlist, hours, etc.)
DROP POLICY IF EXISTS "owner_update_own_restaurant" ON public.restaurants;
CREATE POLICY "owner_update_own_restaurant"
  ON public.restaurants FOR UPDATE
  USING (
    owner_id = auth.uid()
    OR public.is_platform_admin()
  )
  WITH CHECK (
    owner_id = auth.uid()
    OR public.is_platform_admin()
  );

-- Admin-only restaurant CRUD (avoid profiles subqueries)
DROP POLICY IF EXISTS "Admins can insert restaurants" ON public.restaurants;
CREATE POLICY "Admins can insert restaurants"
  ON public.restaurants FOR INSERT
  WITH CHECK (public.is_platform_admin());

DROP POLICY IF EXISTS "Admins can update restaurants" ON public.restaurants;
CREATE POLICY "Admins can update restaurants"
  ON public.restaurants FOR UPDATE
  USING (public.is_platform_admin())
  WITH CHECK (public.is_platform_admin());

DROP POLICY IF EXISTS "Admins can delete restaurants" ON public.restaurants;
CREATE POLICY "Admins can delete restaurants"
  ON public.restaurants FOR DELETE
  USING (public.is_platform_admin());

DROP POLICY IF EXISTS "only_admins_insert_restaurants" ON public.restaurants;
CREATE POLICY "only_admins_insert_restaurants"
  ON public.restaurants FOR INSERT
  WITH CHECK (public.is_platform_admin());

DROP POLICY IF EXISTS "only_admins_delete_restaurants" ON public.restaurants;
CREATE POLICY "only_admins_delete_restaurants"
  ON public.restaurants FOR DELETE
  USING (public.is_platform_admin());
