-- Optional: allow waitlist to be opened N minutes before the first scheduled open (same day).
ALTER TABLE public.restaurants
  ADD COLUMN IF NOT EXISTS waitlist_early_open_enabled boolean NOT NULL DEFAULT false;

ALTER TABLE public.restaurants
  ADD COLUMN IF NOT EXISTS waitlist_early_open_minutes integer NOT NULL DEFAULT 30;

COMMENT ON COLUMN public.restaurants.waitlist_early_open_enabled IS
  'When true, owners may open the waitlist during the window [first_open_today - minutes, first_open_today).';

COMMENT ON COLUMN public.restaurants.waitlist_early_open_minutes IS
  'Minutes before scheduled open that early waitlist is allowed; clamped in app (e.g. 0–720).';

ALTER TABLE public.restaurants
  DROP CONSTRAINT IF EXISTS restaurants_waitlist_early_open_minutes_check;

ALTER TABLE public.restaurants
  ADD CONSTRAINT restaurants_waitlist_early_open_minutes_check
  CHECK (waitlist_early_open_minutes >= 0 AND waitlist_early_open_minutes <= 24 * 60);
