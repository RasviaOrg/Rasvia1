-- Prefer the restaurant the user OWNS over a staff assignment.
-- Previously COALESCE(staff, owner) caused owners who still had an old
-- restaurant_staff row (e.g. another venue) to see the wrong venue in the app.

CREATE OR REPLACE FUNCTION public.get_my_restaurant_id()
RETURNS bigint
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
SET row_security = off
AS $$
  SELECT COALESCE(
    (SELECT id FROM public.restaurants WHERE owner_id = auth.uid() ORDER BY id ASC LIMIT 1),
    (SELECT restaurant_id FROM public.restaurant_staff WHERE user_id = auth.uid() ORDER BY restaurant_id ASC LIMIT 1)
  );
$$;

COMMENT ON FUNCTION public.get_my_restaurant_id() IS
  'Restaurant id for the current user: owned venue (owner_id) first, else staff assignment. row_security=off avoids RLS recursion.';
