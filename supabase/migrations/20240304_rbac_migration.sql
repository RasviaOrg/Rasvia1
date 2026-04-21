-- ============================================================================
-- RBAC Migration: Custom Restaurant Employee Roles & Permissions
-- Run this in your Supabase SQL Editor
-- ============================================================================

-- 1. Create restaurant_roles table
-- Each restaurant can define its own set of roles (FOH, BOH, Manager, etc.)
-- The 'owner' role is auto-created per restaurant and cannot be deleted.
CREATE TABLE IF NOT EXISTS restaurant_roles (
  id          BIGSERIAL PRIMARY KEY,
  restaurant_id BIGINT NOT NULL REFERENCES restaurants(id) ON DELETE CASCADE,
  name        TEXT NOT NULL,
  is_owner    BOOLEAN NOT NULL DEFAULT false,
  created_at  TIMESTAMPTZ NOT NULL DEFAULT now(),

  -- Each restaurant can only have one role with a given name
  UNIQUE (restaurant_id, name)
);

-- 2. Create role_permissions table
-- Maps each role to a set of permission keys (e.g. 'manage_waitlist')
CREATE TABLE IF NOT EXISTS role_permissions (
  id       BIGSERIAL PRIMARY KEY,
  role_id  BIGINT NOT NULL REFERENCES restaurant_roles(id) ON DELETE CASCADE,
  permission TEXT NOT NULL,

  -- Each role can only have a given permission once
  UNIQUE (role_id, permission)
);

-- 3. Add role_id column to restaurant_staff
-- This links each staff member to a role in restaurant_roles
ALTER TABLE restaurant_staff
  ADD COLUMN IF NOT EXISTS role_id BIGINT REFERENCES restaurant_roles(id) ON DELETE SET NULL;

-- ============================================================================
-- 4. Seed: Create an 'owner' role for every existing restaurant
--    and link existing owner/admin staff to it
-- ============================================================================

-- 4a. Insert owner roles for all restaurants that don't already have one
INSERT INTO restaurant_roles (restaurant_id, name, is_owner)
SELECT id, 'Owner', true
FROM restaurants
WHERE id NOT IN (
  SELECT restaurant_id FROM restaurant_roles WHERE is_owner = true
)
ON CONFLICT (restaurant_id, name) DO NOTHING;

-- 4b. Link existing staff with role 'owner' or 'admin' to the new owner role
UPDATE restaurant_staff rs
SET role_id = rr.id
FROM restaurant_roles rr
WHERE rr.restaurant_id = rs.restaurant_id
  AND rr.is_owner = true
  AND rs.role IN ('owner', 'admin')
  AND rs.role_id IS NULL;

-- 4c. Grant all permissions to every owner role
INSERT INTO role_permissions (role_id, permission)
SELECT rr.id, p.permission
FROM restaurant_roles rr
CROSS JOIN (
  VALUES
    ('view_dashboard'),
    ('manage_waitlist'),
    ('view_floorplan'),
    ('manage_tables'),
    ('view_orders'),
    ('manage_orders'),
    ('update_order_status'),
    ('view_menu'),
    ('manage_menu'),
    ('view_settings'),
    ('manage_settings'),
    ('manage_team'),
    ('view_notifications')
) AS p(permission)
WHERE rr.is_owner = true
ON CONFLICT (role_id, permission) DO NOTHING;

-- ============================================================================
-- 5. RLS Policies
-- ============================================================================

ALTER TABLE restaurant_roles ENABLE ROW LEVEL SECURITY;
ALTER TABLE role_permissions ENABLE ROW LEVEL SECURITY;

-- restaurant_roles: staff of the same restaurant can read roles
CREATE POLICY "Staff can view own restaurant roles"
  ON restaurant_roles FOR SELECT
  USING (
    restaurant_id IN (
      SELECT restaurant_id FROM restaurant_staff WHERE user_id = auth.uid()
    )
  );

-- restaurant_roles: only owners can insert/update/delete roles
CREATE POLICY "Owners can manage roles"
  ON restaurant_roles FOR ALL
  USING (
    restaurant_id IN (
      SELECT rs.restaurant_id FROM restaurant_staff rs
      JOIN restaurant_roles rr ON rr.id = rs.role_id
      WHERE rs.user_id = auth.uid() AND rr.is_owner = true
    )
  )
  WITH CHECK (
    restaurant_id IN (
      SELECT rs.restaurant_id FROM restaurant_staff rs
      JOIN restaurant_roles rr ON rr.id = rs.role_id
      WHERE rs.user_id = auth.uid() AND rr.is_owner = true
    )
  );

-- role_permissions: staff of the same restaurant can read permissions
CREATE POLICY "Staff can view role permissions"
  ON role_permissions FOR SELECT
  USING (
    role_id IN (
      SELECT rr.id FROM restaurant_roles rr
      WHERE rr.restaurant_id IN (
        SELECT restaurant_id FROM restaurant_staff WHERE user_id = auth.uid()
      )
    )
  );

-- role_permissions: only owners can insert/update/delete permissions
CREATE POLICY "Owners can manage role permissions"
  ON role_permissions FOR ALL
  USING (
    role_id IN (
      SELECT rr.id FROM restaurant_roles rr
      WHERE rr.restaurant_id IN (
        SELECT rs.restaurant_id FROM restaurant_staff rs
        JOIN restaurant_roles rr2 ON rr2.id = rs.role_id
        WHERE rs.user_id = auth.uid() AND rr2.is_owner = true
      )
    )
  )
  WITH CHECK (
    role_id IN (
      SELECT rr.id FROM restaurant_roles rr
      WHERE rr.restaurant_id IN (
        SELECT rs.restaurant_id FROM restaurant_staff rs
        JOIN restaurant_roles rr2 ON rr2.id = rs.role_id
        WHERE rs.user_id = auth.uid() AND rr2.is_owner = true
      )
    )
  );

-- ============================================================================
-- 6. Indexes for performance
-- ============================================================================

CREATE INDEX IF NOT EXISTS idx_restaurant_roles_restaurant
  ON restaurant_roles(restaurant_id);

CREATE INDEX IF NOT EXISTS idx_role_permissions_role
  ON role_permissions(role_id);

CREATE INDEX IF NOT EXISTS idx_restaurant_staff_role_id
  ON restaurant_staff(role_id);
