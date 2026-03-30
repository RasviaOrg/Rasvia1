-- RPCs for auth screen routing: existing account → password, new → sign-up.
-- SECURITY DEFINER required because anon cannot read auth.users or arbitrary profiles.

CREATE OR REPLACE FUNCTION public.account_exists_for_email(p_email text)
RETURNS boolean
LANGUAGE sql
SECURITY DEFINER
SET search_path = public
STABLE
AS $$
  SELECT EXISTS (
    SELECT 1
    FROM auth.users
    WHERE lower(email) = lower(trim(p_email))
  );
$$;

COMMENT ON FUNCTION public.account_exists_for_email(text) IS
  'Whether a Supabase Auth user exists for this email (sign-in vs sign-up routing).';

REVOKE ALL ON FUNCTION public.account_exists_for_email(text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.account_exists_for_email(text) TO anon, authenticated;


CREATE OR REPLACE FUNCTION public.account_exists_for_phone(p_phone_digits text)
RETURNS boolean
LANGUAGE sql
SECURITY DEFINER
SET search_path = public
STABLE
AS $$
  SELECT EXISTS (
    SELECT 1
    FROM public.profiles
    WHERE phone_number = trim(p_phone_digits)
  );
$$;

COMMENT ON FUNCTION public.account_exists_for_phone(text) IS
  'Whether a profile row exists for this 10-digit phone (sign-in vs sign-up routing).';

REVOKE ALL ON FUNCTION public.account_exists_for_phone(text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.account_exists_for_phone(text) TO anon, authenticated;
