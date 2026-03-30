-- Allow platform admins to list all profiles (RasviaWeb admin UI, etc.).
-- Uses SECURITY DEFINER helper so the policy does not subquery profiles under RLS (infinite recursion).

CREATE OR REPLACE FUNCTION public.is_platform_admin()
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT EXISTS (
    SELECT 1 FROM public.profiles
    WHERE id = auth.uid()
      AND COALESCE(lower(trim(role)), '') = 'admin'
  );
$$;

COMMENT ON FUNCTION public.is_platform_admin() IS
  'True if the current user is a platform admin. SECURITY DEFINER avoids RLS recursion when used in policies.';

REVOKE ALL ON FUNCTION public.is_platform_admin() FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.is_platform_admin() TO authenticated;
GRANT EXECUTE ON FUNCTION public.is_platform_admin() TO service_role;

DROP POLICY IF EXISTS "Admins can read all profiles" ON public.profiles;

CREATE POLICY "Admins can read all profiles"
  ON public.profiles
  FOR SELECT
  TO authenticated
  USING (public.is_platform_admin());
