-- RPC to securely lookup the email associated with a phone number for authentication
-- SECURITY DEFINER required because anon cannot read arbitrary profiles due to RLS

CREATE OR REPLACE FUNCTION public.get_email_for_phone(p_phone_digits text)
RETURNS text
LANGUAGE sql
SECURITY DEFINER
SET search_path = public
STABLE
AS $$
  SELECT email
  FROM public.profiles
  WHERE phone_number = trim(p_phone_digits)
  ORDER BY updated_at DESC
  LIMIT 1;
$$;

COMMENT ON FUNCTION public.get_email_for_phone(text) IS
  'Returns the email associated with the given 10-digit phone number. Securely bypasses RLS for the auth login flow. If multiple profiles share the same phone number, it returns the most recently active one.';

REVOKE ALL ON FUNCTION public.get_email_for_phone(text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.get_email_for_phone(text) TO anon, authenticated;
