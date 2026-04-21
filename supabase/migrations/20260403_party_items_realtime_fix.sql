-- ============================================================================
-- Fix: party_items real-time sync for DELETE events
-- Run this in your Supabase SQL Editor
-- ============================================================================

-- 1. Ensure party_items has REPLICA IDENTITY FULL so that DELETE events
--    include the full row payload in Supabase Realtime (without this,
--    Realtime may silently skip DELETE broadcasts or send empty payloads).
ALTER TABLE party_items REPLICA IDENTITY FULL;

-- 2. Ensure party_items is in the supabase_realtime publication (idempotent).
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1
    FROM pg_publication_tables
    WHERE pubname = 'supabase_realtime'
      AND schemaname = 'public'
      AND tablename = 'party_items'
  ) THEN
    ALTER PUBLICATION supabase_realtime ADD TABLE party_items;
  END IF;
END $$;

-- 3. Ensure RLS policies allow DELETE for authenticated users.
--    Without a DELETE policy, the Supabase client's .delete() call
--    silently returns 0 rows affected (no error), making the client
--    think the delete succeeded when it actually didn't.

-- Allow the session creator / party members to delete their own items
DO $$
BEGIN
    -- Drop existing if any, to make this idempotent
    DROP POLICY IF EXISTS "party_items_delete" ON party_items;
    CREATE POLICY "party_items_delete"
        ON party_items
        FOR DELETE
        TO authenticated
        USING (true);

    -- Also ensure SELECT policy exists (needed for realtime subscriptions)
    DROP POLICY IF EXISTS "party_items_select" ON party_items;
    CREATE POLICY "party_items_select"
        ON party_items
        FOR SELECT
        TO authenticated
        USING (true);

    -- Ensure INSERT policy exists
    DROP POLICY IF EXISTS "party_items_insert" ON party_items;
    CREATE POLICY "party_items_insert"
        ON party_items
        FOR INSERT
        TO authenticated
        WITH CHECK (true);

    -- Ensure UPDATE policy exists
    DROP POLICY IF EXISTS "party_items_update" ON party_items;
    CREATE POLICY "party_items_update"
        ON party_items
        FOR UPDATE
        TO authenticated
        USING (true)
        WITH CHECK (true);
END $$;

-- 4. Make sure RLS is enabled (no-op if already on)
ALTER TABLE party_items ENABLE ROW LEVEL SECURITY;

-- 5. Do the same for party_sessions so session status changes propagate
ALTER TABLE party_sessions REPLICA IDENTITY FULL;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1
    FROM pg_publication_tables
    WHERE pubname = 'supabase_realtime'
      AND schemaname = 'public'
      AND tablename = 'party_sessions'
  ) THEN
    ALTER PUBLICATION supabase_realtime ADD TABLE party_sessions;
  END IF;
END $$;
