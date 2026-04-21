-- ============================================================================
-- Walk-in Kiosk: Add source column to waitlist_entries
-- Run this in your Supabase SQL Editor
-- ============================================================================

-- 1. Add source column to waitlist_entries
--    Values: 'walk_in' (kiosk), 'app' (mobile app), 'web' (web join link)
ALTER TABLE waitlist_entries
  ADD COLUMN IF NOT EXISTS source TEXT DEFAULT 'app';

-- 2. Allow anonymous (unauthenticated) inserts from the kiosk
--    The kiosk runs on the restaurant's own iPad with no logged-in user,
--    so we need a permissive INSERT policy for the anon role.
--
--    IMPORTANT: This policy lets anyone insert a waiting entry for ANY restaurant.
--    If you want to restrict to known restaurant IDs only, add a subquery check:
--      WITH CHECK (restaurant_id IN (SELECT id FROM restaurants))
CREATE POLICY IF NOT EXISTS "allow_kiosk_walkin_insert"
  ON waitlist_entries
  FOR INSERT
  TO anon
  WITH CHECK (status = 'waiting' AND source = 'walk_in');

-- 3. (Optional) Also allow anon to read the current wait time from a
--    restaurant_settings table if you add one in the future.

-- Make sure RLS is enabled on waitlist_entries (should already be enabled)
-- ALTER TABLE waitlist_entries ENABLE ROW LEVEL SECURITY;
