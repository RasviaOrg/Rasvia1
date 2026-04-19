-- ============================================================================
-- Menu item numeric spice level
-- ----------------------------------------------------------------------------
-- Historically we only tracked `is_spicy` (boolean), but the client lets
-- owners pick a 0–3 level. The boolean collapses 1/2/3 into a single bucket,
-- so after a refetch the UI reverts to either 0 or 2. Add a numeric
-- `spice_level` column backfilled from the existing boolean and keep both
-- in sync going forward (client writes both).
--
-- CHECK keeps us in the expected domain. `is_spicy` is left in place so
-- any existing reports keep working without migration.
-- ============================================================================

ALTER TABLE public.menu_items
  ADD COLUMN IF NOT EXISTS spice_level smallint NOT NULL DEFAULT 0
    CHECK (spice_level >= 0 AND spice_level <= 3);

-- Back-fill: any row previously flagged spicy lands at level 2 (the
-- client default for "spicy but not extreme"). Rows that were already
-- non-spicy stay at 0.
UPDATE public.menu_items
   SET spice_level = 2
 WHERE is_spicy = true
   AND spice_level = 0;

COMMENT ON COLUMN public.menu_items.spice_level IS
  'Numeric spice intensity 0–3. Mirrors and supersedes is_spicy; kept alongside is_spicy for backwards-compatible reads.';
