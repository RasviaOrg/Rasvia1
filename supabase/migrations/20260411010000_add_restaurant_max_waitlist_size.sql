ALTER TABLE public.restaurants
  ADD COLUMN IF NOT EXISTS max_waitlist_size integer NOT NULL DEFAULT 15;

COMMENT ON COLUMN public.restaurants.max_waitlist_size IS
  'Maximum active waitlist parties allowed at this restaurant before new joins are blocked.';

ALTER TABLE public.restaurants
  DROP CONSTRAINT IF EXISTS restaurants_max_waitlist_size_check;

ALTER TABLE public.restaurants
  ADD CONSTRAINT restaurants_max_waitlist_size_check
  CHECK (max_waitlist_size >= 1 AND max_waitlist_size <= 200);

