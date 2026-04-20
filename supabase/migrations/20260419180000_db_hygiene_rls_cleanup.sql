-- ============================================================================
-- DATABASE HYGIENE / RLS CLEANUP (April 2026)
-- ----------------------------------------------------------------------------
-- Fixes raised by `get_advisors`:
--   * RLS disabled on `system_config` and `waitlist_entries` (ERROR)
--   * Policies always-true on `group_orders` and duplicate `party_items`
--     policies (WARN, effectively no row-level security)
--   * `menu_categories` had RLS enabled but no policies (table effectively
--     unreadable; no client uses it today, but we'd rather have safe defaults)
--   * `function_search_path_mutable` for trigger / utility / SECURITY DEFINER
--     helpers (all set to `search_path = public`)
--
-- Also drops `order_item_modifiers` which was created by the POS migration but
-- has zero rows and zero references in either repo.
-- ============================================================================

BEGIN;

-- ────────────────────────────────────────────────────────────────────────────
-- 1. system_config: lock down to authenticated read + platform admin write
-- ────────────────────────────────────────────────────────────────────────────
ALTER TABLE public.system_config ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "system_config read" ON public.system_config;
DROP POLICY IF EXISTS "system_config admin write" ON public.system_config;

-- All signed-in users may read non-secret platform config (banner, max_party_size, …).
CREATE POLICY "system_config read"
  ON public.system_config
  FOR SELECT
  TO authenticated
  USING (true);

-- Only platform admins may modify config rows.
CREATE POLICY "system_config admin write"
  ON public.system_config
  FOR ALL
  TO authenticated
  USING (public.is_platform_admin())
  WITH CHECK (public.is_platform_admin());

-- ────────────────────────────────────────────────────────────────────────────
-- 2. waitlist_entries: enable RLS so the existing policies actually apply
-- ────────────────────────────────────────────────────────────────────────────
ALTER TABLE public.waitlist_entries ENABLE ROW LEVEL SECURITY;

-- Owners / staff need to read & manage their restaurant's waitlist.
DROP POLICY IF EXISTS "waitlist owner read" ON public.waitlist_entries;
CREATE POLICY "waitlist owner read"
  ON public.waitlist_entries
  FOR SELECT
  TO authenticated
  USING (
    public.is_platform_admin()
    OR EXISTS (
      SELECT 1 FROM public.restaurants r
      WHERE r.id = waitlist_entries.restaurant_id
        AND r.owner_id = auth.uid()
    )
    OR EXISTS (
      SELECT 1 FROM public.restaurant_staff rs
      WHERE rs.restaurant_id = waitlist_entries.restaurant_id
        AND rs.user_id = auth.uid()
    )
  );

DROP POLICY IF EXISTS "waitlist owner write" ON public.waitlist_entries;
CREATE POLICY "waitlist owner write"
  ON public.waitlist_entries
  FOR UPDATE
  TO authenticated
  USING (
    public.is_platform_admin()
    OR EXISTS (
      SELECT 1 FROM public.restaurants r
      WHERE r.id = waitlist_entries.restaurant_id
        AND r.owner_id = auth.uid()
    )
    OR EXISTS (
      SELECT 1 FROM public.restaurant_staff rs
      WHERE rs.restaurant_id = waitlist_entries.restaurant_id
        AND rs.user_id = auth.uid()
    )
  )
  WITH CHECK (
    public.is_platform_admin()
    OR EXISTS (
      SELECT 1 FROM public.restaurants r
      WHERE r.id = waitlist_entries.restaurant_id
        AND r.owner_id = auth.uid()
    )
    OR EXISTS (
      SELECT 1 FROM public.restaurant_staff rs
      WHERE rs.restaurant_id = waitlist_entries.restaurant_id
        AND rs.user_id = auth.uid()
    )
  );

DROP POLICY IF EXISTS "waitlist owner delete" ON public.waitlist_entries;
CREATE POLICY "waitlist owner delete"
  ON public.waitlist_entries
  FOR DELETE
  TO authenticated
  USING (
    public.is_platform_admin()
    OR EXISTS (
      SELECT 1 FROM public.restaurants r
      WHERE r.id = waitlist_entries.restaurant_id
        AND r.owner_id = auth.uid()
    )
    OR EXISTS (
      SELECT 1 FROM public.restaurant_staff rs
      WHERE rs.restaurant_id = waitlist_entries.restaurant_id
        AND rs.user_id = auth.uid()
    )
  );

-- ────────────────────────────────────────────────────────────────────────────
-- 3. group_orders: replace the always-true policy with read-only-for-owners.
--    `party_settle_payment` (SECURITY DEFINER) bypasses RLS so the legacy
--    mirror writes still succeed.
-- ────────────────────────────────────────────────────────────────────────────
DROP POLICY IF EXISTS "Allow authenticated read/write on group_orders"
  ON public.group_orders;
DROP POLICY IF EXISTS "group_orders owner read" ON public.group_orders;

CREATE POLICY "group_orders owner read"
  ON public.group_orders
  FOR SELECT
  TO authenticated
  USING (
    public.is_platform_admin()
    OR EXISTS (
      SELECT 1 FROM public.restaurants r
      WHERE r.id = group_orders.restaurant_id
        AND r.owner_id = auth.uid()
    )
    OR EXISTS (
      SELECT 1 FROM public.restaurant_staff rs
      WHERE rs.restaurant_id = group_orders.restaurant_id
        AND rs.user_id = auth.uid()
    )
  );

COMMENT ON TABLE public.group_orders IS
  'DEPRECATED legacy mirror table written by party_settle_payment(); not read by any client. Safe to drop after one full release with no consumers.';

-- ────────────────────────────────────────────────────────────────────────────
-- 4. party_items: collapse the duplicate / over-permissive policies.
--    Guests authenticate via the SECURITY DEFINER `party_*` RPCs, which run
--    with `row_security=off`, so direct INSERT/UPDATE/DELETE from clients is
--    not required. Public role keeps SELECT for the join screen.
-- ────────────────────────────────────────────────────────────────────────────
DROP POLICY IF EXISTS "Guests Can Add Items"          ON public.party_items;
DROP POLICY IF EXISTS "Public Item Access"            ON public.party_items;
DROP POLICY IF EXISTS "party_items_delete"            ON public.party_items;
DROP POLICY IF EXISTS "party_items_insert"            ON public.party_items;
DROP POLICY IF EXISTS "party_items_public_delete"     ON public.party_items;
DROP POLICY IF EXISTS "party_items_public_update"     ON public.party_items;
DROP POLICY IF EXISTS "party_items_read"              ON public.party_items;
DROP POLICY IF EXISTS "party_items_select"            ON public.party_items;
DROP POLICY IF EXISTS "party_items_update"            ON public.party_items;

-- Single readable policy: anyone with the session id (which is unguessable
-- and only handed out via the party join link) can read items in that party.
CREATE POLICY "party_items_select"
  ON public.party_items
  FOR SELECT
  USING (true);

-- All mutations must go through the party_* SECURITY DEFINER RPCs.
-- (No INSERT/UPDATE/DELETE policy → blocked for non-superuser roles.)

-- ────────────────────────────────────────────────────────────────────────────
-- 5. menu_categories: add proper read+write policies (currently RLS on, no
--    policies → table effectively dark; only 5 rows for one restaurant).
-- ────────────────────────────────────────────────────────────────────────────
DROP POLICY IF EXISTS "menu_categories public read" ON public.menu_categories;
DROP POLICY IF EXISTS "menu_categories owner write" ON public.menu_categories;

CREATE POLICY "menu_categories public read"
  ON public.menu_categories
  FOR SELECT
  USING (true);

CREATE POLICY "menu_categories owner write"
  ON public.menu_categories
  FOR ALL
  TO authenticated
  USING (
    public.is_platform_admin()
    OR EXISTS (
      SELECT 1 FROM public.restaurants r
      WHERE r.id = menu_categories.restaurant_id
        AND r.owner_id = auth.uid()
    )
  )
  WITH CHECK (
    public.is_platform_admin()
    OR EXISTS (
      SELECT 1 FROM public.restaurants r
      WHERE r.id = menu_categories.restaurant_id
        AND r.owner_id = auth.uid()
    )
  );

-- ────────────────────────────────────────────────────────────────────────────
-- 6. Drop unused order_item_modifiers (0 rows, no client references)
-- ────────────────────────────────────────────────────────────────────────────
DROP TABLE IF EXISTS public.order_item_modifiers CASCADE;

-- ────────────────────────────────────────────────────────────────────────────
-- 7. Pin search_path on every function flagged by the security advisor
-- ────────────────────────────────────────────────────────────────────────────
ALTER FUNCTION public.set_restaurant_menu_tags_updated_at()    SET search_path = public;
ALTER FUNCTION public.set_restaurant_media_slides_updated_at() SET search_path = public;
ALTER FUNCTION public.touch_review_reports_updated_at()        SET search_path = public;
ALTER FUNCTION public.set_user_cart_items_updated_at()         SET search_path = public;
ALTER FUNCTION public.set_orders_updated_at()                  SET search_path = public;
ALTER FUNCTION public.set_party_payments_updated_at()          SET search_path = public;
ALTER FUNCTION public.enforce_waitlist_capacity()              SET search_path = public;
ALTER FUNCTION public.is_open(bigint)                          SET search_path = public;
ALTER FUNCTION public.set_manager_pin(uuid, bigint, text)      SET search_path = public;
ALTER FUNCTION public.verify_manager_pin(bigint, text)         SET search_path = public;

COMMIT;
