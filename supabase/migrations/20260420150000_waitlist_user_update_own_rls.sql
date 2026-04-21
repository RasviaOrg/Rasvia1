-- Allow diners to update (e.g. cancel) their own waitlist row. After RLS was
-- enabled with only owner/staff write policies, clients could INSERT and SELECT
-- but not UPDATE — leaving the queue from the app silently failed.

BEGIN;

DROP POLICY IF EXISTS "Users update own waitlist entry" ON public.waitlist_entries;

CREATE POLICY "Users update own waitlist entry"
  ON public.waitlist_entries
  FOR UPDATE
  TO authenticated
  USING (auth.uid() = user_id)
  WITH CHECK (auth.uid() = user_id);

COMMIT;
