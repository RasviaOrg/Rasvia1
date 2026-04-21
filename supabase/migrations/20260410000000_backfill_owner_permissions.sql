-- ============================================================================
-- Backfill missing permissions for owner roles
--
-- The original RBAC migration (20240304) only seeded 13 permissions.
-- Nine permissions added later (POS, KDS, reports, etc.) were never added
-- to existing owner roles. This migration backfills them.
-- ============================================================================

INSERT INTO role_permissions (role_id, permission)
SELECT rr.id, p.permission
FROM restaurant_roles rr
CROSS JOIN (
  VALUES
    ('access_pos'),
    ('void_items'),
    ('apply_discounts'),
    ('manage_shifts'),
    ('view_reports'),
    ('manage_modifiers'),
    ('transfer_tables'),
    ('access_kds'),
    ('access_kiosk')
) AS p(permission)
WHERE rr.is_owner = true
ON CONFLICT (role_id, permission) DO NOTHING;
