-- Fix "infinite recursion detected in policy for relation profiles" on UPDATE (e.g. changing name).
-- Cause: policy "users_cannot_change_own_role" used subqueries like
--   (SELECT role FROM profiles WHERE id = auth.uid())
-- Those reads go through RLS on profiles again while evaluating the UPDATE policy.

-- Read role without triggering profiles RLS (SECURITY DEFINER runs as function owner).
CREATE OR REPLACE FUNCTION public.profile_role_for_user(uid uuid)
RETURNS text
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT role::text FROM public.profiles WHERE id = uid LIMIT 1;
$$;

COMMENT ON FUNCTION public.profile_role_for_user(uuid) IS
  'Returns profiles.role for a user; used in RLS WITH CHECK to avoid recursive subqueries on profiles.';

REVOKE ALL ON FUNCTION public.profile_role_for_user(uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.profile_role_for_user(uuid) TO authenticated;
GRANT EXECUTE ON FUNCTION public.profile_role_for_user(uuid) TO service_role;

-- Reuse profile_role_for_user so we do not duplicate EXISTS logic / parens.
CREATE OR REPLACE FUNCTION public.is_platform_admin()
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT COALESCE(lower(trim(public.profile_role_for_user(auth.uid()))), '') = 'admin';
$$;

DROP POLICY IF EXISTS "users_cannot_change_own_role" ON public.profiles;

CREATE POLICY "users_cannot_change_own_role"
  ON public.profiles FOR UPDATE
  USING (
    id = auth.uid()
    OR public.is_platform_admin()
  )
  WITH CHECK (
    (role IS NOT DISTINCT FROM public.profile_role_for_user(auth.uid()))
    OR public.is_platform_admin()
  );
