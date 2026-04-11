CREATE OR REPLACE FUNCTION public.enforce_waitlist_capacity()
RETURNS trigger
LANGUAGE plpgsql
AS $$
DECLARE
  max_size integer;
  active_count integer;
BEGIN
  IF NEW.status NOT IN ('waiting', 'notified') THEN
    RETURN NEW;
  END IF;

  SELECT COALESCE(r.max_waitlist_size, 15)
    INTO max_size
  FROM public.restaurants r
  WHERE r.id = NEW.restaurant_id;

  IF max_size IS NULL THEN
    max_size := 15;
  END IF;

  SELECT COUNT(*)
    INTO active_count
  FROM public.waitlist_entries w
  WHERE w.restaurant_id = NEW.restaurant_id
    AND w.status IN ('waiting', 'notified')
    AND (TG_OP <> 'UPDATE' OR w.id <> NEW.id);

  IF active_count >= max_size THEN
    RAISE EXCEPTION 'WAITLIST_FULL'
      USING MESSAGE = 'Waitlist is currently full. Please call the restaurant directly.';
  END IF;

  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_enforce_waitlist_capacity ON public.waitlist_entries;

CREATE TRIGGER trg_enforce_waitlist_capacity
BEFORE INSERT OR UPDATE OF status, restaurant_id
ON public.waitlist_entries
FOR EACH ROW
EXECUTE FUNCTION public.enforce_waitlist_capacity();

