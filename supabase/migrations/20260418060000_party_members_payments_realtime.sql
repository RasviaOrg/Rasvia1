-- ============================================================================
-- Fix: party_members + party_payments realtime sync across platforms
--
-- Symptom: a guest who joins a party_session on the web (RasviaWeb) never
-- appears on the mobile app's live members list (and vice versa) until the
-- viewer manually refreshes the screen. Same for payments.
--
-- Cause: the `party_join_session` / `party_create_payment` RPCs insert the
-- rows correctly, RLS on the tables is `USING (true)`, and both clients
-- subscribe via `supabase.channel(...).on('postgres_changes', { table: 'party_members' })`
-- — but the Supabase Realtime server only relays `postgres_changes` events
-- for tables that are published through the `supabase_realtime` publication.
--
-- `party_items` and `party_sessions` were added to that publication in
-- `20260403_party_items_realtime_fix.sql` (RasviaWeb-only), but
-- `party_members` and `party_payments` were never added. So inserts on those
-- tables are silently invisible to live subscribers.
--
-- This migration:
--   1. Sets REPLICA IDENTITY FULL on party_members and party_payments so DELETE
--      events (e.g. a guest leaving the party) carry the full old row and
--      aren't silently skipped by Realtime.
--   2. Idempotently adds both tables to the supabase_realtime publication.
--   3. Belt-and-suspenders: also ensures party_items and party_sessions are in
--      the publication, in case the Supabase DB was bootstrapped from
--      Rasvia1's migration history alone (which did not include the
--      20260403 RasviaWeb-only fix).
--
-- MIRROR: this file is duplicated byte-for-byte at
--   RasviaWeb/supabase/migrations/20260418060000_party_members_payments_realtime.sql
-- and must stay in sync per AGENTS.md.
-- ============================================================================

-- 1. REPLICA IDENTITY FULL on the missing tables
ALTER TABLE public.party_members  REPLICA IDENTITY FULL;
ALTER TABLE public.party_payments REPLICA IDENTITY FULL;

-- Defensive: also re-apply on the two tables that were already fixed, so the
-- setting is consistent regardless of whether 20260403 ran.
ALTER TABLE public.party_items    REPLICA IDENTITY FULL;
ALTER TABLE public.party_sessions REPLICA IDENTITY FULL;

-- 2. Ensure all four party_* tables are members of the supabase_realtime
--    publication. Each ADD TABLE is gated on pg_publication_tables to keep
--    this migration idempotent.
DO $$
DECLARE
  v_table text;
BEGIN
  FOREACH v_table IN ARRAY ARRAY[
    'party_sessions',
    'party_members',
    'party_items',
    'party_payments'
  ] LOOP
    IF NOT EXISTS (
      SELECT 1
      FROM pg_publication_tables
      WHERE pubname    = 'supabase_realtime'
        AND schemaname = 'public'
        AND tablename  = v_table
    ) THEN
      EXECUTE format(
        'ALTER PUBLICATION supabase_realtime ADD TABLE public.%I',
        v_table
      );
    END IF;
  END LOOP;
END $$;
