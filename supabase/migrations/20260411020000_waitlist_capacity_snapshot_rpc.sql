CREATE OR REPLACE FUNCTION public.get_waitlist_capacity_snapshot(p_restaurant_id bigint)
RETURNS TABLE (max_waitlist_size integer, active_count integer)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  RETURN QUERY
  SELECT
    COALESCE(r.max_waitlist_size, 15) AS max_waitlist_size,
    (
      SELECT COUNT(*)::integer
      FROM public.waitlist_entries w
      WHERE w.restaurant_id = p_restaurant_id
        AND w.status IN ('waiting', 'notified')
    ) AS active_count
  FROM public.restaurants r
  WHERE r.id = p_restaurant_id;
END;
$$;

REVOKE ALL ON FUNCTION public.get_waitlist_capacity_snapshot(bigint) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.get_waitlist_capacity_snapshot(bigint) TO authenticated;
